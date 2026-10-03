import { describe, expect, it } from 'vitest';
import { addMemory, compactAll, createGame } from '@shared-roof/shared';
import { openDb, Store } from '../db';
import { Recall, cosine } from './recall';

// fake embedding: topic axes, so "shell by the sea" lands near the beach memory without sharing a keyword
const AXES = [/beach|sea|shell|sand|swim/i, /cook|dinner|shakshuka|pan/i, /fight|angry|yell/i];
const vec = (t: string) => AXES.map((re) => (re.test(t) ? 1 : 0.05));

describe('recall by meaning (S1)', () => {
  it('finds the paraphrased memory, archived ones included, skips cooling ones, and caches vectors', async () => {
    let embedCalls = 0;
    const fake = (async (url: string, init?: RequestInit) => {
      if (url.endsWith('/api/tags')) return new Response(JSON.stringify({ models: [{ name: 'nomic-embed-text:latest' }] }));
      embedCalls++;
      const { input } = JSON.parse(String(init!.body)) as { input: string[] };
      return new Response(JSON.stringify({ embeddings: input.map(vec) }));
    }) as typeof fetch;
    const s = createGame({ seed: 2 });
    addMemory(s, 'ren', 'found a seashell on the beach with Mio', ['ren', 'mio'], 0.6);
    for (let i = 0; i < 45; i++) addMemory(s, 'ren', `cooked dinner number ${i}`, ['ren'], 0.9);
    compactAll(s); // the beach memory falls out of the active 40 into the archive
    expect(s.memory.ren.some((m) => m.text.includes('seashell'))).toBe(false);
    const r = new Recall('http://x', 'nomic-embed-text', new Store(openDb(':memory:')), fake);
    const found = await r.recallFor(s, 'ren', 'do you remember that shell by the sea?');
    expect(found[0]).toContain('seashell');
    expect(await r.recallFor(s, 'ren', 'do you remember that shell by the sea?', new Set([found[0]]))).not.toContain(found[0]);
    const before = embedCalls;
    await r.recallFor(s, 'ren', 'do you remember that shell by the sea?');
    expect(embedCalls).toBe(before); // every vector came from SQLite
    expect(cosine([1, 0], [0, 1])).toBe(0);
  });
  it('stays off without the embedding model', async () => {
    const none = (async () => new Response(JSON.stringify({ models: [] }))) as unknown as typeof fetch;
    const s = createGame({ seed: 2 });
    addMemory(s, 'ren', 'found a seashell', ['ren'], 0.6);
    expect(await new Recall('http://x', 'nomic-embed-text', new Store(openDb(':memory:')), none).recallFor(s, 'ren', 'shell')).toEqual([]);
  });
});
