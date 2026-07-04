import { describe, expect, test } from 'bun:test';
import { DEFAULT_TRADING_RISK_LIMITS } from './trading-risk';
import { DEFAULT_TRADING_RISK_SETTINGS } from '../prompts/morning-research';

describe('default trading risk limits', () => {
  test('matches the frontend defaults applied for new users', () => {
    expect(DEFAULT_TRADING_RISK_LIMITS).toEqual({
      maxDailyLoss: 5000,
      maxTradesPerDay: 5,
      maxCapitalPerTrade: 25000,
      maxOpenPositions: 3,
    });
  });

  test('uses the same defaults for research prompt fallbacks', () => {
    expect(DEFAULT_TRADING_RISK_SETTINGS).toBe(DEFAULT_TRADING_RISK_LIMITS);
  });
});
