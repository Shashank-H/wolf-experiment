import { and, desc, eq } from 'drizzle-orm';
import { db } from '../db/client';
import { apiKeys, dailyResearchSessions, gttCandidates, holdingsSnapshots, positions, rcaReports, researchSources, tradingPreferences, userSettings, watchlistItems } from '../db/schema';
import { ExaProvider } from '../providers/research/ExaProvider';
import { FinnhubProvider } from '../providers/research/FinnhubProvider';
import { OpenAiCompatibleProvider } from '../providers/research/OpenAiCompatibleProvider';
import { DEFAULT_MORNING_RESEARCH_SETTINGS, DEFAULT_TRADING_RISK_SETTINGS, buildMorningResearchGttMessages, buildMorningResearchIdeasMessages, transientTradeCandidateLimit } from '../prompts/morning-research';
import type { MorningResearchSettings, ResearchRiskTolerance, TradingRiskSettings } from '../prompts/morning-research';
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
  const [context, settings, preferences, secrets, rcaLearnings] = await Promise.all([
    loadBrokerContext(userId),
    db.select().from(userSettings).where(eq(userSettings.userId, userId)).limit(1),
    db.select().from(tradingPreferences).where(eq(tradingPreferences.userId, userId)).limit(1),
    loadSecrets(userId),
    loadRcaLearnings(userId),
  ]);
  const providerConfig = settings[0]?.providerConfig ?? {};
  const researchSettings = parseResearchSettings(providerConfig);
  const tradingRiskSettings = parseTradingRiskSettings(preferences[0]);
  const providerWarnings: string[] = [];
  const symbols = [...new Set([...context.holdings.map((row) => row.tradingsymbol), ...context.positions.map((row) => row.tradingsymbol), ...DEFAULT_SYMBOLS])].slice(0, 16);
  const model = typeof providerConfig.mediumModel === 'string' && providerConfig.mediumModel.trim() ? providerConfig.mediumModel.trim() : 'gpt-4o-mini';
  assertResearchPreflight(secrets);
  const { sources, errors: sourceErrors } = await collectSources(symbols, secrets);
  providerWarnings.push(...sourceErrors);
  let plan: MorningResearchPlan;
  let conversation: AgentConversationTrace;
  try {
    if (!sources.length) throw new Error(`Morning research requires at least one successful external source: ${sourceErrors.join('; ') || 'no sources returned'}`);
    ({ plan, conversation } = await buildPlan({ context, sources, model, llmApiKey: secrets.llmApiKey, llmBaseUrl: stringConfig(providerConfig.llmBaseUrl), providerWarnings, researchSettings, tradingRiskSettings, rcaLearnings }));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Morning research failed';
    const session = await persistFailedResearchSession({ userId, tradeDate, isDryRun, model, message, providerWarnings, context, sources });
    await audit('research.morning.failed', { userId, entityType: 'daily_research_session', entityId: session.id, metadata: { tradeDate, error: message, sources: sources.length } });
    throw error;
  }

  const [session] = await db.insert(dailyResearchSessions).values({
    userId,
    tradeDate,
    status: 'completed',
    marketThesis: plan.marketThesis,
    sectorBias: plan.sectorBias,
    riskWarnings: [...plan.riskWarnings, ...providerWarnings],
    model,
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
      model,
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

function assertResearchPreflight(secrets: Awaited<ReturnType<typeof loadSecrets>>) {
  if (!secrets.llmApiKey) throw new Error('LLM API key is required before morning research can start');
  if (!secrets.exaApiKey && !secrets.finnhubApiKey) throw new Error('At least one research source provider is required before morning research can start: configure Exa or Finnhub');
}

async function collectSources(symbols: string[], secrets: Awaited<ReturnType<typeof loadSecrets>>): Promise<{ sources: ResearchSource[]; errors: string[] }> {
  const tasks: Array<{ provider: string; promise: Promise<ResearchSource[]> }> = [];
  const errors: string[] = [];
  if (secrets.exaApiKey) tasks.push({ provider: 'exa', promise: new ExaProvider(secrets.exaApiKey).search({ query: `Indian equity market news ${symbols.slice(0, 8).join(' ')}`, symbols, limit: 8 }) });
  if (secrets.finnhubApiKey) tasks.push({ provider: 'finnhub', promise: new FinnhubProvider(secrets.finnhubApiKey).search({ query: 'market news', symbols: symbols.filter((symbol) => /^[A-Z.]+$/.test(symbol)), limit: 8 }) });
  const settled = await Promise.allSettled(tasks.map((task) => task.promise));
  const sources: ResearchSource[] = [];
  for (const [index, result] of settled.entries()) {
    const provider = tasks[index]?.provider ?? 'research';
    if (result.status === 'fulfilled') {
      if (result.value.length) sources.push(...result.value);
      else errors.push(`${provider} returned no research sources`);
    } else {
      errors.push(`${provider} failed: ${result.reason instanceof Error ? result.reason.message : 'Research provider failed'}`);
    }
  }
  return { sources: sources.slice(0, 24), errors };
}

async function buildPlan(input: { context: BrokerContext; sources: ResearchSource[]; model: string; llmApiKey: string | null; llmBaseUrl?: string; providerWarnings: string[]; researchSettings: MorningResearchSettings; tradingRiskSettings: TradingRiskSettings; rcaLearnings: Awaited<ReturnType<typeof loadRcaLearnings>> }): Promise<{ plan: MorningResearchPlan; conversation: AgentConversationTrace }> {
  if (!input.llmApiKey) throw new Error('LLM API key is required before morning research can start');
  const llm = new OpenAiCompatibleProvider(input.llmApiKey, input.llmBaseUrl);

  const ideasMessages = buildMorningResearchIdeasMessages({ broker: input.context, sources: input.sources.slice(0, 12), settings: input.researchSettings, tradingRisk: input.tradingRiskSettings, rcaLearnings: input.rcaLearnings });
  const ideasResult = await generateValidatedJsonWithRetry({
    llm,
    model: input.model,
    temperature: 0.15,
    messages: ideasMessages,
    stage: 'ideas',
    validate: (json) => normalizeIdeasPlan(json, input.researchSettings),
  });
  const ideasPlan = ideasResult.value;
  const ideasConversation = { ...ideasResult.conversation, thoughtDetails: [...ideasResult.conversation.thoughtDetails, ...deriveIdeasThoughtDetails(ideasPlan)] };

  const gttMessages = buildMorningResearchGttMessages({ broker: input.context, sources: input.sources.slice(0, 12), settings: input.researchSettings, tradingRisk: input.tradingRiskSettings, rcaLearnings: input.rcaLearnings, ideasPlan: ideasPlan as unknown as Record<string, unknown> });
  const gttResult = await generateValidatedJsonWithRetry({
    llm,
    model: input.model,
    temperature: 0.1,
    messages: gttMessages,
    stage: 'gtt',
    validate: (json) => normalizeGttPlan(json, input.researchSettings),
  });
  const gttPlan = gttResult.value;
  const plan: MorningResearchPlan = { ...ideasPlan, ...gttPlan };
  return { plan, conversation: mergeConversations(input.model, ideasConversation, { ...gttResult.conversation, thoughtDetails: [...gttResult.conversation.thoughtDetails, ...deriveGttThoughtDetails(gttPlan)] }, plan) };
}

type ValidatedJsonRequest<T> = {
  llm: OpenAiCompatibleProvider;
  model: string;
  temperature: number;
  messages: LlmMessage[];
  stage: string;
  validate: (json: Record<string, unknown>) => T;
};

const llmRepairAttempts = 1;

async function generateValidatedJsonWithRetry<T>(input: ValidatedJsonRequest<T>): Promise<{ value: T; conversation: AgentConversationTrace }> {
  let messages = input.messages;
  let lastError: unknown;
  for (let attempt = 0; attempt <= llmRepairAttempts; attempt += 1) {
    try {
      const result = await input.llm.generateJsonWithConversation({ model: input.model, temperature: input.temperature, messages });
      const value = input.validate(result.json);
      return {
        value,
        conversation: {
          ...result.conversation,
          messages: result.conversation.messages.map((message) => ({ ...message, metadata: { ...(message.metadata ?? {}), stage: input.stage, attempt: attempt + 1 } })),
          rawResponse: { ...(result.conversation.rawResponse ?? {}), attempts: attempt + 1, repaired: attempt > 0 },
        },
      };
    } catch (error) {
      lastError = error;
      if (attempt >= llmRepairAttempts) break;
      messages = [
        ...input.messages,
        {
          role: 'user',
          content: [
            `The previous ${input.stage} response was invalid: ${error instanceof Error ? error.message : 'invalid response'}.`,
            'Retry once and return only a corrected JSON object that exactly matches the requested schema.',
            'Do not invent defaults for missing fields; provide evidence-backed values or empty arrays only where the schema permits empty arrays.',
          ].join('\n'),
        },
      ];
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`LLM ${input.stage} response failed validation`);
}

function failedConversation(model: string, reason: string, providerWarnings: string[], sources: ResearchSource[]): AgentConversationTrace {
  const now = new Date().toISOString();
  return {
    provider: 'openai-compatible',
    model,
    startedAt: now,
    completedAt: now,
    status: 'failed',
    messages: [{ role: 'assistant', content: reason, createdAt: now, metadata: { source: 'error' } }],
    thoughtDetails: [{ title: 'Morning research failed', detail: reason, metadata: { providerWarnings, sourceCount: sources.length } }],
    rawResponse: { failed: true, providerWarnings, sourceCount: sources.length },
    error: reason,
  };
}

async function persistFailedResearchSession(input: { userId: string; tradeDate: string; isDryRun: boolean; model: string; message: string; providerWarnings: string[]; context: BrokerContext; sources: ResearchSource[] }) {
  const conversation = failedConversation(input.model, input.message, input.providerWarnings, input.sources);
  const [session] = await db.insert(dailyResearchSessions).values({
    userId: input.userId,
    tradeDate: input.tradeDate,
    status: 'failed',
    marketThesis: '',
    sectorBias: [],
    riskWarnings: [input.message, ...input.providerWarnings],
    model: input.model,
    rawPlan: { error: input.message, sourceCount: input.sources.length },
    agentConversation: conversation as unknown as Record<string, unknown>,
    isDryRun: input.isDryRun,
    dryRunStatus: input.isDryRun ? 'failed' : null,
    dryRunSummary: input.isDryRun ? `Dry run morning research failed: ${input.message}` : '',
  }).onConflictDoUpdate({
    target: [dailyResearchSessions.userId, dailyResearchSessions.tradeDate, dailyResearchSessions.isDryRun],
    set: {
      status: 'failed',
      marketThesis: '',
      sectorBias: [],
      riskWarnings: [input.message, ...input.providerWarnings],
      model: input.model,
      rawPlan: { error: input.message, sourceCount: input.sources.length },
      agentConversation: conversation as unknown as Record<string, unknown>,
      dryRunStatus: input.isDryRun ? 'failed' : null,
      dryRunSummary: input.isDryRun ? `Dry run morning research failed: ${input.message}` : '',
      dryRunCompletedAt: null,
      dryRunTotalPnl: '0',
      updatedAt: new Date(),
    },
  }).returning();
  await Promise.all([
    db.delete(researchSources).where(eq(researchSources.sessionId, session.id)),
    db.delete(gttCandidates).where(eq(gttCandidates.sessionId, session.id)),
    db.delete(watchlistItems).where(and(eq(watchlistItems.userId, input.userId), eq(watchlistItems.tradeDate, input.tradeDate), eq(watchlistItems.source, 'ai'))),
  ]);
  return session;
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

function normalizeIdeasPlan(raw: Record<string, unknown>, settings = DEFAULT_MORNING_RESEARCH_SETTINGS): MorningResearchIdeasPlan {
  const errors: string[] = [];
  const marketThesis = requiredString(raw.marketThesis, 'marketThesis', errors);
  const sectorBiasInput = requiredRecordArray(raw.sectorBias, 'sectorBias', errors);
  const watchlistInput = requiredRecordArray(raw.watchlist, 'watchlist', errors);
  const tradeCandidatesInput = requiredRecordArray(raw.tradeCandidates, 'tradeCandidates', errors);
  const riskWarningsInput = requiredArray(raw.riskWarnings, 'riskWarnings', errors);

  const sectorBias = sectorBiasInput.slice(0, 8).map((item, index) => ({
    sector: requiredString(item.sector, `sectorBias[${index}].sector`, errors),
    bias: requiredEnum(item.bias, `sectorBias[${index}].bias`, ['bullish', 'bearish', 'neutral'] as const, errors),
    reason: requiredString(item.reason, `sectorBias[${index}].reason`, errors),
  }));
  const watchlist = watchlistInput.slice(0, settings.maxWatchlistItems).map((item, index) => ({
    exchange: requiredExchange(item.exchange, `watchlist[${index}].exchange`, errors),
    tradingsymbol: requiredSymbol(item.tradingsymbol, `watchlist[${index}].tradingsymbol`, errors),
    bias: requiredEnum(item.bias, `watchlist[${index}].bias`, ['long', 'short', 'neutral'] as const, errors),
    reason: requiredString(item.reason, `watchlist[${index}].reason`, errors),
  }));
  const tradeCandidates = tradeCandidatesInput.slice(0, transientTradeCandidateLimit(settings)).map((item, index) => ({
    exchange: requiredExchange(item.exchange, `tradeCandidates[${index}].exchange`, errors),
    tradingsymbol: requiredSymbol(item.tradingsymbol, `tradeCandidates[${index}].tradingsymbol`, errors),
    side: requiredEnum(item.side, `tradeCandidates[${index}].side`, ['BUY', 'SELL'] as const, errors),
    thesis: requiredString(item.thesis, `tradeCandidates[${index}].thesis`, errors),
    entryPlan: requiredString(item.entryPlan, `tradeCandidates[${index}].entryPlan`, errors),
    invalidation: requiredString(item.invalidation, `tradeCandidates[${index}].invalidation`, errors),
    confidence: requiredInt(item.confidence, `tradeCandidates[${index}].confidence`, 0, 100, errors),
  }));
  const riskWarnings = riskWarningsInput.map((item, index) => requiredString(item, `riskWarnings[${index}]`, errors)).slice(0, 12);

  if (!sectorBias.length) errors.push('sectorBias must contain at least one item');
  if (!watchlist.length) errors.push('watchlist must contain at least one item');
  if (errors.length) throw new Error(`Invalid ideas research JSON: ${errors.join('; ')}`);
  return { marketThesis, sectorBias, watchlist, tradeCandidates, riskWarnings };
}

function normalizeGttPlan(raw: Record<string, unknown>, settings = DEFAULT_MORNING_RESEARCH_SETTINGS): MorningResearchGttPlan {
  const errors: string[] = [];
  const gttCandidatesInput = requiredRecordArray(raw.gttCandidates, 'gttCandidates', errors);
  const gttCandidates = gttCandidatesInput.slice(0, settings.maxGttCandidates).map((item, index) => {
    const targetPrice = requiredPositiveNumber(item.targetPrice, `gttCandidates[${index}].targetPrice`, errors);
    const stopLossPrice = requiredPositiveNumber(item.stopLossPrice, `gttCandidates[${index}].stopLossPrice`, errors);
    const transactionType = requiredEnum(item.transactionType, `gttCandidates[${index}].transactionType`, ['BUY', 'SELL'] as const, errors);
    if (targetPrice !== undefined && stopLossPrice !== undefined) {
      if (targetPrice === stopLossPrice) errors.push(`gttCandidates[${index}].targetPrice and stopLossPrice must differ`);
      if (transactionType === 'SELL' && targetPrice <= stopLossPrice) errors.push(`gttCandidates[${index}] SELL exit requires targetPrice above stopLossPrice`);
      if (transactionType === 'BUY' && targetPrice >= stopLossPrice) errors.push(`gttCandidates[${index}] BUY exit requires targetPrice below stopLossPrice`);
    }
    return {
      exchange: requiredExchange(item.exchange, `gttCandidates[${index}].exchange`, errors),
      tradingsymbol: requiredSymbol(item.tradingsymbol, `gttCandidates[${index}].tradingsymbol`, errors),
      transactionType,
      triggerPrice: optionalPositiveNumberStrict(item.triggerPrice, `gttCandidates[${index}].triggerPrice`, errors),
      limitPrice: optionalPositiveNumberStrict(item.limitPrice, `gttCandidates[${index}].limitPrice`, errors),
      targetPrice,
      stopLossPrice,
      quantity: requiredInt(item.quantity, `gttCandidates[${index}].quantity`, 1, 1_000_000, errors),
      rationale: requiredString(item.rationale, `gttCandidates[${index}].rationale`, errors),
    };
  });
  if (errors.length) throw new Error(`Invalid GTT research JSON: ${errors.join('; ')}`);
  return { gttCandidates };
}

function requiredArray(value: unknown, path: string, errors: string[]): unknown[] {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`);
    return [];
  }
  return value;
}

function requiredRecordArray(value: unknown, path: string, errors: string[]): Array<Record<string, unknown>> {
  const items = requiredArray(value, path, errors);
  const records: Array<Record<string, unknown>> = [];
  items.forEach((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) errors.push(`${path}[${index}] must be an object`);
    else records.push(item as Record<string, unknown>);
  });
  return records;
}

function requiredString(value: unknown, path: string, errors: string[]): string {
  const text = stringValue(value);
  if (!text) errors.push(`${path} is required`);
  return text;
}

function requiredSymbol(value: unknown, path: string, errors: string[]): string {
  const symbol = requiredString(value, path, errors).toUpperCase();
  if (symbol && !/^[A-Z0-9 ._-]+$/.test(symbol)) errors.push(`${path} has invalid characters`);
  return symbol;
}

function requiredExchange(value: unknown, path: string, errors: string[]): 'NSE' | 'NFO' {
  return requiredEnum(value, path, ['NSE', 'NFO'] as const, errors);
}

function requiredEnum<const T extends readonly string[]>(value: unknown, path: string, allowed: T, errors: string[]): T[number] {
  const text = stringValue(value).toUpperCase();
  const match = allowed.find((item) => item.toUpperCase() === text);
  if (!match) errors.push(`${path} must be one of ${allowed.join(', ')}`);
  return (match ?? allowed[0]) as T[number];
}

function requiredInt(value: unknown, path: string, min: number, max: number, errors: string[]): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) {
    errors.push(`${path} must be an integer between ${min} and ${max}`);
    return min;
  }
  return number;
}

function requiredPositiveNumber(value: unknown, path: string, errors: string[]): number {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    errors.push(`${path} must be a positive number`);
    return 0;
  }
  return number;
}

function optionalPositiveNumberStrict(value: unknown, path: string, errors: string[]): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    errors.push(`${path} must be a positive number when supplied`);
    return undefined;
  }
  return number;
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

function parseTradingRiskSettings(preferences?: { maxDailyLoss?: unknown; maxTradesPerDay?: unknown; maxCapitalPerTrade?: unknown; maxOpenPositions?: unknown }): TradingRiskSettings {
  return {
    maxDailyLoss: configInt(preferences?.maxDailyLoss, DEFAULT_TRADING_RISK_SETTINGS.maxDailyLoss, 0, Number.MAX_SAFE_INTEGER),
    maxTradesPerDay: configInt(preferences?.maxTradesPerDay, DEFAULT_TRADING_RISK_SETTINGS.maxTradesPerDay, 0, Number.MAX_SAFE_INTEGER),
    maxCapitalPerTrade: configInt(preferences?.maxCapitalPerTrade, DEFAULT_TRADING_RISK_SETTINGS.maxCapitalPerTrade, 0, Number.MAX_SAFE_INTEGER),
    maxOpenPositions: configInt(preferences?.maxOpenPositions, DEFAULT_TRADING_RISK_SETTINGS.maxOpenPositions, 0, Number.MAX_SAFE_INTEGER),
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

function normalizeBias(value: unknown): 'long' | 'short' | 'neutral' {
  const text = stringValue(value).toLowerCase();
  return text === 'long' || text === 'bullish' ? 'long' : text === 'short' || text === 'bearish' ? 'short' : 'neutral';
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}
