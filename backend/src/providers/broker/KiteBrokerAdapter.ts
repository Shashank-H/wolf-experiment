import { createHash } from 'node:crypto';
import { regularOrderExecutionDisabled } from '../../trading-safety';
import type { BrokerAdapter } from './BrokerAdapter';
import type {
  BrokerGtt,
  BrokerGttResult,
  BrokerOrder,
  BrokerOrderResult,
  BrokerProfile,
  CancelOrderInput,
  CreateGttInput,
  Holding,
  InstrumentRef,
  MarginSnapshot,
  ModifyGttInput,
  ModifyOrderInput,
  PlaceOrderInput,
  Position,
  Quote,
} from './types';

export const DEFAULT_KITE_API_URL = 'https://api.kite.trade';

type KiteCredentials = { apiKey: string; accessToken: string; apiUrl?: string };

export type KiteSession = {
  accessToken: string;
  publicToken?: string;
  refreshToken?: string;
  userId?: string;
  userName?: string;
  email?: string;
  avatarUrl?: string;
  raw: Record<string, unknown>;
};

export class KiteBrokerAdapter implements BrokerAdapter {
  private readonly apiUrl: string;

  static loginUrl(apiKey: string): string {
    const url = new URL('https://kite.zerodha.com/connect/login');
    url.searchParams.set('v', '3');
    url.searchParams.set('api_key', apiKey);
    return url.toString();
  }

  static async generateSession(input: { apiKey: string; apiSecret: string; requestToken: string; apiUrl?: string }): Promise<KiteSession> {
    const apiUrl = normalizeApiUrl(input.apiUrl ?? DEFAULT_KITE_API_URL);
    const checksum = createHash('sha256').update(`${input.apiKey}${input.requestToken}${input.apiSecret}`).digest('hex');
    const response = await fetch(`${apiUrl}/session/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formBody({ api_key: input.apiKey, request_token: input.requestToken, checksum }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.status === 'error') {
      throw new Error(payload.message ?? `Kite session exchange failed: ${response.status}`);
    }
    const data = payload.data ?? {};
    if (!data.access_token) throw new Error('Kite did not return an access token');
    return {
      accessToken: String(data.access_token),
      publicToken: data.public_token ? String(data.public_token) : undefined,
      refreshToken: data.refresh_token ? String(data.refresh_token) : undefined,
      userId: data.user_id ? String(data.user_id) : undefined,
      userName: data.user_name ? String(data.user_name) : undefined,
      email: data.email ? String(data.email) : undefined,
      avatarUrl: data.avatar_url ? String(data.avatar_url) : undefined,
      raw: data,
    };
  }

  constructor(private readonly credentials: KiteCredentials) {
    this.apiUrl = normalizeApiUrl(credentials.apiUrl ?? DEFAULT_KITE_API_URL);
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${this.apiUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `token ${this.credentials.apiKey}:${this.credentials.accessToken}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        ...(init.headers ?? {}),
      },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.status === 'error') {
      throw new Error(payload.message ?? `Kite request failed: ${response.status}`);
    }
    return payload.data as T;
  }

  getProfile(): Promise<BrokerProfile> {
    return this.request<any>('/user/profile').then((data) => ({
      userId: String(data.user_id),
      userName: data.user_name,
      email: data.email,
      broker: 'kite',
    }));
  }

  getHoldings(): Promise<Holding[]> {
    return this.request<any[]>('/portfolio/holdings').then((rows) => rows.map(mapHolding));
  }

  getPositions(): Promise<Position[]> {
    return this.request<any>('/portfolio/positions').then((data) => [...(data.net ?? []), ...(data.day ?? [])].map(mapPosition));
  }

  getMargins(): Promise<MarginSnapshot> {
    return this.request<any>('/user/margins').then((data) => ({
      available: Number(data.equity?.available?.cash ?? 0),
      used: Number(data.equity?.utilised?.debits ?? 0),
      raw: data,
    }));
  }

  getQuotes(symbols: InstrumentRef[]): Promise<Quote[]> {
    const instruments = symbols.map((symbol) => `${symbol.exchange}:${symbol.tradingsymbol}`);
    if (instruments.length === 0) return Promise.resolve([]);
    return this.request<Record<string, any>>(`/quote?${new URLSearchParams(instruments.map((i) => ['i', i]))}`).then((data) =>
      Object.entries(data).map(([key, value]) => mapQuote(key, value)),
    );
  }

  placeOrder(_input: PlaceOrderInput): Promise<BrokerOrderResult> {
    regularOrderExecutionDisabled();
  }

  modifyOrder(_input: ModifyOrderInput): Promise<BrokerOrderResult> {
    regularOrderExecutionDisabled();
  }

  async cancelOrder(_input: CancelOrderInput): Promise<void> {
    regularOrderExecutionDisabled();
  }

  createGtt(input: CreateGttInput): Promise<BrokerGttResult> {
    return this.request<any>('/gtt/triggers', { method: 'POST', body: formBody(gttPayload(input)) }).then((data) => ({
      gttId: String(data.trigger_id),
      raw: data,
    }));
  }

  modifyGtt(input: ModifyGttInput): Promise<BrokerGttResult> {
    return this.request<any>(`/gtt/triggers/${input.gttId}`, { method: 'PUT', body: formBody(gttPayload(input)) }).then((data) => ({
      gttId: String(data.trigger_id ?? input.gttId),
      raw: data,
    }));
  }

  async cancelGtt(input: { gttId: string }): Promise<void> {
    await this.request(`/gtt/triggers/${input.gttId}`, { method: 'DELETE' });
  }

  getOrders(): Promise<BrokerOrder[]> {
    return this.request<any[]>('/orders').then((rows) => rows.map(mapOrder));
  }

  getGtts(): Promise<BrokerGtt[]> {
    return this.request<any[]>('/gtt/triggers').then((rows) => rows.map((row) => ({
      gttId: String(row.id ?? row.trigger_id),
      status: row.status,
      tradingsymbol: row.tradingsymbol,
      exchange: row.exchange,
      createdAt: row.created_at,
      raw: row,
    })));
  }
}

function normalizeApiUrl(value: string) {
  return value.trim().replace(/\/+$/, '');
}

function formBody(input: Record<string, unknown>) {
  return new URLSearchParams(Object.entries(input).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)]));
}

function orderPayload(input: Partial<PlaceOrderInput>) {
  return {
    tradingsymbol: input.tradingsymbol,
    exchange: input.exchange,
    transaction_type: input.transactionType,
    quantity: input.quantity,
    product: input.product,
    order_type: input.orderType,
    price: input.price,
    validity: input.validity,
    tag: input.tag,
  };
}

function gttPayload(input: CreateGttInput) {
  if (input.type === 'two-leg' && (input.triggerValues.length !== 2 || input.orders.length !== 2)) {
    throw new Error('Kite two-leg GTT requires exactly two trigger values and two orders: target and stoploss');
  }
  return {
    type: input.type ?? 'two-leg',
    condition: JSON.stringify({ exchange: input.exchange, tradingsymbol: input.tradingsymbol, trigger_values: input.triggerValues, last_price: input.lastPrice }),
    orders: JSON.stringify(input.orders),
  };
}

function mapHolding(row: any): Holding {
  return {
    exchange: String(row.exchange ?? 'NSE'),
    tradingsymbol: String(row.tradingsymbol),
    quantity: Number(row.quantity ?? 0),
    averagePrice: Number(row.average_price ?? 0),
    lastPrice: Number(row.last_price ?? 0),
    pnl: Number(row.pnl ?? 0),
  };
}

function mapPosition(row: any): Position {
  return { ...mapHolding(row), product: row.product, dayQuantity: Number(row.day_quantity ?? 0) };
}

function mapQuote(instrument: string, row: any): Quote {
  const [exchange, tradingsymbol] = instrument.split(':');
  return {
    exchange,
    tradingsymbol,
    instrumentToken: row.instrument_token,
    lastPrice: Number(row.last_price ?? 0),
    changePercent: Number(row.ohlc?.close ? ((Number(row.last_price) - Number(row.ohlc.close)) / Number(row.ohlc.close)) * 100 : 0),
    volume: Number(row.volume ?? 0),
    dayHigh: Number(row.ohlc?.high ?? 0),
    dayLow: Number(row.ohlc?.low ?? 0),
    open: Number(row.ohlc?.open ?? 0),
    previousClose: Number(row.ohlc?.close ?? 0),
    updatedAt: row.timestamp ?? new Date().toISOString(),
    raw: row,
  };
}

function mapOrder(row: any): BrokerOrder {
  return {
    orderId: String(row.order_id),
    status: row.status,
    tradingsymbol: row.tradingsymbol,
    exchange: row.exchange,
    transactionType: row.transaction_type,
    quantity: Number(row.quantity ?? 0),
    filledQuantity: Number(row.filled_quantity ?? 0),
    averagePrice: Number(row.average_price ?? 0),
    statusMessage: row.status_message,
    placedAt: row.order_timestamp,
    raw: row,
  };
}
