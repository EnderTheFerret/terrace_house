import { expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../app';
import { openDb, Store } from '../db';
import { MockLlm } from '../llm/mock';
import { MockImageBackend } from '../image/mock';
import { replayEvents } from './replay';
import { queueNpcPlans } from '@shared-roof/shared';
import { applyCharacterSnapshot } from './personas';

it('joins the second housemate mid-talk, interrupts for the third, and replays the whole first day', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'roof-movein-'));
  const store = new Store(openDb(':memory:'));
  const { app, session } = await buildApp({ llm: new MockLlm(), image: new MockImageBackend(dir), store, workflowHash: 'mock', cacheDir: dir });
  const events: { kind: string; data: any }[] = [];
  const stream = (id: string) => session.stream(id, (kind, data) => events.push({ kind, data }));
  const finish = async () => {
    for (const scene of session.summaries()) {
      if (scene.phase === 'done') continue;
      await stream(scene.id);
      if (session.summaries().find(s => s.id === scene.id)?.phase === 'awaiting-choice') {
        const choice = [...events].reverse().find(e => e.kind === 'choice' && e.data.id === scene.id)!;
        session.choose(scene.id, choice.data.intents[0]);
        await stream(scene.id);
        if (session.runs.get(scene.id)?.phase === 'awaiting-choice') {
          session.choose(scene.id, { done: true });
          await stream(scene.id);
        }
      }
    }
    await session.endSlot();
  };
  try {
    await session.newGame({ seed: 7, moveInDay: true });
    const first = await session.act({ type: 'idle' });
    const id = first.scenes[0].id;
    await stream(id);
    expect(first.scenes[0].participants).toHaveLength(2);
    const original = first.scenes[0].participants.find(p => p !== session.state!.playerId)!;
    expect(events.some(e => e.kind === 'line-end' && e.data.text.includes(`I'm ${session.state!.characters[original].name}`))).toBe(true);
    for (let n = 0; n < 8 && !events.some(e => e.kind === 'arrival-joined'); n++) {
      session.choose(id, { text: 'Hello! What do you enjoy doing on a free day?' });
      await stream(id);
    }
    const joined = events.find(e => e.kind === 'arrival-joined')!;
    expect(joined).toBeDefined();
    expect(joined.data.participants).toHaveLength(3);
    expect(session.summaries()[0].phase).toBe('awaiting-choice');
    expect(events.some(e => e.kind === 'line-end' && e.data.speaker === joined.data.intro.id)).toBe(true);
    const residents = Object.values(session.state!.characters).filter(c => c.status === 'inHouse').map(c => [c.id, c.location]);
    const lineCount = events.filter(e => e.kind === 'line-end').length;
    const generation = ['lines', 'deltas', 'commentary', 'shot'].map(method => vi.spyOn(session.gen, method as 'lines'));
    session.choose(id, { done: true });
    await stream(id);
    generation.forEach(spy => { expect(spy).not.toHaveBeenCalled(); spy.mockRestore(); });
    expect(events.filter(e => e.kind === 'line-end')).toHaveLength(lineCount);
    await session.endSlot();
    expect(session.summaries()).toEqual([]);
    expect(Object.values(session.state!.characters).filter(c => c.status === 'inHouse').map(c => [c.id, c.location])).toEqual(residents);
    expect(replayEvents(store.events(session.state!.gameId))).toEqual(session.state);

    await session.act({ type: 'skip' });
    await finish();
    expect(session.state!.world.slot).toBe('slot1');
    const target = joined.data.intro.id;
    const chat = await session.act({ type: 'talk', target });
    const chatId = chat.scenes[0].id;
    await stream(chatId);
    for (let n = 0; n < 8 && !events.some(e => e.kind === 'arrival-pending'); n++) {
      session.choose(chatId, { text: 'Tell me more about yourself.' });
      await stream(chatId);
    }
    expect(events.find(e => e.kind === 'arrival-pending')).toBeDefined();
    expect(session.summaries().find(s => s.id === chatId)?.phase).toBe('done');
    const third = session.summaries().find(s => s.phase === 'new')!;
    expect(third.participants).toHaveLength(4);
    await finish();
    expect(replayEvents(store.events(session.state!.gameId))).toEqual(session.state);
    // The original greeter can be elsewhere now; continue with the person who heard this interrupted talk.
    const resumed = await session.act({ type: 'talk', target });
    expect(resumed.scenes[0].title).toBe('continuing your conversation');
    expect(resumed.scenes[0].premise).toContain('Tell me more about yourself.');
    await finish();
    for (let n = 0; n < 12 && Object.values(session.state!.characters).filter(c => c.status === 'inHouse').length < 6; n++) {
      await session.act({ type: 'skip' });
      await finish();
    }
    expect(Object.values(session.state!.characters).filter(c => c.status === 'inHouse')).toHaveLength(6);
    expect(session.state!.world.slot).toBe('evening');
    expect(replayEvents(store.events(session.state!.gameId))).toEqual(session.state);
  } finally { await app.close(); store.db.close(); rmSync(dir, { recursive: true, force: true }); }
});

it('ending a regular conversation clears pending scenes and allows another action', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'roof-exit-'));
  const store = new Store(openDb(':memory:'));
  const { app, session } = await buildApp({ llm: new MockLlm(), image: new MockImageBackend(dir), store, workflowHash: 'mock', cacheDir: dir });
  try {
    await session.newGame({ seed: 87, moveInDay: false });
    const morning = await session.act({ type: 'idle' });
    for (const sc of morning.scenes) {
      if (sc.phase === 'done') continue;
      if (sc.phase === 'awaiting-response') { session.respond(sc.id, 'ignore'); continue; }
      const choices: string[][] = [];
      await session.stream(sc.id, (kind, data) => { if (kind === 'choice') choices.push((data as { intents: string[] }).intents); });
      if (choices.length) {
        session.choose(sc.id, choices.at(-1)![0]);
        await session.stream(sc.id, () => {});
        if (session.runs.get(sc.id)?.phase === 'awaiting-choice') {
          session.choose(sc.id, { done: true });
          await session.stream(sc.id, () => {});
        }
      }
    }
    await session.endSlot();
    // Make the pending NPC conversation explicit; an autonomous cast need not create it for this seed.
    for (const id of ['ren', 'kaito']) {
      session.state!.characters[id].persona.routine.jobSlots = [];
      session.state!.characters[id].lastAction = 'hobby';
      session.state!.characters[id].activityUntil = 0;
      session.state!.characters[id].location = 'living';
      applyCharacterSnapshot(session.state!, session.state!.characters[id]);
      store.appendEvent(session.state!.gameId, 'generated-character', { character: session.state!.characters[id] });
    }
    queueNpcPlans(session.state!, { ren: { kind: 'seek', target: 'kaito' }, kaito: { kind: 'seek', target: 'ren' } });
    store.appendEvent(session.state!.gameId, 'autonomy', { plans: { ren: { kind: 'seek', target: 'kaito' }, kaito: { kind: 'seek', target: 'ren' } } });
    const result = await session.act({ type: 'talk', target: 'sora' });
    const actionTime = session.state!.world.minutes;
    expect(result.scenes.filter(s => s.phase !== 'done').length).toBeGreaterThan(1);
    const scene = result.scenes.find(s => s.isPlayerScene)!;
    expect(scene).toBeDefined();
    await session.stream(scene.id, () => {});
    const openingTime = session.state!.world.minutes;
    expect(openingTime).toBeGreaterThan(actionTime);
    session.choose(scene.id, { text: 'Hello, how are you?' });
    await session.stream(scene.id, () => {});
    const repliedTime = session.state!.world.minutes;
    expect(repliedTime).toBeGreaterThan(openingTime);
    const location = session.state!.characters.sora.location;
    session.choose(scene.id, { done: true });
    await session.stream(scene.id, () => {});
    expect(session.state!.world.minutes).toBe(repliedTime);
    expect(session.summaries().every(s => s.phase === 'done')).toBe(true);
    expect(session.state!.characters.sora.location).toBe(location);
    await session.endSlot();
    expect(replayEvents(store.events(session.state!.gameId))).toEqual(session.state);
    await expect(session.act({ type: 'house', activity: 'tidy' })).resolves.toHaveProperty('view');
  } finally { await app.close(); store.db.close(); rmSync(dir, { recursive: true, force: true }); }
});
