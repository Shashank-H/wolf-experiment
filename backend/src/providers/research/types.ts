export type DiscoveryEvidence = {
  provider: string;
  title?: string;
  url?: string;
  summary?: string;
  publishedAt?: string;
  raw?: Record<string, unknown>;
};

export type CatalystType = 'earnings' | 'order_win' | 'mna' | 'regulatory' | 'corporate_action' | 'brokerage_rating' | 'sector_cue' | 'global_cue' | 'management_commentary' | 'litigation_or_risk' | 'other_news';

export type CatalystDirection = 'positive' | 'negative' | 'mixed' | 'unknown';

export type CandidateRankingMetadata = {
  score: number;
  catalystStrength?: number;
  sourceConfidence?: number;
  recencyScore?: number;
  sentimentClarity?: number;
  tradeabilityScore?: number;
  moveScore?: number;
  liquidityScore?: number;
  evidenceScore?: number;
  riskScore?: number;
  reasons: string[];
};

export type MarketCandidate = {
  exchange: string;
  tradingsymbol: string;
  instrumentType: 'EQ';
  lastPrice?: number;
  referencePrice?: number;
  changePercent?: number;
  volume?: number;
  turnover?: number;
  sector?: string;
  sentiment?: 'bullish' | 'bearish' | 'neutral' | 'unknown';
  catalystType?: CatalystType;
  catalystDirection?: CatalystDirection;
  reactiveSignal?: boolean;
  validationStatus?: 'watchlist_only' | 'price_validated' | 'liquidity_validated' | 'gtt_ready';
  discoveredBy: string[];
  evidence: DiscoveryEvidence[];
  ranking?: CandidateRankingMetadata;
  raw?: Record<string, unknown>;
};

export type ResearchSource = {
  provider: string;
  title: string;
  url?: string;
  summary: string;
  symbols: string[];
  publishedAt?: string;
  raw?: Record<string, unknown>;
};

export type ResearchQuery = {
  query: string;
  symbols?: string[];
  limit?: number;
  lookbackDays?: number;
};

export type MarketDiscoveryQuery = {
  limit: number;
};

export interface MarketDiscoveryProvider {
  discover(input: MarketDiscoveryQuery): Promise<MarketCandidate[]>;
}

export type ExaSearchOptions = ResearchQuery & {
  type?: 'instant' | 'fast' | 'auto' | 'deep-lite' | 'deep' | 'deep-reasoning';
  additionalQueries?: string[];
  startPublishedDate?: string;
  endPublishedDate?: string;
  includeDomains?: string[];
  excludeDomains?: string[];
  userLocation?: string;
  moderation?: boolean;
  systemPrompt?: string;
  maxAgeHours?: number;
  textMaxCharacters?: number;
  summaryQuery?: string;
};

export interface ResearchProvider {
  search(input: ResearchQuery): Promise<ResearchSource[]>;
}

export type ExaAgentRunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export type ExaAgentRun = {
  id: string;
  status: ExaAgentRunStatus;
  stopReason?: string | null;
  createdAt?: string;
  completedAt?: string | null;
  request?: Record<string, unknown> | null;
  output?: { text?: string; structured?: unknown; grounding?: unknown[] };
  usage?: Record<string, unknown>;
  costDollars?: Record<string, unknown>;
};

export type ExaAgentRunEvent = {
  id?: string;
  event: string;
  data?: unknown;
  createdAt?: string;
};

export type ExaAgentRunRequest = {
  query: string;
  systemPrompt?: string;
  outputSchema?: Record<string, unknown>;
  effort?: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'auto';
  input?: { data?: Array<Record<string, unknown>>; exclusion?: Array<Record<string, unknown>> };
  metadata?: Record<string, string>;
  previousRunId?: string;
};

export type LlmMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export type AgentConversationMessage = LlmMessage & {
  name?: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
};

export type AgentConversationTrace = {
  provider: string;
  model: string;
  startedAt: string;
  completedAt: string;
  status: 'completed' | 'fallback' | 'failed';
  messages: AgentConversationMessage[];
  thoughtDetails: Array<{ title: string; detail: string; metadata?: Record<string, unknown> }>;
  rawResponse?: Record<string, unknown>;
  error?: string;
};

export type LlmJsonRequest = {
  model: string;
  messages: LlmMessage[];
  temperature?: number;
};

export interface LlmProvider {
  generateJson(input: LlmJsonRequest): Promise<Record<string, unknown>>;
}

export type MorningResearchTradeCandidate = {
  exchange: string;
  tradingsymbol: string;
  side: 'BUY' | 'SELL';
  thesis: string;
  entryPlan: string;
  invalidation: string;
  confidence: number;
};

export type MorningResearchGttCandidate = {
  exchange: string;
  tradingsymbol: string;
  transactionType: 'BUY' | 'SELL';
  triggerPrice?: number;
  limitPrice?: number;
  stopLossPrice?: number;
  targetPrice?: number;
  quantity: number;
  rationale: string;
};

export type MorningResearchIdeasPlan = {
  marketThesis: string;
  sectorBias: Array<{ sector: string; bias: 'bullish' | 'bearish' | 'neutral'; reason: string }>;
  watchlist: Array<{ exchange: string; tradingsymbol: string; bias: 'long' | 'short' | 'neutral'; reason: string }>;
  tradeCandidates: MorningResearchTradeCandidate[];
  riskWarnings: string[];
  validationNotes?: string[];
};

export type MorningResearchGttPlan = {
  gttCandidates: MorningResearchGttCandidate[];
  validationNotes?: string[];
};

export type MorningResearchPlan = MorningResearchIdeasPlan & MorningResearchGttPlan;
