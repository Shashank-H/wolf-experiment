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
  settings?: { yoloModeEnabled?: boolean; providerConfig?: Record<string, string | undefined> } | null;
  tradingPreferences?: { maxDailyLoss?: Moneyish; maxTradesPerDay?: Moneyish; maxCapitalPerTrade?: Moneyish; maxOpenPositions?: Moneyish } | null;
  providerKeys?: Array<{ provider: string; label: string; updatedAt?: string }>;
  brokerAccount?: BrokerAccount | null;
};
