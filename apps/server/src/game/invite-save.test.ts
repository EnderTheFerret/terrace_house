import { expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../app';
import { openDb, Store } from '../db';
import { MockLlm } from '../llm/mock';
import { MockImageBackend } from '../image/mock';

it('the player can invite a housemate during a talk, the answer follows how they feel, and a mid-talk save resumes it', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'roof-invite-'));
  const store = new Store(openDb(':memory:'));
  const { app, session } = await buildApp({ llm: new MockLlm(), image: new MockImageBackend(dir), store, workflowHash: 'mock', cacheDir: dir, assetsDir: null });
  try {
    await session.newGame({ seed: 21, moveInDay: false });
    const { scenes } = await session.act({ type: 'talk', target: 'ren' });
    const run = session.runs.get(scenes[0].id)!;
    const events: { e: string; d: any }[] = [];
    const stream = () => session.stream(run.id, (e, d) => events.push({ e, d }));
    await stream();
    expect(run.phase).toBe('awaiting-choice');
    expect(() => session.choose(run.id, { invite: { node: 'nowhere' } })).toThrow(/choose a place/);

    const other = run.ev.participants.find((id) => id !== session.state!.playerId)!;
    session.state!.characters[other].lastAction = 'wander';
    session.state!.rel[other][session.state!.playerId].affinity = 70;
    session.choose(run.id, { invite: { node: 'beach' } });
    await stream();
    expect(events.filter((x) => x.e === 'invite').at(-1)?.d).toMatchObject({ from: other, node: 'beach', accepted: true });
    expect(run.transcript.at(-2)?.text).toContain('Gordon & Frishman Beaches');
    expect(run.phase).toBe('awaiting-choice');

    session.state!.characters[other].lastAction = 'work';
    session.choose(run.id, { invite: { node: 'park' } });
    await stream();
    expect(events.filter((x) => x.e === 'invite').at(-1)?.d).toMatchObject({ accepted: false, reason: expect.stringContaining('busy') });

    // saving while the talk is open is allowed and remembers it
    const id = session.save(1);
    expect(store.load(id)?.resume.transcript.length).toBeGreaterThan(2);
    await session.load(id);
    expect((session as any).interruptedTalk.participants).toContain(other);
  } finally {
    await app.close();
  }
});
