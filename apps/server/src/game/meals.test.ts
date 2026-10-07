import { expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGame, housemates, planHouseMeal } from '@shared-roof/shared';
import { buildApp } from '../app';
import { openDb, Store } from '../db';
import { MockLlm } from '../llm/mock';
import { MockImageBackend } from '../image/mock';
import { replayEvents } from './replay';
import { applyCharacterSnapshot } from './personas';

it.each(['load', 'resume'] as const)('enables meals on %s of a first-day save without advancing arrivals or repeating migration', async mode => {
  const dir = mkdtempSync(join(tmpdir(), 'roof-meals-'));
  const store = new Store(openDb(':memory:'));
  const { app, session } = await buildApp({ llm: new MockLlm(), image: new MockImageBackend(dir), store, workflowHash: 'mock', cacheDir: dir });
  try {
    const opts = { seed: 7, moveInDay: true, moveInVersion: 2 as const, gameId: 'saved-move-in' };
    const old = createGame(opts);
    const seq = store.appendEvent(old.gameId, 'new', opts);
    const resume = { participants: housemates(old).map(c => c.id), transcript: [{ speaker: old.playerId, text: 'Welcome home.' }] };
    const id = store.save(mode === 'resume' ? 0 : 2, old, 'first day', seq, resume);
    // An abandoned branch after this save must not enter the resumed replay.
    store.appendEvent(old.gameId, 'time', { lines: 1, minutesPerLine: 5 });
    if (mode === 'load') session.load(id); else expect(session.resumeLatest()).toBe(true);
    const expected = structuredClone(old);
    expected.world.flags.communalMeals = true;
    expect(session.state).toEqual(expected);
    expect(Object.values(session.state!.characters).some(c => c.status === 'arriving')).toBe(true);
    expect(planHouseMeal(session.state!).plan.scenes).toEqual([]);
    expect(replayEvents(store.events(old.gameId))).toEqual(expected);
    expect(store.latestAutosave()!.resume).toEqual(resume);
    const migrated = store.latestAutosave()!;
    session.load(migrated.row.id);
    session.resumeLatest();
    expect(store.events(old.gameId).filter(e => e.kind === 'meal-routines')).toHaveLength(1);
    expect(session.state).toEqual(expected);
  } finally { await app.close(); store.db.close(); rmSync(dir, { recursive: true, force: true }); }
});

it('offers breakfast automatically, resumes an unserved save, feeds once and replays exactly', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'roof-meals-'));
  const store = new Store(openDb(':memory:'));
  const { app, session } = await buildApp({ llm: new MockLlm(), image: new MockImageBackend(dir), store, workflowHash: 'mock', cacheDir: dir });
  try {
    await session.newGame({ seed: 7, moveInDay: false });
    await session.act({ type: 'sleep' });
    await session.endSlot();
    expect(session.state!.world.episode).toBe(2);
    for (const c of housemates(session.state!)) {
      c.persona.routine.jobSlots = []; c.lastAction = 'hobby'; c.location = 'living'; c.activityUntil = 180;
      applyCharacterSnapshot(session.state!, c);
      store.appendEvent(session.state!.gameId, 'generated-character', { character: c });
    }
    const pulse = await session.worldPulse(Date.now() + 30000);
    const breakfast = pulse.scenes.find(s => s.title === 'breakfast together')!;
    expect(breakfast).toBeDefined();
    expect(breakfast.participants).toHaveLength(3);
    expect(session.state!.world.flags.mealBreakfast).toBeUndefined();
    expect(replayEvents(store.events(session.state!.gameId))).toEqual(session.state);
    const saved = session.save(3, 'breakfast is ready');
    session.load(saved);
    const meal = session.summaries().find(s => s.title === 'breakfast together')!;
    expect(meal.id).toBe(breakfast.id);
    expect(meal.participants).toEqual(breakfast.participants);
    await session.stream(meal.id, () => {});
    session.choose(meal.id, { listen: true });
    await session.stream(meal.id, () => {});
    session.choose(meal.id, { done: true });
    await session.stream(meal.id, () => {});
    await session.endSlot();
    expect(session.state!.world.flags.mealBreakfast).toBe(2);
    expect(session.state!.log.filter(l => l.kind === 'domestic' && l.text.includes('shared breakfast'))).toHaveLength(1);
    expect(replayEvents(store.events(session.state!.gameId))).toEqual(session.state);
    const again = await session.worldPulse(Date.now() + 60000);
    expect(again.scenes.filter(s => s.title === 'breakfast together' && s.phase !== 'done')).toEqual([]);
    expect(replayEvents(store.events(session.state!.gameId))).toEqual(session.state);
  } finally { await app.close(); store.db.close(); rmSync(dir, { recursive: true, force: true }); }
});
