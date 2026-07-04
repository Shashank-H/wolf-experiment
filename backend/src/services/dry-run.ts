import { and, desc, eq, gte } from 'drizzle-orm';
import { db } from '../db/client';
import { dailyResearchSessions, gttCandidates, marketSnapshots, orders, rcaFindings, rcaReports, userSettings } from '../db/schema';
import { audit } from '../utils/audit';
import { indianTradeDate, getResearchById, runMorningResearch } from './research';

export type DryRunBundle = {
  session: typeof dailyResearchSessions.$inferSelect;
  trades: Array<typeof orders.$inferSelect>;
  rcaReports: Array<typeof rcaReports.$inferSelect>;
};

export async function isDryRunModeEnabled(userId: string): Promise<boolean> {
  const [settings] = await db.select().from(userSettings).where(eq(userSettings.userId, userId)).limit(1);
  return Boolean(settings?.dryRunModeEnabled);
}

export async function canPlaceBrokerOrders(userId: string): Promise<boolean> {
  return !(await isDryRunModeEnabled(userId));
}

export async function runMorningResearchForCurrentMode(userId: string) {
  if (!(await isDryRunModeEnabled(userId))) return runMorningResearch(userId, { dryRun: false });
  const dryRun = await runDryRunMorning(userId);
  const research = await getResearchById(userId, dryRun.session.id);
  if (!research) throw new Error('Dry-run research session was not found after creation');
  return research;
}

type Candidate = {
  id: string;
  exchange: string;
  tradingsymbol: string;
  transactionType: string;
  quantity: number;
  triggerPrice?: string | null;
  limitPrice?: string | null;
  rationale: string;
  raw: Record<string, unknown>;
};

export async function runDryRunMorning(userId: string): Promise<DryRunBundle> {
  const research = await runMorningResearch(userId, { dryRun: true });
  const tradeDate = research.session.tradeDate;

  if (research.gttCandidates.length) {
    await db.update(gttCandidates).set({ status: 'dry_run_approved', updatedAt: new Date() }).where(eq(gttCandidates.sessionId, research.session.id));
  }

  await db.delete(orders).where(and(eq(orders.userId, userId), eq(orders.researchSessionId, research.session.id), eq(orders.isDryRun, true)));

  const candidates = candidatesForDryRun(research);
  const skipped: Array<{ id: string; symbol: string; reason: string }> = [];
  let tracked = 0;
  for (const candidate of candidates) {
    const latestPrice = await latestMarketPrice(userId, candidate.exchange, candidate.tradingsymbol);
    if (!latestPrice) {
      skipped.push({ id: candidate.id, symbol: `${candidate.exchange}:${candidate.tradingsymbol}`, reason: 'latest_market_price_unavailable' });
      await db.update(gttCandidates).set({ status: 'dry_run_waiting_for_market_data', updatedAt: new Date() }).where(eq(gttCandidates.id, candidate.id));
      continue;
    }
    const entryPrice = latestPrice;
    const pnl = markToMarket(candidate.transactionType, candidate.quantity, entryPrice, latestPrice);
    await db.insert(orders).values({
      userId,
      exchange: candidate.exchange,
      tradingsymbol: candidate.tradingsymbol,
      transactionType: candidate.transactionType,
      product: 'DRY_RUN',
      orderType: 'SIMULATED_GTT',
      quantity: String(candidate.quantity),
      filledQuantity: String(candidate.quantity),
      averagePrice: String(entryPrice),
      currentPrice: String(latestPrice),
      pnl: String(pnl),
      status: 'dry_run_active',
      statusMessage: candidate.rationale,
      raw: { ...candidate.raw, dryRun: { brokerPlacement: 'skipped', entryPriceSource: 'latest_market_snapshot' } },
      isDryRun: true,
      researchSessionId: research.session.id,
      gttCandidateId: candidate.id,
      placedAt: new Date(),
    });
    tracked += 1;
  }

  const dryRunSummary = `Dry run research completed; ${tracked} simulated order(s) are tracking without broker placement${skipped.length ? `; ${skipped.length} candidate(s) waiting for market price.` : '.'}`;
  await db.update(dailyResearchSessions).set({ dryRunSummary, updatedAt: new Date() }).where(eq(dailyResearchSessions.id, research.session.id));
  await audit('dry_run.morning.start', { userId, entityType: 'daily_research_session', entityId: research.session.id, metadata: { tradeDate, candidates: candidates.length, tracked, skipped } });
  return getDryRunByDate(userId, tradeDate) as Promise<DryRunBundle>;
}

export async function completeDryRunDay(userId: string, tradeDate = indianTradeDate()): Promise<DryRunBundle | null> {
  const bundle = await getDryRunByDate(userId, tradeDate);
  if (!bundle) return null;
  await updateTrackedOrderPnls(userId, true, tradeDate);
  await writeEodRca(userId, tradeDate, bundle.session.id, await trackedOrdersForDay(userId, tradeDate, true), 'dry_run_eod');
  return getDryRunByDate(userId, tradeDate);
}

export async function completeLiveTradingDay(userId: string, tradeDate = indianTradeDate()) {
  await updateTrackedOrderPnls(userId, false, tradeDate);
  const rows = await trackedOrdersForDay(userId, tradeDate, false);
  return writeEodRca(userId, tradeDate, null, rows, 'live_eod');
}

export async function updateTrackedOrderPnls(userId: string, isDryRun?: boolean, tradeDate = indianTradeDate()) {
  const rows = await trackedOrdersForDay(userId, tradeDate, isDryRun);
  let updated = 0;
  for (const trade of rows) {
    const latestPrice = await latestMarketPrice(userId, trade.exchange ?? 'NSE', trade.tradingsymbol ?? '');
    const currentPrice = latestPrice || Number(trade.currentPrice) || Number(trade.averagePrice) || 0;
    const pnl = markToMarket(trade.transactionType ?? 'BUY', Number(trade.filledQuantity || trade.quantity), Number(trade.averagePrice), currentPrice);
    await db.update(orders).set({ currentPrice: String(currentPrice), pnl: String(pnl), updatedAt: new Date() }).where(eq(orders.id, trade.id));
    updated += 1;
  }
  await audit('trading.tracking.mark_to_market', { userId, metadata: { tradeDate, mode: isDryRun === true ? 'dry_run' : isDryRun === false ? 'live' : 'all', updated } });
  return { updated };
}

export async function getDryRunToday(userId: string) {
  return getDryRunByDate(userId, indianTradeDate());
}

export async function getDryRunHistory(userId: string, limit = 10) {
  const sessions = await db.select().from(dailyResearchSessions).where(and(eq(dailyResearchSessions.userId, userId), eq(dailyResearchSessions.isDryRun, true))).orderBy(desc(dailyResearchSessions.createdAt)).limit(limit);
  return Promise.all(sessions.map((session) => hydrate(userId, session)));
}

async function getDryRunByDate(userId: string, tradeDate: string): Promise<DryRunBundle | null> {
  const [session] = await db.select().from(dailyResearchSessions).where(and(eq(dailyResearchSessions.userId, userId), eq(dailyResearchSessions.tradeDate, tradeDate), eq(dailyResearchSessions.isDryRun, true))).limit(1);
  return session ? hydrate(userId, session) : null;
}

async function hydrate(userId: string, session: typeof dailyResearchSessions.$inferSelect): Promise<DryRunBundle> {
  const [trades, reports] = await Promise.all([
    db.select().from(orders).where(and(eq(orders.userId, userId), eq(orders.researchSessionId, session.id), eq(orders.isDryRun, true))).orderBy(desc(orders.createdAt)),
    db.select().from(rcaReports).where(and(eq(rcaReports.userId, userId), eq(rcaReports.researchSessionId, session.id))).orderBy(desc(rcaReports.createdAt)),
  ]);
  return { session, trades, rcaReports: reports };
}

function candidatesForDryRun(research: Awaited<ReturnType<typeof runMorningResearch>>): Candidate[] {
  return research.gttCandidates.map((item) => ({ id: item.id, exchange: item.exchange, tradingsymbol: item.tradingsymbol, transactionType: item.transactionType, quantity: item.quantity, triggerPrice: item.triggerPrice, limitPrice: item.limitPrice, rationale: item.rationale, raw: item.raw }));
}

async function trackedOrdersForDay(userId: string, tradeDate: string, isDryRun?: boolean) {
  const start = tradeDateStartUtc(tradeDate);
  const filters = [eq(orders.userId, userId), gte(orders.createdAt, start)];
  if (isDryRun !== undefined) filters.push(eq(orders.isDryRun, isDryRun));
  return db.select().from(orders).where(and(...filters)).orderBy(desc(orders.createdAt));
}

async function writeEodRca(userId: string, tradeDate: string, sessionId: string | null, trades: Array<typeof orders.$inferSelect>, reportType: 'dry_run_eod' | 'live_eod') {
  let totalPnl = 0;
  const signals: Array<{ symbol: string; pnl: number; outcome: string; lesson: string }> = [];
  for (const trade of trades) {
    const latestPrice = await latestMarketPrice(userId, trade.exchange ?? 'NSE', trade.tradingsymbol ?? '');
    const exitPrice = latestPrice || Number(trade.currentPrice) || Number(trade.averagePrice) || 0;
    const quantity = Number(trade.filledQuantity || trade.quantity);
    const pnl = markToMarket(trade.transactionType ?? 'BUY', quantity, Number(trade.averagePrice), exitPrice);
    totalPnl += pnl;
    const outcome = pnl > 0 ? 'winner' : pnl < 0 ? 'loser' : 'flat';
    signals.push({
      symbol: trade.tradingsymbol ?? '',
      pnl,
      outcome,
      lesson: outcome === 'winner' ? 'Thesis and entry timing were validated; preserve this evidence pattern for future research.' : outcome === 'loser' ? 'Thesis, trigger timing, or market-regime fit failed; reduce confidence for similar setups unless stronger confirmation appears.' : 'Flat outcome; avoid over-weighting this setup without a clearer catalyst.',
    });
    await db.update(orders).set({ currentPrice: String(exitPrice), exitPrice: String(exitPrice), pnl: String(pnl), status: reportType === 'dry_run_eod' ? 'dry_run_closed' : trade.status, updatedAt: new Date() }).where(eq(orders.id, trade.id));
  }

  const dry = reportType === 'dry_run_eod';
  const summary = `${dry ? 'Dry-run' : 'Live'} EOD RCA: ${signals.length} ${dry ? 'simulated' : 'broker'} position/order(s), total ${dry ? 'hypothetical' : 'tracked'} PnL ${money(totalPnl)}.`;
  if (sessionId) {
    await db.update(dailyResearchSessions).set({ dryRunStatus: dry ? 'completed' : null, dryRunTotalPnl: String(totalPnl), dryRunSummary: summary, dryRunCompletedAt: new Date(), updatedAt: new Date() }).where(eq(dailyResearchSessions.id, sessionId));
  }
  const [report] = await db.insert(rcaReports).values({
    userId,
    researchSessionId: sessionId,
    tradeDate,
    reportType,
    dailySummary: summary,
    strategyReview: totalPnl >= 0 ? 'Basket was net positive or flat; review winners for repeatable evidence patterns.' : 'Basket was net negative; review losers for thesis, trigger, and market-regime mismatch.',
    agentReasoningReview: dry ? 'Generated from dry-run outcomes. This RCA should influence future research prompts without changing execution safety controls.' : 'Generated from live broker order tracking. This RCA should influence future research prompts without bypassing approval controls.',
    riskReview: dry ? 'No broker orders were placed. Risk was limited to simulated exposure only.' : 'Live broker orders were tracked from broker/order records; new broker GTT placement still requires explicit approval.',
    recommendedImprovements: signals.filter((s) => s.outcome === 'loser').map((s) => `${s.symbol}: require stronger confirmation or tighter invalidation.`),
    promptImprovementSuggestions: signals.map((s) => `${s.symbol}: ${s.lesson}`),
    totalPnl: String(totalPnl),
    raw: { signals, totalPnl, mode: dry ? 'dry_run' : 'live' },
  }).returning();

  for (const signal of signals) {
    const trade = trades.find((item) => item.tradingsymbol === signal.symbol);
    await db.insert(rcaFindings).values({
      userId,
      rcaReportId: report.id,
      orderId: trade?.id ?? null,
      symbol: signal.symbol,
      category: signal.outcome === 'winner' ? 'thesis_correct' : signal.outcome === 'loser' ? 'thesis_or_timing_incorrect' : 'flat_no_edge',
      outcome: signal.outcome,
      pnl: String(signal.pnl),
      finding: signal.lesson,
      recommendation: signal.outcome === 'winner' ? 'Preserve this setup pattern if source quality remains high.' : 'Lower confidence or add confirmation filters for similar setups.',
      raw: signal,
    });
  }

  await audit(`${dry ? 'dry_run' : 'live'}.eod.rca.complete`, { userId, entityType: 'rca_report', entityId: report.id, metadata: { tradeDate, totalPnl, trades: signals.length } });
  return report;
}

function tradeDateStartUtc(tradeDate: string): Date {
  const [year, month, day] = tradeDate.split('-').map(Number);
  return new Date(Date.UTC(year, (month || 1) - 1, day || 1) - 5.5 * 60 * 60 * 1000);
}

async function latestMarketPrice(userId: string, exchange: string, tradingsymbol: string): Promise<number> {
  const [snapshot] = await db.select().from(marketSnapshots).where(and(eq(marketSnapshots.userId, userId), eq(marketSnapshots.exchange, exchange), eq(marketSnapshots.tradingsymbol, tradingsymbol))).orderBy(desc(marketSnapshots.capturedAt)).limit(1);
  return Number(snapshot?.lastPrice ?? 0) || 0;
}

function markToMarket(side: string, quantity: number, entryPrice: number, currentPrice: number): number {
  if (!entryPrice || !currentPrice) return 0;
  const direction = side === 'SELL' ? -1 : 1;
  return roundMoney((currentPrice - entryPrice) * quantity * direction);
}

function money(value: number): string {
  return `${value >= 0 ? '+' : '-'}₹${Math.abs(value).toFixed(2)}`;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}
