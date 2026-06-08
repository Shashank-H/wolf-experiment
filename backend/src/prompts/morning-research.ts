import type { LlmMessage, ResearchSource } from '../providers/research/types';

export type ResearchRiskTolerance = 'conservative' | 'moderate' | 'aggressive';

export type MorningResearchSettings = {
  maxWatchlistItems: number;
  maxTradeCandidates: number;
  maxGttCandidates: number;
  riskTolerance: ResearchRiskTolerance;
};

export const DEFAULT_MORNING_RESEARCH_SETTINGS: MorningResearchSettings = {
  maxWatchlistItems: 6,
  maxTradeCandidates: 4,
  maxGttCandidates: 3,
  riskTolerance: 'conservative',
};

export type MorningResearchPromptContext = {
  broker: {
    holdings: Array<{ exchange: string; tradingsymbol: string; quantity: string; pnl: string }>;
    positions: Array<{ exchange: string; tradingsymbol: string; product: string; quantity: string; pnl: string }>;
  };
  sources: ResearchSource[];
  settings: MorningResearchSettings;
  rcaLearnings?: Array<{ tradeDate: string; summary: string; signals: Array<{ symbol: string; pnl: number; outcome: string; lesson: string }> }>;
};

const RISK_TOLERANCE_GUIDANCE: Record<ResearchRiskTolerance, string> = {
  conservative: 'Capital preservation first. Prefer fewer ideas, lower confidence unless evidence is strong, no speculative trades, and empty trade/GTT arrays when evidence is weak.',
  moderate: 'Balanced risk. Allow more candidates when evidence is multi-source and liquidity is clear, but every idea still needs condition-based entry and explicit invalidation.',
  aggressive: 'Higher idea tolerance for manual review only. You may include more momentum/event-driven ideas, but must still avoid hallucinated prices, illiquid setups, and unmanaged downside.',
};

export const MORNING_RESEARCH_SYSTEM_PROMPT = [
  'You are an Indian equity trading copilot for NSE/NFO markets.',
  'Follow the configured risk tolerance exactly; never exceed the provided candidate limits.',
  'Use only the provided broker context, source summaries, and prior EOD RCA learnings; do not invent news, prices, events, or fundamentals.',
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
      exchange: 'NSE | NFO',
      tradingsymbol: 'string: uppercase broker/exchange symbol',
      bias: 'long | short | neutral',
      reason: 'string: why this belongs on watchlist today',
    },
  ],
  tradeCandidates: [
    {
      exchange: 'NSE | NFO',
      tradingsymbol: 'string: uppercase broker/exchange symbol',
      side: 'BUY | SELL',
      thesis: 'string: setup and evidence',
      entryPlan: 'string: condition-based entry, not a blind market order',
      invalidation: 'string: clear reason to avoid/exit',
      confidence: 'number: integer 0-100; calibrate to configured risk tolerance and evidence quality',
    },
  ],
  gttCandidates: [
    {
      exchange: 'NSE | NFO',
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
  riskWarnings: ['string: concrete risks, missing data, or reasons for manual validation'],
};

export const MORNING_RESEARCH_USER_PROMPT_TEMPLATE = [
  'Create a morning research plan for the current Indian trading day.',
  '',
  'Research settings:',
  '- Maximum watchlist items: {{maxWatchlistItems}}',
  '- Maximum trade candidates: {{maxTradeCandidates}}',
  '- Maximum GTT candidates: {{maxGttCandidates}}',
  '- Risk tolerance: {{riskTolerance}}',
  '- Risk tolerance guidance: {{riskToleranceGuidance}}',
  '',
  'Output requirements:',
  '- Return exactly one JSON object matching this schema:',
  '{{schema}}',
  '- Never exceed the maximum item counts listed in Research settings.',
  '- Keep tradeCandidates sparse. If evidence is weak for the configured risk tolerance, return an empty tradeCandidates array.',
  '- All candidates must be suitable for manual review before execution.',
  '- GTT candidates must be two-leg Kite GTT drafts with both targetPrice and stopLossPrice. Do not output one-sided GTTs.',
  '- transactionType is the exit side for both GTT legs. For SELL exits, targetPrice must be above stopLossPrice. For BUY exits, targetPrice must be below stopLossPrice.',
  '- Do not include intraday price levels unless they are present in the supplied context or sources.',
  '- Add riskWarnings for stale, missing, conflicting, or single-source evidence.',
  '',
  'Available context:',
  '{{context}}',
].join('\n');

export function buildMorningResearchMessages(context: MorningResearchPromptContext): LlmMessage[] {
  const { settings } = context;
  return [
    { role: 'system', content: MORNING_RESEARCH_SYSTEM_PROMPT },
    {
      role: 'user',
      content: MORNING_RESEARCH_USER_PROMPT_TEMPLATE
        .replace('{{maxWatchlistItems}}', String(settings.maxWatchlistItems))
        .replace('{{maxTradeCandidates}}', String(settings.maxTradeCandidates))
        .replace('{{maxGttCandidates}}', String(settings.maxGttCandidates))
        .replace('{{riskTolerance}}', settings.riskTolerance)
        .replace('{{riskToleranceGuidance}}', RISK_TOLERANCE_GUIDANCE[settings.riskTolerance])
        .replace('{{schema}}', JSON.stringify(MORNING_RESEARCH_JSON_SCHEMA, null, 2))
        .replace('{{context}}', JSON.stringify({ broker: context.broker, sources: context.sources, rcaLearnings: context.rcaLearnings ?? [] })),
    },
  ];
}
