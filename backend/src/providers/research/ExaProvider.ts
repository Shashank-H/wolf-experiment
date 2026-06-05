import type { ResearchProvider, ResearchQuery, ResearchSource } from './types';

export class ExaProvider implements ResearchProvider {
  constructor(private readonly apiKey: string, private readonly apiUrl = 'https://api.exa.ai') {}

  async search(input: ResearchQuery): Promise<ResearchSource[]> {
    const response = await fetch(`${this.apiUrl.replace(/\/$/, '')}/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': this.apiKey },
      body: JSON.stringify({ query: input.query, numResults: input.limit ?? 8, type: 'auto', contents: { text: true, highlights: true } }),
    });
    if (!response.ok) throw new Error(`Exa search failed: ${response.status}`);
    const data = await response.json() as { results?: Array<Record<string, unknown>> };
    return (data.results ?? []).map((item) => {
      const title = typeof item.title === 'string' ? item.title : 'Untitled source';
      const text = typeof item.text === 'string' ? item.text : '';
      const highlights = Array.isArray(item.highlights) ? item.highlights.filter((x): x is string => typeof x === 'string') : [];
      return {
        provider: 'exa',
        title,
        url: typeof item.url === 'string' ? item.url : undefined,
        summary: highlights[0] ?? text.slice(0, 500),
        symbols: input.symbols ?? [],
        publishedAt: typeof item.publishedDate === 'string' ? item.publishedDate : undefined,
        raw: item,
      } satisfies ResearchSource;
    });
  }
}
