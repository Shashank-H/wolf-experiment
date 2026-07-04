import type { AgentConversationTrace, LlmJsonRequest, LlmProvider } from './types';

export class OpenAiCompatibleProvider implements LlmProvider {
  constructor(private readonly apiKey: string, private readonly baseUrl = 'https://api.openai.com/v1') {}

  async generateJson(input: LlmJsonRequest): Promise<Record<string, unknown>> {
    return (await this.generateJsonWithConversation(input)).json;
  }

  async generateJsonWithConversation(input: LlmJsonRequest): Promise<{ json: Record<string, unknown>; conversation: AgentConversationTrace }> {
    const startedAt = new Date().toISOString();
    const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model: input.model,
        messages: input.messages,
        temperature: input.temperature ?? 0.2,
        response_format: { type: 'json_object' },
      }),
    });
    if (!response.ok) throw new Error(`LLM request failed: ${response.status}`);
    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }>; usage?: Record<string, unknown>; id?: string; created?: number };
    const completedAt = new Date().toISOString();
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('LLM response did not include content');
    try {
      const json = JSON.parse(content) as Record<string, unknown>;
      return {
        json,
        conversation: {
          provider: 'openai-compatible',
          model: input.model,
          startedAt,
          completedAt,
          status: 'completed',
          messages: [
            ...input.messages.map((message) => ({ ...message, createdAt: startedAt, metadata: { source: 'request' } })),
            { role: 'assistant', content, createdAt: completedAt, metadata: { source: 'response' } },
          ],
          thoughtDetails: deriveThoughtDetails(json),
          rawResponse: { id: data.id, created: data.created, usage: data.usage },
        },
      };
    } catch {
      throw new Error('LLM response was not valid JSON');
    }
  }
}

function deriveThoughtDetails(json: Record<string, unknown>) {
  const details: Array<{ title: string; detail: string; metadata?: Record<string, unknown> }> = [];
  const marketThesis = typeof json.marketThesis === 'string' ? json.marketThesis : '';
  if (marketThesis) details.push({ title: 'Market thesis synthesis', detail: marketThesis });
  if (Array.isArray(json.sectorBias)) {
    for (const item of json.sectorBias.slice(0, 8)) {
      if (!item || typeof item !== 'object') continue;
      const row = item as Record<string, unknown>;
      details.push({ title: `Sector bias · ${String(row.sector ?? 'Market')}`, detail: String(row.reason ?? ''), metadata: { bias: row.bias } });
    }
  }
  if (Array.isArray(json.gttCandidates)) {
    for (const item of json.gttCandidates.slice(0, 8)) {
      if (!item || typeof item !== 'object') continue;
      const row = item as Record<string, unknown>;
      details.push({ title: `GTT draft reasoning · ${String(row.tradingsymbol ?? 'Unknown')}`, detail: String(row.rationale ?? ''), metadata: { exchange: row.exchange, transactionType: row.transactionType, targetPrice: row.targetPrice, stopLossPrice: row.stopLossPrice } });
    }
  }
  if (Array.isArray(json.riskWarnings)) {
    for (const warning of json.riskWarnings.slice(0, 8)) details.push({ title: 'Risk check', detail: String(warning) });
  }
  return details;
}
