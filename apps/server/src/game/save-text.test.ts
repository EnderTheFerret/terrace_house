import { expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../app';
import { openDb, Store } from '../db';
import { MockLlm } from '../llm/mock';
import { MockImageBackend } from '../image/mock';
import { GameSession } from './session';
import { replayEvents } from './replay';
import { actionMinutes, planSlot } from '@shared-roof/shared';

it('restores dialogue and response state, then sends brief texts without scenes or elapsed time', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'roof-save-text-'));
  const store = new Store(openDb(':memory:'));
  const { app, session } = await buildApp({ llm: new MockLlm(), image: new MockImageBackend(dir), store, workflowHash: 'mock', cacheDir: dir });
  try {
    await session.newGame({ seed: 7, moveInDay: false });
    const { scenes } = await session.act({ type: 'talk', target: 'mio', guests: ['ren'], room: 'living' });
    const id = scenes[0].id;
    await session.stream(id, () => {});
    for (let i = 0; i < 6; i++) {
      session.choose(id, { text: `Tell me about your day, part ${i + 1}.`, recipient: 'everyone' });
      await session.stream(id, () => {});
    }
    const run = JSON.parse(JSON.stringify(session.runs.get(id)));
    expect(run.transcript.length).toBeGreaterThan(12);
    const state = structuredClone(session.state!);
    const saved = session.save(1);
    session.choose(id, { text: 'This line belongs only to the abandoned branch.' });
    await session.stream(id, () => {});
    const loaded = await app.inject({ method: 'POST', url: `/api/saves/${saved}/load` });
    expect(loaded.statusCode).toBe(200);
    expect(loaded.json().scenes).toEqual(scenes.map(scene => ({ ...scene, phase: 'awaiting-choice' })));
    expect(JSON.parse(JSON.stringify(session.runs.get(id)))).toEqual(run);
    expect(session.state).toEqual(state);
    const generate = vi.spyOn(session.gen, 'lines');
    const output: { event: string; data: any }[] = [];
    await session.stream(id, (event, data) => output.push({ event, data }));
    expect(output.filter(e => e.event === 'line-end').map(e => e.data.text)).toEqual(run.transcript.map((l: { text: string }) => l.text));
    expect(output.find(e => e.event === 'choice')?.data).toMatchObject({ canType: true, canEnd: true, canListen: true });
    expect(generate).not.toHaveBeenCalled();
    expect(session.state).toEqual(state);
    for (const target of ['mio', 'kaito']) {
      const reply = await app.inject({ method: 'POST', url: '/api/game/action', payload: { action: { type: 'text', target, text: 'Popcorn could be nice.' } } });
      expect(reply.statusCode).toBe(200);
      expect(reply.json().scenes).toEqual(loaded.json().scenes);
      expect(JSON.parse(JSON.stringify(session.runs.get(id)))).toEqual(run);
      expect(session.state!.world).toEqual(state.world);
      expect(session.state!.characters).toEqual(state.characters);
      expect(session.state!.chats[[state.playerId, target].sort().join('|')].at(-2)!.text).toBe('Popcorn could be nice.');
    }
    expect(generate).not.toHaveBeenCalled();
    await expect(session.act({ type: 'idle' })).rejects.toThrow('scenes still pending');
    session.autosave();
    const restarted = new GameSession(store, session.gen, session.images);
    expect(restarted.resumeLatest()).toBe(true);
    expect(JSON.parse(JSON.stringify(restarted.runs.get(id)))).toEqual(run);
    session.choose(id, { done: true });
    await session.stream(id, () => {});
    await session.endSlot();
    expect(replayEvents(store.events(session.state!.gameId))).toEqual(session.state);

    const before = structuredClone(session.state!);
    const action = { type: 'text' as const, target: 'mio', text: 'Want to hang out later?' };
    expect(actionMinutes(action)).toBe(0);
    expect(planSlot(before, action)).toEqual({ state: before, plan: { scenes: [], npcActions: {} } });
    const chat = vi.spyOn(session.gen, 'chat');
    const beats = vi.spyOn(session.gen, 'beatSheet');
    generate.mockClear();
    for (const text of [action.text, 'Thanks, see you then.']) {
      const response = await session.act({ ...action, text });
      expect(response.scenes).toEqual([]);
      expect(session.state!.world).toEqual(before.world);
      expect(session.state!.characters).toEqual(before.characters);
    }
    expect(chat).toHaveBeenCalledTimes(2);
    expect(beats).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    const thread = session.state!.chats[[before.playerId, 'mio'].sort().join('|')];
    expect(thread.slice(-4).map(m => m.from)).toEqual([before.playerId, 'mio', before.playerId, 'mio']);
    expect(thread.at(-2)!.text).toBe('Thanks, see you then.');
    expect(replayEvents(store.events(session.state!.gameId))).toEqual(session.state);
    const legacy = store.save(2, state, 'old recap save', store.load(saved)!.row.log_seq, { participants: run.ev.participants, transcript: run.transcript.slice(-12) });
    session.load(legacy);
    const legacyScene = session.summaries()[0];
    expect(legacyScene.phase).toBe('awaiting-choice');
    expect(session.runs.get(legacyScene.id)!.transcript).toEqual(run.transcript.slice(-12));
    const clock = session.state!.world.minutes;
    await session.stream(legacyScene.id, () => {});
    expect(session.state!.world.minutes).toBe(clock);
    const legacyRun = JSON.parse(JSON.stringify(session.runs.get(legacyScene.id)));
    await session.act({ type: 'text', target: 'kaito', text: 'Can you bring snacks?' });
    expect(session.state!.world.minutes).toBe(clock);
    expect(JSON.parse(JSON.stringify(session.runs.get(legacyScene.id)))).toEqual(legacyRun);
  } finally {
    vi.restoreAllMocks();
    await app.close(); store.db.close(); rmSync(dir, { recursive: true, force: true });
  }
});
