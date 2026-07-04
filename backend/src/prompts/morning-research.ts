import { DEFAULT_TRADING_RISK_LIMITS } from '../config/trading-risk';
import type { LlmMessage, MarketCandidate, ResearchSource } from '../providers/research/types';

export type ResearchRiskTolerance = 'conservative' | 'moderate' | 'aggressive';

export type MorningResearchSettings = {
  maxWatchlistItems: number;
  maxGttCandidates: number;
  riskTolerance: ResearchRiskTolerance;
};

export type TradingRiskSettings = {
  maxDailyLoss: number;
  maxTradesPerDay: number;
  maxCapitalPerTrade: number;
  maxOpenPositions: number;
};

export const DEFAULT_TRADING_RISK_SETTINGS: TradingRiskSettings = DEFAULT_TRADING_RISK_LIMITS;

export const DEFAULT_MORNING_RESEARCH_SETTINGS: MorningResearchSettings = {
  maxWatchlistItems: 6,
  maxGttCandidates: 3,
  riskTolerance: 'conservative',
};

export type MorningResearchPromptContext = {
  broker: {
    holdings: Array<{ exchange: string; tradingsymbol: string; quantity: string; pnl: string }>;
    positions: Array<{ exchange: string; tradingsymbol: string; product: string; quantity: string; pnl: string }>;
  };
  discoveredCandidates: MarketCandidate[];
  sources: ResearchSource[];
  settings: MorningResearchSettings;
  tradingRisk: TradingRiskSettings;
  rcaLearnings?: Array<{ tradeDate: string; summary: string; signals: Array<{ symbol: string; pnl: number; outcome: string; lesson: string }> }>;
};

const RISK_TOLERANCE_GUIDANCE: Record<ResearchRiskTolerance, string> = {
  conservative: 'Capital preservation first. Prefer fewer ideas, no speculative trades, and empty GTT arrays when evidence is weak.',
  moderate: 'Balanced risk. Allow more candidates when evidence is multi-source and liquidity is clear, but every idea still needs condition-based entry and explicit invalidation.',
  aggressive: 'Higher idea tolerance for manual review only. You may include more momentum/event-driven ideas, but must still avoid hallucinated prices, illiquid setups, and unmanaged downside.',
};

export const MORNING_RESEARCH_SYSTEM_PROMPT = [
  'You are an Indian equity trading copilot for NSE cash equities only.',
  'Follow the configured risk tolerance and trading-risk proposal guardrails exactly; never exceed the provided candidate limits.',
  'Use only the provided likely-mover/catalyst candidates, broker context, source summaries, and prior EOD RCA learnings; do not invent symbols, news, prices, events, or fundamentals.',
  'When prior RCA learnings are supplied, adapt selection and confidence away from recurring losing patterns and toward repeatedly validated evidence patterns.',
  'Prefer no trade over a weak trade. All outputs are drafts for manual review, not execution instructions.',
  'Return strict JSON only: no markdown, no commentary, no trailing text.',
].join('\n');

const MORNING_RESEARCH_JSON_SCHEMA = {
  marketThesis: 'string: concise 2-4 sentence market view grounded in supplied sources',
  sectorBias: [
    {
      sector: 'string',
      bias: 'bullish | bearish | neutral',
      reason: 'string: evidence-backed reason',
    },
  ],
  watchlist: [
    {
      exchange: 'NSE',
      tradingsymbol: 'string: uppercase broker/exchange symbol',
      bias: 'long | short | neutral',
      reason: 'string: why this belongs on watchlist today; cite pre-market catalyst evidence and say watchlist-only / needs validation when quote context is missing',
    },
  ],
  riskWarnings: ['string: concrete risks, missing data, or reasons for manual validation'],
};

const MORNING_RESEARCH_IDEAS_JSON_SCHEMA = {
  ...MORNING_RESEARCH_JSON_SCHEMA,
  tradeCandidates: [
    {
      exchange: 'NSE',
      tradingsymbol: 'string: uppercase broker/exchange symbol',
      side: 'BUY | SELL',
      thesis: 'string: evidence-backed candidate thesis citing pre-market catalyst evidence and quote/risk grounding if it should advance to GTT',
      entryPlan: 'string: condition-based entry plan; no invented prices',
      invalidation: 'string: concrete invalidation condition or missing-data caveat',
      confidence: 'number: integer 0-100',
    },
  ],
};

const MORNING_RESEARCH_GTT_JSON_SCHEMA = {
  gttCandidates: [
    {
      exchange: 'NSE',
      tradingsymbol: 'string: uppercase broker/exchange symbol',
      transactionType: 'BUY | SELL: exit side for the GTT legs, not a regular market order',
      targetPrice: 'number: required for broker placement; target/take-profit trigger level grounded in provided context',
      stopLossPrice: 'number: required for broker placement; stoploss trigger level grounded in provided context',
      triggerPrice: 'number: optional legacy alias for targetPrice only if grounded in provided context',
      limitPrice: 'number: optional legacy alias for stopLossPrice only if grounded in provided context',
      quantity: 'number: positive integer; size according to configured risk tolerance',
      rationale: 'string: why this draft two-leg GTT with target and stoploss is appropriate',
    },
  ],
};

export const MORNING_RESEARCH_USER_PROMPT_TEMPLATE = [
  'Create a morning research plan for the current Indian trading day.',
  '',
  'Research settings:',
  '- Maximum watchlist items: {{maxWatchlistItems}}',
  '- Maximum transient trade candidates: {{maxTransientTradeCandidates}}',
  '- Risk tolerance: {{riskTolerance}}',
  '- Risk tolerance guidance: {{riskToleranceGuidance}}',
  '',
  'Trading-risk proposal guardrails from user settings:',
  '- Maximum daily loss/risk budget for app-created GTT proposals: {{maxDailyLoss}}',
  '- Maximum app trades/GTT proposals per day: {{maxTradesPerDay}}',
  '- Maximum capital per proposed trade: {{maxCapitalPerTrade}}',
  '- Maximum simultaneous open positions to consider: {{maxOpenPositions}}',
  '',
  'Output requirements:',
  '- Return exactly one JSON object matching this schema:',
  '{{schema}}',
  '- Never exceed the maximum item counts listed in Research settings.',
  '- Use the trading-risk proposal guardrails to avoid unsuitable ideas early; prefer fewer/no transient trade candidates when an idea is unlikely to fit daily loss, trades/day, capital/trade, or open-position limits.',
  '- A guardrail value of 0 means that particular numeric limit is disabled/not configured.',
  '- Watchlist and trade candidates must come from discoveredCandidates unless the reason explicitly says it is portfolio-only context and why discovery evidence is unavailable.',
  '- Treat discoveredCandidates as likely movers based on pre-market catalysts, not already-moved top gainers/losers.',
  '- Every watchlist or trade candidate must cite supplied discovered-candidate metrics, catalyst type/direction, ranking reasons, and/or source evidence in its reason/thesis; do not output symbols unsupported by discoveredCandidates, broker context, or sources.',
  '- Stage 1 may include catalyst-backed watchlist-only candidates even when lastPrice/referencePrice is missing, but the reason must clearly say needs price/liquidity validation before any GTT.',
  '- Only put a symbol in tradeCandidates when catalyst evidence and quote/risk context are sufficient for Stage 2 consideration; otherwise keep it watchlist-only.',
  '- Trade candidates are transient planning artifacts only. They are not approval objects and are not persisted as database rows.',
  '- Do not include GTT candidates in this stage.',
  '- Add riskWarnings for stale, missing, conflicting, or single-source evidence.',
  '',
  'Available context:',
  '{{context}}',
].join('\n');

export const MORNING_RESEARCH_GTT_USER_PROMPT_TEMPLATE = [
  'Convert selected Stage 1 trade candidates into draft two-leg Kite GTT candidates for manual review.',
  '',
  'Research settings:',
  '- Maximum GTT candidates: {{maxGttCandidates}}',
  '- Risk tolerance: {{riskTolerance}}',
  '- Risk tolerance guidance: {{riskToleranceGuidance}}',
  '',
  'Trading-risk proposal guardrails from user settings:',
  '- Maximum daily loss/risk budget for app-created GTT proposals: {{maxDailyLoss}}',
  '- Maximum app trades/GTT proposals per day: {{maxTradesPerDay}}',
  '- Maximum capital per proposed trade: {{maxCapitalPerTrade}}',
  '- Maximum simultaneous open positions to consider: {{maxOpenPositions}}',
  '',
  'Output requirements:',
  '- Return exactly one JSON object matching this schema:',
  '{{schema}}',
  '- The model must choose which Stage 1 trade candidates advance. Return fewer than the maximum when evidence is weak or when sizing cannot fit the configured trading-risk proposal guardrails.',
  '- Only use candidates and context from Stage 1, discoveredCandidates, and the supplied source/broker context.',
  '- GTT candidates must be draft-only and suitable for manual review before execution.',
  '- Apply the trading-risk proposal guardrails strictly in this stage when selecting and sizing draft GTTs; if no candidate can fit, return an empty gttCandidates array.',
  '- Size quantity so estimated capital (reference price times quantity) stays within maxCapitalPerTrade when configured, and stop-loss risk stays within maxDailyLoss when configured.',
  '- Do not use the maximum candidate count as a target; fewer or zero candidates is preferred over proposals that breach guardrails.',
  '- A guardrail value of 0 means that particular numeric limit is disabled/not configured.',
  '- GTT candidates must be two-leg Kite GTT drafts with both targetPrice and stopLossPrice. Do not output one-sided GTTs.',
  '- GTT prices must be grounded in supplied candidate quote/price context: lastPrice or referencePrice plus explicit source/context support for targetPrice and stopLossPrice. If reference price, target, or stop-loss context is missing, return an empty gttCandidates array.',
  '- Do not create GTT candidates for watchlist-only catalyst candidates that lack price/liquidity validation.',
  '- transactionType is the exit side for both GTT legs. For SELL exits, targetPrice must be above stopLossPrice. For BUY exits, targetPrice must be below stopLossPrice.',
  '- Do not include intraday price levels unless they are present in discoveredCandidates, supplied context, or sources.',
  '',
  'Available context:',
  '{{context}}',
].join('\n');

export function transientTradeCandidateLimit(settings: Pick<MorningResearchSettings, 'maxGttCandidates'>): number {
  return Math.max(4, settings.maxGttCandidates * 3);
}

export function buildMorningResearchIdeasMessages(context: MorningResearchPromptContext): LlmMessage[] {
  const { settings, tradingRisk } = context;
  return [
    { role: 'system', content: MORNING_RESEARCH_SYSTEM_PROMPT },
    {
      role: 'user',
      content: MORNING_RESEARCH_USER_PROMPT_TEMPLATE
        .replace('{{maxWatchlistItems}}', String(settings.maxWatchlistItems))
        .replace('{{maxTransientTradeCandidates}}', String(transientTradeCandidateLimit(settings)))
        .replace('{{riskTolerance}}', settings.riskTolerance)
        .replace('{{riskToleranceGuidance}}', RISK_TOLERANCE_GUIDANCE[settings.riskTolerance])
        .replace('{{maxDailyLoss}}', String(tradingRisk.maxDailyLoss))
        .replace('{{maxTradesPerDay}}', String(tradingRisk.maxTradesPerDay))
        .replace('{{maxCapitalPerTrade}}', String(tradingRisk.maxCapitalPerTrade))
        .replace('{{maxOpenPositions}}', String(tradingRisk.maxOpenPositions))
        .replace('{{schema}}', JSON.stringify(MORNING_RESEARCH_IDEAS_JSON_SCHEMA, null, 2))
        .replace('{{context}}', JSON.stringify({ discoveredCandidates: context.discoveredCandidates, broker: context.broker, sources: context.sources, tradingRisk, rcaLearnings: context.rcaLearnings ?? [] })),
    },
  ];
}

export function buildMorningResearchGttMessages(context: MorningResearchPromptContext & { ideasPlan: Record<string, unknown> }): LlmMessage[] {
  const { settings, tradingRisk } = context;
  return [
    { role: 'system', content: MORNING_RESEARCH_SYSTEM_PROMPT },
    {
      role: 'user',
      content: MORNING_RESEARCH_GTT_USER_PROMPT_TEMPLATE
        .replace('{{maxGttCandidates}}', String(settings.maxGttCandidates))
        .replace('{{riskTolerance}}', settings.riskTolerance)
        .replace('{{riskToleranceGuidance}}', RISK_TOLERANCE_GUIDANCE[settings.riskTolerance])
        .replace('{{maxDailyLoss}}', String(tradingRisk.maxDailyLoss))
        .replace('{{maxTradesPerDay}}', String(tradingRisk.maxTradesPerDay))
        .replace('{{maxCapitalPerTrade}}', String(tradingRisk.maxCapitalPerTrade))
        .replace('{{maxOpenPositions}}', String(tradingRisk.maxOpenPositions))
        .replace('{{schema}}', JSON.stringify(MORNING_RESEARCH_GTT_JSON_SCHEMA, null, 2))
        .replace('{{context}}', JSON.stringify({ discoveredCandidates: context.discoveredCandidates, broker: context.broker, sources: context.sources, tradingRisk, rcaLearnings: context.rcaLearnings ?? [], stage1: context.ideasPlan })),
    },
  ];
}
