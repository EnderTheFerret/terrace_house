import { expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../app';
import { openDb, Store } from '../db';
import { MockLlm } from '../llm/mock';
import { MockImageBackend } from '../image/mock';

it('an invitation typed in free text gets the same answer, and the same go-out prompt, as the invite button', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'roof-typed-invite-'));
  const { app, session } = await buildApp({ llm: new MockLlm(), image: new MockImageBackend(dir), store: new Store(openDb(':memory:')), workflowHash: 'mock', cacheDir: dir, assetsDir: null });
  try {
    await session.newGame({ seed: 21, moveInDay: false });
    const { scenes } = await session.act({ type: 'talk', target: 'ren' });
    const run = session.runs.get(scenes[0].id)!;
    const events: { e: string; d: any }[] = [];
    const stream = () => session.stream(run.id, (e, d) => events.push({ e, d }));
    await stream();
    const s = session.state!;
    const ron = run.ev.participants.find((id) => id !== s.playerId)!; // whoever the talk is with
    s.characters[ron].lastAction = 'wander';
    s.rel[ron][s.playerId].affinity = 70;
    s.characters[ron].persona.keepsShabbat = true;

    // Saturday morning, they keep Shabbat: the game says no at once, with the real reason, instead of an AI yes and a later no
    s.world.weekday = 6; s.world.slot = 'slot1'; s.world.minutes = 30;
    session.choose(run.id, { text: "Maybe head to Carmel market? I'm free right now if you want to do some shopping" });
    await stream();
    expect(events.filter((x) => x.e === 'invite').at(-1)?.d).toMatchObject({ from: ron, node: 'market', accepted: false, reason: expect.stringContaining('Shabbat') });

    // a weekday: the same words get a yes and the go-out prompt (an 'invite' event the screen turns into the button)
    const t = session.state!; // the session swaps its state object after each reply
    t.world.weekday = 3; t.characters[ron].mood = 1; t.rel[ron][t.playerId].affinity = 100; // (their refusal above colours the tone, so make them clearly willing)
    session.choose(run.id, { text: 'Want to go to Carmel Market with me?' });
    await stream();
    const yes = events.filter((x) => x.e === 'invite').at(-1)?.d;
    expect(yes, JSON.stringify(yes)).toMatchObject({ from: ron, node: 'market', accepted: true });
    expect(run.phase).toBe('awaiting-choice');

    // an ordinary line is left alone: no invite event for small talk or a question about a place
    const before = events.filter((x) => x.e === 'invite').length;
    session.choose(run.id, { text: 'Do you know a good butcher at Carmel Market?' });
    await stream();
    expect(events.filter((x) => x.e === 'invite')).toHaveLength(before);
  } finally {
    await app.close();
  }
});
