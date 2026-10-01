// Ollama HTTP adapter: /api/chat with streaming, `format` = JSON schema for structured calls.
// Gemma folds the system role into the first user turn, so everything goes in one user message.
import type { LlmClient, LlmRequest } from '@shared-roof/shared';

export class OllamaClient implements LlmClient {
  readonly name = 'ollama';
  constructor(
    private url: string,
    private model: string,
    private timeoutMs: number,
    private fetchImpl: typeof fetch = fetch,
  ) {}

  private signal(req: LlmRequest) {
    const t = AbortSignal.timeout(this.timeoutMs);
    return req.signal ? AbortSignal.any([req.signal, t]) : t;
  }

  private body(req: LlmRequest, stream: boolean) {
    return JSON.stringify({
      model: this.model,
      messages: [{ role: 'user', content: req.prompt }],
      stream,
      think: false,
      format: req.schema,
      keep_alive: '30m',
      options: { temperature: req.temperature, num_predict: req.maxTokens ?? 512 },
    });
  }

  async health(): Promise<boolean> {
    try {
      const r = await this.fetchImpl(`${this.url}/api/tags`, { signal: AbortSignal.timeout(2500) });
      if (!r.ok) return false;
      const j = (await r.json()) as { models?: { name: string }[] };
      return !!j.models?.some((m) => m.name === this.model || m.name.startsWith(this.model + ':') || m.name === `${this.model}:latest`);
    } catch {
      return false;
    }
  }

  async complete(req: LlmRequest): Promise<string> {
    const r = await this.fetchImpl(`${this.url}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: this.body(req, false), signal: this.signal(req) });
    if (!r.ok) throw new Error(`ollama ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const j = (await r.json()) as { message?: { content?: string } };
    return j.message?.content ?? '';
  }

  async *stream(req: LlmRequest): AsyncIterable<string> {
    const r = await this.fetchImpl(`${this.url}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: this.body(req, true), signal: this.signal(req) });
    if (!r.ok || !r.body) throw new Error(`ollama ${r.status}`);
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        const j = JSON.parse(line) as { message?: { content?: string }; done?: boolean; error?: string };
        if (j.error) throw new Error(j.error);
        if (j.message?.content) yield j.message.content;
        if (j.done) return;
      }
    }
  }
}
