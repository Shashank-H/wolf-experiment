import type { ResearchProvider, ResearchQuery, ResearchSource } from './types';

export class FinnhubProvider implements ResearchProvider {
  constructor(private readonly apiKey: string, private readonly apiUrl = 'https://finnhub.io/api/v1') {}

  async search(input: ResearchQuery): Promise<ResearchSource[]> {
    const symbols = input.symbols?.length ? input.symbols : ['market'];
    const batches = await Promise.all(symbols.slice(0, 8).map((symbol) => this.fetchForSymbol(symbol, input.limit ?? 5)));
    return batches.flat().slice(0, input.limit ?? 12);
  }

  private async fetchForSymbol(symbol: string, limit: number): Promise<ResearchSource[]> {
    const endpoint = symbol === 'market'
      ? `${this.apiUrl.replace(/\/$/, '')}/news?category=general&token=${encodeURIComponent(this.apiKey)}`
      : `${this.apiUrl.replace(/\/$/, '')}/company-news?symbol=${encodeURIComponent(symbol)}&from=${dateOffset(-7)}&to=${dateOffset(0)}&token=${encodeURIComponent(this.apiKey)}`;
    const response = await fetch(endpoint);
    if (!response.ok) throw new Error(`Finnhub news failed: ${response.status}`);
    const data = await response.json() as Array<Record<string, unknown>>;
    return data.slice(0, limit).map((item) => ({
      provider: 'finnhub',
      title: typeof item.headline === 'string' ? item.headline : 'Market news',
      url: typeof item.url === 'string' ? item.url : undefined,
      summary: typeof item.summary === 'string' ? item.summary : '',
      symbols: symbol === 'market' ? [] : [symbol],
      publishedAt: typeof item.datetime === 'number' ? new Date(item.datetime * 1000).toISOString() : undefined,
      raw: item,
    }));
  }
}

function dateOffset(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
