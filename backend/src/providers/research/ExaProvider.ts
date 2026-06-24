import type { ExaAgentRun, ExaAgentRunEvent, ExaAgentRunRequest, ExaSearchOptions, ResearchProvider, ResearchQuery, ResearchSource } from './types';

export class ExaProvider implements ResearchProvider {
  constructor(private readonly apiKey: string, private readonly apiUrl = 'https://api.exa.ai') {}

  async search(input: ResearchQuery): Promise<ResearchSource[]> {
    return this.searchAdvanced(input);
  }

  async searchAdvanced(input: ExaSearchOptions): Promise<ResearchSource[]> {
    const body: Record<string, unknown> = {
      query: input.query,
      numResults: input.limit ?? 30,
      type: input.type ?? 'auto',
      contents: {
        highlights: { query: input.summaryQuery ?? input.query },
        summary: { query: input.summaryQuery ?? 'Catalyst, affected listed company, direction, and why this matters today' },
        maxAgeHours: input.maxAgeHours ?? 6,
      },
    };
    if (input.additionalQueries?.length) body.additionalQueries = input.additionalQueries.slice(0, 10);
    if (input.startPublishedDate) body.startPublishedDate = input.startPublishedDate;
    if (input.endPublishedDate) body.endPublishedDate = input.endPublishedDate;
    if (input.includeDomains?.length) body.includeDomains = input.includeDomains;
    if (input.excludeDomains?.length) body.excludeDomains = input.excludeDomains;
    if (input.userLocation) body.userLocation = input.userLocation;
    if (input.moderation !== undefined) body.moderation = input.moderation;
    if (input.systemPrompt) body.systemPrompt = input.systemPrompt;
    if (input.textMaxCharacters) {
      body.contents = { ...(body.contents as Record<string, unknown>), text: { maxCharacters: input.textMaxCharacters, verbosity: 'compact' } };
    }
    const response = await fetch(`${this.apiUrl.replace(/\/$/, '')}/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': this.apiKey },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`Exa search failed: ${response.status} ${await response.text().catch(() => '')}`.trim());
    const data = await response.json() as { results?: Array<Record<string, unknown>>; output?: Record<string, unknown>; costDollars?: Record<string, unknown> };
    return (data.results ?? []).map((item) => {
      const title = typeof item.title === 'string' ? item.title : 'Untitled source';
      const text = typeof item.text === 'string' ? item.text : '';
      const highlights = Array.isArray(item.highlights) ? item.highlights.filter((x): x is string => typeof x === 'string') : [];
      const summary = typeof item.summary === 'string' ? item.summary : highlights[0] ?? text.slice(0, 500);
      return {
        provider: 'exa',
        title,
        url: typeof item.url === 'string' ? item.url : undefined,
        summary,
        symbols: input.symbols ?? [],
        publishedAt: typeof item.publishedDate === 'string' ? item.publishedDate : undefined,
        raw: { ...item, exaOutput: data.output, costDollars: data.costDollars },
      } satisfies ResearchSource;
    });
  }

  async createAgentRun(input: ExaAgentRunRequest): Promise<ExaAgentRun> {
    const response = await fetch(`${this.apiUrl.replace(/\/$/, '')}/agent/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': this.apiKey },
      body: JSON.stringify(input),
    });
    if (!response.ok) throw new Error(`Exa Agent run create failed: ${response.status} ${await response.text().catch(() => '')}`.trim());
    return await response.json() as ExaAgentRun;
  }

  async getAgentRun(id: string): Promise<ExaAgentRun> {
    const response = await fetch(`${this.apiUrl.replace(/\/$/, '')}/agent/runs/${encodeURIComponent(id)}`, {
      headers: { 'x-api-key': this.apiKey },
    });
    if (!response.ok) throw new Error(`Exa Agent run fetch failed: ${response.status} ${await response.text().catch(() => '')}`.trim());
    return await response.json() as ExaAgentRun;
  }

  async listAgentRunEvents(id: string): Promise<ExaAgentRunEvent[]> {
    const response = await fetch(`${this.apiUrl.replace(/\/$/, '')}/agent/runs/${encodeURIComponent(id)}/events`, {
      headers: { 'x-api-key': this.apiKey },
    });
    if (!response.ok) throw new Error(`Exa Agent events fetch failed: ${response.status}`);
    const data = await response.json() as { data?: ExaAgentRunEvent[]; events?: ExaAgentRunEvent[] } | ExaAgentRunEvent[];
    return Array.isArray(data) ? data : data.data ?? data.events ?? [];
  }
}
