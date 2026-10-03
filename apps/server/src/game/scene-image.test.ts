import { expect, it, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type ImageRequest } from '@shared-roof/shared';
import { buildApp } from '../app';
import { openDb, Store } from '../db';
import { MockLlm } from '../llm/mock';
import { MockImageBackend } from '../image/mock';
import { Generator } from './generate';

it('generates any joined conversation from current dialogue without changing the simulation', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'roof-scene-'));
  const mock = new MockImageBackend(dir);
  const requests: ImageRequest[] = [];
  const image = { name: 'mock', health: async () => true, generate: async (req: ImageRequest) => { requests.push(req); return mock.generate(req); } };
  const shot = vi.spyOn(Generator.prototype, 'shot').mockImplementation(async (s, _ev, transcript) => {
    expect(transcript.some((l) => l.text.includes('bake bread together'))).toBe(true);
    return { [s.playerId]: 'leaning on the counter, ready to bake bread together' };
  });
  const { app, session, queue } = await buildApp({ llm: new MockLlm(), image, store: new Store(openDb(':memory:')), workflowHash: 'mock', cacheDir: dir });
  try {
    await session.newGame({ seed: 21, moveInDay: false });
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
    expect(req.prompt).not.toContain('Recent conversation:');
    expect(req.references).toBeUndefined();
    expect(req.reference2).toMatch(/locations[\\/]/); // the room is a separate edit canvas, image 1
    expect(req.prompt).toContain('pixel art style and palette of image 1');
    expect(req.prompt).not.toContain('image 2');
    expect(req.prompt.match(/bake bread together/g)).toHaveLength(1);
    expect(req.prompt.indexOf('bake bread together')).toBeLessThan(req.prompt.indexOf(';'));
    expect(req.meta!.people![0].appearance).toEqual(session.state!.characters[session.state!.playerId].appearance);
    expect(session.state).toEqual(before);
    expect(run.phase).toBe('awaiting-choice');
    // a candid moment: the last speaker is mid-gesture, nobody lines up for the camera
    expect(req.prompt).toContain('talking, mid-gesture');
    expect(req.prompt).toContain('not lined up');
    expect(req.prompt).toContain('rain only outside the windows, dry indoors'); // the doorstep scene is inside, in the rain
    expect(req.prompt).toContain(`exactly ${req.meta!.people!.length} people, each of them appears once`); // no duplicated faces
    // Same moment is reused rather than queued twice; phone talk preserves separate locations.
    await session.sceneImage(scene.id);
    expect(requests.filter((r) => r.kind === 'freeze')).toHaveLength(1);
    // in a pool scene only the swimmers are in the water
    const partner = session.state!.characters[run.ev.participants.find((p) => p !== session.state!.playerId)!];
    partner.swimming = true;
    await queue.settle((await session.sceneImage(scene.id)).key);
    expect(requests.at(-1)!.prompt.match(/in the pool water up to the chest/g)).toHaveLength(1);
    expect(requests.at(-1)!.prompt).toContain('out of the water and dry');
    partner.swimming = false;
    run.ev.location = 'phone';
    const phone = await session.sceneImage(scene.id);
    await queue.settle(phone.key);
    expect(requests.at(-1)!.prompt).toContain('split-screen composition');
    expect(requests.at(-1)!.prompt).toContain('not in the same room');
    expect(requests.at(-1)!.prompt).not.toContain('share house phone');
    run.ev.participants = ['ren', 'mio'];
    await expect(session.sceneImage(scene.id)).rejects.toThrow(/join this conversation/);
  } finally {
    shot.mockRestore();
    await app.close();
  }
});
