// Recall by meaning (SillyTavern Vector Storage): embed each memory once with Ollama /api/embed, cache the vector in
// SQLite, and pick the speaker's memories closest to what is being said. Score = cosine × salience × recency.
// Keyword recall (topMemories) keeps working without it; this only adds paraphrased callbacks.
import { createHash } from 'node:crypto';
import { memoryScore, type GameState, type MemoryItem } from '@shared-roof/shared';
import type { Store } from '../db';

/** Top 3 (SillyTavern default). Floor measured on nomic-embed-text: paraphrased matches ~0.64, unrelated memories 0.32-0.49. */
export const RECALL_K = 3;
// ponytail: floor tuned for nomic-embed-text; re-measure if OLLAMA_EMBED_MODEL changes
export const RECALL_MIN = 0.55;

export const cosine = (a: number[], b: number[]) => {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
};

export class Recall {
  private ready: boolean | null = null;
  constructor(private url: string, private model: string, private store: Store, private fetchImpl: typeof fetch = fetch) {}

  /** Embedding model installed? Checked once; recall stays off (keywords only) when it is not. */
  async available(): Promise<boolean> {
    if (this.ready !== null) return this.ready;
    try {
      const r = await this.fetchImpl(`${this.url}/api/tags`, { signal: AbortSignal.timeout(2500) });
      const j = (await r.json()) as { models?: { name: string }[] };
      this.ready = !!j.models?.some((m) => m.name === this.model || m.name.startsWith(`${this.model}:`));
    } catch {
      this.ready = false;
    }
    return this.ready;
  }

  private key = (text: string) => createHash('sha256').update(`${this.model}\n${text}`).digest('hex');

  /** Vectors for texts, from the cache or one batched /api/embed call for the missing ones. */
  async embed(texts: string[]): Promise<number[][]> {
    const out = texts.map((t) => this.store.embeddingGet(this.key(t)));
    const missing = [...new Set(texts.filter((_, i) => !out[i]))];
    if (missing.length) {
      const r = await this.fetchImpl(`${this.url}/api/embed`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: this.model, input: missing }), signal: AbortSignal.timeout(20_000) });
      if (!r.ok) throw new Error(`ollama embed ${r.status}`);
      const { embeddings } = (await r.json()) as { embeddings: number[][] };
      missing.forEach((t, i) => this.store.embeddingPut(this.key(t), this.model, embeddings[i]));
    }
    return texts.map((t, i) => out[i] ?? this.store.embeddingGet(this.key(t))!);
  }

  /**
   * The speaker's memories (active and archived) closest in meaning to `query` (the last couple of lines), skipping
   * `exclude` (cooling down, or already in the prompt). Empty when the model is missing or anything fails.
   */
  async recallFor(s: GameState, charId: string, query: string, exclude: Set<string> = new Set()): Promise<string[]> {
    const pool: MemoryItem[] = [...(s.memory[charId] ?? []), ...(s.memoryArchive?.[charId] ?? [])].filter((m) => !exclude.has(m.text));
    if (!query.trim() || !pool.length || !(await this.available())) return [];
    try {
      const [q, ...vs] = await this.embed([query, ...pool.map((m) => m.text)]);
      return pool
        .map((m, i) => ({ m, sim: cosine(q, vs[i]) }))
        .filter((x) => x.sim >= RECALL_MIN)
        .map((x) => ({ text: x.m.text, score: x.sim * (0.5 + 0.5 * memoryScore(x.m, s.world.tick)) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, RECALL_K)
        .map((x) => x.text);
    } catch {
      return [];
    }
  }
}
