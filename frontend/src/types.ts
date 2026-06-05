export type Theme = 'light' | 'dark';
export type Moneyish = number | string | null | undefined;

export type User = { id?: string; email: string; createdAt?: string };
export type MeResponse = { user: User | null };

export type Holding = {
  id: string;
  exchange: string;
  tradingsymbol: string;
  quantity: Moneyish;
  averagePrice: Moneyish;
  lastPrice: Moneyish;
  pnl: Moneyish;
};

export type Position = Holding & { product?: string; dayQuantity?: Moneyish };

export type Order = {
  id: string;
  brokerOrderId?: string;
  exchange?: string;
  tradingsymbol?: string;
  transactionType?: string;
  quantity: Moneyish;
  filledQuantity: Moneyish;
  averagePrice: Moneyish;
  status: string;
  createdAt: string;
};

export type BrokerAccount = {
  id: string;
  broker: string;
  brokerUserId?: string | null;
  displayName?: string | null;
  status: string;
  metadata?: Record<string, unknown>;
  accessTokenExpiresAt?: string | null;
  lastSyncedAt?: string | null;
};

export type SettingsResponse = {
  settings?: { yoloModeEnabled?: boolean; killSwitchEnabled?: boolean; providerConfig?: Record<string, string | number | undefined> } | null;
  tradingPreferences?: { maxDailyLoss?: Moneyish; maxTradesPerDay?: Moneyish; maxCapitalPerTrade?: Moneyish; maxOpenPositions?: Moneyish } | null;
  providerKeys?: Array<{ provider: string; label: string; updatedAt?: string }>;
  brokerAccount?: BrokerAccount | null;
};

export type ResearchSession = {
  id: string;
  tradeDate: string;
  status: string;
  marketThesis: string;
  sectorBias: Array<{ sector: string; bias: string; reason: string }>;
  riskWarnings: string[];
  model?: string | null;
  createdAt: string;
};

export type ResearchSource = {
  id: string;
  provider: string;
  title: string;
  url?: string | null;
  summary: string;
  symbols: string[];
  publishedAt?: string | null;
};

export type WatchlistItem = {
  id: string;
  exchange: string;
  tradingsymbol: string;
  reason: string;
  bias: string;
  source: string;
  status: string;
};

export type TradeCandidate = {
  id: string;
  exchange: string;
  tradingsymbol: string;
  side: string;
  thesis: string;
  entryPlan: string;
  invalidation: string;
  confidence: number;
};

export type GttCandidate = {
  id: string;
  exchange: string;
  tradingsymbol: string;
  transactionType: string;
  triggerPrice?: Moneyish;
  limitPrice?: Moneyish;
  quantity: number;
  rationale: string;
  status: string;
};

export type ResearchBundle = {
  session: ResearchSession;
  sources: ResearchSource[];
  watchlist: WatchlistItem[];
  tradeCandidates: TradeCandidate[];
  gttCandidates: GttCandidate[];
  providerWarnings: string[];
};

export type ResearchResponse = { research: ResearchBundle | null };
export type WatchlistResponse = { watchlist: WatchlistItem[] };

export type TriggerRule = {
  id: string;
  name: string;
  status: string;
  rule: Record<string, unknown>;
  orderDraft: Record<string, unknown>;
  expiresAt: string;
  createdAt: string;
};

export type ApprovalRequest = {
  id: string;
  status: string;
  requestedAction: string;
  payload: Record<string, unknown>;
  rationale: string;
  createdAt: string;
};

export type TriggersResponse = { triggers: TriggerRule[] };
export type ApprovalsResponse = { approvals: ApprovalRequest[] };
