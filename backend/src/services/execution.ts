import { and, desc, eq, lt } from 'drizzle-orm';
import { db } from '../db/client';
import { approvalRequests, gttCandidates, gttOrders, marketSnapshots, orderEvents, orders, tradingPreferences, userSettings } from '../db/schema';
import { audit } from '../utils/audit';
import { kiteAdapterForUser, upsertKiteBrokerAccount } from './broker-sync';
import { parseOrderDraft } from './risk';

const activeGttStatuses = ['created', 'submitted', 'active', 'open'];
const staleGttAgeMs = 2 * 24 * 60 * 60 * 1000;
const maxPriceDriftPct = 5;

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

export async function revalidateGtts(userId: string) {
  const active = await db.select().from(gttOrders).where(eq(gttOrders.userId, userId)).orderBy(desc(gttOrders.createdAt));
  const candidates = await db.select().from(gttCandidates).where(eq(gttCandidates.userId, userId));
  const candidatesById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const [settings] = await db.select().from(userSettings).where(eq(userSettings.userId, userId)).limit(1);
  const [prefs] = await db.select().from(tradingPreferences).where(eq(tradingPreferences.userId, userId)).limit(1);
  const now = new Date();
  const staleBefore = new Date(now.getTime() - staleGttAgeMs);
  const results = [];

  for (const gtt of active.filter((item) => activeGttStatuses.includes(item.status))) {
    const candidate = gtt.gttCandidateId ? candidatesById.get(gtt.gttCandidateId) : undefined;
    const raw = { ...(candidate?.raw ?? {}), ...(gtt.raw ?? {}) } as Record<string, unknown>;
    const latest = await getLastMarketSnapshot(userId, gtt.exchange, gtt.tradingsymbol);
    const triggerPrice = Number(gtt.triggerPrice ?? 0);
    const lastPrice = Number(latest?.lastPrice ?? 0);
    const reasons: string[] = [];

    if (gtt.createdAt < staleBefore) reasons.push('stale_thesis');
    if (hasExpiredSetup(raw, now)) reasons.push('expired_setup');
    if (hasNegativeNews(raw)) reasons.push('negative_news');
    if (raw.marketRegimeChanged === true || raw.changedMarketRegime === true) reasons.push('changed_market_regime');
    if (Number.isFinite(triggerPrice) && triggerPrice > 0 && Number.isFinite(lastPrice) && lastPrice > 0) {
      const driftPct = Math.abs(lastPrice - triggerPrice) / triggerPrice * 100;
      if (driftPct > maxPriceDriftPct) reasons.push(`price_moved_too_far:${driftPct.toFixed(2)}%`);
    }
    if (settings?.killSwitchEnabled) reasons.push('kill_switch_enabled');
    if (prefs?.maxDailyLoss && Number(prefs.maxDailyLoss) <= 0) reasons.push('daily_risk_breached');

    if (reasons.length) {
      const autoAllowed = Boolean(settings?.yoloModeEnabled || settings?.autoGttManagementEnabled);
      let autoError: string | null = null;
      const automation = autoAllowed ? await autoManageRevalidatedGtt(userId, gtt, raw, reasons, lastPrice, now).catch((error) => {
        autoError = error instanceof Error ? error.message : 'Auto GTT management failed';
        return null;
      }) : null;
      if (automation) {
        results.push({ gttOrder: automation.gttOrder, status: automation.status, reasons, action: automation.action });
        continue;
      }
      const [updated] = await db.update(gttOrders).set({
        status: 'revalidation_required',
        statusMessage: autoError ? `Auto-management failed; manual review required: ${autoError}` : `Manual review required: ${reasons.join(', ')}`,
        raw: { ...gtt.raw, revalidation: { checkedAt: now.toISOString(), reasons, lastPrice: latest?.lastPrice ?? null, autoAllowed, autoError } },
        updatedAt: now,
      }).where(eq(gttOrders.id, gtt.id)).returning();
      await audit('gtt.revalidation.flag', { userId, entityType: 'gtt_order', entityId: gtt.id, metadata: { reasons, autoAllowed } });
      results.push({ gttOrder: updated, status: 'flagged', reasons });
    } else {
      const [updated] = await db.update(gttOrders).set({
        statusMessage: 'Revalidated: no blocking drift or expiry detected',
        raw: { ...gtt.raw, revalidation: { checkedAt: now.toISOString(), reasons: [], lastPrice: latest?.lastPrice ?? null } },
        updatedAt: now,
      }).where(eq(gttOrders.id, gtt.id)).returning();
      results.push({ gttOrder: updated, status: 'ok', reasons: [] });
    }
  }

  return {
    checked: results.length,
    flagged: results.filter((result) => result.status === 'flagged').length,
    autoManaged: results.filter((result) => ['auto_cancelled', 'auto_modified'].includes(result.status)).length,
    results,
  };
}

export async function revalidateStaleGttsForAllUsers() {
  const rows = await db.select().from(gttOrders).where(lt(gttOrders.createdAt, new Date(Date.now() - staleGttAgeMs)));
  const users = [...new Set(rows.filter((row) => activeGttStatuses.includes(row.status)).map((row) => row.userId))];
  return await Promise.all(users.map((id) => revalidateGtts(id)));
}

async function autoManageRevalidatedGtt(userId: string, gtt: typeof gttOrders.$inferSelect, raw: Record<string, unknown>, reasons: string[], lastPrice: number, now: Date) {
  const adapter = await kiteAdapterForUser(userId);
  if (!adapter || !gtt.brokerGttId) return null;
  const criticalCancel = reasons.some((reason) => ['kill_switch_enabled', 'expired_setup', 'negative_news', 'changed_market_regime'].includes(reason));
  const modification = suggestedGttModification(raw);

  if (!criticalCancel && modification) {
    const triggerPrice = modification.triggerPrice;
    const limitPrice = modification.limitPrice ?? modification.triggerPrice;
    const quantity = modification.quantity ?? gtt.quantity;
    const brokerResult = await adapter.modifyGtt({
      gttId: gtt.brokerGttId,
      exchange: modification.exchange ?? gtt.exchange,
      tradingsymbol: modification.tradingsymbol ?? gtt.tradingsymbol,
      triggerValues: [triggerPrice],
      lastPrice: Number.isFinite(lastPrice) && lastPrice > 0 ? lastPrice : triggerPrice,
      orders: [{
        exchange: modification.exchange ?? gtt.exchange,
        tradingsymbol: modification.tradingsymbol ?? gtt.tradingsymbol,
        transaction_type: modification.transactionType ?? gtt.transactionType,
        quantity,
        order_type: 'LIMIT',
        product: 'CNC',
        price: limitPrice,
      }],
    });
    const [updated] = await db.update(gttOrders).set({
      exchange: modification.exchange ?? gtt.exchange,
      tradingsymbol: modification.tradingsymbol ?? gtt.tradingsymbol,
      transactionType: modification.transactionType ?? gtt.transactionType,
      triggerPrice: String(triggerPrice),
      limitPrice: String(limitPrice),
      quantity,
      status: 'auto_modified',
      statusMessage: `Auto-modified after revalidation: ${reasons.join(', ')}`,
      raw: { ...gtt.raw, revalidation: { checkedAt: now.toISOString(), reasons, action: 'modify', brokerResult: brokerResult.raw } },
      updatedAt: now,
    }).where(eq(gttOrders.id, gtt.id)).returning();
    await audit('gtt.revalidation.auto_modify', { userId, entityType: 'gtt_order', entityId: gtt.id, metadata: { reasons, brokerGttId: gtt.brokerGttId } });
    return { gttOrder: updated, status: 'auto_modified', action: 'modify' };
  }

  if (criticalCancel || reasons.some((reason) => reason.startsWith('price_moved_too_far'))) {
    await adapter.cancelGtt({ gttId: gtt.brokerGttId });
    const [updated] = await db.update(gttOrders).set({
      status: 'auto_cancelled',
      statusMessage: `Auto-cancelled after revalidation: ${reasons.join(', ')}`,
      raw: { ...gtt.raw, revalidation: { checkedAt: now.toISOString(), reasons, action: 'cancel' } },
      cancelledAt: now,
      updatedAt: now,
    }).where(eq(gttOrders.id, gtt.id)).returning();
    await audit('gtt.revalidation.auto_cancel', { userId, entityType: 'gtt_order', entityId: gtt.id, metadata: { reasons, brokerGttId: gtt.brokerGttId } });
    return { gttOrder: updated, status: 'auto_cancelled', action: 'cancel' };
  }

  return null;
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
  const snapshot = await getLastMarketSnapshot(userId, exchange, tradingsymbol);
  const price = Number(snapshot?.lastPrice ?? fallback);
  return Number.isFinite(price) && price > 0 ? price : fallback;
}

async function getLastMarketSnapshot(userId: string, exchange: string, tradingsymbol: string) {
  const [snapshot] = await db.select().from(marketSnapshots).where(and(eq(marketSnapshots.userId, userId), eq(marketSnapshots.exchange, exchange), eq(marketSnapshots.tradingsymbol, tradingsymbol))).orderBy(desc(marketSnapshots.capturedAt)).limit(1);
  return snapshot ?? null;
}

function suggestedGttModification(raw: Record<string, unknown>) {
  const source = raw.suggestedGtt ?? raw.gttModification ?? raw.autoGttModification;
  if (!source || typeof source !== 'object') return null;
  const input = source as Record<string, unknown>;
  const triggerPrice = Number(input.triggerPrice ?? input.trigger_price);
  const limitPrice = Number(input.limitPrice ?? input.limit_price ?? triggerPrice);
  const quantity = input.quantity === undefined ? undefined : Number(input.quantity);
  if (!Number.isFinite(triggerPrice) || triggerPrice <= 0) return null;
  if (!Number.isFinite(limitPrice) || limitPrice <= 0) return null;
  if (quantity !== undefined && (!Number.isSafeInteger(quantity) || quantity <= 0)) return null;
  return {
    exchange: typeof input.exchange === 'string' ? input.exchange : undefined,
    tradingsymbol: typeof input.tradingsymbol === 'string' ? input.tradingsymbol : undefined,
    transactionType: typeof input.transactionType === 'string' ? input.transactionType : typeof input.transaction_type === 'string' ? input.transaction_type : undefined,
    triggerPrice,
    limitPrice,
    quantity,
  };
}

function hasExpiredSetup(raw: Record<string, unknown>, now: Date) {
  const value = raw.expiresAt ?? raw.expiry ?? raw.setupExpiresAt ?? raw.validUntil;
  if (typeof value !== 'string') return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date < now;
}

function hasNegativeNews(raw: Record<string, unknown>) {
  if (raw.negativeNews === true || raw.adverseNews === true) return true;
  const sentiment = Number(raw.newsSentiment ?? raw.sentimentScore);
  return Number.isFinite(sentiment) && sentiment < -0.4;
}
