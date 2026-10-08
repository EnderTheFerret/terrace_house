import { expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../app';
import { openDb, Store } from '../db';
import { MockLlm } from '../llm/mock';
import { MockImageBackend } from '../image/mock';
import { replayEvents } from './replay';
import { createGame, dropUnattracted, FEELING_SCALE, planConflict, planFromWords, proposedPlan, rel, rereadChange, ROOMS, welcomedFlirts } from '@shared-roof/shared';
import { plansBlock } from '../prompts/common';

it('reads a later meet-up from typed words and leaves right-now or plan-free talk alone', () => {
  const s = createGame({ seed: 3 });
  s.world.episode = 2; s.world.slot = 'slot1'; s.world.weekday = 0;
  expect(proposedPlan(s, 'cafe tomorrow morning?')).toEqual({ node: 'cafe', episode: 3, slot: 'slot1' });
  expect(proposedPlan(s, 'want to hit the beach at 4?')).toEqual({ node: 'beach', episode: 2, slot: 'slot3' });
  expect(proposedPlan(s, "let's do the flea market on Friday")).toEqual({ node: 'arcade', episode: 7, slot: 'slot1' });
  expect(proposedPlan(s, 'movie in the living room tonight at 9?')).toEqual({ node: 'living', episode: 2, slot: 'evening' });
  expect(proposedPlan(s, 'Go on a date with me, cafe tomorrow evening?')).toEqual({ node: 'cafe', episode: 3, slot: 'evening', date: true });
  expect(proposedPlan(s, 'Would you like some coffee?')).toBeNull(); // no time: not a plan
  expect(proposedPlan(s, 'I went to the beach this morning.')).toBeNull(); // past, and not an invitation
  expect(proposedPlan(s, "I'm going to the beach tomorrow morning with the others, isn't that funny?")).toBeNull(); // news about other people, not an invitation
  expect(proposedPlan(s, "we're going to the beach tomorrow morning with the others, wanna come?")).toEqual({ node: 'beach', episode: 3, slot: 'slot1' });
  expect(proposedPlan(s, 'beach this morning?')).toBeNull(); // the current block is "now", the invite button's job
});

it('a calendar plan marked as a date is private to the pair and survives replay', async () => {
  const { session, store, close } = await setup();
  try {
    await session.newGame({ seed: 21, moveInDay: false });
    const s0 = session.state!;
    const target = Object.values(s0.characters).find(c => !c.isPlayer && c.interestedIn.includes(s0.characters[s0.playerId].gender))!;
    rel(s0, target.id, s0.playerId).trust = 60;
    await session.act({ type: 'plan', target: target.id, node: 'cafe', episode: 2, slot: 'slot1', date: true });
    const s = session.state!;
    const plan = s.invitations.at(-1)!;
    expect(plan).toMatchObject({ to: target.id, date: true, status: 'accepted' });
    const outsider = Object.values(s.characters).find(c => !c.isPlayer && c.id !== target.id)!;
    expect(plansBlock(s, outsider.id)).not.toContain('Rothschild Coffee');
    expect(plansBlock(s, target.id)).toContain('on a private date to Rothschild Coffee');
    expect(replayEvents(store.events(s.gameId)).invitations).toEqual(s.invitations);
  } finally { await close(); }
});

it('turns an agreed typed plan into a calendar entry the housemate knows about, and replays it', async () => {
  const { session, store, close } = await setup();
  try {
    await session.newGame({ seed: 21, moveInDay: false });
    for (const k of ['affinity', 'trust'] as const) rel(session.state!, 'ren', session.state!.playerId)[k] = 80;
    const result = await session.act({ type: 'talk', target: 'ren', room: 'living' });
    const scene = result.scenes.find(s => s.isPlayerScene)!;
    await session.stream(scene.id, () => {});
    session.choose(scene.id, { text: 'Cafe tomorrow morning?', recipient: 'ren' });
    await session.stream(scene.id, () => {});
    const s = session.state!;
    const plan = s.invitations.find(p => p.from === s.playerId && p.to === 'ren')!;
    expect(plan).toMatchObject({ node: 'cafe', episode: s.world.episode + 1, slot: 'slot1', status: 'accepted' });
    expect(plansBlock(s, 'ren')).toContain('Rothschild Coffee tomorrow at 10:00 (agreed)');
    expect(replayEvents(store.events(s.gameId)).invitations).toEqual(s.invitations);

    await session.act({ type: 'text', target: 'ren', text: 'beach at 4 tomorrow?' }); // Ren's shift: declined, no entry
    expect(session.state!.invitations.some(p => p.node === 'beach')).toBe(false);
    await session.act({ type: 'text', target: 'ren', text: 'beach tomorrow at 9pm?' });
    expect(session.state!.invitations.find(p => p.node === 'beach')).toMatchObject({ to: 'ren', slot: 'evening', status: 'accepted' });
    expect(replayEvents(store.events(s.gameId)).invitations).toEqual(session.state!.invitations);
  } finally { await close(); }
});

it('one group text plans with several housemates: each answers in their own thread and agrees for themselves', async () => {
  const { session, store, close } = await setup();
  try {
    await session.newGame({ seed: 21, moveInDay: false });
    const s0 = session.state!;
    const ids = Object.values(s0.characters).filter(c => !c.isPlayer && c.status === 'inHouse').map(c => c.id).slice(0, 3);
    for (const id of ids) for (const k of ['affinity', 'trust'] as const) rel(s0, id, s0.playerId)[k] = 90;
    await session.act({ type: 'text', target: ids[0], guests: ids.slice(1), text: 'Living room movie tomorrow at 9pm?' });
    const s = session.state!;
    for (const id of ids) expect(s.chats[[id, s.playerId].sort().join('|')]?.some(m => m.from === id)).toBe(true);
    const plans = s.invitations.filter(p => p.from === s.playerId && p.node === 'living');
    expect(plans.length).toBeGreaterThan(0);
    expect(plans.every(p => ids.includes(p.to) && p.slot === 'evening' && p.status === 'accepted')).toBe(true);
    expect(replayEvents(store.events(s.gameId)).invitations).toEqual(s.invitations);
    await expect(session.act({ type: 'text', target: ids[0], guests: [ids[0]], text: 'hi' })).rejects.toThrow(/not available/);
  } finally { await close(); }
});

it('reads full place names, scopes the invitation to its sentence, and lets you join someone already going there', () => {
  const s = createGame({ seed: 3 });
  s.world.episode = 2; s.world.slot = 'slot1'; s.world.weekday = 0;
  // "Dizengoff" and "Square" are each shared with another place; the whole name is not
  expect(proposedPlan(s, 'free to come to Dizengoff Square tomorrow 10 am?')).toEqual({ node: 'station', episode: 3, slot: 'slot1' });
  // telling them about a bar night, then asking something else, invites nobody to the bar
  expect(proposedPlan(s, 'Drinking at the bar later. Why, you want to hear some juicy gossip?')).toBeNull();
  const other = Object.values(s.characters).find((c) => !c.isPlayer && c.status === 'inHouse')!;
  const third = Object.values(s.characters).find((c) => !c.isPlayer && c.status === 'inHouse' && c.id !== other.id)!;
  s.invitations.push({ id: 'plan-x', from: other.id, to: third.id, episode: 2, slot: 'evening', node: 'livehouse', status: 'accepted' });
  expect(planConflict(s, other.id, { node: 'livehouse', episode: 2, slot: 'evening' })).toBe('');
  expect(planConflict(s, other.id, { node: 'bar', episode: 2, slot: 'evening' })).toBe('already has plans then');
});

it('adds, moves and calls off a plan the model read from texts, and replays it', async () => {
  const { session, store, close } = await setup();
  try {
    await session.newGame({ seed: 21, moveInDay: false });
    const P = session.state!.playerId;
    const read = vi.spyOn(session.gen, 'planRead');
    read.mockImplementation(async (s) => ({ plan: planFromWords(s, 'livehouse', 'tomorrow at 21:30')! }));
    await session.act({ type: 'text', target: 'ren', text: 'so a yes or no, am I coming tomorrow?' });
    const plan = session.state!.invitations.find((p) => [p.from, p.to].includes('ren') && [p.from, p.to].includes(P))!;
    expect(plan).toMatchObject({ node: 'livehouse', episode: session.state!.world.episode + 1, slot: 'evening', status: 'accepted' });
    read.mockImplementation(async (s) => ({ plan: planFromWords(s, 'bar', 'tomorrow at 20:30')! }));
    await session.act({ type: 'text', target: 'ren', text: 'actually the bar tomorrow works better' });
    expect(session.state!.invitations.filter((p) => p.id === plan.id)[0]).toMatchObject({ node: 'bar', status: 'accepted' });
    read.mockResolvedValue({ cancel: true });
    await session.act({ type: 'text', target: 'ren', text: "sorry, can't make it tomorrow" });
    expect(session.state!.invitations.find((p) => p.id === plan.id)!.status).toBe('declined');
    expect(replayEvents(store.events(session.state!.gameId)).invitations).toEqual(session.state!.invitations);
  } finally { await close(); }
});

it('keeps what a scene gave pairs the reading leaves out, and drops romance without attraction', () => {
  const empty = { affinityDeltas: [], romanceDeltas: [], tensionDeltas: [], trustDeltas: [], newMemories: [], moodDeltas: [] };
  const applied = { ...empty, trustDeltas: [{ from: 'hana', to: 'player', delta: 4.8 }], affinityDeltas: [{ from: 'hana', to: 'player', delta: 3 }] };
  const next = { ...empty, affinityDeltas: [{ from: 'hana', to: 'player', delta: 4 }] };
  const change = rereadChange(next, applied, FEELING_SCALE);
  expect(change.trustDeltas).toEqual([]); // trust the reading didn't mention stays as the scene left it
  expect(change.affinityDeltas).toEqual([{ from: 'hana', to: 'player', delta: 4 * FEELING_SCALE - 3 * FEELING_SCALE }]);
  const s = createGame({ seed: 3 });
  const [a, b] = Object.values(s.characters).filter((c) => !c.isPlayer && c.gender === 'man');
  const romance = dropUnattracted(s, { ...empty, romanceDeltas: [{ from: a.id, to: b.id, delta: 3 }] });
  expect(romance.romanceDeltas).toEqual(a.interestedIn.includes('man') ? [{ from: a.id, to: b.id, delta: 3 }] : []);
  // a flirt the listener liked earns romance from someone attracted to the player; from anyone else it doesn't
  const P = s.characters[s.playerId];
  const fan = Object.values(s.characters).find((c) => !c.isPlayer && c.interestedIn.includes(P.gender))!;
  const other = Object.values(s.characters).find((c) => !c.isPlayer && !c.interestedIn.includes(P.gender))!;
  const liked = { ...empty, affinityDeltas: [{ from: fan.id, to: P.id, delta: 2 }, { from: other.id, to: P.id, delta: 3 }] };
  const flirted = welcomedFlirts(s, [{ speaker: P.id, text: '"Yeah, missed me?" I say in a flirty tone.' }], liked);
  expect(flirted.romanceDeltas).toEqual([{ from: fan.id, to: P.id, delta: 2 }]);
  expect(welcomedFlirts(s, [{ speaker: P.id, text: 'Dinner at eight?' }], liked).romanceDeltas).toEqual([]);
});

async function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'roof-chat-plan-'));
  const store = new Store(openDb(':memory:'));
  const { app, session } = await buildApp({ llm: new MockLlm(), image: new MockImageBackend(dir), store, workflowHash: 'mock', cacheDir: dir, assetsDir: null });
  return { session, store, close: async () => { await app.close(); store.db.close(); rmSync(dir, { recursive: true, force: true }); } };
}

it('opens a player-started chat at the input and only speaks after the player', async () => {
  const { session, close } = await setup();
  try {
    await session.newGame({ seed: 21, moveInDay: false });
    const result = await session.act({ type: 'talk', target: 'ren', room: 'living' });
    const scene = result.scenes.find(s => s.isPlayerScene)!;
    const minutes = session.state!.world.minutes;
    const events: string[] = [];
    await session.stream(scene.id, kind => events.push(kind));
    const run = session.runs.get(scene.id)!;
    expect(events).toContain('choice');
    expect(events).not.toContain('line-end');
    expect(run.transcript).toEqual([]);
    expect(session.state!.world.minutes).toBe(minutes);
    session.choose(scene.id, { text: 'Would you like some coffee?', recipient: 'ren' });
    await session.stream(scene.id, () => {});
    expect(run.transcript[0]).toMatchObject({ speaker: session.state!.playerId, text: 'Would you like some coffee?' });
    expect(run.transcript.some(l => l.speaker === 'ren')).toBe(true);
  } finally { await close(); }
});

it.each([false, true])('persists a plan response during a conversation and replays it exactly (accept=%s)', async (accept) => {
  const { session, store, close } = await setup();
  try {
    await session.newGame({ seed: 11, moveInDay: false });
    for (let i = 0; i < 18 && !session.state!.invitations.some(p => p.to === session.state!.playerId && p.status === 'pending'); i++) {
      await session.act({ type: 'skip' });
      await session.endSlot();
    }
    const invitation = session.state!.invitations.find(p => p.to === session.state!.playerId && p.status === 'pending')!;
    expect(invitation).toBeDefined();
    const target = Object.values(session.state!.characters).find(c => !c.isPlayer && c.status === 'inHouse' && ROOMS.includes(c.location as typeof ROOMS[number]) && !['work', 'sleep', 'nap', 'shower'].includes(c.lastAction ?? ''))!;
    expect(target).toBeDefined();
    const result = await session.act({ type: 'talk', target: target.id, room: 'living' });
    const scene = result.scenes.find(s => s.isPlayerScene)!;
    await session.stream(scene.id, () => {});
    session.choose(scene.id, { text: 'Thanks for the invitation.', recipient: target.id });
    await session.stream(scene.id, () => {});
    const run = session.runs.get(scene.id)!;
    const transcript = structuredClone(run.transcript);
    const before = structuredClone(session.state!);
    const summaries = session.summaries();
    const action = { type: 'respondPlan' as const, id: invitation.id, accept };
    const response = await session.act(action);
    const expected = structuredClone(before);
    expected.invitations.find(p => p.id === invitation.id)!.status = accept ? 'accepted' : 'declined';
    expect(session.state).toEqual(expected);
    expect(response.scenes).toEqual(summaries);
    expect(session.runs.get(scene.id)).toBe(run);
    expect(run.transcript).toEqual(transcript);
    await expect(session.act(action)).rejects.toThrow(/no longer pending/);
    expect(session.state).toEqual(expected);
    expect(replayEvents(store.events(expected.gameId))).toEqual(expected);
    const saved = session.save(1, 'plan during chat');
    session.load(saved);
    expect(session.state).toEqual(expected);
    expect(session.runs.get(scene.id)!.transcript).toEqual(transcript);
  } finally { await close(); }
});
