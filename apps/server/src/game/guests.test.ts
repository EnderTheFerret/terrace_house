import { expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { guestCharacter, type ImageRequest } from '@shared-roof/shared';
import { buildApp } from '../app';
import { openDb, Store } from '../db';
import { MockLlm } from '../llm/mock';
import { MockImageBackend } from '../image/mock';

it('binds a random classmate, renders their artwork and lets them answer typed words and intents', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'roof-guests-'));
  const store = new Store(openDb(':memory:'));
  const { app, session, queue } = await buildApp({ llm: new MockLlm(), image: new MockImageBackend(dir), store, workflowHash: 'mock', cacheDir: dir, assetsDir: null });
  try {
    await session.newGame({ seed: 7, moveInDay: false });
    session.state!.world.slot = 'slot1';
    session.state!.world.weekday = 1;
    const result = await session.act({ type: 'goOut', node: 'university', activity: 'class' });
    const scene = result.scenes.find(sc => sc.title === 'at class')!;
    expect(scene).toBeDefined();
    const emitted: { kind: string; data: any }[] = [];
    await session.stream(scene.id, (kind, data) => emitted.push({ kind, data }));
    const guest = emitted.find(e => e.kind === 'scene')!.data.outsiders[0];
    expect(guest.id).toBe('classmate');
    expect(guest.appearance).toEqual(guestCharacter(session.state!, 'classmate')!.appearance);
    expect(guestCharacter(session.state!, 'classmate')).toEqual(guestCharacter(session.state!, 'classmate'));
    expect(guestCharacter({ seed: 8 }, 'classmate')!.portraitSeed).not.toBe(guest.portraitSeed);
    expect(session.state!.characters.classmate).toBeUndefined();
    expect(emitted.some(e => e.kind === 'line-end' && e.data.speaker === 'classmate')).toBe(true);
    for (const choice of [{ text: 'What did you think of the lecture?' }, { intent: 'joke' }]) {
      emitted.length = 0;
      session.choose(scene.id, choice);
      await session.stream(scene.id, (kind, data) => emitted.push({ kind, data }));
      expect(emitted.some(e => e.kind === 'line-end' && e.data.speaker === 'classmate')).toBe(true);
      expect(emitted.some(e => e.kind === ('text' in choice ? 'choice' : 'done'))).toBe(true);
    }
    const portrait = await app.inject('/api/image/character/classmate');
    expect(portrait.statusCode).toBe(200);
    await queue.settle(portrait.json().key);
    const stand = await app.inject('/api/image/character/classmate/stand');
    expect(stand.statusCode).toBe(200);
    await queue.settle(stand.json().key);
    expect((await app.inject('/api/image/character/unknown')).statusCode).toBe(404);
    const save = session.save(1, 'class guest');
    session.load(save);
    expect(guestCharacter(session.state!, 'classmate')!.appearance).toEqual(guest.appearance);
    expect(session.state!.characters.classmate).toBeUndefined();
  } finally {
    await app.close();
    store.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it.each([
  ['classmate', 'blue jeans and white sneakers'],
  ['hamabe', 'work apron over dark trousers'],
  ['gonda', 'work apron over dark trousers'],
  ['sponsor', 'tailored trousers and loafers'],
])('dresses %s for their role from the existing identity portrait', async (id, clothing) => {
  const dir = mkdtempSync(join(tmpdir(), 'roof-guest-outfit-'));
  const store = new Store(openDb(':memory:'));
  let serial = 0;
  // Finished-file fixtures exercise the edit chain; pixel quality is checked against real ComfyUI separately.
  const generate = vi.fn(async (_req: ImageRequest) => {
    const path = `${++serial}.png`;
    writeFileSync(join(dir, path), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    return { id: path, path, mime: 'image/png', placeholder: false };
  });
  const { app, session, queue } = await buildApp({ llm: new MockLlm(), image: { name: 'fixture', health: async () => true, generate }, store, workflowHash: 'fixture', cacheDir: dir, assetsDir: null });
  try {
    await session.newGame({ seed: 7, moveInDay: false });
    const base = await app.inject(`/api/image/character/${id}`);
    await queue.settle(base.json().key);
    const dressed = await app.inject(`/api/image/character/${id}/outfit?occasion=daily&day=0`);
    expect(dressed.statusCode).toBe(200);
    await queue.settle(dressed.json().key);
    const requests = generate.mock.calls.map(([req]) => req);
    const identityRequest = requests.find(req => req.subjectKey.startsWith(`portrait:${id}:`) && !req.reference)!;
    const outfitRequest = requests.find(req => req.subjectKey.startsWith(`portrait:${id}:`) && req.reference)!;
    expect(outfitRequest.prompt).toContain(clothing);
    expect(outfitRequest.prompt).toContain('Preserve the character identity');
    expect(outfitRequest.reference).toBe(queue.localFile(identityRequest));
    const stand = await app.inject(`/api/image/character/${id}/stand?occasion=daily&day=0`);
    expect(stand.statusCode).toBe(200);
    await queue.settle(stand.json().key);
    expect(generate.mock.calls.at(-1)![0].meta!.appearance!.outfit).toContain(clothing);
    const beach = await app.inject(`/api/image/character/${id}/outfit?occasion=beach`);
    await queue.settle(beach.json().key);
    expect(generate.mock.calls.at(-1)![0].meta!.appearance!.outfit).toMatch(/bikini|swimsuit|sarong|swim trunks|board shorts/);
  } finally {
    await app.close();
    store.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
