import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { apiKeys, brokerAccounts, holdingsSnapshots, marketSnapshots, orders, positions, userSettings } from '../db/schema';
import { cacheQuotes } from '../market/quote-cache';
import { KiteBrokerAdapter } from '../providers/broker/KiteBrokerAdapter';
import type { InstrumentRef } from '../providers/broker/types';
import { decryptSecret } from '../utils/crypto';

export async function kiteAdapterForUser(userId: string): Promise<KiteBrokerAdapter | null> {
  const [keys, settingsRows, accountRows] = await Promise.all([
    db.select().from(apiKeys).where(eq(apiKeys.userId, userId)),
    db.select().from(userSettings).where(eq(userSettings.userId, userId)).limit(1),
    db.select().from(brokerAccounts).where(eq(brokerAccounts.userId, userId)).limit(1),
  ]);
  const byLabel = new Map(keys.filter((key) => key.provider === 'kite').map((key) => [key.label, key]));
  const apiKey = byLabel.get('api_key');
  const accessToken = byLabel.get('access_token');
  const apiUrl = typeof settingsRows[0]?.providerConfig?.kiteApiUrl === 'string' ? settingsRows[0].providerConfig.kiteApiUrl : undefined;
  if (!apiKey || !accessToken) return null;
  if (accountRows[0]?.accessTokenExpiresAt && accountRows[0].accessTokenExpiresAt.getTime() <= Date.now()) return null;
  return new KiteBrokerAdapter({ apiKey: decryptSecret(apiKey), accessToken: decryptSecret(accessToken), apiUrl });
}

export async function upsertKiteBrokerAccount(userId: string, adapter: KiteBrokerAdapter) {
  const profile = await adapter.getProfile().catch(() => null);
  const [account] = await db.insert(brokerAccounts).values({
    userId,
    broker: 'kite',
    brokerUserId: profile?.userId,
    displayName: profile?.userName ?? profile?.email ?? profile?.userId,
    status: 'connected',
    metadata: profile ? { profile } : {},
    lastSyncedAt: new Date(),
  }).onConflictDoUpdate({
    target: [brokerAccounts.userId, brokerAccounts.broker],
    set: {
      brokerUserId: profile?.userId,
      displayName: profile?.userName ?? profile?.email ?? profile?.userId,
      status: 'connected',
      metadata: profile ? { profile } : {},
      lastSyncedAt: new Date(),
      updatedAt: new Date(),
    },
  }).returning();
  return account;
}

export async function refreshKiteBrokerAccount(userId: string) {
  const adapter = await kiteAdapterForUser(userId);
  if (!adapter) return null;
  return upsertKiteBrokerAccount(userId, adapter);
}

export async function syncPortfolio(userId: string) {
  const adapter = await kiteAdapterForUser(userId);
  if (!adapter) return { ok: false, reason: 'missing_kite_credentials' };
  const account = await upsertKiteBrokerAccount(userId, adapter);
  const [holdings, brokerPositions] = await Promise.all([adapter.getHoldings(), adapter.getPositions()]);
  if (holdings.length) {
    await db.insert(holdingsSnapshots).values(holdings.map((holding) => ({
      userId,
      brokerAccountId: account.id,
      exchange: holding.exchange,
      tradingsymbol: holding.tradingsymbol,
      quantity: String(holding.quantity),
      averagePrice: String(holding.averagePrice),
      lastPrice: String(holding.lastPrice),
      pnl: String(holding.pnl),
      raw: holding,
    })));
  }
  for (const position of brokerPositions) {
    await db.insert(positions).values({
      userId,
      brokerAccountId: account.id,
      exchange: position.exchange,
      tradingsymbol: position.tradingsymbol,
      product: position.product ?? 'CNC',
      quantity: String(position.quantity),
      dayQuantity: String(position.dayQuantity ?? 0),
      averagePrice: String(position.averagePrice),
      lastPrice: String(position.lastPrice),
      pnl: String(position.pnl),
      raw: position,
    }).onConflictDoUpdate({
      target: [positions.userId, positions.exchange, positions.tradingsymbol, positions.product],
      set: { brokerAccountId: account.id, quantity: String(position.quantity), dayQuantity: String(position.dayQuantity ?? 0), averagePrice: String(position.averagePrice), lastPrice: String(position.lastPrice), pnl: String(position.pnl), raw: position, lastSyncedAt: new Date(), updatedAt: new Date() },
    });
  }
  return { ok: true, holdings: holdings.length, positions: brokerPositions.length };
}

export async function syncOrders(userId: string) {
  const adapter = await kiteAdapterForUser(userId);
  if (!adapter) return { ok: false, reason: 'missing_kite_credentials' };
  const account = await upsertKiteBrokerAccount(userId, adapter);
  const brokerOrders = await adapter.getOrders();
  for (const order of brokerOrders) {
    if (!order.orderId) continue;
    await db.insert(orders).values({
      userId,
      brokerAccountId: account.id,
      brokerOrderId: order.orderId,
      exchange: order.exchange,
      tradingsymbol: order.tradingsymbol,
      transactionType: order.transactionType,
      quantity: String(order.quantity ?? 0),
      filledQuantity: String(order.filledQuantity ?? 0),
      averagePrice: String(order.averagePrice ?? 0),
      status: order.status ?? 'unknown',
      statusMessage: order.statusMessage,
      raw: order.raw as Record<string, unknown>,
      placedAt: order.placedAt ? new Date(order.placedAt) : undefined,
    }).onConflictDoUpdate({
      target: [orders.userId, orders.brokerOrderId],
      set: { brokerAccountId: account.id, filledQuantity: String(order.filledQuantity ?? 0), averagePrice: String(order.averagePrice ?? 0), status: order.status ?? 'unknown', statusMessage: order.statusMessage, raw: order.raw as Record<string, unknown>, updatedAt: new Date() },
    });
  }
  return { ok: true, orders: brokerOrders.length };
}

export async function pollMarket(userId: string, symbols: InstrumentRef[]) {
  const adapter = await kiteAdapterForUser(userId);
  if (!adapter) return { ok: false, reason: 'missing_kite_credentials' };
  const quotes = await adapter.getQuotes(symbols);
  await cacheQuotes(userId, quotes);
  if (quotes.length) {
    await db.insert(marketSnapshots).values(quotes.map((quote) => ({ userId, exchange: quote.exchange, tradingsymbol: quote.tradingsymbol, lastPrice: String(quote.lastPrice), changePercent: String(quote.changePercent ?? 0), volume: quote.volume ?? 0, raw: quote.raw as Record<string, unknown> })));
  }
  const { evaluateMarketTriggers } = await import('./trigger-evaluation');
  const triggerEvaluation = quotes.length ? await evaluateMarketTriggers(userId, quotes) : { evaluated: 0, matched: 0 };
  return { ok: true, quotes: quotes.length, triggerEvaluation };
}
