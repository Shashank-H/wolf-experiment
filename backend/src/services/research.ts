import { and, desc, eq } from 'drizzle-orm';
import { db } from '../db/client';
import { apiKeys, dailyResearchSessions, gttCandidates, holdingsSnapshots, marketSnapshots, positions, rcaReports, researchSources, tradingPreferences, userSettings, watchlistItems } from '../db/schema';
import { ExaProvider } from '../providers/research/ExaProvider';
import { FinnhubProvider } from '../providers/research/FinnhubProvider';
import { NseMarketMoverProvider } from '../providers/research/NseMarketMoverProvider';
import { OpenAiCompatibleProvider } from '../providers/research/OpenAiCompatibleProvider';
import { DEFAULT_MORNING_RESEARCH_SETTINGS, DEFAULT_TRADING_RISK_SETTINGS, buildMorningResearchGttMessages, buildMorningResearchIdeasMessages, transientTradeCandidateLimit } from '../prompts/morning-research';
import type { MorningResearchSettings, ResearchRiskTolerance, TradingRiskSettings } from '../prompts/morning-research';
import type { AgentConversationTrace, CatalystDirection, CatalystType, LlmMessage, MarketCandidate, MorningResearchGttPlan, MorningResearchIdeasPlan, MorningResearchPlan, ResearchSource } from '../providers/research/types';
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

type DiscoverySettings = {
  candidateShortlistSize: number;
  broadSourceLimit: number;
  focusedSourceLimit: number;
  sourceLimit: number;
  snapshotLimit: number;
  promptSourceLimit: number;
  freshnessHours: number;
  newsLookbackDays: number;
  minVolume: number;
  enableReactiveMoverConfirmation: boolean;
};

const DEFAULT_DISCOVERY_SETTINGS: DiscoverySettings = {
  // Number of catalyst candidates that survive filtering/ranking and are passed to the LLM.
  candidateShortlistSize: 12,
  // Max broad pre-market news/search sources to collect before symbol extraction.
  broadSourceLimit: 10,
  // Max focused follow-up sources to collect for each shortlisted candidate.
  focusedSourceLimit: 3,
  // Max total deduped research sources persisted and supplied downstream.
  sourceLimit: 24,
  // Max recent quote snapshots to inspect when enriching catalyst candidates with price/liquidity context.
  snapshotLimit: 500,
  // Max sources to include directly in the final research prompt context.
  promptSourceLimit: 12,
  // Freshness window for catalyst evidence and market snapshots.
  freshnessHours: 36,
  // Lookback window used when querying news/search providers.
  newsLookbackDays: 7,
  // Minimum volume for a candidate to count as liquidity-validated for GTT readiness.
  minVolume: 1,
  // Optional after-open/fallback confirmation from reactive NSE top movers; disabled for pre-market primary discovery.
  enableReactiveMoverConfirmation: false,
};

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
  const discoverySettings = parseDiscoverySettings(providerConfig);
  const providerWarnings: string[] = [];
  const model = typeof providerConfig.mediumModel === 'string' && providerConfig.mediumModel.trim() ? providerConfig.mediumModel.trim() : 'gpt-4o-mini';
  const smallModel = typeof providerConfig.smallModel === 'string' && providerConfig.smallModel.trim() ? providerConfig.smallModel.trim() : 'gpt-4o-mini';
  assertResearchPreflight(secrets);
  const discovery = await discoverMarketCandidates({ userId, secrets, settings: discoverySettings, symbolBlacklist: preferences[0]?.symbolBlacklist ?? [], smallModel, llmBaseUrl: stringConfig(providerConfig.llmBaseUrl) });
  const { candidates, sources, errors: sourceErrors } = discovery;
  providerWarnings.push(...sourceErrors);
  let plan: MorningResearchPlan;
  let conversation: AgentConversationTrace;
  try {
    if (!sources.length) throw new Error(`Morning research requires at least one successful external source: ${sourceErrors.join('; ') || 'no sources returned'}`);
    ({ plan, conversation } = await buildPlan({ context, discoveredCandidates: candidates, sources, model, llmApiKey: secrets.llmApiKey, llmBaseUrl: stringConfig(providerConfig.llmBaseUrl), providerWarnings, researchSettings, tradingRiskSettings, discoverySettings, rcaLearnings }));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Morning research failed';
    const session = await persistFailedResearchSession({ userId, tradeDate, isDryRun, model, message, providerWarnings, context, discoveredCandidates: candidates, sources });
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
    rawPlan: { ...(plan as unknown as Record<string, unknown>), discovery: discoveryMetadata(candidates, sourceErrors, discoverySettings) },
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
      rawPlan: { ...(plan as unknown as Record<string, unknown>), discovery: discoveryMetadata(candidates, sourceErrors, discoverySettings) },
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
      raw: { ...(source.raw ?? {}), discovery: { candidateSymbols: candidates.filter((candidate) => source.symbols.includes(candidate.tradingsymbol)).map((candidate) => `${candidate.exchange}:${candidate.tradingsymbol}`) } },
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
}

async function discoverMarketCandidates(input: { userId: string; secrets: Awaited<ReturnType<typeof loadSecrets>>; settings: DiscoverySettings; symbolBlacklist: string[]; smallModel: string; llmBaseUrl?: string }): Promise<{ candidates: MarketCandidate[]; sources: ResearchSource[]; errors: string[] }> {
  const catalyst = await discoverCatalystCandidates(input);
  const catalystCandidates = rankCandidates(filterCandidates(dedupeCandidates(extractCandidatesFromSources(catalyst.sources)), input.symbolBlacklist, input.settings, { requirePriceAndLiquidity: false }), input.settings);
  const enrichedCandidates = enrichCandidatesWithSnapshots(catalystCandidates, await loadRecentSnapshotCandidates(input.userId, input.settings));
  const focused = enrichedCandidates.length ? await collectSources({ secrets: input.secrets, settings: input.settings, candidates: enrichedCandidates, smallModel: input.smallModel, llmBaseUrl: input.llmBaseUrl }) : { sources: [], errors: [] };
  const focusedExtracted = extractCandidatesFromSources(focused.sources);
  const ranked = rankCandidates(filterCandidates(dedupeCandidates([...enrichedCandidates, ...focusedExtracted]), input.symbolBlacklist, input.settings, { requirePriceAndLiquidity: false }), input.settings);
  const confirmed = await maybeConfirmWithReactiveMovers(ranked, input.settings);
  const allSources = mergeSources([...candidateSources(confirmed), ...catalyst.sources, ...focused.sources], input.settings.sourceLimit);
  return { candidates: attachCandidateSymbolsToSourcesToCandidates(confirmed, allSources), sources: attachCandidateSymbolsToSources(allSources, confirmed), errors: [...catalyst.errors, ...focused.errors] };
}

const PRE_MARKET_CATALYST_QUERIES = [
  'NSE stocks in news today India pre market',
  'Indian stocks likely to move today results order win approval',
  'stocks to watch today NSE earnings results',
  'NSE companies order wins approvals acquisitions today',
  'brokerage upgrade downgrade Indian stocks today',
  'Indian sectors in focus today global cues crude rupee rates',
];

async function discoverCatalystCandidates(input: { secrets: Awaited<ReturnType<typeof loadSecrets>>; settings: DiscoverySettings; smallModel: string; llmBaseUrl?: string }): Promise<{ sources: ResearchSource[]; errors: string[] }> {
  const tasks: Array<{ provider: string; promise: Promise<ResearchSource[]> }> = [];
  if (input.secrets.exaApiKey) {
    const perQueryLimit = Math.max(2, Math.ceil(input.settings.broadSourceLimit / PRE_MARKET_CATALYST_QUERIES.length));
    for (const query of PRE_MARKET_CATALYST_QUERIES) {
      tasks.push({ provider: 'exa', promise: new ExaProvider(input.secrets.exaApiKey).search({ query, limit: perQueryLimit, lookbackDays: input.settings.newsLookbackDays }) });
    }
  }
  const settled = await Promise.allSettled(tasks.map((task) => task.promise));
  const sources: ResearchSource[] = [];
  const errors: string[] = [];
  for (const [index, result] of settled.entries()) {
    const provider = tasks[index]?.provider ?? 'research';
    if (result.status === 'fulfilled') {
      if (result.value.length) sources.push(...result.value);
      else errors.push(`${provider} returned no catalyst sources`);
    } else {
      errors.push(`${provider} failed: ${result.reason instanceof Error ? result.reason.message : 'Research provider failed'}`);
    }
  }
  const classified = await classifySourcesWithSmallModel(sources, input.secrets.llmApiKey, input.smallModel, input.llmBaseUrl);
  return { sources: mergeSources(classified, input.settings.sourceLimit), errors };
}

type CatalystClassification = {
  symbols: string[];
  type: CatalystType;
  direction: CatalystDirection;
  strength: number;
  confidence?: number;
  rationale?: string;
};

async function classifySourcesWithSmallModel(sources: ResearchSource[], llmApiKey: string | null, smallModel: string, llmBaseUrl?: string): Promise<ResearchSource[]> {
  if (!sources.length) return sources;
  if (!llmApiKey) return sources.map((source) => attachFallbackClassification(source));
  try {
    const provider = new OpenAiCompatibleProvider(llmApiKey, llmBaseUrl);
    const json = await provider.generateJson({
      model: smallModel,
      temperature: 0,
      messages: [
        { role: 'system', content: 'Classify Indian equity news for a pre-market research agent. Return strict JSON only. Extract explicit NSE cash-equity symbols/tickers mentioned by the source. Do not infer a ticker if the source does not mention one. Classify catalystType as one of earnings, order_win, mna, regulatory, corporate_action, brokerage_rating, sector_cue, global_cue, management_commentary, litigation_or_risk, other_news. Classify direction as positive, negative, mixed, or unknown. Strength is an integer 0-35 based on likely next-session move impact.' },
        { role: 'user', content: JSON.stringify({ sources: sources.map((source, id) => ({ id, provider: source.provider, title: source.title, summary: source.summary, symbols: source.symbols, publishedAt: source.publishedAt })) }) },
      ],
    });
    const rows = Array.isArray(json.classifications) ? json.classifications : [];
    const byId = new Map<number, CatalystClassification>();
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      const record = row as Record<string, unknown>;
      const id = Number(record.id);
      if (!Number.isInteger(id)) continue;
      byId.set(id, {
        symbols: stringArray(record.symbols).map(normalizeSymbol).filter(isNseEquitySymbol),
        type: catalystTypeValue(record.catalystType),
        direction: catalystDirectionValue(record.direction),
        strength: boundedNumber(record.strength, 0, 35, 8),
        confidence: boundedNumber(record.confidence, 0, 1, 0.5),
        rationale: typeof record.rationale === 'string' ? record.rationale : undefined,
      });
    }
    return sources.map((source, id) => attachClassification(source, byId.get(id) ?? fallbackClassification(source)));
  } catch {
    return sources.map((source) => attachFallbackClassification(source));
  }
}

function attachClassification(source: ResearchSource, classification: CatalystClassification): ResearchSource {
  return {
    ...source,
    symbols: [...new Set([...source.symbols.map(normalizeSymbol), ...classification.symbols].filter(isNseEquitySymbol))],
    raw: { ...(source.raw ?? {}), catalyst: classification },
  };
}

function attachFallbackClassification(source: ResearchSource): ResearchSource {
  return attachClassification(source, fallbackClassification(source));
}

function fallbackClassification(source: ResearchSource): CatalystClassification {
  return { symbols: source.symbols.map(normalizeSymbol).filter(isNseEquitySymbol), type: 'other_news', direction: 'unknown', strength: 8, confidence: 0.1, rationale: 'Small-model classification unavailable; using provider symbols only.' };
}

async function maybeConfirmWithReactiveMovers(candidates: MarketCandidate[], settings: DiscoverySettings): Promise<MarketCandidate[]> {
  if (!settings.enableReactiveMoverConfirmation) return candidates;
  try {
    const reactive = await new NseMarketMoverProvider().discover({ limit: settings.candidateShortlistSize });
    const reactiveBySymbol = new Map(reactive.map((candidate) => [candidate.tradingsymbol, candidate]));
    return candidates.map((candidate) => {
      const match = reactiveBySymbol.get(candidate.tradingsymbol);
      if (!match) return candidate;
      return {
        ...candidate,
        lastPrice: candidate.lastPrice ?? match.lastPrice,
        referencePrice: candidate.referencePrice ?? match.referencePrice,
        changePercent: candidate.changePercent ?? match.changePercent,
        volume: Math.max(candidate.volume ?? 0, match.volume ?? 0) || candidate.volume,
        turnover: Math.max(candidate.turnover ?? 0, match.turnover ?? 0) || candidate.turnover,
        reactiveSignal: true,
        discoveredBy: [...new Set([...candidate.discoveredBy, 'nse_market_movers_confirmation'])],
        evidence: [...candidate.evidence, ...match.evidence.map((item) => ({ ...item, provider: 'nse_market_movers_confirmation' }))].slice(0, 8),
        ranking: candidate.ranking ? { ...candidate.ranking, reasons: [...candidate.ranking.reasons, 'reactive mover confirmation after open'] } : candidate.ranking,
      };
    });
  } catch {
    return candidates;
  }
}

async function collectSources(input: { secrets: Awaited<ReturnType<typeof loadSecrets>>; settings: DiscoverySettings; candidates: MarketCandidate[]; smallModel?: string; llmBaseUrl?: string }): Promise<{ sources: ResearchSource[]; errors: string[] }> {
  const tasks: Array<{ provider: string; promise: Promise<ResearchSource[]> }> = [];
  const errors: string[] = [];
  for (const candidate of input.candidates.slice(0, input.settings.candidateShortlistSize)) {
    const query = `${candidate.exchange} ${candidate.tradingsymbol} catalyst news results order approval rating today India`;
    if (input.secrets.exaApiKey) tasks.push({ provider: 'exa', promise: new ExaProvider(input.secrets.exaApiKey).search({ query, symbols: [candidate.tradingsymbol], limit: input.settings.focusedSourceLimit, lookbackDays: input.settings.newsLookbackDays }) });
    if (input.secrets.finnhubApiKey) tasks.push({ provider: 'finnhub', promise: new FinnhubProvider(input.secrets.finnhubApiKey).search({ query, symbols: [candidate.tradingsymbol], limit: input.settings.focusedSourceLimit, lookbackDays: input.settings.newsLookbackDays }) });
  }
  if (!input.candidates.length) {
    const query = PRE_MARKET_CATALYST_QUERIES[0];
    if (input.secrets.exaApiKey) tasks.push({ provider: 'exa', promise: new ExaProvider(input.secrets.exaApiKey).search({ query, limit: input.settings.broadSourceLimit, lookbackDays: input.settings.newsLookbackDays }) });
  }
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
  const classified = await classifySourcesWithSmallModel(sources, input.secrets.llmApiKey, input.smallModel ?? 'gpt-4o-mini', input.llmBaseUrl);
  return { sources: mergeSources(classified, input.settings.sourceLimit), errors };
}

async function loadRecentSnapshotCandidates(userId: string, settings: DiscoverySettings): Promise<MarketCandidate[]> {
  const freshAfter = Date.now() - settings.freshnessHours * 60 * 60 * 1000;
  const rows = await db.select().from(marketSnapshots).where(eq(marketSnapshots.userId, userId)).orderBy(desc(marketSnapshots.capturedAt)).limit(settings.snapshotLimit);
  return rows
    .filter((row) => row.capturedAt.getTime() >= freshAfter)
    .map((row) => ({
      exchange: row.exchange.toUpperCase(),
      tradingsymbol: normalizeSymbol(row.tradingsymbol),
      instrumentType: 'EQ' as const,
      lastPrice: positiveNumber(row.lastPrice),
      referencePrice: positiveNumber(row.lastPrice),
      changePercent: finiteNumber(row.changePercent),
      volume: Number(row.volume ?? 0),
      discoveredBy: ['market_snapshot_validation'],
      evidence: [{ provider: 'market_snapshot_validation', title: 'Recent quote/snapshot validation', publishedAt: row.capturedAt.toISOString(), raw: row.raw }],
      validationStatus: 'price_validated' as const,
      raw: { marketSnapshotId: row.id, capturedAt: row.capturedAt.toISOString() },
    }));
}

function enrichCandidatesWithSnapshots(candidates: MarketCandidate[], snapshots: MarketCandidate[]): MarketCandidate[] {
  const bySymbol = new Map(snapshots.map((snapshot) => [snapshot.tradingsymbol, snapshot]));
  return candidates.map((candidate) => {
    const snapshot = bySymbol.get(candidate.tradingsymbol);
    if (!snapshot) return { ...candidate, validationStatus: candidate.lastPrice || candidate.referencePrice ? 'price_validated' : 'watchlist_only' };
    const hasLiquidity = (snapshot.volume ?? 0) > 0 || (snapshot.turnover ?? 0) > 0;
    return {
      ...candidate,
      lastPrice: candidate.lastPrice ?? snapshot.lastPrice,
      referencePrice: candidate.referencePrice ?? snapshot.referencePrice,
      changePercent: candidate.changePercent ?? snapshot.changePercent,
      volume: Math.max(candidate.volume ?? 0, snapshot.volume ?? 0) || candidate.volume,
      turnover: Math.max(candidate.turnover ?? 0, snapshot.turnover ?? 0) || candidate.turnover,
      validationStatus: hasLiquidity ? 'gtt_ready' : 'price_validated',
      discoveredBy: [...new Set([...candidate.discoveredBy, ...snapshot.discoveredBy])],
      evidence: [...candidate.evidence, ...snapshot.evidence].slice(0, 8),
    };
  });
}

function extractCandidatesFromSources(sources: ResearchSource[]): MarketCandidate[] {
  const candidates: MarketCandidate[] = [];
  for (const source of sources) {
    const classification = sourceCatalyst(source);
    for (const symbol of extractSymbolsFromSource(source, classification)) {
      candidates.push({
        exchange: 'NSE',
        tradingsymbol: symbol,
        instrumentType: 'EQ',
        sentiment: sentimentFromDirection(classification.direction),
        catalystType: classification.type,
        catalystDirection: classification.direction,
        discoveredBy: [source.provider],
        evidence: [{ provider: source.provider, title: source.title, url: source.url, summary: source.summary, publishedAt: source.publishedAt, raw: { ...(source.raw ?? {}), catalyst: classification } }],
        validationStatus: 'watchlist_only',
        raw: { sourceProvider: source.provider, extractedFrom: 'small_model_catalyst_source', catalyst: classification },
      });
    }
  }
  return candidates;
}

function extractSymbolsFromSource(source: ResearchSource, classification = sourceCatalyst(source)): string[] {
  const rawSymbols = [
    ...source.symbols,
    ...classification.symbols,
    ...stringArray(source.raw?.symbols),
    ...stringArray(source.raw?.related),
    ...stringArray(source.raw?.ticker),
    ...stringArray(source.raw?.tickers),
  ];
  return [...new Set(rawSymbols.map(normalizeSymbol).filter(isNseEquitySymbol))];
}

function dedupeCandidates(candidates: MarketCandidate[]): MarketCandidate[] {
  const byKey = new Map<string, MarketCandidate>();
  for (const candidate of candidates) {
    const key = `${candidate.exchange.toUpperCase()}:${normalizeSymbol(candidate.tradingsymbol)}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...candidate, exchange: candidate.exchange.toUpperCase(), tradingsymbol: normalizeSymbol(candidate.tradingsymbol), discoveredBy: [...new Set(candidate.discoveredBy)], evidence: candidate.evidence.slice(0, 8) });
      continue;
    }
    existing.lastPrice ??= candidate.lastPrice;
    existing.referencePrice ??= candidate.referencePrice;
    existing.changePercent ??= candidate.changePercent;
    existing.volume = Math.max(existing.volume ?? 0, candidate.volume ?? 0) || undefined;
    existing.turnover = Math.max(existing.turnover ?? 0, candidate.turnover ?? 0) || undefined;
    existing.catalystType = strongerCatalystType(existing.catalystType, candidate.catalystType);
    existing.catalystDirection = mergeCatalystDirection(existing.catalystDirection, candidate.catalystDirection);
    existing.validationStatus = strongerValidation(existing.validationStatus, candidate.validationStatus);
    existing.reactiveSignal = existing.reactiveSignal || candidate.reactiveSignal;
    existing.discoveredBy = [...new Set([...existing.discoveredBy, ...candidate.discoveredBy])];
    existing.evidence = [...existing.evidence, ...candidate.evidence].slice(0, 8);
  }
  return [...byKey.values()];
}

function filterCandidates(candidates: MarketCandidate[], symbolBlacklist: string[], settings: DiscoverySettings, options: { requirePriceAndLiquidity: boolean }): MarketCandidate[] {
  const blacklist = new Set(symbolBlacklist.map(normalizeSymbol));
  const freshAfter = Date.now() - settings.freshnessHours * 60 * 60 * 1000;
  return candidates.filter((candidate) => {
    if (candidate.exchange !== 'NSE' || candidate.instrumentType !== 'EQ') return false;
    if (!isNseEquitySymbol(candidate.tradingsymbol) || blacklist.has(candidate.tradingsymbol)) return false;
    const hasFreshEvidence = candidate.evidence.some((item) => item.publishedAt && Date.parse(item.publishedAt) >= freshAfter);
    if (!hasFreshEvidence) return false;
    if (!options.requirePriceAndLiquidity) return true;
    const hasPrice = positiveNumber(candidate.lastPrice) !== undefined || positiveNumber(candidate.referencePrice) !== undefined;
    const hasLiquidity = (candidate.volume ?? 0) >= settings.minVolume || (candidate.turnover ?? 0) > 0;
    return hasPrice && hasLiquidity;
  });
}

function rankCandidates(candidates: MarketCandidate[], settings: DiscoverySettings): MarketCandidate[] {
  return candidates.map((candidate) => {
    const catalystStrength = catalystStrengthScore(candidate);
    const sourceConfidence = Math.min(20, candidate.evidence.length * 5 + candidate.discoveredBy.filter((provider) => !provider.includes('market_snapshot')).length * 3);
    const recencyScore = recencyScoreFor(candidate);
    const sentimentClarity = candidate.catalystDirection && candidate.catalystDirection !== 'unknown' ? 15 : candidate.sentiment && candidate.sentiment !== 'unknown' ? 8 : 3;
    const tradeabilityScore = tradeabilityScoreFor(candidate, settings);
    const moveScore = Math.min(10, Math.abs(candidate.changePercent ?? 0) * 2);
    const liquidityScore = Math.min(10, Math.log10(Math.max(1, candidate.volume ?? 0)) * 2);
    const score = Number((catalystStrength + sourceConfidence + recencyScore + sentimentClarity + tradeabilityScore + (candidate.reactiveSignal ? 2 : 0)).toFixed(2));
    return { ...candidate, ranking: { score, catalystStrength, sourceConfidence, recencyScore, sentimentClarity, tradeabilityScore, moveScore, liquidityScore, evidenceScore: sourceConfidence, riskScore: tradeabilityScore, reasons: rankingReasons(candidate) } };
  }).sort((a, b) => (b.ranking?.score ?? 0) - (a.ranking?.score ?? 0) || a.tradingsymbol.localeCompare(b.tradingsymbol)).slice(0, settings.candidateShortlistSize);
}

function rankingReasons(candidate: MarketCandidate): string[] {
  const reasons: string[] = [];
  if (candidate.catalystType) reasons.push(`catalyst ${candidate.catalystType}`);
  if (candidate.catalystDirection && candidate.catalystDirection !== 'unknown') reasons.push(`direction ${candidate.catalystDirection}`);
  if (candidate.evidence.length) reasons.push(`${candidate.evidence.length} catalyst evidence item(s)`);
  if (candidate.lastPrice || candidate.referencePrice) reasons.push('price context available');
  else reasons.push('watchlist-only until price validation');
  if (candidate.volume !== undefined) reasons.push(`volume ${candidate.volume}`);
  if (candidate.reactiveSignal) reasons.push('reactive mover confirmation only');
  return reasons;
}

function candidateSources(candidates: MarketCandidate[]): ResearchSource[] {
  return candidates.map((candidate) => ({
    provider: 'discovery',
    title: `Likely mover catalyst ${candidate.exchange}:${candidate.tradingsymbol}`,
    summary: candidate.ranking?.reasons.join('; ') || `${candidate.tradingsymbol} discovered by ${candidate.discoveredBy.join(', ')}`,
    symbols: [candidate.tradingsymbol],
    publishedAt: new Date().toISOString(),
    raw: { candidate },
  }));
}

function attachCandidateSymbolsToSources(sources: ResearchSource[], candidates: MarketCandidate[]): ResearchSource[] {
  return sources.map((source) => {
    const matched = candidates.filter((candidate) => source.symbols.includes(candidate.tradingsymbol) || textMentionsSymbol(`${source.title} ${source.summary}`, candidate.tradingsymbol)).map((candidate) => candidate.tradingsymbol);
    return matched.length ? { ...source, symbols: [...new Set([...source.symbols, ...matched])] } : source;
  });
}

function attachCandidateSymbolsToSourcesToCandidates(candidates: MarketCandidate[], sources: ResearchSource[]): MarketCandidate[] {
  return candidates.map((candidate) => ({
    ...candidate,
    evidence: candidate.evidence.length ? candidate.evidence : sources.filter((source) => source.symbols.includes(candidate.tradingsymbol)).slice(0, 3).map((source) => ({ provider: source.provider, title: source.title, url: source.url, summary: source.summary, publishedAt: source.publishedAt, raw: source.raw })),
  }));
}

function mergeSources(sources: ResearchSource[], limit: number): ResearchSource[] {
  const byKey = new Map<string, ResearchSource>();
  for (const source of sources) {
    const key = `${source.provider}:${source.url ?? source.title}`;
    if (!byKey.has(key)) byKey.set(key, source);
  }
  return [...byKey.values()].sort((a, b) => sourceTime(b) - sourceTime(a) || a.title.localeCompare(b.title)).slice(0, limit);
}

function sourceTime(source: ResearchSource): number {
  const parsed = Date.parse(source.publishedAt ?? '');
  return Number.isFinite(parsed) ? parsed : 0;
}

function discoveryMetadata(candidates: MarketCandidate[], errors: string[], settings: DiscoverySettings): Record<string, unknown> {
  return { marketScope: 'NSE_EQUITY_ONLY', mode: 'pre_market_catalyst', generatedAt: new Date().toISOString(), settings, errors, candidates };
}

function normalizeSymbol(value: unknown): string {
  return typeof value === 'string' ? value.trim().toUpperCase().replace(/^NSE[:\s-]*/, '').replace(/\.(NS|BO)$/i, '') : '';
}

function isNseEquitySymbol(symbol: string): boolean {
  return /^[A-Z][A-Z0-9]{1,14}$/.test(symbol) && !symbol.includes('NIFTY') && symbol !== 'SENSEX' && !COMMON_NEWS_TOKENS.has(symbol);
}

const COMMON_NEWS_TOKENS = new Set(['NSE', 'BSE', 'IPO', 'FII', 'DII', 'RBI', 'SEBI', 'GDP', 'EPS', 'CEO', 'CFO', 'BUY', 'SELL', 'INDIA', 'MARKET', 'STOCK', 'SHARE', 'INDEX', 'TODAY', 'NEWS', 'RESULTS', 'ORDER', 'WIN', 'APPROVAL', 'RATING', 'CRUDE', 'RUPEE']);

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap((item) => stringArray(item));
  if (typeof value === 'string') return value.split(/[\s,;|]+/).filter(Boolean);
  return [];
}

function finiteNumber(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function positiveNumber(value: unknown): number | undefined {
  const number = finiteNumber(value);
  return number !== undefined && number > 0 ? number : undefined;
}

const CATALYST_TYPES: CatalystType[] = ['earnings', 'order_win', 'mna', 'regulatory', 'corporate_action', 'brokerage_rating', 'sector_cue', 'global_cue', 'management_commentary', 'litigation_or_risk', 'other_news'];
const CATALYST_DIRECTIONS: CatalystDirection[] = ['positive', 'negative', 'mixed', 'unknown'];

function sourceCatalyst(source: ResearchSource): CatalystClassification {
  const raw = source.raw?.catalyst;
  if (raw && typeof raw === 'object') {
    const record = raw as Record<string, unknown>;
    return {
      symbols: stringArray(record.symbols).map(normalizeSymbol).filter(isNseEquitySymbol),
      type: catalystTypeValue(record.type ?? record.catalystType),
      direction: catalystDirectionValue(record.direction),
      strength: boundedNumber(record.strength, 0, 35, 8),
      confidence: boundedNumber(record.confidence, 0, 1, 0.5),
      rationale: typeof record.rationale === 'string' ? record.rationale : undefined,
    };
  }
  return fallbackClassification(source);
}

function catalystTypeValue(value: unknown): CatalystType {
  return typeof value === 'string' && CATALYST_TYPES.includes(value as CatalystType) ? value as CatalystType : 'other_news';
}

function catalystDirectionValue(value: unknown): CatalystDirection {
  return typeof value === 'string' && CATALYST_DIRECTIONS.includes(value as CatalystDirection) ? value as CatalystDirection : 'unknown';
}

function boundedNumber(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function catalystStrengthScore(candidate: MarketCandidate): number {
  const evidenceStrength = Math.max(0, ...candidate.evidence.map((item) => item.raw && typeof item.raw.catalyst === 'object' ? boundedNumber((item.raw.catalyst as Record<string, unknown>).strength, 0, 35, 8) : 0));
  const direct = candidate.catalystType === 'other_news' || !candidate.catalystType ? 8 : candidate.catalystType === 'sector_cue' || candidate.catalystType === 'global_cue' ? 14 : 22;
  return Math.min(35, Math.max(evidenceStrength, direct) + Math.min(8, Math.max(0, candidate.evidence.length - 1) * 2));
}

function recencyScoreFor(candidate: MarketCandidate): number {
  const newest = Math.max(0, ...candidate.evidence.map((item) => Date.parse(item.publishedAt ?? '') || 0));
  if (!newest) return 3;
  const hours = (Date.now() - newest) / (60 * 60 * 1000);
  if (hours <= 12) return 15;
  if (hours <= 24) return 11;
  if (hours <= 48) return 7;
  return 3;
}

function tradeabilityScoreFor(candidate: MarketCandidate, settings: DiscoverySettings): number {
  const hasPrice = positiveNumber(candidate.lastPrice) !== undefined || positiveNumber(candidate.referencePrice) !== undefined;
  const hasLiquidity = (candidate.volume ?? 0) >= settings.minVolume || (candidate.turnover ?? 0) > 0;
  if (hasPrice && hasLiquidity) return 15;
  if (hasPrice) return 10;
  return 4;
}

function strongerCatalystType(a?: CatalystType, b?: CatalystType): CatalystType | undefined {
  if (!a) return b;
  if (!b) return a;
  return catalystTypeBaseStrength(a) >= catalystTypeBaseStrength(b) ? a : b;
}

function catalystTypeBaseStrength(type: CatalystType): number {
  return type === 'other_news' ? 8 : type === 'sector_cue' || type === 'global_cue' ? 14 : 22;
}

function mergeCatalystDirection(a?: CatalystDirection, b?: CatalystDirection): CatalystDirection | undefined {
  if (!a) return b;
  if (!b || a === b) return a;
  if (a === 'unknown') return b;
  if (b === 'unknown') return a;
  return 'mixed';
}

function strongerValidation(a?: MarketCandidate['validationStatus'], b?: MarketCandidate['validationStatus']): MarketCandidate['validationStatus'] {
  const order = ['watchlist_only', 'price_validated', 'liquidity_validated', 'gtt_ready'];
  return order.indexOf(b ?? 'watchlist_only') > order.indexOf(a ?? 'watchlist_only') ? b : a;
}

function sentimentFromDirection(direction: CatalystDirection): MarketCandidate['sentiment'] {
  if (direction === 'positive') return 'bullish';
  if (direction === 'negative') return 'bearish';
  if (direction === 'mixed') return 'neutral';
  return 'unknown';
}

function textMentionsSymbol(text: string, symbol: string): boolean {
  return new RegExp(`\\b${symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(text.toUpperCase());
}

async function buildPlan(input: { context: BrokerContext; discoveredCandidates: MarketCandidate[]; sources: ResearchSource[]; model: string; llmApiKey: string | null; llmBaseUrl?: string; providerWarnings: string[]; researchSettings: MorningResearchSettings; tradingRiskSettings: TradingRiskSettings; discoverySettings: DiscoverySettings; rcaLearnings: Awaited<ReturnType<typeof loadRcaLearnings>> }): Promise<{ plan: MorningResearchPlan; conversation: AgentConversationTrace }> {
  if (!input.llmApiKey) throw new Error('LLM API key is required before morning research can start');
  const llm = new OpenAiCompatibleProvider(input.llmApiKey, input.llmBaseUrl);

  const promptSourcesLimit = Math.max(input.discoverySettings.promptSourceLimit, input.discoveredCandidates.length);
  const ideasMessages = buildMorningResearchIdeasMessages({ broker: input.context, discoveredCandidates: input.discoveredCandidates, sources: input.sources.slice(0, promptSourcesLimit), settings: input.researchSettings, tradingRisk: input.tradingRiskSettings, rcaLearnings: input.rcaLearnings });
  const ideasResult = await generateValidatedJsonWithRetry({
    llm,
    model: input.model,
    temperature: 0.15,
    messages: ideasMessages,
    stage: 'ideas',
    validate: (json) => normalizeIdeasPlan(json, input.researchSettings, allowedResearchSymbols(input.context, input.discoveredCandidates, input.sources)),
  });
  const ideasPlan = ideasResult.value;
  const ideasConversation = { ...ideasResult.conversation, thoughtDetails: [...ideasResult.conversation.thoughtDetails, ...deriveIdeasThoughtDetails(ideasPlan)] };

  const gttMessages = buildMorningResearchGttMessages({ broker: input.context, discoveredCandidates: input.discoveredCandidates, sources: input.sources.slice(0, promptSourcesLimit), settings: input.researchSettings, tradingRisk: input.tradingRiskSettings, rcaLearnings: input.rcaLearnings, ideasPlan: ideasPlan as unknown as Record<string, unknown> });
  const gttResult = await generateValidatedJsonWithRetry({
    llm,
    model: input.model,
    temperature: 0.1,
    messages: gttMessages,
    stage: 'gtt',
    validate: (json) => normalizeGttPlan(json, input.researchSettings, input.discoveredCandidates),
  });
  const gttPlan = gttResult.value;
  const validationNotes = [...(ideasPlan.validationNotes ?? []), ...(gttPlan.validationNotes ?? [])];
  const plan: MorningResearchPlan = { ...ideasPlan, ...gttPlan, ...(validationNotes.length ? { validationNotes } : {}) };
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

async function persistFailedResearchSession(input: { userId: string; tradeDate: string; isDryRun: boolean; model: string; message: string; providerWarnings: string[]; context: BrokerContext; discoveredCandidates: MarketCandidate[]; sources: ResearchSource[] }) {
  const conversation = failedConversation(input.model, input.message, input.providerWarnings, input.sources);
  const [session] = await db.insert(dailyResearchSessions).values({
    userId: input.userId,
    tradeDate: input.tradeDate,
    status: 'failed',
    marketThesis: '',
    sectorBias: [],
    riskWarnings: [input.message, ...input.providerWarnings],
    model: input.model,
    rawPlan: { error: input.message, sourceCount: input.sources.length, discovery: { candidates: input.discoveredCandidates } },
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
      rawPlan: { error: input.message, sourceCount: input.sources.length, discovery: { candidates: input.discoveredCandidates } },
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
    ...(plan.validationNotes ?? []).map((note) => ({ title: 'Stage 1 validation note', detail: note })),
    ...plan.tradeCandidates.map((item) => ({ title: `Transient idea · ${item.tradingsymbol}`, detail: item.thesis, metadata: { exchange: item.exchange, side: item.side, confidence: item.confidence, entryPlan: item.entryPlan, invalidation: item.invalidation } })),
  ];
}

function deriveGttThoughtDetails(plan: MorningResearchGttPlan) {
  return [
    { title: 'Stage 2 GTT drafts validated', detail: `${plan.gttCandidates.length} draft GTT candidate(s) selected for persistence.` },
    ...(plan.validationNotes ?? []).map((note) => ({ title: 'Stage 2 validation note', detail: note })),
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

function normalizeIdeasPlan(raw: Record<string, unknown>, settings = DEFAULT_MORNING_RESEARCH_SETTINGS, allowedSymbols?: Set<string>): MorningResearchIdeasPlan {
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

  const validationNotes: string[] = [];
  const groundedTradeCandidates = allowedSymbols?.size ? tradeCandidates.filter((item) => allowedSymbols.has(item.tradingsymbol)) : tradeCandidates;
  const droppedTradeSymbols = allowedSymbols?.size ? tradeCandidates.filter((item) => !allowedSymbols.has(item.tradingsymbol)).map((item) => item.tradingsymbol) : [];
  if (droppedTradeSymbols.length) validationNotes.push(`Dropped ungrounded trade candidate(s) during validation: ${[...new Set(droppedTradeSymbols)].join(', ')}.`);
  if (!sectorBias.length) errors.push('sectorBias must contain at least one item');
  if (!watchlist.length) errors.push('watchlist must contain at least one item');
  if (errors.length) throw new Error(`Invalid ideas research JSON: ${errors.join('; ')}`);
  return { marketThesis, sectorBias, watchlist, tradeCandidates: groundedTradeCandidates, riskWarnings, ...(validationNotes.length ? { validationNotes } : {}) };
}

function normalizeGttPlan(raw: Record<string, unknown>, settings = DEFAULT_MORNING_RESEARCH_SETTINGS, discoveredCandidates: MarketCandidate[] = []): MorningResearchGttPlan {
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
  const priceContextBySymbol = new Map(discoveredCandidates.map((candidate) => [candidate.tradingsymbol, Boolean(candidate.lastPrice || candidate.referencePrice)]));
  const groundedGttCandidates = gttCandidates.filter((candidate) => priceContextBySymbol.get(candidate.tradingsymbol) === true);
  const droppedGttSymbols = gttCandidates.filter((candidate) => priceContextBySymbol.get(candidate.tradingsymbol) !== true).map((candidate) => candidate.tradingsymbol);
  const validationNotes = droppedGttSymbols.length ? [`Dropped GTT candidate(s) missing discovered price context during validation: ${[...new Set(droppedGttSymbols)].join(', ')}.`] : [];
  if (errors.length) throw new Error(`Invalid GTT research JSON: ${errors.join('; ')}`);
  return { gttCandidates: groundedGttCandidates, ...(validationNotes.length ? { validationNotes } : {}) };
}

function allowedResearchSymbols(context: BrokerContext, candidates: MarketCandidate[], sources: ResearchSource[]): Set<string> {
  return new Set([
    ...candidates.map((candidate) => candidate.tradingsymbol),
    ...context.holdings.map((row) => normalizeSymbol(row.tradingsymbol)),
    ...context.positions.map((row) => normalizeSymbol(row.tradingsymbol)),
    ...sources.flatMap((source) => source.symbols.map(normalizeSymbol)),
  ].filter(Boolean));
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

function requiredExchange(value: unknown, path: string, errors: string[]): 'NSE' {
  return requiredEnum(value, path, ['NSE'] as const, errors);
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

export const __researchDiscoveryTestHooks = {
  classifySourcesWithSmallModel,
  collectSources,
  dedupeCandidates,
  filterCandidates,
  maybeConfirmWithReactiveMovers,
  normalizeIdeasPlan,
  normalizeGttPlan,
  rankCandidates,
};

function parseResearchSettings(config: Record<string, unknown>): MorningResearchSettings {
  return {
    maxWatchlistItems: configInt(config.maxWatchlistItems, DEFAULT_MORNING_RESEARCH_SETTINGS.maxWatchlistItems, 0, 24),
    maxGttCandidates: configInt(config.maxGttCandidates, DEFAULT_MORNING_RESEARCH_SETTINGS.maxGttCandidates, 0, 12),
    riskTolerance: normalizeRiskTolerance(config.riskTolerance),
  };
}

function parseDiscoverySettings(config: Record<string, unknown>): DiscoverySettings {
  return {
    candidateShortlistSize: configInt(config.candidateShortlistSize, DEFAULT_DISCOVERY_SETTINGS.candidateShortlistSize, 1, 50),
    broadSourceLimit: configInt(config.broadSourceLimit, DEFAULT_DISCOVERY_SETTINGS.broadSourceLimit, 1, 50),
    focusedSourceLimit: configInt(config.focusedSourceLimit, DEFAULT_DISCOVERY_SETTINGS.focusedSourceLimit, 1, 10),
    sourceLimit: configInt(config.sourceLimit, DEFAULT_DISCOVERY_SETTINGS.sourceLimit, 1, 100),
    snapshotLimit: configInt(config.snapshotLimit, DEFAULT_DISCOVERY_SETTINGS.snapshotLimit, 1, 2_000),
    promptSourceLimit: configInt(config.promptSourceLimit, DEFAULT_DISCOVERY_SETTINGS.promptSourceLimit, 1, 100),
    freshnessHours: configInt(config.freshnessHours, DEFAULT_DISCOVERY_SETTINGS.freshnessHours, 1, 168),
    newsLookbackDays: configInt(config.newsLookbackDays, DEFAULT_DISCOVERY_SETTINGS.newsLookbackDays, 1, 30),
    minVolume: configInt(config.minVolume, DEFAULT_DISCOVERY_SETTINGS.minVolume, 0, Number.MAX_SAFE_INTEGER),
    enableReactiveMoverConfirmation: config.enableReactiveMoverConfirmation === true,
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
