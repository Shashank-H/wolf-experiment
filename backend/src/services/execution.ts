import { and, desc, eq } from 'drizzle-orm';
import { db } from '../db/client';
import { approvalRequests, gttCandidates, gttOrders, marketSnapshots, orderEvents, orders, userSettings } from '../db/schema';
import { audit } from '../utils/audit';
import { kiteAdapterForUser, upsertKiteBrokerAccount } from './broker-sync';
import { parseOrderDraft } from './risk';

const activeGttStatuses = ['created', 'submitted', 'active', 'open'];

export async function listGttState(userId: string) {
  const [candidates, active] = await Promise.all([
    db.select().from(gttCandidates).where(eq(gttCandidates.userId, userId)).orderBy(desc(gttCandidates.createdAt)),
    db.select().from(gttOrders).where(eq(gttOrders.userId, userId)).orderBy(desc(gttOrders.createdAt)),
  ]);
  const adapter = await kiteAdapterForUser(userId);
  const brokerGtts = adapter ? await adapter.getGtts().catch(() => []) : [];
  return { candidates, gttOrders: active, brokerGtts };
}

export async function approveGttCandidate(userId: string, candidateId: string) {
  await assertLiveTradingAllowed(userId);
  const [candidate] = await db.select().from(gttCandidates).where(and(eq(gttCandidates.userId, userId), eq(gttCandidates.id, candidateId))).limit(1);
  if (!candidate) return null;
  if (!['draft', 'proposed', 'pending', 'rejected'].includes(candidate.status)) throw new Error(`GTT candidate with status ${candidate.status} cannot be approved`);

  const idempotencyKey = `gtt-candidate:${candidate.id}:v1`;
  const existing = await findExistingGtt(userId, idempotencyKey);
  if (existing) return { candidate, gttOrder: existing, idempotent: true };

  const triggerPrice = Number(candidate.triggerPrice ?? 0);
  const limitPrice = Number(candidate.limitPrice ?? candidate.triggerPrice ?? 0);
  if (!Number.isFinite(triggerPrice) || triggerPrice <= 0) throw new Error('GTT trigger price is required before broker placement');
  if (!Number.isFinite(limitPrice) || limitPrice <= 0) throw new Error('GTT limit price is required before broker placement');

  const adapter = await kiteAdapterForUser(userId);
  if (!adapter) throw new Error('Kite API key and access token are required before GTT placement');
  const account = await upsertKiteBrokerAccount(userId, adapter);
  const lastPrice = await getLastPrice(userId, candidate.exchange, candidate.tradingsymbol, triggerPrice);
  const brokerResult = await adapter.createGtt({
    exchange: candidate.exchange,
    tradingsymbol: candidate.tradingsymbol,
    triggerValues: [triggerPrice],
    lastPrice,
    orders: [{
      exchange: candidate.exchange,
      tradingsymbol: candidate.tradingsymbol,
      transaction_type: candidate.transactionType,
      quantity: candidate.quantity,
      order_type: 'LIMIT',
      product: 'CNC',
      price: limitPrice,
    }],
  });

  const [gttOrder] = await db.insert(gttOrders).values({
    userId,
    brokerAccountId: account.id,
    gttCandidateId: candidate.id,
    brokerGttId: brokerResult.gttId,
    idempotencyKey,
    exchange: candidate.exchange,
    tradingsymbol: candidate.tradingsymbol,
    transactionType: candidate.transactionType,
    triggerPrice: String(triggerPrice),
    limitPrice: String(limitPrice),
    quantity: candidate.quantity,
    status: brokerResult.status ?? 'submitted',
    statusMessage: 'Placed through Kite GTT',
    raw: brokerResult.raw as Record<string, unknown>,
    placedAt: new Date(),
  }).returning();
  const [updatedCandidate] = await db.update(gttCandidates).set({ status: 'placed', updatedAt: new Date() }).where(eq(gttCandidates.id, candidate.id)).returning();
  await audit('gtt.approve.place', { userId, entityType: 'gtt_candidate', entityId: candidate.id, metadata: { brokerGttId: brokerResult.gttId, gttOrderId: gttOrder.id } });
  return { candidate: updatedCandidate, gttOrder, idempotent: false };
}

export async function rejectGttCandidate(userId: string, candidateId: string, note?: string) {
  const [candidate] = await db.update(gttCandidates).set({ status: 'rejected', updatedAt: new Date() }).where(and(eq(gttCandidates.userId, userId), eq(gttCandidates.id, candidateId))).returning();
  if (!candidate) return null;
  await audit('gtt.reject', { userId, entityType: 'gtt_candidate', entityId: candidate.id, metadata: { note } });
  return candidate;
}

export async function cancelGtt(userId: string, id: string) {
  await assertLiveTradingAllowed(userId);
  const [gtt] = await db.select().from(gttOrders).where(and(eq(gttOrders.userId, userId), eq(gttOrders.id, id))).limit(1);
  if (!gtt) return null;
  if (!activeGttStatuses.includes(gtt.status)) throw new Error(`GTT status ${gtt.status} cannot be cancelled`);
  if (gtt.brokerGttId) {
    const adapter = await kiteAdapterForUser(userId);
    if (!adapter) throw new Error('Kite API key and access token are required before broker cancellation can be submitted');
    await adapter.cancelGtt({ gttId: gtt.brokerGttId });
  }
  const [updated] = await db.update(gttOrders).set({ status: 'cancel_requested', statusMessage: 'Cancel submitted by user', cancelledAt: new Date(), updatedAt: new Date() }).where(eq(gttOrders.id, gtt.id)).returning();
  await audit('gtt.cancel.request', { userId, entityType: 'gtt_order', entityId: gtt.id, metadata: { brokerGttId: gtt.brokerGttId } });
  return updated;
}

export async function executeApprovedOrderFromApproval(userId: string, approvalId: string) {
  await assertLiveTradingAllowed(userId);
  const [approval] = await db.select().from(approvalRequests).where(and(eq(approvalRequests.userId, userId), eq(approvalRequests.id, approvalId))).limit(1);
  if (!approval) return null;
  const orderDraft = parseOrderDraft(approval.payload);
  const idempotencyKey = `approval:${approval.id}:place_order:v1`;
  const [existing] = await db.select().from(orders).where(and(eq(orders.userId, userId), eq(orders.idempotencyKey, idempotencyKey))).limit(1);
  if (existing) return { order: existing, idempotent: true };

  const adapter = await kiteAdapterForUser(userId);
  if (!adapter) throw new Error('Kite API key and access token are required before broker order placement');
  const account = await upsertKiteBrokerAccount(userId, adapter);
  const [created] = await db.insert(orders).values({
    userId,
    brokerAccountId: account.id,
    idempotencyKey,
    exchange: orderDraft.exchange,
    tradingsymbol: orderDraft.tradingsymbol,
    transactionType: orderDraft.transactionType,
    product: orderDraft.product,
    orderType: orderDraft.orderType,
    quantity: String(orderDraft.quantity),
    status: 'submitting',
    raw: { source: 'approval', approvalId },
  } as any).returning();
  await db.insert(orderEvents).values({ userId, orderId: created.id, eventType: 'submit_started', message: 'Broker order submission started from approved request', raw: { approvalId } });

  try {
    const result = await adapter.placeOrder({ ...orderDraft, tag: `wolf-${approval.id.slice(0, 12)}` });
    const [updated] = await db.update(orders).set({ brokerOrderId: result.orderId, status: result.status ?? 'submitted', raw: result.raw as Record<string, unknown>, placedAt: new Date(), updatedAt: new Date() }).where(eq(orders.id, created.id)).returning();
    await db.insert(orderEvents).values({ userId, orderId: created.id, eventType: 'submitted', brokerStatus: result.status, message: 'Broker accepted order submission', raw: result.raw as Record<string, unknown> });
    await audit('order.execute.approval', { userId, entityType: 'order', entityId: updated.id, metadata: { approvalId, brokerOrderId: result.orderId } });
    return { order: updated, idempotent: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Broker order placement failed';
    const [failed] = await db.update(orders).set({ status: 'failed', statusMessage: message, updatedAt: new Date() }).where(eq(orders.id, created.id)).returning();
    await db.insert(orderEvents).values({ userId, orderId: created.id, eventType: 'submit_failed', message, raw: { approvalId } });
    throw Object.assign(new Error(message), { order: failed });
  }
}

async function assertLiveTradingAllowed(userId: string) {
  const [settings] = await db.select().from(userSettings).where(eq(userSettings.userId, userId)).limit(1);
  if (settings?.dryRunModeEnabled) throw new Error('Global dry-run mode is enabled; broker placement is blocked');
  if (settings?.killSwitchEnabled) throw new Error('Kill switch is enabled; broker placement is blocked');
}

async function findExistingGtt(userId: string, idempotencyKey: string) {
  const [existing] = await db.select().from(gttOrders).where(and(eq(gttOrders.userId, userId), eq(gttOrders.idempotencyKey, idempotencyKey))).limit(1);
  return existing ?? null;
}

async function getLastPrice(userId: string, exchange: string, tradingsymbol: string, fallback: number) {
  const [snapshot] = await db.select().from(marketSnapshots).where(and(eq(marketSnapshots.userId, userId), eq(marketSnapshots.exchange, exchange), eq(marketSnapshots.tradingsymbol, tradingsymbol))).orderBy(desc(marketSnapshots.capturedAt)).limit(1);
  const price = Number(snapshot?.lastPrice ?? fallback);
  return Number.isFinite(price) && price > 0 ? price : fallback;
}
