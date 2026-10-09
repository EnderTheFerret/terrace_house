import { expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../app';
import { openDb, Store } from '../db';
import { MockLlm } from '../llm/mock';
import { MockImageBackend } from '../image/mock';
import { runMissions } from '@shared-roof/shared';

it('asking a close housemate to play matchmaker or snoop gets an answer from closeness and personality, button or typed', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'roof-favor-'));
  const { app, session } = await buildApp({ llm: new MockLlm(), image: new MockImageBackend(dir), store: new Store(openDb(':memory:')), workflowHash: 'mock', cacheDir: dir, assetsDir: null });
  try {
    await session.newGame({ seed: 21, moveInDay: false });
    const { scenes } = await session.act({ type: 'talk', target: 'ren' });
    const run = session.runs.get(scenes[0].id)!;
    const events: { e: string; d: any }[] = [];
    const stream = () => session.stream(run.id, (e, d) => events.push({ e, d }));
    await stream();
    const s = session.state!;
    const P = s.playerId;
    const helper = run.ev.participants.find((id) => id !== P)!;
    const target = Object.keys(s.characters).find((id) => id !== P && id !== helper && s.characters[id].status === 'inHouse')!;
    for (const id of [helper, target, P]) s.characters[id].interestedIn = ['man', 'woman', 'nonbinary'] as never;
    s.characters[helper].lastAction = 'hobby';
    Object.assign(s.rel[helper][P], { affinity: 60, trust: 60, romance: 0 });
    s.characters[helper].persona.traits = [0.5, 0.4, 0.85, 0.6, 0.2]; // outgoing

    expect(() => session.choose(run.id, { favor: { kind: 'match', a: P, b: 'nobody' } })).toThrow(/who to ask/);
    expect(() => session.choose(run.id, { favor: { kind: 'snoop', a: P, b: helper, with: helper } })).toThrow(/helper cannot/);
    expect(() => session.choose(run.id, { favor: { kind: 'match', a: helper, b: target, with: helper } })).toThrow(/helper cannot/);
    expect(() => session.choose(run.id, { favor: { kind: 'snoop', a: P, b: helper, with: helper } })).toThrow(/helper cannot/);
    expect(() => session.choose(run.id, { favor: { kind: 'match', a: helper, b: target, with: helper } })).toThrow(/helper cannot/);
    const before = s.rel[target]?.[P]?.affinity ?? 0;
    session.choose(run.id, { favor: { kind: 'match', a: P, b: target } });
    await stream();
    expect(events.filter((x) => x.e === 'favor').at(-1)?.d).toMatchObject({ from: helper, kind: 'match', accepted: true, note: expect.stringContaining('get back to you') });
    // it takes time and happens off screen: queued now, nothing has moved yet
    expect(session.state!.missions).toHaveLength(1);
    expect(session.state!.missions[0]).toMatchObject({ helper, status: 'pending' });
    expect(session.state!.rel[target][P].affinity).toBe(before);

    // a shy helper turns the same request down, and nothing moves
    const t = session.state!;
    t.characters[helper].persona.traits = [0.5, 0.5, 0.1, 0.5, 0.9];
    t.world.flags = {};
    const after = t.rel[target][P].affinity;
    const name = t.characters[target].name.split(' ')[0];
    session.choose(run.id, { text: `Could you find out if ${name} likes me? Snoop around a bit.` });
    await stream();
    const no = events.filter((x) => x.e === 'favor').at(-1)?.d;
    expect(no, JSON.stringify(no)).toMatchObject({ from: helper, kind: 'snoop', accepted: false });
    expect(session.state!.rel[target][P].affinity).toBe(after);
    expect(run.phase).toBe('awaiting-choice');

    // an ordinary line about the same person is left alone
    const count = events.filter((x) => x.e === 'favor').length;
    session.choose(run.id, { text: `How is ${name} doing today?` });
    await stream();
    expect(events.filter((x) => x.e === 'favor')).toHaveLength(count);

    // the next block: the helper has done it and comes up to the player, who hears the news in a talk with them
    session.choose(run.id, { done: true });
    await stream();
    const u = session.state!;
    const m = u.missions[0];
    m.dueEpisode = u.world.episode; m.dueSlot = u.world.slot;
    u.characters[helper].lastAction = 'hobby';
    u.characters[helper].persona.traits = [0.5, 0.4, 0.85, 0.6, 0.2];
    runMissions(u);
    expect(u.missions[0].status).toBe('ready');
    expect(u.rel[target][P].affinity).toBeGreaterThan(before);
    expect(u.approaches.some((a) => a.from === helper)).toBe(true);
    const talk = await session.act({ type: 'approach', id: u.approaches.find((a) => a.from === helper)!.id, accept: true });
    const run2 = session.runs.get(talk.scenes[0].id)!;
    await session.stream(run2.id, () => {});
    expect(session.state!.missions[0].status).toBe('told');
    expect(run2.ev.participants).toContain(helper);
  } finally {
    await app.close();
  }
});
