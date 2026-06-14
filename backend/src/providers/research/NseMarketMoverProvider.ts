import type { MarketCandidate, MarketDiscoveryProvider } from './types';

type NseMoverKind = 'gainers' | 'loosers';

type NseMoverQuery = {
  limit: number;
};

export class NseMarketMoverProvider implements MarketDiscoveryProvider {
  constructor(private readonly apiUrl = 'https://www.nseindia.com') {}

  async discover(input: NseMoverQuery): Promise<MarketCandidate[]> {
    const [gainers, losers] = await Promise.all([
      this.fetchMovers('gainers', input.limit),
      this.fetchMovers('loosers', input.limit),
    ]);
    return [...gainers, ...losers].slice(0, input.limit * 2);
  }

  private async fetchMovers(kind: NseMoverKind, limit: number): Promise<MarketCandidate[]> {
    const response = await this.nseFetch(`/api/live-analysis-variations?index=${kind}&type=allSec`);
    const data = await response.json() as Record<string, unknown>;
    const rows = extractRows(data);
    return rows.flatMap((row): MarketCandidate[] => {
      const tradingsymbol = normalizeSymbol(row.symbol ?? row.SYMBOL ?? row.meta?.symbol);
      const lastPrice = numberField(row.ltp ?? row.lastPrice ?? row.last_price);
      const changePercent = numberField(row.pChange ?? row.perChange ?? row.changePercent ?? row.netPrice);
      const volume = numberField(row.tradedQuantity ?? row.volume ?? row.totalTradedVolume);
      if (!tradingsymbol || !lastPrice) return [];
      return [{
        exchange: 'NSE',
        tradingsymbol,
        instrumentType: 'EQ',
        lastPrice,
        referencePrice: lastPrice,
        changePercent,
        volume,
        turnover: numberField(row.turnover ?? row.totalTurnover),
        sentiment: kind === 'gainers' ? 'bullish' : 'bearish',
        discoveredBy: ['nse_market_movers'],
        evidence: [{ provider: 'nse_market_movers', title: `NSE ${kind === 'gainers' ? 'top gainers' : 'top losers'}`, publishedAt: new Date().toISOString(), raw: row }],
        raw: { provider: 'nse_market_movers', moverKind: kind, row },
      }];
    }).slice(0, limit);
  }

  private async nseFetch(path: string): Promise<Response> {
    const baseUrl = this.apiUrl.replace(/\/$/, '');
    const baseHeaders = {
      'accept': 'application/json,text/plain,*/*',
      'accept-language': 'en-US,en;q=0.9',
      'user-agent': 'Mozilla/5.0 research-agent/1.0',
      'referer': `${baseUrl}/market-data/top-gainers-losers`,
    };
    const bootstrap = await fetch(baseUrl, { headers: baseHeaders });
    const cookie = bootstrap.headers.get('set-cookie')?.split(',').map((part) => part.split(';')[0]).join('; ');
    const response = await fetch(`${baseUrl}${path}`, { headers: { ...baseHeaders, ...(cookie ? { cookie } : {}) } });
    if (!response.ok) throw new Error(`NSE market movers failed: ${response.status}`);
    return response;
  }
}

function extractRows(data: Record<string, unknown>): Array<Record<string, any>> {
  const matches: Array<Record<string, any>> = [];
  visit(data, matches);
  return matches;
}

function visit(value: unknown, matches: Array<Record<string, any>>) {
  if (Array.isArray(value)) {
    const rows = value.filter(isRecord) as Array<Record<string, any>>;
    const moverRows = rows.filter((row) => normalizeSymbol(row.symbol ?? row.SYMBOL ?? row.meta?.symbol) && numberField(row.ltp ?? row.lastPrice ?? row.last_price));
    if (moverRows.length) matches.push(...moverRows);
    else rows.forEach((row) => visit(row, matches));
    return;
  }
  if (isRecord(value)) Object.values(value).forEach((child) => visit(child, matches));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeSymbol(value: unknown): string {
  return typeof value === 'string' ? value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '') : '';
}

function numberField(value: unknown): number | undefined {
  if (typeof value === 'string') value = value.replace(/,/g, '');
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}
