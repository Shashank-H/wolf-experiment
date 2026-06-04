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

export interface BrokerAdapter {
  getProfile(): Promise<BrokerProfile>;
  getHoldings(): Promise<Holding[]>;
  getPositions(): Promise<Position[]>;
  getMargins(): Promise<MarginSnapshot>;
  getQuotes(symbols: InstrumentRef[]): Promise<Quote[]>;
  placeOrder(input: PlaceOrderInput): Promise<BrokerOrderResult>;
  modifyOrder(input: ModifyOrderInput): Promise<BrokerOrderResult>;
  cancelOrder(input: CancelOrderInput): Promise<void>;
  createGtt(input: CreateGttInput): Promise<BrokerGttResult>;
  modifyGtt(input: ModifyGttInput): Promise<BrokerGttResult>;
  cancelGtt(input: { gttId: string }): Promise<void>;
  getOrders(): Promise<BrokerOrder[]>;
  getGtts(): Promise<BrokerGtt[]>;
}
