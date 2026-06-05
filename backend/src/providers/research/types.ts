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

export type LlmJsonRequest = {
  model: string;
  messages: LlmMessage[];
  temperature?: number;
};

export interface LlmProvider {
  generateJson(input: LlmJsonRequest): Promise<Record<string, unknown>>;
}

export type MorningResearchPlan = {
  marketThesis: string;
  sectorBias: Array<{ sector: string; bias: 'bullish' | 'bearish' | 'neutral'; reason: string }>;
  watchlist: Array<{ exchange: string; tradingsymbol: string; bias: 'long' | 'short' | 'neutral'; reason: string }>;
  tradeCandidates: Array<{
    exchange: string;
    tradingsymbol: string;
    side: 'BUY' | 'SELL';
    thesis: string;
    entryPlan: string;
    invalidation: string;
    confidence: number;
  }>;
  gttCandidates: Array<{
    exchange: string;
    tradingsymbol: string;
    transactionType: 'BUY' | 'SELL';
    triggerPrice?: number;
    limitPrice?: number;
    quantity: number;
    rationale: string;
  }>;
  riskWarnings: string[];
};
