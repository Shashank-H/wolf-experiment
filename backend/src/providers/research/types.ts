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
};

export interface ResearchProvider {
  search(input: ResearchQuery): Promise<ResearchSource[]>;
}

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
};

export type MorningResearchGttPlan = {
  gttCandidates: MorningResearchGttCandidate[];
};

export type MorningResearchPlan = MorningResearchIdeasPlan & MorningResearchGttPlan;
