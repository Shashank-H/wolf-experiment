import { describe, expect, test } from 'bun:test';
import { buildMorningResearchGttMessages, buildMorningResearchIdeasMessages } from './morning-research';

const context = {
  broker: { holdings: [], positions: [] },
  discoveredCandidates: [
    {
      exchange: 'NSE',
      tradingsymbol: 'TATAMOTORS',
      instrumentType: 'EQ' as const,
      lastPrice: 800,
      referencePrice: 790,
      changePercent: 3.2,
      volume: 12_000_000,
      discoveredBy: ['mock-movers'],
      evidence: [{ provider: 'mock-news', summary: 'Volume-backed breakout with fresh catalyst' }],
      ranking: { score: 82, moveScore: 32, liquidityScore: 25, evidenceScore: 15, riskScore: 10, reasons: ['strong move', 'liquid'] },
    },
  ],
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

  test('includes discovered candidates and grounding requirements in Stage 1 ideas prompt', () => {
    const messages = buildMorningResearchIdeasMessages(context);
    const prompt = messages.map((message) => message.content).join('\n');

    expect(prompt).toContain('discoveredCandidates');
    expect(prompt).toContain('TATAMOTORS');
    expect(prompt).toContain('Watchlist and trade candidates must come from discoveredCandidates');
    expect(prompt).toContain('cite supplied discovered-candidate metrics');
  });

  test('does not include old hardcoded default symbol names in prompts', () => {
    const prompt = [
      ...buildMorningResearchIdeasMessages(context),
      ...buildMorningResearchGttMessages({ ...context, ideasPlan: { tradeCandidates: [] } }),
    ].map((message) => message.content).join('\n');

    for (const symbol of ['NIFTY 50', 'BANKNIFTY', 'RELIANCE', 'HDFCBANK', 'INFY']) {
      expect(prompt).not.toContain(symbol);
    }
  });

  test('requires empty GTT output when grounded price context is missing', () => {
    const messages = buildMorningResearchGttMessages({ ...context, discoveredCandidates: [{ ...context.discoveredCandidates[0], lastPrice: undefined, referencePrice: undefined }], ideasPlan: { tradeCandidates: [{ exchange: 'NSE', tradingsymbol: 'TATAMOTORS' }] } });
    const prompt = messages.map((message) => message.content).join('\n');

    expect(prompt).toContain('If reference price, target, or stop-loss context is missing, return an empty gttCandidates array.');
    expect(prompt).toContain('GTT prices must be grounded in supplied candidate quote/price context');
  });
});
