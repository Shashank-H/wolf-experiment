import type { LlmJsonRequest, LlmProvider } from './types';

export class OpenAiCompatibleProvider implements LlmProvider {
  constructor(private readonly apiKey: string, private readonly baseUrl = 'https://api.openai.com/v1') {}

  async generateJson(input: LlmJsonRequest): Promise<Record<string, unknown>> {
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
    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('LLM response did not include content');
    try {
      return JSON.parse(content) as Record<string, unknown>;
    } catch {
      throw new Error('LLM response was not valid JSON');
    }
  }
}
