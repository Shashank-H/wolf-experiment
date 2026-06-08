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
  settings?: { yoloModeEnabled?: boolean; killSwitchEnabled?: boolean; dryRunModeEnabled?: boolean; autoGttManagementEnabled?: boolean; tradingSchedulerEnabled?: boolean; morningResearchTimeIst?: string; eodRcaTimeIst?: string; tradingLoopIntervalMinutes?: number; gttRevalidationSchedulerEnabled?: boolean; gttRevalidationIntervalMinutes?: number; providerConfig?: Record<string, string | number | undefined> } | null;
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
  targetPrice?: Moneyish;
  stopLossPrice?: Moneyish;
  quantity: number;
  rationale: string;
  status: string;
  raw?: Record<string, unknown>;
};

export type GttOrder = {
  id: string;
  brokerGttId?: string | null;
  exchange: string;
  tradingsymbol: string;
  transactionType: string;
  triggerPrice: Moneyish;
  limitPrice: Moneyish;
  targetPrice?: Moneyish;
  stopLossPrice?: Moneyish;
  quantity: number;
  status: string;
  statusMessage?: string | null;
  raw?: Record<string, unknown>;
  placedAt?: string | null;
  cancelledAt?: string | null;
};

export type BrokerGtt = {
  gttId: string;
  status?: string;
  tradingsymbol?: string;
  exchange?: string;
  createdAt?: string;
};

export type GttResponse = { candidates: GttCandidate[]; gttOrders: GttOrder[]; brokerGtts: BrokerGtt[] };

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

export type DryRunTrade = {
  id: string;
  exchange: string;
  tradingsymbol: string;
  transactionType: string;
  quantity: number;
  averagePrice: Moneyish;
  currentPrice: Moneyish;
  exitPrice?: Moneyish;
  pnl: Moneyish;
  status: string;
  statusMessage?: string;
};

export type DryRunBundle = {
  session: {
    id: string;
    tradeDate: string;
    status: string;
    dryRunStatus?: string | null;
    dryRunTotalPnl: Moneyish;
    dryRunSummary: string;
    createdAt: string;
    dryRunCompletedAt?: string | null;
  };
  trades: DryRunTrade[];
  rcaReports: Array<{ id: string; dailySummary: string; totalPnl: Moneyish; raw: Record<string, unknown> }>;
};

export type DryRunResponse = { dryRun: DryRunBundle | null };
export type DryRunHistoryResponse = { dryRuns: DryRunBundle[] };

export type TriggerEvent = {
  id: string;
  triggerRuleId?: string | null;
  eventType: string;
  matched: boolean;
  marketContext: Record<string, unknown>;
  message?: string | null;
  createdAt: string;
};

export type OrderEvent = {
  id: string;
  orderId?: string | null;
  eventType: string;
  brokerStatus?: string | null;
  message?: string | null;
  createdAt: string;
};

export type DaySummary = {
  researchRuns: number;
  tradeCandidates: number;
  gttCandidates: number;
  activeGtts: number;
  triggers: number;
  approvals: number;
  pendingApprovals: number;
  orders: number;
  placedOrders: number;
  rcaReports: number;
  pnl: number;
  headline: string;
};

export type DayBundle = {
  tradeDate: string;
  summary: DaySummary;
  researchSessions: ResearchSession[];
  primarySession: ResearchSession | null;
  dryRunSession: ResearchSession | null;
  sources: ResearchSource[];
  watchlist: WatchlistItem[];
  tradeCandidates: TradeCandidate[];
  gttCandidates: GttCandidate[];
  gttOrders: GttOrder[];
  triggers: TriggerRule[];
  triggerEvents: TriggerEvent[];
  approvals: ApprovalRequest[];
  orders: Order[];
  orderEvents: OrderEvent[];
  rcaReports: Array<{ id: string; dailySummary: string; strategyReview?: string; agentReasoningReview?: string; riskReview?: string; totalPnl: Moneyish; raw: Record<string, unknown> }>;
};

export type DayResponse = { day: DayBundle };
export type HistoryDay = { tradeDate: string; summary: DaySummary; primarySessionId?: string | null; dryRunSessionId?: string | null; latestCreatedAt?: string | null };
export type HistoryResponse = { days: HistoryDay[] };
