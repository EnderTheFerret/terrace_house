// Ollama HTTP adapter: /api/chat with streaming, `format` = JSON schema for structured calls.
// Gemma folds the system role into the first user turn, so everything goes in one user message.
import type { LlmClient, LlmRequest } from '@shared-roof/shared';

/**
 * Sampler presets per model family (SillyTavern-style, seeded from each model card), passed through Ollama `options`.
 * Role-play fine-tunes on Ollama's generic defaults repeat themselves; min_p + a mild repeat penalty curbs that.
 * OLLAMA_OPTIONS (JSON) in .env overrides any field.
 */
const PRESETS: [RegExp, Record<string, number>][] = [
  [/minifantasy|qwen/i, { top_p: 0.8, top_k: 20, min_p: 0.05, repeat_penalty: 1.05, repeat_last_n: 128 }],
  [/stheno|llama-?3\.?[0-9]?-?8b/i, { top_k: 0, top_p: 1, min_p: 0.075, repeat_penalty: 1.1, repeat_last_n: 256 }],
  [/mag-?mell/i, { top_k: 0, top_p: 1, min_p: 0.2 }], // card: MinP 0.2, avoid penalty samplers
  [/magnum|hamanasu/i, { top_k: 0, top_p: 1, min_p: 0.05, repeat_penalty: 1.05, repeat_last_n: 256 }],
  [/llama3\.2|llama-?3\.2/i, { top_p: 0.9, top_k: 40, min_p: 0.05, repeat_penalty: 1.1, repeat_last_n: 128 }],
  [/gemma/i, { top_p: 0.95, top_k: 64 }],
];
const envOptions = (() => { try { return JSON.parse(process.env.OLLAMA_OPTIONS ?? '{}') as Record<string, number>; } catch { return {}; } })();
export const samplerFor = (model: string) => ({ ...(PRESETS.find(([re]) => re.test(model))?.[1] ?? {}), ...envOptions });

/**
 * Unload every model Ollama has resident (keep_alive 0). On one 16 GB card a resident LLM pushes ComfyUI into slow
 * offloading (measured 20-50x slower); the image queue never runs during dialogue, so freeing it costs one reload.
 */
export async function unloadOllama(url: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  try {
    const ps = (await (await fetchImpl(`${url}/api/ps`, { signal: AbortSignal.timeout(2000) })).json()) as { models?: { name: string }[] };
    await Promise.all((ps.models ?? []).map((m) => fetchImpl(`${url}/api/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: m.name, keep_alive: 0 }), signal: AbortSignal.timeout(10_000) })));
  } catch {
    /* Ollama not running: nothing to free */
  }
}

export class OllamaClient implements LlmClient {
  readonly name = 'ollama';
  constructor(
    private url: string,
    private model: string,
    private timeoutMs: number,
    private fetchImpl: typeof fetch = fetch,
    private keepAlive: string | number = '30m',
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
      keep_alive: this.keepAlive,
      // use_mmap: Ollama otherwise copies the weights into private RAM (10.5 GB for Gemma 12B) beside ComfyUI's cache,
      // and an image job then pages the whole PC to disk (seconds-long freezes); mapped weights are reclaimable cache
      options: { ...samplerFor(this.model), temperature: req.temperature, num_predict: req.maxTokens ?? 512, num_ctx: 8192, use_mmap: true },
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
    const j = (await r.json()) as { message?: { content?: string }; done_reason?: string };
    if (j.done_reason === 'length') throw new Error('Reply exceeded its generation limit; try a shorter reply.');
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
        const j = JSON.parse(line) as { message?: { content?: string }; done?: boolean; done_reason?: string; error?: string };
        if (j.error) throw new Error(j.error);
        if (j.message?.content) yield j.message.content;
        if (j.done_reason === 'length') throw new Error('Reply exceeded its generation limit; try a shorter reply.');
        if (j.done) return;
      }
    }
  }
}
