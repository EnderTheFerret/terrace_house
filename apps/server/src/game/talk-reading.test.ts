import { expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../app';
import { openDb, Store } from '../db';
import { MockLlm } from '../llm/mock';
import { MockImageBackend } from '../image/mock';
import { replayEvents } from './replay';
import { FEELING_SCALE, type DeltaProposal } from '@shared-roof/shared';
import { deltaPrompt } from '../prompts/scene';
import { Generator } from './generate';
import { Budget } from '../llm/structured';

const empty = (): DeltaProposal => ({ affinityDeltas: [], romanceDeltas: [], tensionDeltas: [], trustDeltas: [], newMemories: [], moodDeltas: [] });

async function talk() {
  const dir = mkdtempSync(join(tmpdir(), 'roof-reading-'));
  const store = new Store(openDb(':memory:'));
  const { app, session } = await buildApp({ llm: new MockLlm(), image: new MockImageBackend(dir), store, workflowHash: 'mock', cacheDir: dir });
  await session.newGame({ seed: 7 });
  const result = await session.act({ type: 'idle' });
  const scene = result.scenes[0];
  await session.stream(scene.id, () => {});
  const other = scene.participants.find((id) => id !== session.state!.playerId)!;
  return { session, store, scene, other, close: async () => { await app.close(); store.db.close(); rmSync(dir, { recursive: true, force: true }); } };
}

it.each([[-6, 'You are an idiot. I cannot stand you.'], [6, 'Your coffee smells amazing, thank you.']])('reads typed words after an instant close and applies only the difference (%s)', async (delta, words) => {
  const { session, store, scene, other, close } = await talk();
  try {
    const player = session.state!.playerId;
    const opening = session.state!.rel[other][player].affinity;
    session.choose(scene.id, { text: words });
    await session.stream(scene.id, () => {});
    let answer!: (p: DeltaProposal) => void;
    const reading = vi.spyOn(session.gen, 'deltas').mockImplementation(() => new Promise(resolve => { answer = resolve; }));
    const commentary = vi.spyOn(session.gen, 'commentary');
    const shot = vi.spyOn(session.gen, 'shot');
    session.choose(scene.id, { done: true });
    const emitted: string[] = [];
    await session.stream(scene.id, kind => emitted.push(kind));
    expect(emitted).toContain('done');
    expect(session.busy).toBe(false);
    expect(commentary).not.toHaveBeenCalled(); expect(shot).not.toHaveBeenCalled();
    expect(reading).toHaveBeenCalledOnce();
    expect(reading.mock.calls[0][2].some(l => l.speaker === player && l.text === words)).toBe(true);
    expect(session.dayLog().scenes.find(s => s.id === scene.id)!.reading).toBe('pending');
    await expect(session.reread(scene.id)).rejects.toThrow(/still being read/);
    await session.endSlot();
    const afterClose = session.state!.rel[other][player].affinity;
    const applied = store.events(session.state!.gameId).find(e => e.kind === 'scene' && e.payload.eventId === scene.id)!.payload.proposal as DeltaProposal;
    const oldDelta = applied.affinityDeltas.filter(d => d.from === other && d.to === player).reduce((sum, d) => sum + d.delta, 0);
    const proposal = { ...empty(), affinityDeltas: [{ from: other, to: player, delta }], newMemories: [{ charId: other, text: `Remembered: ${words}`, salience: 0.6 }] };
    answer(proposal);
    await vi.waitFor(() => expect(session.dayLog().scenes.find(s => s.id === scene.id)!.reading).toBe('applied'));
    expect(session.state!.rel[other][player].affinity).toBeCloseTo(afterClose + FEELING_SCALE * (delta - oldDelta), 5);
    expect(delta < 0 ? session.state!.rel[other][player].affinity < opening : session.state!.rel[other][player].affinity > opening).toBe(true);
    expect(session.state!.memory[other].some(m => m.text === `Remembered: ${words}`)).toBe(true);
    expect(replayEvents(store.events(session.state!.gameId))).toEqual(session.state);
    // Manual re-read replaces the automatic read, rather than subtracting the old template twice.
    reading.mockResolvedValue({ ...proposal, affinityDeltas: [{ from: other, to: player, delta: delta + 2 }] });
    const before = session.state!.rel[other][player].affinity;
    await session.reread(scene.id);
    expect(session.state!.rel[other][player].affinity).toBeCloseTo(before + 2 * FEELING_SCALE, 5);
    expect(replayEvents(store.events(session.state!.gameId))).toEqual(session.state);
    const save = session.save(1, 'after reading');
    const saved = structuredClone(session.state);
    session.load(save);
    expect(session.state).toEqual(saved);
  } finally { await close(); }
});

it.each(['empty', 'zero', 'invalid', 'offline', 'error'])('keeps the engine outcome for an unusable reading (%s)', async (mode) => {
  const { session, store, scene, other, close } = await talk();
  try {
    session.choose(scene.id, { text: 'Hello, how are you?' });
    await session.stream(scene.id, () => {});
    const proposal = empty();
    if (mode === 'zero') proposal.affinityDeltas.push({ from: other, to: session.state!.playerId, delta: 0 });
    if (mode === 'invalid') proposal.affinityDeltas.push({ from: 'unknown', to: session.state!.playerId, delta: -15 });
    const spy = vi.spyOn(session.gen, 'deltas');
    if (mode === 'error') spy.mockRejectedValue(new Error('model unavailable'));
    else spy.mockResolvedValue(mode === 'offline' ? null : proposal);
    session.choose(scene.id, { done: true });
    await session.stream(scene.id, () => {});
    const before = structuredClone(session.state);
    await vi.waitFor(() => expect(session.dayLog().scenes.find(s => s.id === scene.id)!.reading).toBe('fallback'));
    expect(session.state).toEqual(before);
    expect(replayEvents(store.events(session.state!.gameId))).toEqual(session.state);
  } finally { await close(); }
});

it('skips a reading when the player never typed, and ignores results from a discarded save branch', async () => {
  const { session, store, scene, other, close } = await talk();
  try {
    const spy = vi.spyOn(session.gen, 'deltas');
    const save = session.save(1, 'before reading');
    session.choose(scene.id, { done: true, hangout: true });
    await session.stream(scene.id, () => {});
    expect(spy).not.toHaveBeenCalled();
    session.load(save);
    const id = session.summaries()[0].id;
    expect(id).toBe(scene.id);
    await session.stream(id, () => {});
    session.choose(id, { text: 'I hate you.' });
    await session.stream(id, () => {});
    let answer!: (p: DeltaProposal) => void;
    spy.mockImplementation(() => new Promise(resolve => { answer = resolve; }));
    session.choose(id, { done: true });
    await session.stream(id, () => {});
    session.load(save);
    const before = structuredClone(session.state);
    answer({ ...empty(), affinityDeltas: [{ from: other, to: session.state!.playerId, delta: -10 }] });
    await new Promise(resolve => setImmediate(resolve));
    expect(session.state).toEqual(before);
    expect(store.events(session.state!.gameId).some(e => e.kind === 'reading')).toBe(false);
  } finally { await close(); }
});

it('keeps early typed words in the reading prompt even after a long group conversation', async () => {
  const { session, scene, close } = await talk();
  try {
    const run = session.runs.get(scene.id)!;
    const words = Array.from({ length: 30 }, (_, i) => `message ${i}: ${'ordinary detail '.repeat(10)}`);
    const transcript = [{ speaker: session.state!.playerId, text: 'I hate you.' }, ...words.map(text => ({ speaker: session.state!.playerId, text })), ...Array.from({ length: 20 }, () => ({ speaker: 'ren', text: 'Later words.' }))];
    const prompt = deltaPrompt(session.state!, run.ev, transcript, {});
    expect(prompt).toContain('I hate you.');
    words.forEach(text => expect(prompt).toContain(text));
  } finally { await close(); }
});

it('defers a completed reading until an in-flight scene segment releases its state', async () => {
  const { session, store, scene, other, close } = await talk();
  try {
    session.choose(scene.id, { text: 'Thank you for showing me around.' });
    await session.stream(scene.id, () => {});
    let answer!: (p: DeltaProposal) => void;
    vi.spyOn(session.gen, 'deltas').mockImplementation(() => new Promise(resolve => { answer = resolve; }));
    session.choose(scene.id, { done: true });
    await session.stream(scene.id, () => {});
    await session.endSlot();
    const next = await session.act({ type: 'talk', target: other });
    const nextId = next.scenes.find(s => s.isPlayerScene)!.id;
    let release!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const original = session.gen.beatSheet.bind(session.gen);
    const sheet = vi.spyOn(session.gen, 'beatSheet').mockImplementation(async (...args) => { await blocked; return original(...args); });
    const segment = session.stream(nextId, () => {});
    await vi.waitFor(() => expect(sheet).toHaveBeenCalled());
    answer({ ...empty(), affinityDeltas: [{ from: other, to: session.state!.playerId, delta: 6 }] });
    await new Promise(resolve => setImmediate(resolve));
    expect(session.busy).toBe(true);
    expect(store.events(session.state!.gameId).some(e => e.kind === 'reading')).toBe(false);
    release();
    await segment;
    expect(store.events(session.state!.gameId).filter(e => e.kind === 'reading')).toHaveLength(1);
    expect(replayEvents(store.events(session.state!.gameId))).toEqual(session.state);
  } finally { await close(); }
});

it('lowers affinity for a direct insult even when the real generator receives an empty model answer', async () => {
  const { session, store, scene, other, close } = await talk();
  try {
    session.choose(scene.id, { text: 'You are an idiot. I hate you.', recipient: other });
    await session.stream(scene.id, () => {});
    const mock = new MockLlm();
    const reader = new Generator({ name: 'empty-model', health: async () => true, complete: async () => JSON.stringify(empty()), stream: mock.stream.bind(mock) });
    vi.spyOn(session.gen, 'deltas').mockImplementation(reader.deltas.bind(reader));
    const before = session.state!.rel[other][session.state!.playerId].affinity;
    session.choose(scene.id, { done: true });
    await session.stream(scene.id, () => {});
    await vi.waitFor(() => expect(session.dayLog().scenes.find(s => s.id === scene.id)!.reading).toBe('applied'));
    expect(session.state!.rel[other][session.state!.playerId].affinity).toBeLessThan(before);
    expect(replayEvents(store.events(session.state!.gameId))).toEqual(session.state);
  } finally { await close(); }
});

it('uses the selected dialogue model for readings when planning and dialogue models differ', async () => {
  const { session, scene, other, close } = await talk();
  try {
    const mock = new MockLlm();
    const planning = { name: 'planning', health: async () => true, complete: vi.fn(mock.complete.bind(mock)), stream: mock.stream.bind(mock) };
    const proposal = { ...empty(), affinityDeltas: [{ from: other, to: session.state!.playerId, delta: 4 }] };
    const dialogue = { ...planning, name: 'dialogue', complete: vi.fn(async () => JSON.stringify(proposal)) };
    const reader = new Generator(planning, dialogue);
    expect(await reader.deltas(session.state!, session.runs.get(scene.id)!.ev, [], {}, new Budget(2))).toEqual(proposal);
    expect(dialogue.complete).toHaveBeenCalledOnce();
    expect(planning.complete).not.toHaveBeenCalled();
  } finally { await close(); }
});
