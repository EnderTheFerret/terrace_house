import { expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EMOTIONS, addMemory, createGame, projectForPlayer, rel, type ImageRequest } from '@shared-roof/shared';
import { buildApp } from '../app';
import { openDb, Store } from '../db';
import { MockLlm } from '../llm/mock';
import { MockImageBackend } from '../image/mock';
import { cacheKey, ImageQueue, PRIORITY } from '../image/queue';
import { expressionRequest, portraitRequest } from '../image/requests';
import { memoriesBlock, relationshipLine } from '../prompts/common';

it('validates expressions, references the approved face, caches each emotion and leaves game state unchanged', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'roof-expression-'));
  const store = new Store(openDb(':memory:'));
  const requests: ImageRequest[] = [];
  const mock = new MockImageBackend(dir);
  const image = { name: 'comfyui', health: async () => true, generate: async (r: ImageRequest) => { requests.push(r); return { ...await mock.generate(r), placeholder: false }; } };
  const { app, session, queue } = await buildApp({ llm: new MockLlm(), image, store, workflowHash: 'mock', cacheDir: dir });
  try {
    await session.newGame({ seed: 21 });
    const before = structuredClone(session.state);
    const c = session.state!.characters.ren;
    const base = portraitRequest(c);
    const baseStatus = queue.request(base, PRIORITY.portrait);
    const settledBase = await queue.settle(baseStatus.key);
    expect(settledBase.status).toBe('ready');
    expect(settledBase.url).toBeTruthy();
    const baseFile = queue.localFile(base);
    expect(baseFile).toBeTruthy();
    expect(base.subjectKey).toContain(':knees-up-v3');
    expect(expressionRequest(c, 'neutral')).toEqual(base);
    const post = (id: string, emotion: string) => app.inject({ method: 'POST', url: `/api/image/character/${id}/expression`, payload: { emotion } });
    expect((await post('ren', 'invented')).statusCode).toBe(400);
    expect((await post('missing', 'happy')).statusCode).toBe(404);
    const keys = new Set<string>();
    for (const emotion of EMOTIONS.filter((e) => e !== 'neutral')) {
      const response = await post('ren', emotion);
      expect(response.statusCode).toBe(200);
      const key = response.json().key;
      keys.add(key);
      await queue.settle(key);
      const request = requests.at(-1)!;
      expect(request.reference).toBe(baseFile);
      expect(request.prompt).toContain(`${emotion === 'tender' ? 'in love' : emotion} expression`);
      expect(request.seed).toBe(base.seed);
      expect(request.subjectKey).toBe(`${base.subjectKey}:expression:v3:${emotion}`);
      expect(cacheKey('mock', request)).not.toBe(cacheKey('mock', base));
      const count = requests.length;
      expect((await post('ren', emotion)).json().key).toBe(key);
      expect(requests).toHaveLength(count);
    }
    expect(keys.size).toBe(EMOTIONS.length - 1);
    expect((await post('ren', 'neutral')).json().url).toBe(settledBase.url);
    expect(session.state).toEqual(before);
  } finally {
    await app.close(); store.db.close(); rmSync(dir, { recursive: true, force: true });
  }
});

it('keeps personal memories and summaries across saves, refreshes dialogue context and hides private history', () => {
  const s = createGame({ seed: 21 });
  const P = s.playerId;
  const shared = [P, 'ren'];
  s.pairSummary[`ren>${P}`] = 'Outdated relationship summary';
  rel(s, 'ren', P).affinity = 70;
  addMemory(s, 'ren', 'We promised to bake bread on Sunday.', shared, 0.9);
  addMemory(s, P, 'We promised to bake bread on Sunday.', shared, 0.9);
  addMemory(s, 'ren', 'Private talk with Mio about a secret.', ['ren', 'mio'], 1);
  const store = new Store(openDb(':memory:'));
  try {
    const id = store.save(1, s, 'memory check', 0);
    const loaded = store.load(id)!.state;
    expect(loaded.memory).toEqual(s.memory);
    expect(loaded.pairSummary).toEqual(s.pairSummary);
    const summary = relationshipLine(loaded, 'ren', P);
    expect(summary).toContain('really likes');
    expect(summary).toContain('bake bread');
    expect(summary).not.toContain('Outdated');
    const context = memoriesBlock(loaded, 'ren', shared);
    expect(context).toContain('bake bread');
    expect(context).not.toContain('Private talk');
    loaded.memory.ren.unshift({ episode: 1, tick: -100, participants: ['ren', 'mio'], salience: 0.1, text: 'We found a seashell on the beach.' });
    expect(memoriesBlock(loaded, 'ren', shared, 1, 'Remember that seashell on the beach?')).toContain('seashell');
    expect(memoriesBlock(loaded, 'mio', shared, 3, 'seashell')).not.toContain('seashell');
    expect(memoriesBlock(loaded, 'ren', [P, 'mio', 'ren'], 3)).toContain('bake bread');
    const history = projectForPlayer(loaded).bible.find((b) => b.id === 'ren')!.sharedHistory;
    expect(history.memories[0].text).toContain('bake bread');
    expect(JSON.stringify(history)).not.toContain('Private talk');
  } finally { store.db.close(); }
});

it('retries a placeholder in the same process once the real backend recovers', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'roof-retry-'));
  const store = new Store(openDb(':memory:'));
  const mock = new MockImageBackend(dir);
  let up = false;
  let calls = 0;
  const backend = { name: 'comfyui', health: async () => up, generate: async (r: ImageRequest) => { calls++; if (!up) throw new Error('offline'); return { ...await mock.generate(r), placeholder: false }; } };
  const queue = new ImageQueue(backend, mock, store, 'w', dir, null);
  try {
    const r = expressionRequest(createGame({ seed: 21 }).characters.ren, 'happy');
    const first = queue.request(r, PRIORITY.portrait);
    expect((await queue.settle(first.key)).placeholder).toBe(true);
    up = true; queue.lastFailure = 0; // simulate expiry of the offline backoff
    const second = queue.request(r, PRIORITY.portrait);
    expect((await queue.settle(second.key)).placeholder).toBe(false);
    expect(calls).toBe(2);
  } finally { store.db.close(); rmSync(dir, { recursive: true, force: true }); }
});
