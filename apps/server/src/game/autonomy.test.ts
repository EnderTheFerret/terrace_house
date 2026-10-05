import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { autonomyOptions, createGame, GameState, npcs, passTime, queueNpcPlans, recordConversation, type LlmClient, type LlmRequest } from '@shared-roof/shared';
import { decideActivities } from './autonomy';
import { replayEvents } from './replay';
import { buildApp } from '../app';
import { openDb, Store } from '../db';
import { MockLlm } from '../llm/mock';
import { MockImageBackend } from '../image/mock';

afterEach(() => vi.restoreAllMocks());
const fixture = () => {
  const s = createGame({ seed: 9, moveInDay: false });
  s.world.slot = 'slot1';
  for (const c of npcs(s)) { c.persona.routine.jobSlots = []; c.activityUntil = 100; c.lastAction = 'hobby'; c.location = 'living'; }
  s.characters.ren.activityUntil = 0;
  return s;
};

it('uses private personality and read message history to choose a real room activity, with replayable plans', async () => {
  const s = fixture();
  s.chats.own = [{ from: s.playerId, text: 'Let us make coffee in the kitchen.', tick: 0, readBy: ['ren'], ignoredBy: [] }];
  s.chats.secret = [{ from: 'mio', text: 'PRIVATE_OTHER_THREAD', tick: 0, readBy: ['sora'], ignoredBy: [] }];
  const option = autonomyOptions(s, s.characters.ren).findIndex(a => a.kind === 'hobby' && a.room === 'kitchen');
  let request: LlmRequest | undefined;
  const llm: LlmClient = { name: 'scripted', health: async () => true, complete: async r => {
    request = r; return JSON.stringify({ choices: { ren: option } });
  }, stream: async function* () {} };
  const result = await decideActivities(llm, s, 5);
  expect(result.source).toBe('llm');
  expect(request!.kind).toBe('actions');
  expect(request!.prompt).toContain('Personality:');
  expect(request!.prompt).toContain('make coffee in the kitchen');
  expect(request!.prompt).not.toContain('PRIVATE_OTHER_THREAD');
  queueNpcPlans(s, result.plans);
  const next = passTime(s, 1, [], 5);
  expect(next.characters.ren.location).toBe('kitchen');
  expect(next.characters.ren.activityUntil).toBe(60);
  expect(next.characters[s.playerId].location).toBe(s.characters[s.playerId].location);
  expect(GameState.safeParse(next).success).toBe(true);
  // The model result is logged as data; replay never calls a model.
  const initial = createGame({ seed: 9, moveInDay: false });
  const valid = autonomyOptions(initial, initial.characters.ren).find(a => a.kind === 'hobby' && a.room === 'kitchen')!;
  queueNpcPlans(initial, { ren: valid });
  expect(replayEvents([
    { seq: 1, kind: 'new', payload: { seed: 9, moveInDay: false } },
    { seq: 2, kind: 'autonomy', payload: { plans: { ren: valid } } },
    { seq: 3, kind: 'time', payload: { lines: 1, minutesPerLine: 5 } },
  ])).toEqual(passTime(initial, 1, [], 5));
});

it('rejects fabricated model options and never replans a protected or busy housemate', async () => {
  const s = fixture();
  const complete = vi.fn(async () => '{"choices":{"ren":9999}}');
  const llm: LlmClient = { name: 'bad', complete, health: async () => true, stream: async function* () {} };
  expect((await decideActivities(llm, s, 5, ['ren'])).plans).toEqual({});
  expect(complete).not.toHaveBeenCalled();
  const result = await decideActivities(llm, s, 5);
  expect(result.source).toBe('mock');
  expect(complete).toHaveBeenCalledTimes(1);
  expect(Object.keys(result.plans)).toEqual(['ren']);
  expect(autonomyOptions(s, s.characters.ren)).toContainEqual(result.plans.ren);
});

it('preserves plans spoken aloud only for listeners and fits a full house inside the model context', async () => {
  const s = recordConversation(fixture(), ['ren', 'mio'], [{ speaker: 'ren', text: 'I want to read in the kitchen.' }]);
  expect(s.memory.ren.at(-1)?.text).toContain('I want to read in the kitchen');
  expect(s.memory.mio.at(-1)?.text).toContain('I want to read in the kitchen');
  expect(s.memory.sora.some(m => m.text.includes('read in the kitchen'))).toBe(false);
  for (const c of npcs(s)) c.activityUntil = 0;
  let prompt = '';
  const llm: LlmClient = { name: 'scripted', health: async () => true, complete: async req => {
    prompt = req.prompt;
    return JSON.stringify({ choices: Object.fromEntries(npcs(s).map(c => [c.id, 0])) });
  }, stream: async function* () {} };
  const result = await decideActivities(llm, s, 5);
  expect(result.source).toBe('llm');
  expect(prompt.length).toBeLessThan(26000);
  expect(prompt).toContain('I want to read in the kitchen');
  expect(Object.keys(result.plans)).toHaveLength(5);
});

it('ticks only idle sessions, throttles pulses, locks concurrent mutations and replays the pulse', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'roof-autonomy-'));
  const store = new Store(openDb(':memory:'));
  const { app, session } = await buildApp({ llm: new MockLlm(), image: new MockImageBackend(dir), store, workflowHash: 'mock', cacheDir: dir });
  try {
    await session.newGame({ seed: 9, moveInDay: false });
    const original = session.state!.world.minutes;
    const first = await session.worldPulse(100000);
    expect(session.state!.world.minutes).toBe(original + 5);
    expect(first.scenes).toEqual([]);
    await session.worldPulse(100001);
    expect(session.state!.world.minutes).toBe(original + 5);
    session.busy = true;
    await session.worldPulse(200000);
    expect(session.state!.world.minutes).toBe(original + 5);
    session.busy = false;
    expect(replayEvents(store.events(session.state!.gameId))).toEqual(session.state);
    const pending = session.worldPulse(200000);
    await expect(session.act({ type: 'visit', room: 'kitchen' })).rejects.toThrow('generation is running');
    await pending;
    const target = session.view().characters.find(c => !c.isPlayer && c.location && c.location !== 'out')!;
    await session.act({ type: 'talk', target: target.id, room: 'living' });
    const minutes = session.state!.world.minutes;
    await session.worldPulse(300000);
    expect(session.state!.world.minutes).toBe(minutes);
  } finally { await app.close(); store.db.close(); rmSync(dir, { recursive: true, force: true }); }
});
