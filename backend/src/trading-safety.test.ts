import { describe, expect, test } from 'bun:test';
import { KiteBrokerAdapter } from './providers/broker/KiteBrokerAdapter';

const adapter = new KiteBrokerAdapter({ apiKey: 'test', accessToken: 'test' });

describe('trading safety invariant', () => {
  test('Kite regular order placement is hard-disabled', () => {
    expect(() => adapter.placeOrder({ exchange: 'NSE', tradingsymbol: 'RELIANCE', transactionType: 'BUY', product: 'CNC', orderType: 'MARKET', quantity: 1 })).toThrow(/never places regular market\/limit orders/i);
  });

  test('Kite regular order modification/cancellation are hard-disabled', async () => {
    expect(() => adapter.modifyOrder({ orderId: 'regular-order-id', price: 100 })).toThrow(/regular broker order placement\/modification\/cancellation is disabled/i);
    await expect(adapter.cancelOrder({ orderId: 'regular-order-id' })).rejects.toThrow(/regular broker order placement\/modification\/cancellation is disabled/i);
  });
});
