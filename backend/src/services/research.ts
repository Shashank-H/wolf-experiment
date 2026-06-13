import { and, desc, eq } from 'drizzle-orm';
import { db } from '../db/client';
import { apiKeys, dailyResearchSessions, gttCandidates, holdingsSnapshots, positions, rcaReports, researchSources, userSettings, watchlistItems } from '../db/schema';
import { ExaProvider } from '../providers/research/ExaProvider';
import { FinnhubProvider } from '../providers/research/FinnhubProvider';
import { OpenAiCompatibleProvider } from '../providers/research/OpenAiCompatibleProvider';
import { DEFAULT_MORNING_RESEARCH_SETTINGS, buildMorningResearchGttMessages, buildMorningResearchIdeasMessages, transientTradeCandidateLimit } from '../prompts/morning-research';
import type { MorningResearchSettings, ResearchRiskTolerance } from '../prompts/morning-research';
import type { AgentConversationTrace, LlmMessage, MorningResearchGttPlan, MorningResearchIdeasPlan, MorningResearchPlan, ResearchSource } from '../providers/research/types';
import { audit } from '../utils/audit';
import { decryptSecret } from '../utils/crypto';

export type MorningResearchResult = {
  session: typeof dailyResearchSessions.$inferSelect;
  sources: Array<typeof researchSources.$inferSelect>;
  watchlist: Array<typeof watchlistItems.$inferSelect>;
  gttCandidates: Array<typeof gttCandidates.$inferSelect>;
  providerWarnings: string[];
};

type BrokerContext = {
  holdings: Array<{ exchange: string; tradingsymbol: string; quantity: string; pnl: string }>;
  positions: Array<{ exchange: string; tradingsymbol: string; product: string; quantity: string; pnl: string }>;
};

const DEFAULT_SYMBOLS = ['NIFTY 50', 'BANKNIFTY', 'RELIANCE', 'HDFCBANK', 'INFY'];

export async function runMorningResearch(userId: string, options: { dryRun?: boolean } = {}): Promise<MorningResearchResult> {
  const tradeDate = indianTradeDate();
  const isDryRun = Boolean(options.dryRun);
  const [context, settings, secrets, rcaLearnings] = await Promise.all([
    loadBrokerContext(userId),
    db.select().from(userSettings).where(eq(userSettings.userId, userId)).limit(1),
    loadSecrets(userId),
    loadRcaLearnings(userId),
  ]);
  const providerConfig = settings[0]?.providerConfig ?? {};
  const researchSettings = parseResearchSettings(providerConfig);
  const providerWarnings: string[] = [];
  const symbols = [...new Set([...context.holdings.map((row) => row.tradingsymbol), ...context.positions.map((row) => row.tradingsymbol), ...DEFAULT_SYMBOLS])].slice(0, 16);
  const sources = await collectSources(symbols, secrets, providerWarnings);
  const model = typeof providerConfig.mediumModel === 'string' && providerConfig.mediumModel.trim() ? providerConfig.mediumModel.trim() : 'gpt-4o-mini';
  const { plan, conversation } = await buildPlan({ context, sources, model, llmApiKey: secrets.llmApiKey, llmBaseUrl: stringConfig(providerConfig.llmBaseUrl), providerWarnings, researchSettings, rcaLearnings });

  const [session] = await db.insert(dailyResearchSessions).values({
    userId,
    tradeDate,
    status: 'completed',
    marketThesis: plan.marketThesis,
    sectorBias: plan.sectorBias,
    riskWarnings: [...plan.riskWarnings, ...providerWarnings],
    model: secrets.llmApiKey ? model : 'deterministic-fallback',
    rawPlan: plan as unknown as Record<string, unknown>,
    agentConversation: conversation as unknown as Record<string, unknown>,
    isDryRun,
    dryRunStatus: isDryRun ? 'active' : null,
    dryRunSummary: isDryRun ? 'Dry run research completed; simulated GTTs approved for tracking. No broker orders were placed.' : '',
  }).onConflictDoUpdate({
    target: [dailyResearchSessions.userId, dailyResearchSessions.tradeDate, dailyResearchSessions.isDryRun],
    set: {
      status: 'completed',
      marketThesis: plan.marketThesis,
      sectorBias: plan.sectorBias,
      riskWarnings: [...plan.riskWarnings, ...providerWarnings],
      model: secrets.llmApiKey ? model : 'deterministic-fallback',
      rawPlan: plan as unknown as Record<string, unknown>,
      agentConversation: conversation as unknown as Record<string, unknown>,
      isDryRun,
      dryRunStatus: isDryRun ? 'active' : null,
      dryRunSummary: isDryRun ? 'Dry run research completed; simulated GTTs approved for tracking. No broker orders were placed.' : '',
      dryRunCompletedAt: null,
      dryRunTotalPnl: '0',
      updatedAt: new Date(),
    },
  }).returning();

  await Promise.all([
    db.delete(researchSources).where(eq(researchSources.sessionId, session.id)),
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

  const gttRows = plan.gttCandidates.length
    ? await db.insert(gttCandidates).values(plan.gttCandidates.map((item) => ({
      userId,
      sessionId: session.id,
      exchange: item.exchange || 'NSE',
      tradingsymbol: item.tradingsymbol,
      transactionType: item.transactionType,
      triggerPrice: item.triggerPrice === undefined ? null : String(item.triggerPrice),
      limitPrice: item.limitPrice === undefined ? null : String(item.limitPrice),
      targetPrice: item.targetPrice === undefined ? null : String(item.targetPrice),
      stopLossPrice: item.stopLossPrice === undefined ? null : String(item.stopLossPrice),
      quantity: clampInt(item.quantity, 1, 1_000_000),
      rationale: item.rationale,
      status: 'draft',
      raw: { ...(item as unknown as Record<string, unknown>), stopLossPrice: item.stopLossPrice, targetPrice: item.targetPrice },
    }))).returning()
    : [];

  await audit('research.morning.run', { userId, entityType: 'daily_research_session', entityId: session.id, metadata: { tradeDate, sources: sourceRows.length, watchlist: watchlistRows.length } });
  return { session, sources: sourceRows, watchlist: watchlistRows, gttCandidates: gttRows, providerWarnings };
}

export async function getTodayResearch(userId: string): Promise<MorningResearchResult | null> {
  const [settings] = await db.select().from(userSettings).where(eq(userSettings.userId, userId)).limit(1);
  const isDryRun = Boolean(settings?.dryRunModeEnabled);
  const [session] = await db.select().from(dailyResearchSessions).where(and(eq(dailyResearchSessions.userId, userId), eq(dailyResearchSessions.tradeDate, indianTradeDate()), eq(dailyResearchSessions.isDryRun, isDryRun))).limit(1);
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
  const [sources, watchlist, gttRows] = await Promise.all([
    db.select().from(researchSources).where(and(eq(researchSources.userId, userId), eq(researchSources.sessionId, session.id))).orderBy(desc(researchSources.createdAt)),
    db.select().from(watchlistItems).where(and(eq(watchlistItems.userId, userId), eq(watchlistItems.sessionId, session.id))).orderBy(desc(watchlistItems.createdAt)),
    db.select().from(gttCandidates).where(and(eq(gttCandidates.userId, userId), eq(gttCandidates.sessionId, session.id))).orderBy(desc(gttCandidates.createdAt)),
  ]);
  return { session, sources, watchlist, gttCandidates: gttRows, providerWarnings: [] };
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

async function loadRcaLearnings(userId: string) {
  const rows = await db.select().from(rcaReports).where(eq(rcaReports.userId, userId)).orderBy(desc(rcaReports.createdAt)).limit(5);
  return rows.map((row) => ({
    tradeDate: row.tradeDate,
    summary: row.dailySummary,
    signals: (row.raw.signals as Array<{ symbol: string; pnl: number; outcome: string; lesson: string }> | undefined) ?? [],
  })).reverse();
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

async function buildPlan(input: { context: BrokerContext; sources: ResearchSource[]; model: string; llmApiKey: string | null; llmBaseUrl?: string; providerWarnings: string[]; researchSettings: MorningResearchSettings; rcaLearnings: Awaited<ReturnType<typeof loadRcaLearnings>> }): Promise<{ plan: MorningResearchPlan; conversation: AgentConversationTrace }> {
  const ideasMessages = buildMorningResearchIdeasMessages({ broker: input.context, sources: input.sources.slice(0, 12), settings: input.researchSettings, rcaLearnings: input.rcaLearnings });
  if (!input.llmApiKey) {
    input.providerWarnings.push('LLM API key missing; generated deterministic fallback plan.');
    const plan = fallbackPlan(input.context, input.sources, input.researchSettings);
    const gttMessages = buildMorningResearchGttMessages({ broker: input.context, sources: input.sources.slice(0, 12), settings: input.researchSettings, rcaLearnings: input.rcaLearnings, ideasPlan: plan });
    return { plan, conversation: fallbackConversation(input.model, [...ideasMessages, ...gttMessages], plan, 'LLM API key missing; deterministic fallback used.') };
  }

  const llm = new OpenAiCompatibleProvider(input.llmApiKey, input.llmBaseUrl);
  let ideasPlan: MorningResearchIdeasPlan;
  let ideasConversation: AgentConversationTrace;
  try {
    const result = await llm.generateJsonWithConversation({ model: input.model, temperature: 0.15, messages: ideasMessages });
    ideasPlan = normalizeIdeasPlan(result.json, input.context, input.sources, input.researchSettings);
    ideasConversation = { ...result.conversation, thoughtDetails: [...result.conversation.thoughtDetails, ...deriveIdeasThoughtDetails(ideasPlan)] };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'LLM plan failed';
    input.providerWarnings.push(message);
    const plan = fallbackPlan(input.context, input.sources, input.researchSettings);
    const gttMessages = buildMorningResearchGttMessages({ broker: input.context, sources: input.sources.slice(0, 12), settings: input.researchSettings, rcaLearnings: input.rcaLearnings, ideasPlan: plan });
    return { plan, conversation: fallbackConversation(input.model, [...ideasMessages, ...gttMessages], plan, message, 'failed') };
  }

  const gttMessages = buildMorningResearchGttMessages({ broker: input.context, sources: input.sources.slice(0, 12), settings: input.researchSettings, rcaLearnings: input.rcaLearnings, ideasPlan: ideasPlan as unknown as Record<string, unknown> });
  try {
    const result = await llm.generateJsonWithConversation({ model: input.model, temperature: 0.1, messages: gttMessages });
    const gttPlan = normalizeGttPlan(result.json, input.researchSettings);
    const plan: MorningResearchPlan = { ...ideasPlan, ...gttPlan };
    return { plan, conversation: mergeConversations(input.model, ideasConversation, { ...result.conversation, thoughtDetails: [...result.conversation.thoughtDetails, ...deriveGttThoughtDetails(gttPlan)] }, plan) };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'LLM GTT drafting failed';
    input.providerWarnings.push(message);
    const gttPlan = fallbackGttPlan(input.researchSettings);
    const plan: MorningResearchPlan = { ...ideasPlan, ...gttPlan };
    const fallbackGttConversation = fallbackConversation(input.model, gttMessages, plan, message, 'failed');
    return { plan, conversation: mergeConversations(input.model, ideasConversation, fallbackGttConversation, plan, 'failed', message) };
  }
}

function fallbackConversation(model: string, messages: LlmMessage[], plan: MorningResearchPlan, reason: string, status: 'fallback' | 'failed' = 'fallback'): AgentConversationTrace {
  const now = new Date().toISOString();
  return {
    provider: 'deterministic-fallback',
    model,
    startedAt: now,
    completedAt: now,
    status,
    messages: [
      ...messages.map((message) => ({ ...message, createdAt: now, metadata: { source: 'request' } })),
      { role: 'assistant', content: JSON.stringify(plan, null, 2), createdAt: now, metadata: { source: 'fallback_response', reason } },
    ],
    thoughtDetails: [{ title: 'Fallback path', detail: reason }, ...derivePlanThoughtDetails(plan)],
    rawResponse: { fallback: true, reason },
    error: status === 'failed' ? reason : undefined,
  };
}

function derivePlanThoughtDetails(plan: MorningResearchPlan) {
  return [
    ...deriveIdeasThoughtDetails(plan),
    ...deriveGttThoughtDetails(plan),
  ];
}

function deriveIdeasThoughtDetails(plan: MorningResearchIdeasPlan) {
  return [
    { title: 'Stage 1 ideas validated', detail: `${plan.watchlist.length} watchlist item(s), ${plan.tradeCandidates.length} transient trade candidate(s), ${plan.riskWarnings.length} risk warning(s). Trade candidates remain session-only.` },
    ...plan.tradeCandidates.map((item) => ({ title: `Transient idea · ${item.tradingsymbol}`, detail: item.thesis, metadata: { exchange: item.exchange, side: item.side, confidence: item.confidence, entryPlan: item.entryPlan, invalidation: item.invalidation } })),
  ];
}

function deriveGttThoughtDetails(plan: MorningResearchGttPlan) {
  return [
    { title: 'Stage 2 GTT drafts validated', detail: `${plan.gttCandidates.length} draft GTT candidate(s) selected for persistence.` },
    ...plan.gttCandidates.map((item) => ({ title: `Draft GTT · ${item.tradingsymbol}`, detail: item.rationale, metadata: { exchange: item.exchange, transactionType: item.transactionType, targetPrice: item.targetPrice, stopLossPrice: item.stopLossPrice, quantity: item.quantity } })),
  ];
}

function mergeConversations(model: string, stage1: AgentConversationTrace, stage2: AgentConversationTrace, plan: MorningResearchPlan, status: AgentConversationTrace['status'] = stage2.status === 'failed' ? 'failed' : 'completed', error?: string): AgentConversationTrace {
  return {
    provider: stage1.provider === stage2.provider ? stage1.provider : `${stage1.provider}+${stage2.provider}`,
    model,
    startedAt: stage1.startedAt,
    completedAt: stage2.completedAt,
    status,
    messages: [
      ...stage1.messages.map((message) => ({ ...message, metadata: { ...(message.metadata ?? {}), stage: 'ideas' } })),
      ...stage2.messages.map((message) => ({ ...message, metadata: { ...(message.metadata ?? {}), stage: 'gtt' } })),
    ],
    thoughtDetails: [
      ...stage1.thoughtDetails,
      ...stage2.thoughtDetails,
      { title: 'Two-stage research complete', detail: `${plan.tradeCandidates.length} transient idea(s) considered; ${plan.gttCandidates.length} GTT draft(s) selected for persistence.` },
    ],
    rawResponse: { stage1: stage1.rawResponse ?? {}, stage2: stage2.rawResponse ?? {} },
    error,
  };
}

function fallbackPlan(context: BrokerContext, sources: ResearchSource[], settings = DEFAULT_MORNING_RESEARCH_SETTINGS): MorningResearchPlan {
  const symbols = [...new Set([...context.positions.map((row) => row.tradingsymbol), ...context.holdings.map((row) => row.tradingsymbol), ...DEFAULT_SYMBOLS])].slice(0, settings.maxWatchlistItems);
  const tradeSymbols = symbols.slice(0, transientTradeCandidateLimit(settings));
  return {
    marketThesis: sources.length
      ? `Review ${sources.length} fresh source(s), but keep execution manual until Phase 4 risk checks are active.`
      : 'No external research providers were available. Use portfolio context only and avoid automated execution.',
    sectorBias: [{ sector: 'Broad market', bias: 'neutral', reason: 'Awaiting validated multi-provider research and risk-engine confirmation.' }],
    watchlist: symbols.map((symbol) => ({ exchange: symbol.includes('NIFTY') ? 'NFO' : 'NSE', tradingsymbol: symbol, bias: 'neutral', reason: 'Carry-forward broker context / benchmark watch item.' })),
    tradeCandidates: tradeSymbols.map((symbol) => ({ exchange: symbol.includes('NIFTY') ? 'NFO' : 'NSE', tradingsymbol: symbol, side: 'BUY', thesis: 'Deterministic fallback idea from broker context only; requires manual validation.', entryPlan: 'Wait for independently verified evidence and valid price levels before acting.', invalidation: 'Skip if fresh research, liquidity, or risk checks are unavailable.', confidence: 10 })),
    gttCandidates: [],
    riskWarnings: ['Automated execution is disabled for research output.', 'Validate every candidate manually until trigger/risk phases are implemented.'],
  };
}

function fallbackGttPlan(_settings = DEFAULT_MORNING_RESEARCH_SETTINGS): MorningResearchGttPlan {
  return { gttCandidates: [] };
}

function normalizeIdeasPlan(raw: Record<string, unknown>, context: BrokerContext, sources: ResearchSource[], settings = DEFAULT_MORNING_RESEARCH_SETTINGS): MorningResearchIdeasPlan {
  const fallback = fallbackPlan(context, sources, settings);
  const sectorBias = arrayValue(raw.sectorBias).slice(0, 8).map((item) => ({ sector: stringValue(item.sector) || 'Market', bias: normalizeSectorBias(item.bias), reason: stringValue(item.reason) || 'No reason supplied.' }));
  const watchlist = arrayValue(raw.watchlist).slice(0, settings.maxWatchlistItems).map((item) => ({ exchange: stringValue(item.exchange) || 'NSE', tradingsymbol: stringValue(item.tradingsymbol).toUpperCase(), bias: normalizeBias(item.bias), reason: stringValue(item.reason) || 'LLM watchlist item.' })).filter((item) => item.tradingsymbol);
  return {
    marketThesis: stringValue(raw.marketThesis) || fallback.marketThesis,
    sectorBias: sectorBias.length ? sectorBias : fallback.sectorBias,
    watchlist: watchlist.length ? watchlist : fallback.watchlist,
    tradeCandidates: arrayValue(raw.tradeCandidates).slice(0, transientTradeCandidateLimit(settings)).map((item) => ({ exchange: stringValue(item.exchange) || 'NSE', tradingsymbol: stringValue(item.tradingsymbol).toUpperCase(), side: normalizeSide(item.side), thesis: stringValue(item.thesis) || 'LLM transient trade candidate.', entryPlan: stringValue(item.entryPlan) || 'No entry plan supplied.', invalidation: stringValue(item.invalidation) || 'No invalidation supplied.', confidence: clampInt(Number(item.confidence ?? 0), 0, 100) })).filter((item) => item.tradingsymbol),
    riskWarnings: arrayValue(raw.riskWarnings).map((item) => String(item)).slice(0, 12),
  };
}

function normalizeGttPlan(raw: Record<string, unknown>, settings = DEFAULT_MORNING_RESEARCH_SETTINGS): MorningResearchGttPlan {
  return {
    gttCandidates: arrayValue(raw.gttCandidates).slice(0, settings.maxGttCandidates).map((item) => ({ exchange: stringValue(item.exchange) || 'NSE', tradingsymbol: stringValue(item.tradingsymbol).toUpperCase(), transactionType: normalizeSide(item.transactionType), triggerPrice: optionalNumber(item.triggerPrice ?? item.targetPrice), limitPrice: optionalNumber(item.limitPrice ?? item.stopLossPrice), stopLossPrice: optionalNumber(item.stopLossPrice ?? item.stoplossPrice ?? item.stop_loss_price ?? item.limitPrice), targetPrice: optionalNumber(item.targetPrice ?? item.target_price ?? item.target ?? item.triggerPrice), quantity: clampInt(Number(item.quantity ?? 1), 1, 1_000_000), rationale: stringValue(item.rationale) || 'Draft two-leg GTT suggestion.' })).filter((item) => item.tradingsymbol),
  };
}

export function indianTradeDate(date = new Date()): string {
  const ist = new Date(date.getTime() + 5.5 * 60 * 60 * 1000);
  return ist.toISOString().slice(0, 10);
}

function stringConfig(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function parseResearchSettings(config: Record<string, unknown>): MorningResearchSettings {
  return {
    maxWatchlistItems: configInt(config.maxWatchlistItems, DEFAULT_MORNING_RESEARCH_SETTINGS.maxWatchlistItems, 0, 24),
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
