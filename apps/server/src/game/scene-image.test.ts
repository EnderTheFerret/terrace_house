import { expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type ImageRequest } from '@shared-roof/shared';
import { buildApp } from '../app';
import { openDb, Store } from '../db';
import { MockLlm } from '../llm/mock';
import { MockImageBackend } from '../image/mock';

it('generates any joined conversation from current dialogue without changing the simulation', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'roof-scene-'));
  const mock = new MockImageBackend(dir);
  const requests: ImageRequest[] = [];
  const image = { name: 'mock', health: async () => true, generate: async (req: ImageRequest) => { requests.push(req); return mock.generate(req); } };
  const { app, session, queue } = await buildApp({ llm: new MockLlm(), image, store: new Store(openDb(':memory:')), workflowHash: 'mock', cacheDir: dir });
  try {
    await session.newGame({ seed: 21 });
    expect((await app.inject({ method: 'POST', url: '/api/scene/missing/image' })).statusCode).toBe(400);
    await session.act({ type: 'talk', target: 'ren' });
    const scene = session.summaries().find((sc) => sc.isPlayerScene)!;
    const run = session.runs.get(scene.id)!;
    run.ev.freeze = false; // ordinary conversations must work too
    await session.stream(scene.id, () => {});
    session.choose(scene.id, { text: 'Could we bake bread together in the kitchen?' });
    await session.stream(scene.id, () => {});
    const before = structuredClone(session.state);
    const response = await app.inject({ method: 'POST', url: `/api/scene/${scene.id}/image` });
    expect(response.statusCode).toBe(200);
    await queue.settle(response.json().key);
    const req = requests.find((r) => r.kind === 'freeze')!;
    expect(req.prompt).toContain('bake bread together');
    expect(req.prompt).toContain('Recent conversation:');
    expect(req.reference).toMatch(/tel-aviv-player\.png$/);
    expect(req.meta!.people).toHaveLength(2);
    expect(req.meta!.people![0].appearance).toEqual(session.state!.characters[session.state!.playerId].appearance);
    expect(session.state).toEqual(before);
    expect(run.phase).toBe('awaiting-choice');
    // Same moment is reused rather than queued twice; phone talk preserves separate locations.
    session.sceneImage(scene.id);
    expect(requests.filter((r) => r.kind === 'freeze')).toHaveLength(1);
    run.ev.location = 'phone';
    const phone = session.sceneImage(scene.id);
    await queue.settle(phone.key);
    expect(requests.at(-1)!.prompt).toContain('split-screen composition');
    expect(requests.at(-1)!.prompt).toContain('not in the same room');
    expect(requests.at(-1)!.prompt).not.toContain('share house phone');
    run.ev.participants = ['ren', 'mio'];
    expect(() => session.sceneImage(scene.id)).toThrow(/join this conversation/);
  } finally {
    await app.close();
  }
});
