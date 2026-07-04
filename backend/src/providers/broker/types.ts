export type InstrumentRef = {
  exchange: string;
  tradingsymbol: string;
};

export type BrokerProfile = {
  userId: string;
  userName?: string;
  email?: string;
  broker: 'kite' | string;
};

export type Holding = {
  exchange: string;
  tradingsymbol: string;
  quantity: number;
  averagePrice: number;
  lastPrice: number;
  pnl: number;
};

export type Position = Holding & {
  product?: string;
  dayQuantity?: number;
};

export type MarginSnapshot = {
  available: number;
  used: number;
  raw?: unknown;
};

export type Quote = {
  exchange: string;
  tradingsymbol: string;
  instrumentToken?: number;
  lastPrice: number;
  changePercent?: number;
  volume?: number;
  dayHigh?: number;
  dayLow?: number;
  open?: number;
  previousClose?: number;
  updatedAt: string;
  raw?: unknown;
};

export type PlaceOrderInput = {
  tradingsymbol: string;
  exchange: string;
  transactionType: 'BUY' | 'SELL';
  quantity: number;
  product: string;
  orderType: string;
  price?: number;
  validity?: string;
  tag?: string;
};

export type ModifyOrderInput = Partial<PlaceOrderInput> & { orderId: string; variety?: string };
export type CancelOrderInput = { orderId: string; variety?: string };

export type BrokerOrderResult = { orderId: string; status?: string; raw?: unknown };
export type BrokerOrder = BrokerOrderResult & {
  tradingsymbol?: string;
  exchange?: string;
  transactionType?: string;
  quantity?: number;
  filledQuantity?: number;
  averagePrice?: number;
  statusMessage?: string;
  placedAt?: string;
};

export type CreateGttInput = {
  type?: 'single' | 'two-leg';
  tradingsymbol: string;
  exchange: string;
  triggerValues: number[];
  lastPrice: number;
  orders: Array<Record<string, unknown>>;
};
export type ModifyGttInput = CreateGttInput & { gttId: string };
export type BrokerGttResult = { gttId: string; status?: string; raw?: unknown };
export type BrokerGtt = BrokerGttResult & { tradingsymbol?: string; exchange?: string; createdAt?: string };
