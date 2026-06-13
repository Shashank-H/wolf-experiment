import { describe, expect, test } from 'bun:test';
import { buildMorningResearchGttMessages, buildMorningResearchIdeasMessages } from './morning-research';

const context = {
  broker: { holdings: [], positions: [] },
  sources: [],
  settings: { maxWatchlistItems: 6, maxGttCandidates: 3, riskTolerance: 'conservative' as const },
  tradingRisk: { maxDailyLoss: 5000, maxTradesPerDay: 5, maxCapitalPerTrade: 25000, maxOpenPositions: 3 },
};

describe('morning research prompt trading-risk guardrails', () => {
  test('includes trading risk settings in Stage 1 ideas prompt', () => {
    const messages = buildMorningResearchIdeasMessages(context);
    const prompt = messages.map((message) => message.content).join('\n');

    expect(prompt).toContain('Trading-risk proposal guardrails');
    expect(prompt).toContain('Maximum daily loss/risk budget for app-created GTT proposals: 5000');
    expect(prompt).toContain('Maximum app trades/GTT proposals per day: 5');
    expect(prompt).toContain('Maximum capital per proposed trade: 25000');
    expect(prompt).toContain('Maximum simultaneous open positions to consider: 3');
    expect(prompt).toContain('prefer fewer/no transient trade candidates');
  });

  test('includes stricter fewer-or-empty guidance in Stage 2 GTT prompt', () => {
    const messages = buildMorningResearchGttMessages({ ...context, ideasPlan: { tradeCandidates: [] } });
    const prompt = messages.map((message) => message.content).join('\n');

    expect(prompt).toContain('Apply the trading-risk proposal guardrails strictly');
    expect(prompt).toContain('return an empty gttCandidates array');
    expect(prompt).toContain('fewer or zero candidates is preferred');
    expect(prompt).toContain('"tradingRisk":{"maxDailyLoss":5000,"maxTradesPerDay":5,"maxCapitalPerTrade":25000,"maxOpenPositions":3}');
  });
});
