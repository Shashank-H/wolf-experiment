import { and, desc, eq } from 'drizzle-orm';
import { db } from '../db/client';
import { apiKeys, dailyResearchSessions, gttCandidates, holdingsSnapshots, positions, researchSources, tradeCandidates, userSettings, watchlistItems } from '../db/schema';
import { ExaProvider } from '../providers/research/ExaProvider';
import { FinnhubProvider } from '../providers/research/FinnhubProvider';
import { OpenAiCompatibleProvider } from '../providers/research/OpenAiCompatibleProvider';
import { DEFAULT_MORNING_RESEARCH_SETTINGS, buildMorningResearchMessages } from '../prompts/morning-research';
import type { MorningResearchSettings, ResearchRiskTolerance } from '../prompts/morning-research';
import type { MorningResearchPlan, ResearchSource } from '../providers/research/types';
import { audit } from '../utils/audit';
import { decryptSecret } from '../utils/crypto';

export type MorningResearchResult = {
  session: typeof dailyResearchSessions.$inferSelect;
  sources: Array<typeof researchSources.$inferSelect>;
  watchlist: Array<typeof watchlistItems.$inferSelect>;
  tradeCandidates: Array<typeof tradeCandidates.$inferSelect>;
  gttCandidates: Array<typeof gttCandidates.$inferSelect>;
  providerWarnings: string[];
};

type BrokerContext = {
  holdings: Array<{ exchange: string; tradingsymbol: string; quantity: string; pnl: string }>;
  positions: Array<{ exchange: string; tradingsymbol: string; product: string; quantity: string; pnl: string }>;
};

const DEFAULT_SYMBOLS = ['NIFTY 50', 'BANKNIFTY', 'RELIANCE', 'HDFCBANK', 'INFY'];

export async function runMorningResearch(userId: string): Promise<MorningResearchResult> {
  const tradeDate = indianTradeDate();
  const [context, settings, secrets] = await Promise.all([
    loadBrokerContext(userId),
    db.select().from(userSettings).where(eq(userSettings.userId, userId)).limit(1),
    loadSecrets(userId),
  ]);
  const providerConfig = settings[0]?.providerConfig ?? {};
  const researchSettings = parseResearchSettings(providerConfig);
  const providerWarnings: string[] = [];
  const symbols = [...new Set([...context.holdings.map((row) => row.tradingsymbol), ...context.positions.map((row) => row.tradingsymbol), ...DEFAULT_SYMBOLS])].slice(0, 16);
  const sources = await collectSources(symbols, secrets, providerWarnings);
  const model = typeof providerConfig.mediumModel === 'string' && providerConfig.mediumModel.trim() ? providerConfig.mediumModel.trim() : 'gpt-4o-mini';
  const plan = await buildPlan({ context, sources, model, llmApiKey: secrets.llmApiKey, llmBaseUrl: stringConfig(providerConfig.llmBaseUrl), providerWarnings, researchSettings });

  const [session] = await db.insert(dailyResearchSessions).values({
    userId,
    tradeDate,
    status: 'completed',
    marketThesis: plan.marketThesis,
    sectorBias: plan.sectorBias,
    riskWarnings: [...plan.riskWarnings, ...providerWarnings],
    model: secrets.llmApiKey ? model : 'deterministic-fallback',
    rawPlan: plan as unknown as Record<string, unknown>,
  }).onConflictDoUpdate({
    target: [dailyResearchSessions.userId, dailyResearchSessions.tradeDate],
    set: {
      status: 'completed',
      marketThesis: plan.marketThesis,
      sectorBias: plan.sectorBias,
      riskWarnings: [...plan.riskWarnings, ...providerWarnings],
      model: secrets.llmApiKey ? model : 'deterministic-fallback',
      rawPlan: plan as unknown as Record<string, unknown>,
      updatedAt: new Date(),
    },
  }).returning();

  await Promise.all([
    db.delete(researchSources).where(eq(researchSources.sessionId, session.id)),
    db.delete(tradeCandidates).where(eq(tradeCandidates.sessionId, session.id)),
    db.delete(gttCandidates).where(eq(gttCandidates.sessionId, session.id)),
    db.delete(watchlistItems).where(and(eq(watchlistItems.userId, userId), eq(watchlistItems.tradeDate, tradeDate), eq(watchlistItems.source, 'ai'))),
  ]);

  const sourceRows = sources.length
    ? await db.insert(researchSources).values(sources.map((source) => ({
      userId,
      sessionId: session.id,
      provider: source.provider,
      title: source.title,
      url: source.url,
      summary: source.summary,
      symbols: source.symbols,
      publishedAt: source.publishedAt ? new Date(source.publishedAt) : null,
      raw: source.raw ?? {},
    }))).returning()
    : [];

  const watchlistRows = plan.watchlist.length
    ? await db.insert(watchlistItems).values(plan.watchlist.map((item) => ({
      userId,
      sessionId: session.id,
      tradeDate,
      exchange: item.exchange || 'NSE',
      tradingsymbol: item.tradingsymbol,
      bias: item.bias,
      reason: item.reason,
      source: 'ai',
      status: 'active',
    }))).onConflictDoNothing().returning()
    : [];

  const tradeRows = plan.tradeCandidates.length
    ? await db.insert(tradeCandidates).values(plan.tradeCandidates.map((item) => ({
      userId,
      sessionId: session.id,
      exchange: item.exchange || 'NSE',
      tradingsymbol: item.tradingsymbol,
      side: item.side,
      thesis: item.thesis,
      entryPlan: item.entryPlan,
      invalidation: item.invalidation,
      confidence: clampInt(item.confidence, 0, 100),
      raw: item as unknown as Record<string, unknown>,
    }))).returning()
    : [];

  const gttRows = plan.gttCandidates.length
    ? await db.insert(gttCandidates).values(plan.gttCandidates.map((item) => ({
      userId,
      sessionId: session.id,
      exchange: item.exchange || 'NSE',
      tradingsymbol: item.tradingsymbol,
      transactionType: item.transactionType,
      triggerPrice: item.triggerPrice === undefined ? null : String(item.triggerPrice),
      limitPrice: item.limitPrice === undefined ? null : String(item.limitPrice),
      quantity: clampInt(item.quantity, 1, 1_000_000),
      rationale: item.rationale,
      status: 'draft',
      raw: item as unknown as Record<string, unknown>,
    }))).returning()
    : [];

  await audit('research.morning.run', { userId, entityType: 'daily_research_session', entityId: session.id, metadata: { tradeDate, sources: sourceRows.length, watchlist: watchlistRows.length } });
  return { session, sources: sourceRows, watchlist: watchlistRows, tradeCandidates: tradeRows, gttCandidates: gttRows, providerWarnings };
}

export async function getTodayResearch(userId: string): Promise<MorningResearchResult | null> {
  const [session] = await db.select().from(dailyResearchSessions).where(and(eq(dailyResearchSessions.userId, userId), eq(dailyResearchSessions.tradeDate, indianTradeDate()))).limit(1);
  return session ? hydrateSession(userId, session) : null;
}

export async function getResearchById(userId: string, sessionId: string): Promise<MorningResearchResult | null> {
  const [session] = await db.select().from(dailyResearchSessions).where(and(eq(dailyResearchSessions.userId, userId), eq(dailyResearchSessions.id, sessionId))).limit(1);
  return session ? hydrateSession(userId, session) : null;
}

export async function getTodayWatchlist(userId: string) {
  return db.select().from(watchlistItems).where(and(eq(watchlistItems.userId, userId), eq(watchlistItems.tradeDate, indianTradeDate()))).orderBy(desc(watchlistItems.createdAt));
}

export async function addManualWatchlistItem(userId: string, input: { exchange?: string; tradingsymbol: string; reason?: string; bias?: string }) {
  const [row] = await db.insert(watchlistItems).values({
    userId,
    tradeDate: indianTradeDate(),
    exchange: input.exchange?.trim().toUpperCase() || 'NSE',
    tradingsymbol: input.tradingsymbol.trim().toUpperCase(),
    reason: input.reason?.trim() || 'Manual watchlist item',
    bias: normalizeBias(input.bias),
    source: 'manual',
    status: 'active',
  }).onConflictDoUpdate({
    target: [watchlistItems.userId, watchlistItems.tradeDate, watchlistItems.exchange, watchlistItems.tradingsymbol],
    set: { reason: input.reason?.trim() || 'Manual watchlist item', bias: normalizeBias(input.bias), source: 'manual', status: 'active', updatedAt: new Date() },
  }).returning();
  await audit('watchlist.manual.upsert', { userId, entityType: 'watchlist_item', entityId: row.id, metadata: { symbol: row.tradingsymbol } });
  return row;
}

export async function deleteWatchlistItem(userId: string, id: string) {
  const rows = await db.delete(watchlistItems).where(and(eq(watchlistItems.userId, userId), eq(watchlistItems.id, id))).returning();
  if (rows[0]) await audit('watchlist.delete', { userId, entityType: 'watchlist_item', entityId: id });
  return rows[0] ?? null;
}

async function hydrateSession(userId: string, session: typeof dailyResearchSessions.$inferSelect): Promise<MorningResearchResult> {
  const [sources, watchlist, tradeRows, gttRows] = await Promise.all([
    db.select().from(researchSources).where(and(eq(researchSources.userId, userId), eq(researchSources.sessionId, session.id))).orderBy(desc(researchSources.createdAt)),
    db.select().from(watchlistItems).where(and(eq(watchlistItems.userId, userId), eq(watchlistItems.sessionId, session.id))).orderBy(desc(watchlistItems.createdAt)),
    db.select().from(tradeCandidates).where(and(eq(tradeCandidates.userId, userId), eq(tradeCandidates.sessionId, session.id))).orderBy(desc(tradeCandidates.createdAt)),
    db.select().from(gttCandidates).where(and(eq(gttCandidates.userId, userId), eq(gttCandidates.sessionId, session.id))).orderBy(desc(gttCandidates.createdAt)),
  ]);
  return { session, sources, watchlist, tradeCandidates: tradeRows, gttCandidates: gttRows, providerWarnings: [] };
}

async function loadBrokerContext(userId: string): Promise<BrokerContext> {
  const [holdingRows, positionRows] = await Promise.all([
    db.select().from(holdingsSnapshots).where(eq(holdingsSnapshots.userId, userId)).orderBy(desc(holdingsSnapshots.capturedAt)).limit(20),
    db.select().from(positions).where(eq(positions.userId, userId)).orderBy(desc(positions.lastSyncedAt)).limit(20),
  ]);
  return {
    holdings: holdingRows.map((row) => ({ exchange: row.exchange, tradingsymbol: row.tradingsymbol, quantity: String(row.quantity), pnl: String(row.pnl) })),
    positions: positionRows.map((row) => ({ exchange: row.exchange, tradingsymbol: row.tradingsymbol, product: row.product, quantity: String(row.quantity), pnl: String(row.pnl) })),
  };
}

async function loadSecrets(userId: string) {
  const rows = await db.select().from(apiKeys).where(eq(apiKeys.userId, userId));
  const secret = (provider: string, label: string) => {
    const row = rows.find((item) => item.provider === provider && item.label === label);
    return row ? decryptSecret(row) : null;
  };
  return { exaApiKey: secret('exa', 'api_key'), finnhubApiKey: secret('finnhub', 'api_key'), llmApiKey: secret('llm', 'api_key') };
}

async function collectSources(symbols: string[], secrets: Awaited<ReturnType<typeof loadSecrets>>, warnings: string[]): Promise<ResearchSource[]> {
  const tasks: Array<Promise<ResearchSource[]>> = [];
  if (secrets.exaApiKey) tasks.push(new ExaProvider(secrets.exaApiKey).search({ query: `Indian equity market news ${symbols.slice(0, 8).join(' ')}`, symbols, limit: 8 }));
  else warnings.push('Exa API key missing; web research skipped.');
  if (secrets.finnhubApiKey) tasks.push(new FinnhubProvider(secrets.finnhubApiKey).search({ query: 'market news', symbols: symbols.filter((symbol) => /^[A-Z.]+$/.test(symbol)), limit: 8 }));
  else warnings.push('Finnhub API key missing; market news skipped.');
  const settled = await Promise.allSettled(tasks);
  return settled.flatMap((result) => {
    if (result.status === 'fulfilled') return result.value;
    warnings.push(result.reason instanceof Error ? result.reason.message : 'Research provider failed');
    return [];
  }).slice(0, 24);
}

async function buildPlan(input: { context: BrokerContext; sources: ResearchSource[]; model: string; llmApiKey: string | null; llmBaseUrl?: string; providerWarnings: string[]; researchSettings: MorningResearchSettings }): Promise<MorningResearchPlan> {
  if (!input.llmApiKey) {
    input.providerWarnings.push('LLM API key missing; generated deterministic fallback plan.');
    return fallbackPlan(input.context, input.sources, input.researchSettings);
  }
  try {
    const llm = new OpenAiCompatibleProvider(input.llmApiKey, input.llmBaseUrl);
    const json = await llm.generateJson({
      model: input.model,
      temperature: 0.15,
      messages: buildMorningResearchMessages({ broker: input.context, sources: input.sources.slice(0, 12), settings: input.researchSettings }),
    });
    return normalizePlan(json, input.context, input.sources, input.researchSettings);
  } catch (error) {
    input.providerWarnings.push(error instanceof Error ? error.message : 'LLM plan failed');
    return fallbackPlan(input.context, input.sources, input.researchSettings);
  }
}

function fallbackPlan(context: BrokerContext, sources: ResearchSource[], settings = DEFAULT_MORNING_RESEARCH_SETTINGS): MorningResearchPlan {
  const symbols = [...new Set([...context.positions.map((row) => row.tradingsymbol), ...context.holdings.map((row) => row.tradingsymbol), ...DEFAULT_SYMBOLS])].slice(0, settings.maxWatchlistItems);
  return {
    marketThesis: sources.length
      ? `Review ${sources.length} fresh source(s), but keep execution manual until Phase 4 risk checks are active.`
      : 'No external research providers were available. Use portfolio context only and avoid automated execution.',
    sectorBias: [{ sector: 'Broad market', bias: 'neutral', reason: 'Awaiting validated multi-provider research and risk-engine confirmation.' }],
    watchlist: symbols.map((symbol) => ({ exchange: symbol.includes('NIFTY') ? 'NFO' : 'NSE', tradingsymbol: symbol, bias: 'neutral', reason: 'Carry-forward broker context / benchmark watch item.' })),
    tradeCandidates: symbols.slice(0, Math.min(settings.maxTradeCandidates, fallbackTradeCandidateCount(settings.riskTolerance))).map((symbol) => ({ exchange: symbol.includes('NIFTY') ? 'NFO' : 'NSE', tradingsymbol: symbol, side: 'BUY', thesis: 'Candidate requires manual confirmation; fallback plan has no directional edge.', entryPlan: 'Wait for price confirmation and risk approval.', invalidation: 'Do not trade if liquidity, spread, or daily loss limits fail.', confidence: 35 })),
    gttCandidates: [],
    riskWarnings: ['Automated execution is disabled for research output.', 'Validate every candidate manually until trigger/risk phases are implemented.'],
  };
}

function normalizePlan(raw: Record<string, unknown>, context: BrokerContext, sources: ResearchSource[], settings = DEFAULT_MORNING_RESEARCH_SETTINGS): MorningResearchPlan {
  const fallback = fallbackPlan(context, sources, settings);
  return {
    marketThesis: stringValue(raw.marketThesis) || fallback.marketThesis,
    sectorBias: arrayValue(raw.sectorBias).slice(0, 8).map((item) => ({ sector: stringValue(item.sector) || 'Market', bias: normalizeSectorBias(item.bias), reason: stringValue(item.reason) || 'No reason supplied.' })),
    watchlist: arrayValue(raw.watchlist).slice(0, settings.maxWatchlistItems).map((item) => ({ exchange: stringValue(item.exchange) || 'NSE', tradingsymbol: stringValue(item.tradingsymbol).toUpperCase(), bias: normalizeBias(item.bias), reason: stringValue(item.reason) || 'LLM watchlist item.' })).filter((item) => item.tradingsymbol) || fallback.watchlist,
    tradeCandidates: arrayValue(raw.tradeCandidates).slice(0, settings.maxTradeCandidates).map((item) => ({ exchange: stringValue(item.exchange) || 'NSE', tradingsymbol: stringValue(item.tradingsymbol).toUpperCase(), side: normalizeSide(item.side), thesis: stringValue(item.thesis) || 'No thesis supplied.', entryPlan: stringValue(item.entryPlan) || 'Manual confirmation required.', invalidation: stringValue(item.invalidation) || 'Abort if risk checks fail.', confidence: clampInt(Number(item.confidence ?? 0), 0, 100) })).filter((item) => item.tradingsymbol),
    gttCandidates: arrayValue(raw.gttCandidates).slice(0, settings.maxGttCandidates).map((item) => ({ exchange: stringValue(item.exchange) || 'NSE', tradingsymbol: stringValue(item.tradingsymbol).toUpperCase(), transactionType: normalizeSide(item.transactionType), triggerPrice: optionalNumber(item.triggerPrice), limitPrice: optionalNumber(item.limitPrice), quantity: clampInt(Number(item.quantity ?? 1), 1, 1_000_000), rationale: stringValue(item.rationale) || 'Draft GTT suggestion.' })).filter((item) => item.tradingsymbol),
    riskWarnings: arrayValue(raw.riskWarnings).map((item) => String(item)).slice(0, 12),
  };
}

function indianTradeDate(date = new Date()): string {
  const ist = new Date(date.getTime() + 5.5 * 60 * 60 * 1000);
  return ist.toISOString().slice(0, 10);
}

function stringConfig(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function parseResearchSettings(config: Record<string, unknown>): MorningResearchSettings {
  return {
    maxWatchlistItems: configInt(config.maxWatchlistItems, DEFAULT_MORNING_RESEARCH_SETTINGS.maxWatchlistItems, 0, 24),
    maxTradeCandidates: configInt(config.maxTradeCandidates, DEFAULT_MORNING_RESEARCH_SETTINGS.maxTradeCandidates, 0, 12),
    maxGttCandidates: configInt(config.maxGttCandidates, DEFAULT_MORNING_RESEARCH_SETTINGS.maxGttCandidates, 0, 12),
    riskTolerance: normalizeRiskTolerance(config.riskTolerance),
  };
}

function configInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? clampInt(parsed, min, max) : fallback;
}

function normalizeRiskTolerance(value: unknown): ResearchRiskTolerance {
  const text = stringValue(value).toLowerCase();
  return text === 'moderate' || text === 'aggressive' ? text : 'conservative';
}

function fallbackTradeCandidateCount(riskTolerance: ResearchRiskTolerance): number {
  return riskTolerance === 'aggressive' ? 3 : riskTolerance === 'moderate' ? 2 : 1;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function arrayValue(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => item !== null && typeof item === 'object') : [];
}

function normalizeBias(value: unknown): 'long' | 'short' | 'neutral' {
  const text = stringValue(value).toLowerCase();
  return text === 'long' || text === 'bullish' ? 'long' : text === 'short' || text === 'bearish' ? 'short' : 'neutral';
}

function normalizeSectorBias(value: unknown): 'bullish' | 'bearish' | 'neutral' {
  const text = stringValue(value).toLowerCase();
  return text === 'bullish' || text === 'bearish' ? text : 'neutral';
}

function normalizeSide(value: unknown): 'BUY' | 'SELL' {
  return stringValue(value).toUpperCase() === 'SELL' ? 'SELL' : 'BUY';
}

function optionalNumber(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}
