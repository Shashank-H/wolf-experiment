import type { InstrumentRef, Quote } from '../broker/types';

export type CandleRequest = {
  instrument: InstrumentRef;
  interval: string;
  from: string;
  to: string;
};

export type Candle = {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type MarketStatus = {
  exchange: string;
  isOpen: boolean;
  nextOpenAt?: string;
  nextCloseAt?: string;
};

export interface MarketDataProvider {
  getQuotes(symbols: InstrumentRef[]): Promise<Quote[]>;
  getHistoricalCandles(input: CandleRequest): Promise<Candle[]>;
  getMarketStatus(exchange: string): Promise<MarketStatus>;
}
