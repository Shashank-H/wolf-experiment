import { and, desc, eq } from 'drizzle-orm';
import { db } from '../db/client';
import { apiKeys, gttCandidates, marketSnapshots, researchRunEvents, researchRuns, tradingPreferences, userSettings } from '../db/schema';
import { ExaProvider } from '../providers/research/ExaProvider';
import { OpenAiCompatibleProvider } from '../providers/research/OpenAiCompatibleProvider';
import type { AgentConversationTrace, ExaAgentRun, ExaAgentRunEvent, LlmMessage, ResearchSource } from '../providers/research/types';
import type { Quote } from '../providers/broker/types';
import { audit } from '../utils/audit';
import { decryptSecret } from '../utils/crypto';
import { kiteAdapterForUser } from './broker-sync';

export type ResearchRunCreateInput = {
  researchType?: 'pre_market' | 'after_open' | 'manual';
  clientLocalDate?: string;
  clientTimeZone?: string;
};

export type ResearchRunBundle = {
  run: typeof researchRuns.$inferSelect;
  events: Array<typeof researchRunEvents.$inferSelect>;
};

type Secrets = { exaApiKey: string | null; llmApiKey: string | null };
type RunEventPayload = Record<string, unknown>;
type Subscriber = (event: typeof researchRunEvents.$inferSelect) => void;

const subscribers = new Map<string, Set<Subscriber>>();
const terminalStatuses = new Set(['completed', 'completed_no_actionable_candidates', 'failed', 'failed_to_start']);

export async function createResearchRun(userId: string, input: ResearchRunCreateInput = {}) {
  const [settings, preferences, secrets] = await Promise.all([
    db.select().from(userSettings).where(eq(userSettings.userId, userId)).limit(1),
    db.select().from(tradingPreferences).where(eq(tradingPreferences.userId, userId)).limit(1),
    loadRunSecrets(userId),
  ]);
  if (!settings[0]) throw new Error('Account setup incomplete: user settings row is missing');
  if (!preferences[0]) throw new Error('Account setup incomplete: trading preferences row is missing');
  if (!secrets.exaApiKey) throw new Error('Exa API key is required before research can start');
  if (!secrets.llmApiKey) throw new Error('LLM API key is required before research can start');

  const providerConfig = settings[0].providerConfig ?? {};
  const model = stringConfig(providerConfig.mediumModel) ?? stringConfig(providerConfig.smallModel) ?? 'gpt-4o-mini';
  const [run] = await db.insert(researchRuns).values({
    userId,
    status: 'queued',
    researchType: input.researchType ?? 'pre_market',
    clientLocalDate: validLocalDate(input.clientLocalDate),
    clientTimeZone: validTimeZone(input.clientTimeZone),
    model,
  }).returning();
  await appendRunEvent(run.id, userId, 'research.queued', { runId: run.id, createdAt: run.createdAt.toISOString(), researchType: run.researchType });
  void processResearchRun(run.id).catch(async (error) => {
    await failRun(run.id, userId, error instanceof Error ? error.message : 'Research run failed');
  });
  await audit('research.run.created', { userId, entityType: 'research_run', entityId: run.id, metadata: { researchType: run.researchType } });
  return { runId: run.id, streamUrl: `/research/runs/${run.id}/events` };
}

export async function getResearchRun(userId: string, runId: string): Promise<ResearchRunBundle | null> {
  const [run] = await db.select().from(researchRuns).where(and(eq(researchRuns.userId, userId), eq(researchRuns.id, runId))).limit(1);
  if (!run) return null;
  const events = await db.select().from(researchRunEvents).where(and(eq(researchRunEvents.userId, userId), eq(researchRunEvents.runId, runId))).orderBy(researchRunEvents.sequence);
  return { run, events };
}

export async function listResearchRuns(userId: string, options: { limit?: number } = {}) {
  return db.select().from(researchRuns).where(eq(researchRuns.userId, userId)).orderBy(desc(researchRuns.createdAt)).limit(options.limit ?? 50);
}

export async function subscribeToRunEvents(userId: string, runId: string, signal?: AbortSignal): Promise<ReadableStream<Uint8Array> | null> {
  const bundle = await getResearchRun(userId, runId);
  if (!bundle) return null;
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: typeof researchRunEvents.$inferSelect) => {
        controller.enqueue(encoder.encode(`id: ${event.sequence}\nevent: ${event.eventType}\ndata: ${JSON.stringify({ ...event.payload, createdAt: event.createdAt.toISOString(), sequence: event.sequence })}\n\n`));
      };
      for (const event of bundle.events) send(event);
      if (terminalStatuses.has(bundle.run.status)) {
        controller.close();
        return;
      }
      const set = subscribers.get(runId) ?? new Set<Subscriber>();
      set.add(send);
      subscribers.set(runId, set);
      const cleanup = () => {
        set.delete(send);
        if (!set.size) subscribers.delete(runId);
        try { controller.close(); } catch { /* closed */ }
      };
      signal?.addEventListener('abort', cleanup, { once: true });
    },
  });
}

async function processResearchRun(runId: string) {
  const [run] = await db.select().from(researchRuns).where(eq(researchRuns.id, runId)).limit(1);
  if (!run) throw new Error('Research run not found');
  const [settings, preferences, secrets] = await Promise.all([
    db.select().from(userSettings).where(eq(userSettings.userId, run.userId)).limit(1),
    db.select().from(tradingPreferences).where(eq(tradingPreferences.userId, run.userId)).limit(1),
    loadRunSecrets(run.userId),
  ]);
  if (!settings[0]) throw new Error('Account setup incomplete: user settings row is missing');
  if (!preferences[0]) throw new Error('Account setup incomplete: trading preferences row is missing');
  if (!secrets.exaApiKey) throw new Error('Exa API key is required before research can start');
  if (!secrets.llmApiKey) throw new Error('LLM API key is required before research can start');

  await updateRun(run.id, { status: 'running' });
  await appendRunEvent(run.id, run.userId, 'research.started', { runId: run.id, createdAt: run.createdAt.toISOString(), providers: ['exa', 'llm'], researchType: run.researchType, clientLocalDate: run.clientLocalDate, clientTimeZone: run.clientTimeZone });
  await appendRunEvent(run.id, run.userId, 'research.providers.validated', { providers: ['exa', 'llm'] });

  const providerConfig = settings[0].providerConfig ?? {};
  const model = run.model ?? stringConfig(providerConfig.mediumModel) ?? stringConfig(providerConfig.smallModel) ?? 'gpt-4o-mini';
  const llmBaseUrl = stringConfig(providerConfig.llmBaseUrl);
  const exa = new ExaProvider(secrets.exaApiKey);
  const llm = new OpenAiCompatibleProvider(secrets.llmApiKey, llmBaseUrl);
  const researchWindow = researchWindowUtc(run.clientLocalDate, run.clientTimeZone);
  const symbolBlacklist = Array.isArray(preferences[0]?.symbolBlacklist) ? preferences[0].symbolBlacklist.map(String) : [];

  const exaRequest = buildExaAgentRequest(run, researchWindow, symbolBlacklist);
  await appendRunEvent(run.id, run.userId, 'research.exa.started', { effort: exaRequest.effort, researchWindowUtc: researchWindow });
  const exaRun = await exa.createAgentRun(exaRequest);
  await updateRun(run.id, { exaRunId: exaRun.id, contextSnapshot: { exaRequest, researchWindowUtc: researchWindow } });
  const completedExaRun = await waitForExaRun(exa, exaRun, run.id, run.userId);
  if (completedExaRun.status !== 'completed') throw new Error(`Exa research did not complete: ${completedExaRun.status}`);
  await appendRunEvent(run.id, run.userId, 'research.exa.completed', { exaRunId: completedExaRun.id, usage: completedExaRun.usage, costDollars: completedExaRun.costDollars });

  const exaOutput = normalizeExaStructuredOutput(completedExaRun.output?.structured);
  await appendRunEvent(run.id, run.userId, 'research.structured_output.validated', { sources: exaOutput.sources.length, candidates: exaOutput.candidates.length, unresolvedCompanies: exaOutput.unresolvedCompanies.length });
  if (!exaOutput.sources.length) throw new Error('no_research_sources_found');

  const initialSources = exaOutput.sources.map(sourceFromStructured);
  const llmReview = await runLlmDecisionLoop({ run, llm, exa, model, exaOutput, sources: initialSources, symbolBlacklist, researchWindow });
  const persistedGttCandidates = await persistResearchGttCandidates(run, llmReview.final);
  await appendRunEvent(run.id, run.userId, 'research.result.ready', { watchlist: llmReview.final.watchlist.length, gttCandidates: persistedGttCandidates, warnings: llmReview.final.riskWarnings.length });

  const finalStatus = llmReview.final.watchlist.length || persistedGttCandidates ? 'completed' : 'completed_no_actionable_candidates';
  await updateRun(run.id, {
    status: finalStatus,
    marketThesis: llmReview.final.marketThesis,
    sectorBias: llmReview.final.sectorBias,
    riskWarnings: llmReview.final.riskWarnings,
    providerWarnings: llmReview.providerWarnings,
    rawResult: { exa: completedExaRun.output, final: llmReview.final, validatedExaOutput: exaOutput, persistedGttCandidates },
    contextSnapshot: { exaRequest, researchWindowUtc: researchWindow, llm: llmReview.conversation, actions: llmReview.actions, sources: llmReview.sources },
    costDollars: completedExaRun.costDollars ?? {},
    completedAt: new Date(),
  });
  await appendRunEvent(run.id, run.userId, finalStatus === 'completed' ? 'research.completed' : 'research.completed_no_actionable_candidates', { status: finalStatus, watchlist: llmReview.final.watchlist.length, gttCandidates: persistedGttCandidates });
  await audit('research.run.completed', { userId: run.userId, entityType: 'research_run', entityId: run.id, metadata: { status: finalStatus, watchlist: llmReview.final.watchlist.length, gttCandidates: persistedGttCandidates } });
}

type LlmLoopInput = {
  run: typeof researchRuns.$inferSelect;
  llm: OpenAiCompatibleProvider;
  exa: ExaProvider;
  model: string;
  exaOutput: StructuredResearchOutput;
  sources: ResearchSource[];
  symbolBlacklist: string[];
  researchWindow: { start: string; end: string; clientLocalDate?: string | null; clientTimeZone?: string | null };
};

type LlmLoopResult = {
  final: FinalResearchJson;
  conversation: AgentConversationTrace;
  actions: Array<Record<string, unknown>>;
  sources: ResearchSource[];
  providerWarnings: string[];
};

async function runLlmDecisionLoop(input: LlmLoopInput): Promise<LlmLoopResult> {
  await appendRunEvent(input.run.id, input.run.userId, 'research.llm.review.started', { model: input.model });
  const actions: Array<Record<string, unknown>> = [];
  const providerWarnings: string[] = [];
  let sources = input.sources;
  let review = await askLlmForResearchDecision(input, sources, actions, false);
  let conversation = review.conversation;
  const requested = review.json.actions.find((action) => action.type === 'request_exa_search' || action.type === 'request_exa_contents' || action.type === 'request_symbol_resolution');
  if (requested) {
    await appendRunEvent(input.run.id, input.run.userId, 'research.llm_action.requested', requested as Record<string, unknown>);
    try {
      if (requested.type === 'request_exa_search') {
        const query = requested.query || `NSE ${requested.symbol ?? ''} ${requested.reason ?? ''} latest catalyst India`;
        await appendRunEvent(input.run.id, input.run.userId, 'research.followup.started', { query, symbol: requested.symbol });
        const freshSources = await input.exa.searchAdvanced({
          query,
          symbols: requested.symbol ? [requested.symbol] : undefined,
          limit: 10,
          type: 'deep',
          userLocation: 'IN',
          moderation: true,
          startPublishedDate: input.researchWindow.start,
          endPublishedDate: input.researchWindow.end,
          summaryQuery: `Verify catalyst and tradable NSE symbol for ${requested.symbol ?? query}`,
          maxAgeHours: 3,
        });
        sources = dedupeSources([...sources, ...freshSources]);
        actions.push({ ...requested, status: 'completed', returnedSources: freshSources.length });
        await appendRunEvent(input.run.id, input.run.userId, 'research.followup.completed', { query, returnedSources: freshSources.length });
      } else {
        actions.push({ ...requested, status: 'rejected', reason: 'Action is reserved for a later implementation' });
      }
      await appendRunEvent(input.run.id, input.run.userId, 'research.llm_action.completed', actions.at(-1) ?? {});
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Follow-up action failed';
      providerWarnings.push(message);
      actions.push({ ...requested, status: 'failed', error: message });
      await appendRunEvent(input.run.id, input.run.userId, 'research.llm_action.completed', actions.at(-1) ?? {});
    }
    review = await askLlmForResearchDecision(input, sources, actions, true);
    conversation = mergeRunConversations(input.model, conversation, review.conversation);
  }
  let final = normalizeFinalResearch(review.json, input.exaOutput, input.symbolBlacklist);
  await appendRunEvent(input.run.id, input.run.userId, 'research.candidates.filtered', { watchlist: final.watchlist.length, dropped: final.droppedCandidates.length });
  await appendRunEvent(input.run.id, input.run.userId, 'research.candidates.ranked', { watchlist: final.watchlist.map((item) => item.tradingsymbol) });
  const tradePlan = await refineGttCandidatesWithMarketPrices(input, final, sources);
  if (tradePlan) {
    final = tradePlan.final;
    conversation = mergeRunConversations(input.model, conversation, tradePlan.conversation);
    actions.push({ type: 'generate_gtt_trade_plan', status: 'completed', quotes: tradePlan.quotes.length, gttCandidates: final.gttCandidates.length });
    await appendRunEvent(input.run.id, input.run.userId, 'research.gtt_trade_plan.completed', { quotes: tradePlan.quotes.length, gttCandidates: final.gttCandidates.length });
  }
  return { final, conversation, actions, sources, providerWarnings };
}

async function refineGttCandidatesWithMarketPrices(input: LlmLoopInput, final: FinalResearchJson, sources: ResearchSource[]): Promise<{ final: FinalResearchJson; conversation: AgentConversationTrace; quotes: Quote[] } | null> {
  const symbols = [...new Set(final.watchlist.map((item) => item.tradingsymbol))];
  if (!symbols.length) return null;
  const quotes = await loadCurrentQuotes(input.run.userId, symbols);
  await appendRunEvent(input.run.id, input.run.userId, 'research.kite_quotes.loaded', { requested: symbols.length, quotes: quotes.length, missing: symbols.filter((symbol) => !quotes.some((quote) => quote.tradingsymbol === symbol)) });
  const messages: LlmMessage[] = [
    { role: 'system', content: 'You are a cautious NSE cash-equity trade-planning agent. Use the completed research, collected sources, and live/current Kite quote context to produce draft GTT trigger candidates. Decide long vs short, entry trigger/purchase price, target, stoploss, and quantity. Return strict JSON only. These are review-only draft GTTs, not placed orders.' },
    { role: 'user', content: JSON.stringify({
      task: 'Convert the research watchlist into concrete draft GTT candidates using current Kite prices and source-grounded catalysts. Prefer no candidate over an unsupported trade, but every returned candidate must have non-zero triggerPrice, limitPrice, targetPrice, and stopLossPrice.',
      rules: [
        'Only NSE cash equities from the watchlist are allowed.',
        'Use currentPrice/lastPrice as the anchor. For BUY, target must be above entry and stoploss below entry. For SELL, target must be below entry and stoploss above entry.',
        'triggerPrice is the purchase/entry trigger. limitPrice should be near triggerPrice for review.',
        'Do not output zeros or nulls for price fields. Drop the GTT candidate if you cannot decide prices.',
        'Base long/short and price levels on research catalyst, recent quote range, day high/low/open/previous close, and risk/reward.',
        'Include rationale and triggerLogic explaining why the entry, target, and stoploss were chosen.',
      ],
      outputShape: {
        gttCandidates: [{ exchange: 'NSE', tradingsymbol: 'string', transactionType: 'BUY|SELL', triggerPrice: 0, limitPrice: 0, targetPrice: 0, stopLossPrice: 0, quantity: 1, rationale: 'string', evidenceSourceIds: ['source id/url'], triggerLogic: 'string' }],
        riskWarnings: ['string'],
      },
      currentQuotes: quotes.map((quote) => ({ exchange: quote.exchange, tradingsymbol: quote.tradingsymbol, currentPrice: quote.lastPrice, changePercent: quote.changePercent, dayHigh: quote.dayHigh, dayLow: quote.dayLow, open: quote.open, previousClose: quote.previousClose, volume: quote.volume, updatedAt: quote.updatedAt })),
      research: final,
      sources: sources.map((source, index) => ({ id: `tool-${index}`, title: source.title, url: source.url, summary: source.summary, symbols: source.symbols, publishedAt: source.publishedAt })),
    }) },
  ];
  const result = await input.llm.generateJsonWithConversation({ model: input.model, temperature: 0.15, messages });
  const refined = normalizeFinalResearch({ ...final, ...result.json, watchlist: final.watchlist }, input.exaOutput, input.symbolBlacklist);
  const quoteBySymbol = new Map(quotes.map((quote) => [quote.tradingsymbol, quote]));
  refined.gttCandidates = refined.gttCandidates.filter((candidate) => hasCompleteTradePrices(candidate) && pricesAreDirectionallyValid(candidate, quoteBySymbol.get(candidate.tradingsymbol)));
  refined.riskWarnings = [...new Set([...final.riskWarnings, ...refined.riskWarnings])].slice(0, 30);
  return { final: refined, conversation: result.conversation, quotes };
}

async function loadCurrentQuotes(userId: string, symbols: string[]): Promise<Quote[]> {
  const adapter = await kiteAdapterForUser(userId);
  if (adapter) {
    try {
      const quotes = await adapter.getQuotes(symbols.map((tradingsymbol) => ({ exchange: 'NSE', tradingsymbol })));
      if (quotes.length) return quotes.map((quote) => ({ ...quote, tradingsymbol: normalizeSymbol(quote.tradingsymbol) })).filter((quote) => quote.lastPrice > 0);
    } catch {
      // Fall through to recent cached market snapshots.
    }
  }
  const snapshots = await db.select().from(marketSnapshots).where(eq(marketSnapshots.userId, userId)).orderBy(desc(marketSnapshots.capturedAt)).limit(1000);
  const wanted = new Set(symbols);
  const bySymbol = new Map<string, Quote>();
  for (const snapshot of snapshots) {
    const symbol = normalizeSymbol(snapshot.tradingsymbol);
    const lastPrice = nullableNumber(snapshot.lastPrice);
    if (!wanted.has(symbol) || !lastPrice || bySymbol.has(symbol)) continue;
    bySymbol.set(symbol, { exchange: snapshot.exchange, tradingsymbol: symbol, lastPrice, changePercent: Number(snapshot.changePercent ?? 0), volume: Number(snapshot.volume ?? 0), updatedAt: snapshot.capturedAt.toISOString(), raw: snapshot.raw });
  }
  return [...bySymbol.values()];
}

function hasCompleteTradePrices(candidate: FinalResearchJson['gttCandidates'][number]) {
  return Boolean(candidate.triggerPrice && candidate.limitPrice && candidate.targetPrice && candidate.stopLossPrice);
}

function pricesAreDirectionallyValid(candidate: FinalResearchJson['gttCandidates'][number], quote?: Quote) {
  const entry = candidate.triggerPrice ?? 0;
  const target = candidate.targetPrice ?? 0;
  const stop = candidate.stopLossPrice ?? 0;
  if (entry <= 0 || target <= 0 || stop <= 0) return false;
  if (quote && Math.abs(entry - quote.lastPrice) / quote.lastPrice > 0.2) return false;
  return candidate.transactionType === 'SELL' ? target < entry && stop > entry : target > entry && stop < entry;
}

async function askLlmForResearchDecision(input: LlmLoopInput, sources: ResearchSource[], actions: Array<Record<string, unknown>>, forceFinalize: boolean) {
  const messages: LlmMessage[] = [
    { role: 'system', content: 'You are the app-managed market research decision agent for Indian/NSE cash equities. Use only the grounded Exa evidence and tool results. You may make judgment-heavy decisions. Return strict JSON only. Every actionable research result must include draft GTT trigger candidates extracted from the research. These are draft triggers for review only, not placed orders or execution instructions.' },
    { role: 'user', content: JSON.stringify({
      task: forceFinalize ? 'Finalize research now from available evidence.' : 'Decide whether to accept/drop/rank candidates or request one bounded follow-up action.',
      allowedActions: forceFinalize ? ['finalize_research', 'mark_no_actionable_candidates'] : ['request_exa_search', 'request_exa_contents', 'request_symbol_resolution', 'accept_candidate', 'drop_candidate', 'finalize_research', 'mark_no_actionable_candidates'],
      outputShape: {
        actions: [{ type: 'finalize_research | mark_no_actionable_candidates | request_exa_search', symbol: 'optional NSE symbol', query: 'required for request_exa_search', reason: 'why' }],
        marketThesis: 'string',
        sectorBias: [{ sector: 'string', bias: 'bullish|bearish|neutral', reason: 'string' }],
        watchlist: [{ exchange: 'NSE', tradingsymbol: 'string', bias: 'long|short|neutral', reason: 'source-grounded thesis', evidenceSourceIds: ['source id/url'], rankReason: 'string' }],
        gttCandidates: [{ exchange: 'NSE', tradingsymbol: 'string', transactionType: 'BUY|SELL', triggerPrice: 'number when evidence supports an actionable trigger, else null', limitPrice: 'number or null', targetPrice: 'number or null', stopLossPrice: 'number or null', quantity: 1, rationale: 'why this trigger follows from the research', evidenceSourceIds: ['source id/url'], triggerLogic: 'breakout/breakdown/price-confirmation condition' }],
        droppedCandidates: [{ companyName: 'string', symbol: 'optional', reason: 'string' }],
        riskWarnings: ['string'],
        missingDataWarnings: ['string'],
      },
      guardrails: ['Only NSE cash equities can be actionable', 'Do not guess unsupported symbols', 'If evidence is weak, either request one focused Exa search or add a warning', 'For every watchlist item, extract a draft GTT trigger candidate; keep prices null when unavailable instead of inventing unsupported exact prices', 'Draft GTT candidates are review artifacts only and must not imply order placement'],
      researchWindowUtc: input.researchWindow,
      exaStructuredOutput: input.exaOutput,
      sources: sources.map((source, index) => ({ id: `tool-${index}`, title: source.title, url: source.url, summary: source.summary, symbols: source.symbols, publishedAt: source.publishedAt })),
      previousActions: actions,
    }) },
  ];
  const result = await input.llm.generateJsonWithConversation({ model: input.model, temperature: 0.2, messages });
  return { json: normalizeLlmDecisionJson(result.json), conversation: result.conversation };
}

async function waitForExaRun(exa: ExaProvider, initial: ExaAgentRun, appRunId: string, userId: string): Promise<ExaAgentRun> {
  let current = initial;
  const seenEvents = new Set<string>();
  for (let attempt = 0; attempt < 80; attempt += 1) {
    for (const event of await safeListExaEvents(exa, current.id)) {
      const key = event.id ?? `${event.event}:${JSON.stringify(event.data)}`;
      if (seenEvents.has(key)) continue;
      seenEvents.add(key);
      await appendRunEvent(appRunId, userId, 'research.exa.event', { exaRunId: current.id, event: event.event, data: event.data, exaCreatedAt: event.createdAt });
    }
    if (current.status === 'completed' || current.status === 'failed' || current.status === 'cancelled') return current;
    await sleep(3000);
    current = await exa.getAgentRun(current.id);
  }
  throw new Error('Exa Agent run timed out');
}

async function safeListExaEvents(exa: ExaProvider, id: string): Promise<ExaAgentRunEvent[]> {
  try { return await exa.listAgentRunEvents(id); } catch { return []; }
}

async function failRun(runId: string, userId: string, message: string) {
  await updateRun(runId, { status: 'failed', riskWarnings: [message], completedAt: new Date() });
  await appendRunEvent(runId, userId, 'research.failed', { error: message });
  await audit('research.run.failed', { userId, entityType: 'research_run', entityId: runId, metadata: { error: message } });
}

async function updateRun(runId: string, values: Partial<typeof researchRuns.$inferInsert>) {
  await db.update(researchRuns).set({ ...values, updatedAt: new Date() }).where(eq(researchRuns.id, runId));
}

async function appendRunEvent(runId: string, userId: string, eventType: string, payload: RunEventPayload) {
  const [latest] = await db.select().from(researchRunEvents).where(eq(researchRunEvents.runId, runId)).orderBy(desc(researchRunEvents.sequence)).limit(1);
  const [event] = await db.insert(researchRunEvents).values({ runId, userId, eventType, payload, sequence: (latest?.sequence ?? 0) + 1 }).returning();
  const set = subscribers.get(runId);
  if (set) for (const subscriber of set) subscriber(event);
  return event;
}

async function loadRunSecrets(userId: string): Promise<Secrets> {
  const rows = await db.select().from(apiKeys).where(eq(apiKeys.userId, userId));
  const secret = (provider: string, label: string) => {
    const row = rows.find((item) => item.provider === provider && item.label === label);
    return row ? decryptSecret(row) : null;
  };
  return { exaApiKey: secret('exa', 'api_key'), llmApiKey: secret('llm', 'api_key') };
}

type StructuredResearchOutput = {
  researchWindowUtc?: { start?: string; end?: string };
  clientLocalDate?: string | null;
  clientTimeZone?: string | null;
  market: string;
  marketThesis: string;
  themes: Array<{ name: string; summary: string; evidenceSourceIds: string[] }>;
  sources: Array<{ id: string; title: string; url?: string; publisher?: string; publishedAt?: string; summary: string }>;
  candidates: Array<{ companyName: string; symbol?: string; exchange?: string; catalystType?: string; direction?: string; impactScore?: number; confidence?: number; whyToday: string; evidenceSourceIds: string[]; warnings: string[] }>;
  unresolvedCompanies: Array<{ companyName: string; reason: string; evidenceSourceIds: string[] }>;
  warnings: string[];
};

type LlmAction = { type: string; symbol?: string; query?: string; reason?: string };
type LlmDecisionJson = FinalResearchJson & { actions: LlmAction[] };

type FinalResearchJson = {
  marketThesis: string;
  sectorBias: Array<{ sector: string; bias: 'bullish' | 'bearish' | 'neutral'; reason: string }>;
  watchlist: Array<{ exchange: string; tradingsymbol: string; bias: 'long' | 'short' | 'neutral'; reason: string; evidenceSourceIds: string[]; rankReason?: string }>;
  gttCandidates: Array<{ exchange: string; tradingsymbol: string; transactionType: 'BUY' | 'SELL'; triggerPrice?: number | null; limitPrice?: number | null; targetPrice?: number | null; stopLossPrice?: number | null; quantity?: number; rationale: string; evidenceSourceIds: string[]; triggerLogic?: string }>;
  droppedCandidates: Array<{ companyName: string; symbol?: string; reason: string }>;
  riskWarnings: string[];
  missingDataWarnings: string[];
};

function buildExaAgentRequest(run: typeof researchRuns.$inferSelect, researchWindow: { start: string; end: string; clientLocalDate?: string | null; clientTimeZone?: string | null }, symbolBlacklist: string[]) {
  return {
    query: `Find current Indian NSE cash-equity market/day-trading research catalysts for ${researchWindow.clientLocalDate ?? 'the requested local date'}. Focus on stocks likely to be relevant for pre-market or market research. Use fresh news, company announcements, exchange filings, brokerage actions, earnings/results, order wins, regulatory approvals, M&A, sector/global cues, crude/rupee/rates where relevant. Return only source-grounded structured output. Research UTC window: ${researchWindow.start} to ${researchWindow.end}.`,
    systemPrompt: 'Prefer fresh Indian market, company, exchange, and credible news sources. Avoid duplicate sources/companies. Do not invent symbols or facts. If a company is mentioned but the NSE symbol is not supported by evidence, put it in unresolvedCompanies. Every candidate must cite source IDs or URLs. Do not produce order execution, GTT, or portfolio instructions.',
    effort: 'low' as const,
    metadata: {
      app_run_id: run.id,
      user_id: run.userId,
      research_type: run.researchType,
      created_at_utc: run.createdAt.toISOString(),
      client_local_date: run.clientLocalDate ?? '',
      client_time_zone: run.clientTimeZone ?? '',
    },
    input: symbolBlacklist.length ? { exclusion: symbolBlacklist.map((symbol) => ({ symbol })) } : undefined,
    outputSchema: exaOutputSchema(),
  };
}

function exaOutputSchema(): Record<string, unknown> {
  return {
    type: 'object',
    required: ['market', 'marketThesis', 'themes', 'sources', 'candidates', 'unresolvedCompanies', 'warnings'],
    properties: {
      researchWindowUtc: { type: 'object' },
      clientLocalDate: { type: 'string' },
      clientTimeZone: { type: 'string' },
      market: { type: 'string' },
      marketThesis: { type: 'string' },
      themes: { type: 'array', maxItems: 8, items: { type: 'object', required: ['name', 'summary', 'evidenceSourceIds'], properties: { name: { type: 'string' }, summary: { type: 'string' }, evidenceSourceIds: { type: 'array', items: { type: 'string' } } } } },
      sources: { type: 'array', maxItems: 40, items: { type: 'object', required: ['id', 'title', 'summary'], properties: { id: { type: 'string' }, title: { type: 'string' }, url: { type: 'string' }, publisher: { type: 'string' }, publishedAt: { type: 'string' }, summary: { type: 'string' } } } },
      candidates: { type: 'array', maxItems: 20, items: { type: 'object', required: ['companyName', 'whyToday', 'evidenceSourceIds'], properties: { companyName: { type: 'string' }, symbol: { type: 'string' }, exchange: { type: 'string' }, catalystType: { type: 'string' }, direction: { type: 'string' }, impactScore: { type: 'number' }, confidence: { type: 'number' }, whyToday: { type: 'string' }, evidenceSourceIds: { type: 'array', items: { type: 'string' } }, warnings: { type: 'array', items: { type: 'string' } } } } },
      unresolvedCompanies: { type: 'array', maxItems: 20, items: { type: 'object', required: ['companyName', 'reason', 'evidenceSourceIds'], properties: { companyName: { type: 'string' }, reason: { type: 'string' }, evidenceSourceIds: { type: 'array', items: { type: 'string' } } } } },
      warnings: { type: 'array', items: { type: 'string' } },
    },
  };
}

function normalizeExaStructuredOutput(value: unknown): StructuredResearchOutput {
  if (!value || typeof value !== 'object') throw new Error('Exa structured output missing');
  const record = value as Record<string, unknown>;
  const sources = arrayOfObjects(record.sources).map((row, index) => ({
    id: stringValue(row.id) || `source-${index + 1}`,
    title: stringValue(row.title) || 'Untitled source',
    url: stringValue(row.url) || undefined,
    publisher: stringValue(row.publisher) || undefined,
    publishedAt: stringValue(row.publishedAt) || undefined,
    summary: stringValue(row.summary) || stringValue(row.highlight) || '',
  })).filter((source) => source.title || source.summary || source.url);
  const candidates = arrayOfObjects(record.candidates).map((row) => ({
    companyName: stringValue(row.companyName) || stringValue(row.company) || stringValue(row.name) || 'Unknown company',
    symbol: normalizeSymbol(row.symbol),
    exchange: stringValue(row.exchange) || 'NSE',
    catalystType: stringValue(row.catalystType) || 'other_news',
    direction: stringValue(row.direction) || 'unknown',
    impactScore: boundedNumber(row.impactScore, 0, 100, 50),
    confidence: boundedNumber(row.confidence, 0, 1, 0.5),
    whyToday: stringValue(row.whyToday) || stringValue(row.reason) || '',
    evidenceSourceIds: stringArray(row.evidenceSourceIds ?? row.sourceIds ?? row.sources),
    warnings: stringArray(row.warnings),
  })).filter((candidate) => candidate.whyToday && candidate.evidenceSourceIds.length);
  return {
    researchWindowUtc: objectValue(record.researchWindowUtc) as StructuredResearchOutput['researchWindowUtc'],
    clientLocalDate: stringValue(record.clientLocalDate) || null,
    clientTimeZone: stringValue(record.clientTimeZone) || null,
    market: stringValue(record.market) || 'NSE_EQ',
    marketThesis: stringValue(record.marketThesis),
    themes: arrayOfObjects(record.themes).map((row) => ({ name: stringValue(row.name) || 'Market', summary: stringValue(row.summary), evidenceSourceIds: stringArray(row.evidenceSourceIds) })),
    sources,
    candidates,
    unresolvedCompanies: arrayOfObjects(record.unresolvedCompanies).map((row) => ({ companyName: stringValue(row.companyName) || 'Unknown company', reason: stringValue(row.reason), evidenceSourceIds: stringArray(row.evidenceSourceIds) })),
    warnings: stringArray(record.warnings),
  };
}

function sourceFromStructured(source: StructuredResearchOutput['sources'][number]): ResearchSource {
  return { provider: 'exa_agent', title: source.title, url: source.url, summary: source.summary, symbols: [], publishedAt: source.publishedAt, raw: { structuredSourceId: source.id, publisher: source.publisher } };
}

function normalizeLlmDecisionJson(json: Record<string, unknown>): LlmDecisionJson {
  return { ...normalizeFinalResearch(json, { candidates: [], warnings: [], marketThesis: '', sectorBias: [], themes: [], sources: [], unresolvedCompanies: [], market: 'NSE_EQ' } as unknown as StructuredResearchOutput, []), actions: arrayOfObjects(json.actions).map((row) => ({ type: stringValue(row.type), symbol: normalizeSymbol(row.symbol), query: stringValue(row.query), reason: stringValue(row.reason) })).filter((action) => action.type) };
}

function normalizeFinalResearch(json: Record<string, unknown>, exaOutput: StructuredResearchOutput, symbolBlacklist: string[]): FinalResearchJson {
  const blacklist = new Set(symbolBlacklist.map(normalizeSymbol));
  const watchlist = arrayOfObjects(json.watchlist).map((row) => ({
    exchange: stringValue(row.exchange) || 'NSE',
    tradingsymbol: normalizeSymbol(row.tradingsymbol ?? row.symbol),
    bias: biasValue(row.bias),
    reason: stringValue(row.reason) || stringValue(row.thesis) || '',
    evidenceSourceIds: stringArray(row.evidenceSourceIds ?? row.sources),
    rankReason: stringValue(row.rankReason),
  })).filter((item) => item.exchange === 'NSE' && isNseEquitySymbol(item.tradingsymbol) && !blacklist.has(item.tradingsymbol) && item.reason).slice(0, 12);
  const gttFromJson = arrayOfObjects(json.gttCandidates).map((row) => ({
    exchange: stringValue(row.exchange) || 'NSE',
    tradingsymbol: normalizeSymbol(row.tradingsymbol ?? row.symbol),
    transactionType: transactionTypeValue(row.transactionType),
    triggerPrice: nullableNumber(row.triggerPrice),
    limitPrice: nullableNumber(row.limitPrice),
    targetPrice: nullableNumber(row.targetPrice),
    stopLossPrice: nullableNumber(row.stopLossPrice),
    quantity: Math.max(1, Math.floor(boundedNumber(row.quantity, 1, 1_000_000, 1))),
    rationale: stringValue(row.rationale) || stringValue(row.reason) || stringValue(row.triggerLogic),
    evidenceSourceIds: stringArray(row.evidenceSourceIds ?? row.sources),
    triggerLogic: stringValue(row.triggerLogic),
  })).filter((item) => item.exchange === 'NSE' && isNseEquitySymbol(item.tradingsymbol) && !blacklist.has(item.tradingsymbol) && item.rationale);
  const gttBySymbol = new Map(gttFromJson.map((item) => [item.tradingsymbol, item]));
  for (const item of watchlist) {
    if (!gttBySymbol.has(item.tradingsymbol)) {
      gttBySymbol.set(item.tradingsymbol, {
        exchange: item.exchange,
        tradingsymbol: item.tradingsymbol,
        transactionType: item.bias === 'short' ? 'SELL' : 'BUY',
        triggerPrice: null,
        limitPrice: null,
        targetPrice: null,
        stopLossPrice: null,
        quantity: 1,
        rationale: `Draft GTT trigger extracted from research watchlist: ${item.reason}`,
        evidenceSourceIds: item.evidenceSourceIds,
        triggerLogic: item.rankReason || 'Review current market price and set confirmation trigger before placement.',
      });
    }
  }
  const warnings = [...stringArray(json.riskWarnings), ...stringArray(json.missingDataWarnings), ...exaOutput.warnings];
  return {
    marketThesis: stringValue(json.marketThesis) || exaOutput.marketThesis || 'Research completed with limited thesis detail.',
    sectorBias: arrayOfObjects(json.sectorBias).map((row) => ({ sector: stringValue(row.sector) || 'Market', bias: sectorBiasValue(row.bias), reason: stringValue(row.reason) })).slice(0, 8),
    watchlist,
    gttCandidates: [...gttBySymbol.values()].slice(0, 12),
    droppedCandidates: arrayOfObjects(json.droppedCandidates).map((row) => ({ companyName: stringValue(row.companyName) || stringValue(row.symbol) || 'Unknown', symbol: normalizeSymbol(row.symbol) || undefined, reason: stringValue(row.reason) })).slice(0, 40),
    riskWarnings: [...new Set(warnings.filter(Boolean))].slice(0, 30),
    missingDataWarnings: stringArray(json.missingDataWarnings).slice(0, 20),
  };
}

async function persistResearchGttCandidates(run: typeof researchRuns.$inferSelect, final: FinalResearchJson): Promise<number> {
  if (!final.gttCandidates.length) return 0;
  const latestSnapshots = await db.select().from(marketSnapshots).where(eq(marketSnapshots.userId, run.userId)).orderBy(desc(marketSnapshots.capturedAt)).limit(500);
  const priceBySymbol = new Map<string, number>();
  for (const snapshot of latestSnapshots) {
    const symbol = normalizeSymbol(snapshot.tradingsymbol);
    const price = nullableNumber(snapshot.lastPrice);
    if (symbol && price && !priceBySymbol.has(symbol)) priceBySymbol.set(symbol, price);
  }
  const rows = final.gttCandidates.map((candidate) => {
    const enriched = enrichCandidatePrices(candidate, priceBySymbol.get(candidate.tradingsymbol));
    return {
      userId: run.userId,
      sessionId: null,
      exchange: enriched.exchange,
      tradingsymbol: enriched.tradingsymbol,
      transactionType: enriched.transactionType,
      triggerPrice: decimalString(enriched.triggerPrice),
      limitPrice: decimalString(enriched.limitPrice),
      targetPrice: decimalString(enriched.targetPrice),
      stopLossPrice: decimalString(enriched.stopLossPrice),
      quantity: enriched.quantity ?? 1,
      rationale: enriched.rationale,
      status: enriched.triggerPrice && enriched.targetPrice && enriched.stopLossPrice ? 'draft' : 'draft_needs_price',
      raw: { source: 'research_run', researchRunId: run.id, evidenceSourceIds: enriched.evidenceSourceIds, triggerLogic: enriched.triggerLogic, priceContext: priceBySymbol.get(candidate.tradingsymbol) ?? null },
    };
  });
  await db.insert(gttCandidates).values(rows);
  return rows.length;
}

function enrichCandidatePrices(candidate: FinalResearchJson['gttCandidates'][number], lastPrice?: number): FinalResearchJson['gttCandidates'][number] {
  if (!lastPrice || (candidate.triggerPrice && candidate.limitPrice && candidate.targetPrice && candidate.stopLossPrice)) return candidate;
  const isSell = candidate.transactionType === 'SELL';
  const triggerPrice = candidate.triggerPrice ?? roundPrice(lastPrice * (isSell ? 0.998 : 1.002));
  const limitPrice = candidate.limitPrice ?? triggerPrice;
  const targetPrice = candidate.targetPrice ?? roundPrice(lastPrice * (isSell ? 0.97 : 1.03));
  const stopLossPrice = candidate.stopLossPrice ?? roundPrice(lastPrice * (isSell ? 1.015 : 0.985));
  return {
    ...candidate,
    triggerPrice,
    limitPrice,
    targetPrice,
    stopLossPrice,
    triggerLogic: candidate.triggerLogic || `Price-context fallback from latest market snapshot ${lastPrice}: entry trigger ${triggerPrice}, target ${targetPrice}, stoploss ${stopLossPrice}.`,
  };
}

function roundPrice(value: number): number {
  return Math.round(value * 20) / 20;
}

function mergeRunConversations(model: string, a: AgentConversationTrace, b: AgentConversationTrace): AgentConversationTrace {
  return {
    provider: 'openai-compatible',
    model,
    startedAt: a.startedAt,
    completedAt: b.completedAt,
    status: b.status,
    messages: [...a.messages, ...b.messages],
    thoughtDetails: [...a.thoughtDetails, ...b.thoughtDetails],
    rawResponse: { first: a.rawResponse, second: b.rawResponse },
  };
}

function dedupeSources(sources: ResearchSource[]) {
  const map = new Map<string, ResearchSource>();
  for (const source of sources) {
    const key = source.url || `${source.provider}:${source.title}`;
    if (!map.has(key)) map.set(key, source);
  }
  return [...map.values()].slice(0, 60);
}

function researchWindowUtc(clientLocalDate?: string | null, clientTimeZone?: string | null) {
  // If client-local date/time zone is supplied, keep it as metadata. JS without Temporal cannot reliably convert arbitrary zones.
  // The backend stores UTC and defaults the research freshness window to the last 36 hours.
  const end = new Date();
  const start = new Date(end.getTime() - 36 * 60 * 60 * 1000);
  return { start: start.toISOString(), end: end.toISOString(), clientLocalDate, clientTimeZone };
}

function validLocalDate(value: unknown): string | null {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function validTimeZone(value: unknown): string | null {
  return typeof value === 'string' && /^[A-Za-z_]+\/[A-Za-z0-9_+\-\/]+$/.test(value) ? value : null;
}

function sleep(ms: number) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function stringConfig(value: unknown): string | undefined { return typeof value === 'string' && value.trim() ? value.trim() : undefined; }
function stringValue(value: unknown): string { return typeof value === 'string' ? value.trim() : ''; }
function objectValue(value: unknown): Record<string, unknown> | undefined { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }
function arrayOfObjects(value: unknown): Array<Record<string, unknown>> { return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item)) : []; }
function stringArray(value: unknown): string[] { return Array.isArray(value) ? value.flatMap(stringArray) : typeof value === 'string' ? value.split(/[\n,;|]+/).map((item) => item.trim()).filter(Boolean) : []; }
function boundedNumber(value: unknown, min: number, max: number, fallback: number): number { const parsed = Number(value); return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback; }
function nullableNumber(value: unknown): number | null { const parsed = Number(value); return Number.isFinite(parsed) && parsed > 0 ? parsed : null; }
function decimalString(value: number | null | undefined): string | null { return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(4) : null; }
function normalizeSymbol(value: unknown): string { return typeof value === 'string' ? value.trim().toUpperCase().replace(/^NSE[:\s-]*/, '').replace(/\.(NS|BO)$/i, '') : ''; }
function isNseEquitySymbol(symbol: string): boolean { return /^[A-Z][A-Z0-9]{1,14}$/.test(symbol) && !['NSE', 'BSE', 'IPO', 'FII', 'DII', 'RBI', 'SEBI', 'GDP', 'CEO', 'CFO', 'BUY', 'SELL', 'INDIA', 'MARKET', 'STOCK', 'SHARE', 'INDEX', 'TODAY', 'NEWS', 'RESULTS', 'NIFTY', 'SENSEX'].includes(symbol); }
function biasValue(value: unknown): 'long' | 'short' | 'neutral' { return value === 'long' || value === 'short' || value === 'neutral' ? value : 'neutral'; }
function transactionTypeValue(value: unknown): 'BUY' | 'SELL' { return String(value).toUpperCase() === 'SELL' ? 'SELL' : 'BUY'; }
function sectorBiasValue(value: unknown): 'bullish' | 'bearish' | 'neutral' { return value === 'bullish' || value === 'bearish' || value === 'neutral' ? value : 'neutral'; }
