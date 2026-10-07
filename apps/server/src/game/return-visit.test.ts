import { expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_PLAYER, finishSlot, housemates, joinNewPlayer, planSlot } from '@shared-roof/shared';
import { buildApp } from '../app';
import { openDb, Store } from '../db';
import { MockLlm } from '../llm/mock';
import { MockImageBackend } from '../image/mock';

it('streams a saved former player as a guest, accepts addressed words, and saves their new memories', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'roof-return-visit-'));
  const store = new Store(openDb(':memory:'));
  const { app, session } = await buildApp({ llm: new MockLlm(), image: new MockImageBackend(dir), store, workflowHash: 'mock', cacheDir: dir, assetsDir: null });
  try {
    await session.newGame({ seed: 5, moveInDay: false });
    const original = session.state!.playerId;
    const departed = finishSlot(planSlot(session.state!, { type: 'graduate' }).state);
    const s = joinNewPlayer(departed, { ...DEFAULT_PLAYER, name: 'Next Resident' });
    s.characters[original].lastAction = 'sleep';
    s.world.episode = 6; s.world.slot = 'evening'; s.world.minutes = 0;
    s.world.flags.aired = 4;
    delete s.world.flags.startedBlock;
    for (const c of housemates(s)) {
      c.location = 'living'; c.lastAction = 'hobby'; c.activityUntil = 180;
      delete s.world.flags[`new_${c.id}`];
    }
    const seed = Array.from({ length: 100 }, (_, i) => i + 1).find((rngState) => planSlot({ ...structuredClone(s), rngState }, { type: 'idle' }).plan.scenes.some((sc) => sc.event.templateId === 'former-housemate' && sc.event.isPlayerScene));
    expect(seed).toBeDefined();
    s.rngState = seed!;
    session.state = s;
    const { scenes } = await session.act({ type: 'idle' });
    const summary = scenes.find((sc) => sc.title.includes('visits the house'))!;
    expect(summary).toBeDefined();
    const run = session.runs.get(summary.id)!;
    const emitted: { event: string; data: any }[] = [];
    const stream = () => session.stream(run.id, (event, data) => emitted.push({ event, data }));
    await stream();
    expect(run.phase).toBe('awaiting-choice');
    expect(emitted.find((e) => e.event === 'scene')?.data.participants.map((p: { id: string }) => p.id)).toContain(original);
    expect(emitted.at(-1)?.data.recipients.map((p: { id: string }) => p.id)).toContain(original);
    const reply = await app.inject({ method: 'POST', url: `/api/scene/${run.id}/choose`, payload: { text: 'Welcome back! What have you been doing lately?', recipient: original } });
    expect(reply.statusCode).toBe(200);
    await stream();
    expect(run.transcript.at(-1)?.speaker).toBe(original);
    session.choose(run.id, { done: true });
    await stream();
    expect(run.phase).toBe('done');
    expect(session.state!.characters[original]).toMatchObject({ status: 'left', isPlayer: false });
    expect(session.state!.memory[original].some((m) => m.text.includes('Welcome back!'))).toBe(true);
    const saved = session.save(1, 'after a return visit');
    const loaded = store.load(saved)!.state;
    expect(loaded.characters[original].status).toBe('left');
    expect(loaded.memory[original]).toEqual(session.state!.memory[original]);
    expect(loaded.house.groupChat.members).not.toContain(original);
  } finally {
    await app.close();
    store.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
