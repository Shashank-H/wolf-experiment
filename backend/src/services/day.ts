import { and, desc, eq, gte, lt } from 'drizzle-orm';
import { db } from '../db/client';
import { approvalRequests, dailyResearchSessions, gttCandidates, gttOrders, orderEvents, orders, rcaReports, researchSources, triggerEvents, triggerRules, watchlistItems } from '../db/schema';
import { indianTradeDate } from './research';

export async function getTodayBundle(userId: string) {
  return getDayBundle(userId, indianTradeDate());
}

export async function getDayBundle(userId: string, tradeDate: string) {
  const { start, end } = utcBoundsForTradeDate(tradeDate);
  const researchSessions = await db.select().from(dailyResearchSessions).where(and(eq(dailyResearchSessions.userId, userId), eq(dailyResearchSessions.tradeDate, tradeDate))).orderBy(desc(dailyResearchSessions.createdAt));
  const sessionIds = new Set(researchSessions.map((session) => session.id));
  const [sources, watchlist, gttDrafts, gtts, triggerRows, triggerEventRows, approvalRows, orderRows, rcaRows] = await Promise.all([
    db.select().from(researchSources).where(and(eq(researchSources.userId, userId), gte(researchSources.createdAt, start), lt(researchSources.createdAt, end))).orderBy(desc(researchSources.createdAt)),
    db.select().from(watchlistItems).where(and(eq(watchlistItems.userId, userId), eq(watchlistItems.tradeDate, tradeDate))).orderBy(desc(watchlistItems.createdAt)),
    db.select().from(gttCandidates).where(and(eq(gttCandidates.userId, userId), gte(gttCandidates.createdAt, start), lt(gttCandidates.createdAt, end))).orderBy(desc(gttCandidates.createdAt)),
    db.select().from(gttOrders).where(and(eq(gttOrders.userId, userId), gte(gttOrders.createdAt, start), lt(gttOrders.createdAt, end))).orderBy(desc(gttOrders.createdAt)),
    db.select().from(triggerRules).where(and(eq(triggerRules.userId, userId), gte(triggerRules.createdAt, start), lt(triggerRules.createdAt, end))).orderBy(desc(triggerRules.createdAt)),
    db.select().from(triggerEvents).where(and(eq(triggerEvents.userId, userId), gte(triggerEvents.createdAt, start), lt(triggerEvents.createdAt, end))).orderBy(desc(triggerEvents.createdAt)),
    db.select().from(approvalRequests).where(and(eq(approvalRequests.userId, userId), gte(approvalRequests.createdAt, start), lt(approvalRequests.createdAt, end))).orderBy(desc(approvalRequests.createdAt)),
    db.select().from(orders).where(and(eq(orders.userId, userId), gte(orders.createdAt, start), lt(orders.createdAt, end))).orderBy(desc(orders.createdAt)),
    db.select().from(rcaReports).where(and(eq(rcaReports.userId, userId), eq(rcaReports.tradeDate, tradeDate))).orderBy(desc(rcaReports.createdAt)),
  ]);
  const orderIds = new Set(orderRows.map((order) => order.id));
  const events = orderRows.length ? (await db.select().from(orderEvents).where(and(eq(orderEvents.userId, userId), gte(orderEvents.createdAt, start), lt(orderEvents.createdAt, end))).orderBy(desc(orderEvents.createdAt))).filter((event) => event.orderId && orderIds.has(event.orderId)) : [];
  const primarySession = researchSessions.find((session) => !session.isDryRun) ?? researchSessions[0] ?? null;
  const dryRunSession = researchSessions.find((session) => session.isDryRun) ?? null;
  return {
    tradeDate,
    start: start.toISOString(),
    end: end.toISOString(),
    summary: summarizeDay({ researchSessions, gttDrafts, gtts, triggerRows, approvalRows, orderRows, rcaRows }),
    researchSessions,
    primarySession,
    dryRunSession,
    sources: sources.filter((source) => !source.sessionId || sessionIds.has(source.sessionId)),
    watchlist,
    gttCandidates: gttDrafts,
    gttOrders: gtts,
    triggers: triggerRows,
    triggerEvents: triggerEventRows,
    approvals: approvalRows,
    orders: orderRows,
    orderEvents: events,
    rcaReports: rcaRows,
  };
}

export async function getHistory(userId: string, limit = 60) {
  const sessions = await db.select().from(dailyResearchSessions).where(eq(dailyResearchSessions.userId, userId)).orderBy(desc(dailyResearchSessions.tradeDate), desc(dailyResearchSessions.createdAt)).limit(limit * 2);
  const dates = [...new Set(sessions.map((session) => session.tradeDate))].slice(0, limit);
  const bundles = await Promise.all(dates.map((date) => getDayBundle(userId, date)));
  return bundles.map((bundle) => ({
    tradeDate: bundle.tradeDate,
    summary: bundle.summary,
    primarySessionId: bundle.primarySession?.id ?? null,
    dryRunSessionId: bundle.dryRunSession?.id ?? null,
    latestCreatedAt: bundle.researchSessions[0]?.createdAt ?? null,
  }));
}

function summarizeDay(input: { researchSessions: unknown[]; gttDrafts: Array<{ status: string }>; gtts: Array<{ status: string }>; triggerRows: unknown[]; approvalRows: Array<{ status: string }>; orderRows: Array<{ status: string; pnl?: string }>; rcaRows: Array<{ dailySummary: string; totalPnl: string }> }) {
  const pendingApprovals = input.approvalRows.filter((item) => item.status === 'pending').length;
  const placedOrders = input.orderRows.filter((item) => !['failed', 'cancelled'].includes(item.status)).length;
  const rca = input.rcaRows[0];
  const pnl = input.orderRows.reduce((sum, order) => sum + Number(order.pnl ?? 0), 0) + Number(rca?.totalPnl ?? 0);
  return {
    researchRuns: input.researchSessions.length,
    gttCandidates: input.gttDrafts.length,
    activeGtts: input.gtts.filter((item) => ['created', 'submitted', 'active', 'open'].includes(item.status)).length,
    triggers: input.triggerRows.length,
    approvals: input.approvalRows.length,
    pendingApprovals,
    orders: input.orderRows.length,
    placedOrders,
    rcaReports: input.rcaRows.length,
    pnl,
    headline: rca?.dailySummary || `${input.researchSessions.length} research run(s), ${input.gttDrafts.length} GTT candidate(s), ${input.orderRows.length} order(s).`,
  };
}

function utcBoundsForTradeDate(tradeDate: string) {
  const start = new Date(`${tradeDate}T00:00:00.000+05:30`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}
