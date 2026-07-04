import type { ResearchProvider, ResearchQuery, ResearchSource } from './types';

export class FinnhubProvider implements ResearchProvider {
  constructor(private readonly apiKey: string, private readonly apiUrl = 'https://finnhub.io/api/v1') {}

  async search(input: ResearchQuery): Promise<ResearchSource[]> {
    // Max Finnhub articles to request/keep for this call. Caller normally supplies this from discovery settings; 8 is a conservative per-provider fallback to avoid noisy/expensive source fan-out.
    const limit = input.limit ?? 8;
    if (!input.symbols?.length) return this.fetchGeneral(limit);
    const batches = await Promise.all(input.symbols.slice(0, limit).map((symbol) => this.fetchForSymbol(symbol, limit, input.lookbackDays ?? 7)));
    return batches.flat().slice(0, limit);
  }

  private async fetchGeneral(limit: number): Promise<ResearchSource[]> {
    const endpoint = `${this.apiUrl.replace(/\/$/, '')}/news?category=general&token=${encodeURIComponent(this.apiKey)}`;
    const response = await fetch(endpoint);
    if (!response.ok) throw new Error(`Finnhub news failed: ${response.status}`);
    const data = await response.json() as Array<Record<string, unknown>>;
    return data.slice(0, limit).map((item) => this.mapArticle(item, []));
  }

  private async fetchForSymbol(symbol: string, limit: number, lookbackDays: number): Promise<ResearchSource[]> {
    const endpoint = `${this.apiUrl.replace(/\/$/, '')}/company-news?symbol=${encodeURIComponent(symbol)}&from=${dateOffset(-Math.max(1, lookbackDays))}&to=${dateOffset(0)}&token=${encodeURIComponent(this.apiKey)}`;
    const response = await fetch(endpoint);
    if (!response.ok) throw new Error(`Finnhub news failed: ${response.status}`);
    const data = await response.json() as Array<Record<string, unknown>>;
    return data.slice(0, limit).map((item) => this.mapArticle(item, [symbol]));
  }

  private mapArticle(item: Record<string, unknown>, symbols: string[]): ResearchSource {
    return {
      provider: 'finnhub',
      title: typeof item.headline === 'string' ? item.headline : 'Market news',
      url: typeof item.url === 'string' ? item.url : undefined,
      summary: typeof item.summary === 'string' ? item.summary : '',
      symbols,
      publishedAt: typeof item.datetime === 'number' ? new Date(item.datetime * 1000).toISOString() : undefined,
      raw: item,
    };
  }
}

function dateOffset(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
