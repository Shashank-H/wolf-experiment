import { describe, expect, test } from 'bun:test';
import { NseMarketMoverProvider } from '../providers/research/NseMarketMoverProvider';
import type { MarketCandidate } from '../providers/research/types';
import { __researchDiscoveryTestHooks } from './research';

const settings = {
  candidateShortlistSize: 5,
  broadSourceLimit: 10,
  focusedSourceLimit: 3,
  sourceLimit: 24,
  snapshotLimit: 500,
  promptSourceLimit: 12,
  freshnessHours: 36,
  newsLookbackDays: 7,
  minVolume: 1000,
  enableReactiveMoverConfirmation: false,
};

function candidate(input: Partial<MarketCandidate> & { tradingsymbol: string }): MarketCandidate {
  return {
    ...input,
    exchange: input.exchange ?? 'NSE',
    tradingsymbol: input.tradingsymbol,
    instrumentType: input.instrumentType ?? 'EQ',
    lastPrice: input.lastPrice ?? 100,
    changePercent: input.changePercent ?? 1,
    volume: input.volume ?? 10_000,
    discoveredBy: input.discoveredBy ?? ['mock'],
    evidence: input.evidence ?? [{ provider: 'mock', summary: 'fresh evidence', publishedAt: new Date().toISOString() }],
  };
}

describe('NSE market mover discovery provider', () => {
  test('bootstraps NSE cookies and maps nested mover rows', async () => {
    const originalFetch = globalThis.fetch;
    const calls: Array<{ url: string; cookie?: string }> = [];
    globalThis.fetch = Object.assign(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const headers = init?.headers as Record<string, string> | undefined;
      calls.push({ url, cookie: headers?.cookie });
      if (url === 'https://nse.test') return new Response('', { headers: { 'set-cookie': 'nseappid=abc; Path=/; HttpOnly' } });
      return Response.json({ data: { rows: [{ symbol: 'ABC', ltp: '123.45', pChange: '4.2', tradedQuantity: '10000' }] } });
    }, originalFetch);
    try {
      const candidates = await new NseMarketMoverProvider('https://nse.test').discover({ limit: 5 });
      expect(candidates[0]).toMatchObject({ exchange: 'NSE', tradingsymbol: 'ABC', lastPrice: 123.45, changePercent: 4.2, volume: 10000 });
      expect(calls.some((call) => call.cookie?.includes('nseappid=abc'))).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe('research discovery pure helpers', () => {
  test('uses small model to classify catalyst type, direction, and symbols', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = Object.assign(async () => Response.json({
      choices: [{ message: { content: JSON.stringify({ classifications: [{ id: 0, symbols: ['ABC'], catalystType: 'order_win', direction: 'positive', strength: 31, confidence: 0.9, rationale: 'Large order win before market open' }] }) } }],
    }), originalFetch);
    try {
      const [classified] = await __researchDiscoveryTestHooks.classifySourcesWithSmallModel([{ provider: 'mock', title: 'ABC wins large order', summary: 'Company bags a large order', symbols: [], publishedAt: new Date().toISOString() }], 'llm-key', 'small-model');
      expect(classified.symbols).toEqual(['ABC']);
      expect(classified.raw?.catalyst).toMatchObject({ type: 'order_win', direction: 'positive', strength: 31 });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('converts provider failures into warnings instead of throwing', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = Object.assign(async () => new Response('bad gateway', { status: 502 }), originalFetch);
    try {
      const result = await __researchDiscoveryTestHooks.collectSources({
        secrets: { exaApiKey: 'test-exa-key', finnhubApiKey: null, llmApiKey: 'test-llm-key' },
        settings,
        candidates: [],
      });

      expect(result.sources).toEqual([]);
      expect(result.errors.join(' ')).toContain('exa failed');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('does not call broad Finnhub research when no candidates are available', async () => {
    const originalFetch = globalThis.fetch;
    let fetchCalls = 0;
    globalThis.fetch = Object.assign(async () => {
      fetchCalls += 1;
      return Response.json({});
    }, originalFetch);
    try {
      const result = await __researchDiscoveryTestHooks.collectSources({
        secrets: { exaApiKey: null, finnhubApiKey: 'test-finnhub-key', llmApiKey: null },
        settings,
        candidates: [],
      });

      expect(result.sources).toEqual([]);
      expect(result.errors).toEqual([]);
      expect(fetchCalls).toBe(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('filters blacklisted and non-NSE-equity candidates', () => {
    const filtered = __researchDiscoveryTestHooks.filterCandidates([
      candidate({ tradingsymbol: 'TATAMOTORS' }),
      candidate({ tradingsymbol: 'BLOCKED' }),
      candidate({ exchange: 'NFO', tradingsymbol: 'FUTURE' }),
      candidate({ tradingsymbol: 'NIFTY' }),
      candidate({ tradingsymbol: 'ILLIQUID', volume: 0 }),
      { ...candidate({ tradingsymbol: 'NOPRICE' }), lastPrice: undefined, referencePrice: undefined },
    ], ['blocked'], settings, { requirePriceAndLiquidity: true });

    expect(filtered.map((item) => item.tradingsymbol)).toEqual(['TATAMOTORS']);
  });

  test('does not call NSE movers as primary discovery when reactive confirmation is disabled', async () => {
    const originalFetch = globalThis.fetch;
    let called = false;
    globalThis.fetch = Object.assign(async () => {
      called = true;
      return Response.json({});
    }, originalFetch);
    try {
      const confirmed = await __researchDiscoveryTestHooks.maybeConfirmWithReactiveMovers([candidate({ tradingsymbol: 'CATALYST' })], settings);
      expect(called).toBe(false);
      expect(confirmed[0].discoveredBy).not.toContain('nse_market_movers_confirmation');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('can use NSE movers as explicit fallback/confirmation when enabled', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = Object.assign(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === 'https://nse.test') return new Response('', { headers: { 'set-cookie': 'nseappid=abc; Path=/' } });
      return Response.json({ data: [{ symbol: 'CATALYST', ltp: 125, pChange: 3.4, tradedQuantity: 5000 }] });
    }, originalFetch);
    try {
      const confirmed = await __researchDiscoveryTestHooks.maybeConfirmWithReactiveMovers([candidate({ tradingsymbol: 'CATALYST' })], { ...settings, enableReactiveMoverConfirmation: true });
      expect(confirmed[0]).toMatchObject({ tradingsymbol: 'CATALYST', reactiveSignal: true, referencePrice: 125 });
      expect(confirmed[0].evidence.some((item) => item.provider === 'nse_market_movers_confirmation')).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('allows catalyst-backed watchlist candidates without price when not creating GTT', () => {
    const filtered = __researchDiscoveryTestHooks.filterCandidates([
      { ...candidate({ tradingsymbol: 'CATALYST' }), lastPrice: undefined, referencePrice: undefined, volume: undefined },
    ], [], settings, { requirePriceAndLiquidity: false });

    expect(filtered.map((item) => item.tradingsymbol)).toEqual(['CATALYST']);
  });

  test('ranks catalyst evidence above after-the-fact move with weak catalyst', () => {
    const ranked = __researchDiscoveryTestHooks.rankCandidates([
      candidate({ tradingsymbol: 'ALREADYMOVED', changePercent: 8, volume: 900_000, evidence: [{ provider: 'market_snapshot_validation', summary: 'price moved', publishedAt: new Date().toISOString() }], catalystType: 'other_news' }),
      candidate({ tradingsymbol: 'CATALYST', changePercent: 0.5, volume: 2_000, evidence: [{ provider: 'news', title: 'NSE:CATALYST wins large order', summary: 'large order win fresh catalyst', publishedAt: new Date().toISOString() }, { provider: 'news2', title: 'CATALYST gets approval', publishedAt: new Date().toISOString() }], catalystType: 'order_win', catalystDirection: 'positive' }),
    ], settings);

    expect(ranked[0].tradingsymbol).toBe('CATALYST');
    expect(ranked[0].ranking?.score).toBeGreaterThan(ranked[1].ranking?.score ?? 0);
  });

  test('drops GTT candidates when discovered candidate price context is missing', () => {
    const plan = __researchDiscoveryTestHooks.normalizeGttPlan({
      gttCandidates: [{ exchange: 'NSE', tradingsymbol: 'NOPRICE', transactionType: 'SELL', targetPrice: 110, stopLossPrice: 95, quantity: 1, rationale: 'test' }],
    }, undefined, [{ ...candidate({ tradingsymbol: 'NOPRICE' }), lastPrice: undefined, referencePrice: undefined }]);

    expect(plan.gttCandidates).toEqual([]);
    expect(plan.validationNotes?.join(' ')).toContain('NOPRICE');
  });

  test('accepts empty GTT output when price context is missing', () => {
    const plan = __researchDiscoveryTestHooks.normalizeGttPlan({ gttCandidates: [] }, undefined, []);
    expect(plan.gttCandidates).toEqual([]);
  });

  test('drops ungrounded trade candidates but keeps grounded ones', () => {
    const plan = __researchDiscoveryTestHooks.normalizeIdeasPlan({
      marketThesis: 'Grounded thesis.',
      sectorBias: [{ sector: 'Banks', bias: 'bullish', reason: 'evidence' }],
      watchlist: [{ exchange: 'NSE', tradingsymbol: 'GROUNDED', bias: 'long', reason: 'watch' }],
      tradeCandidates: [
        { exchange: 'NSE', tradingsymbol: 'GROUNDED', side: 'BUY', thesis: 'ok', entryPlan: 'breakout', invalidation: 'failure', confidence: 70 },
        { exchange: 'NSE', tradingsymbol: 'UNGROUNDED', side: 'BUY', thesis: 'no support', entryPlan: 'breakout', invalidation: 'failure', confidence: 70 },
      ],
      riskWarnings: [],
    }, undefined, new Set(['GROUNDED']));

    expect(plan.tradeCandidates.map((item) => item.tradingsymbol)).toEqual(['GROUNDED']);
    expect(plan.validationNotes?.join(' ')).toContain('UNGROUNDED');
    expect(plan.riskWarnings).toEqual([]);
  });

  test('keeps ungrounded watchlist items because watchlist is informational', () => {
    const plan = __researchDiscoveryTestHooks.normalizeIdeasPlan({
      marketThesis: 'Grounded thesis.',
      sectorBias: [{ sector: 'Industrials', bias: 'neutral', reason: 'evidence' }],
      watchlist: [{ exchange: 'NSE', tradingsymbol: 'WATCHONLY', bias: 'neutral', reason: 'watch only' }],
      tradeCandidates: [],
      riskWarnings: [],
    }, undefined, new Set(['OTHER']));

    expect(plan.watchlist.map((item) => item.tradingsymbol)).toEqual(['WATCHONLY']);
    expect(plan.validationNotes).toBeUndefined();
  });

  test('allows all ungrounded trade candidates to be filtered without failing structurally valid ideas', () => {
    const plan = __researchDiscoveryTestHooks.normalizeIdeasPlan({
      marketThesis: 'Grounded thesis.',
      sectorBias: [{ sector: 'IT', bias: 'neutral', reason: 'evidence' }],
      watchlist: [{ exchange: 'NSE', tradingsymbol: 'WATCHONLY', bias: 'neutral', reason: 'watch only' }],
      tradeCandidates: [{ exchange: 'NSE', tradingsymbol: 'UNGROUNDED', side: 'BUY', thesis: 'no support', entryPlan: 'breakout', invalidation: 'failure', confidence: 70 }],
      riskWarnings: [],
    }, undefined, new Set(['OTHER']));

    expect(plan.tradeCandidates).toEqual([]);
    expect(plan.validationNotes?.join(' ')).toContain('UNGROUNDED');
  });
});
