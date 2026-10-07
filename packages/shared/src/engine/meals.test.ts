import { expect, it } from 'vitest';
import { createGame, finishSlot, planHouseMeal, planSlot, resolveScene } from './loop';
import { housemates } from './core';
import { canEat } from './cooking';
import { content } from '../content';
import { GameState } from '../model';
import { simulateSeason } from '../sim/season';

function freeHouse(episode = 2) {
  const s = createGame({ seed: 7, moveInDay: false, communalMeals: true });
  s.world.episode = episode;
  s.world.weekday = 1;
  if (episode === 1) s.world.flags.moveIn = Object.keys(s.characters).join(',');
  for (const c of housemates(s)) {
    c.location = 'living'; c.lastAction = 'hobby'; c.activityUntil = 0;
    c.persona.routine.jobSlots = []; c.needs.hunger = 80;
  }
  return s;
}

it('breakfast gathers only one or two free housemates, without disrupting work, sleep or outings', () => {
  const s = freeHouse();
  const others = housemates(s).filter(c => !c.isPlayer);
  others[0].persona.routine.jobSlots = [{ slot: 'morning', weekdays: [1] }];
  others[1].lastAction = 'sleep'; others[1].activityUntil = 90;
  others[2].location = 'park'; others[2].lastAction = 'goOut'; others[2].activityUntil = 180;
  const r = planSlot(s, { type: 'house', activity: 'hangout' });
  const ev = r.plan.scenes[0].event;
  expect(ev.title).toBe('breakfast together');
  expect(ev.participants).toEqual([s.playerId, others[3].id, others[4].id]);
  for (const c of others.slice(0, 3)) expect(r.state.characters[c.id]).toEqual(c);
  expect(ev.participants.every(id => r.state.characters[id].location === 'kitchen')).toBe(true);
});

it('dinner includes every free resident and excludes shifts and active private routines', () => {
  const s = freeHouse(); s.world.slot = 'evening';
  const others = housemates(s).filter(c => !c.isPlayer);
  others[0].persona.routine.jobSlots = [{ slot: 'evening', weekdays: [1] }];
  others[1].lastAction = 'shower'; others[1].activityUntil = 20;
  const r = planHouseMeal(s);
  expect(r.plan.scenes[0].event.participants).toEqual([s.playerId, ...others.slice(2).map(c => c.id)]);
  const all = freeHouse(); all.world.slot = 'evening';
  expect(planHouseMeal(all).plan.scenes[0].event.participants).toHaveLength(6);
});

it('meals leave accepted plans, overnight trips and explicit conversations alone', () => {
  const s = freeHouse(); s.world.slot = 'evening';
  s.invitations.push({ id: 'dinner-out', from: 'ren', to: 'mio', episode: 2, slot: 'evening', node: 'cafe', status: 'accepted' });
  s.world.flags.away_shun = 'galilee';
  s.characters.shun.location = 'galilee'; s.characters.shun.lastAction = 'goOut'; s.characters.shun.activityUntil = 0;
  const ev = planHouseMeal(s).plan.scenes[0].event;
  expect(ev.participants).not.toContain('ren');
  expect(ev.participants).not.toContain('mio');
  expect(ev.participants).not.toContain('shun');
  const talked = planSlot(freeHouse(), { type: 'talk', target: 'ren' });
  expect(talked.plan.scenes.some(p => p.event.tags.includes('communal-meal'))).toBe(false);
  const first = freeHouse(1);
  expect(() => planSlot(first, { type: 'graduate' })).toThrow(/welcome dinner/);
});

it('breakfast can be an NPC meal when the player has an early shift, and students can eat before lectures', () => {
  const s = freeHouse();
  s.world.playerJob = { nodeId: 'cafe', slot: 'morning', weekdays: [1], wage: 110 };
  const r = planHouseMeal(s);
  expect(r.plan.scenes[0].event.participants).not.toContain(s.playerId);
  expect(r.plan.scenes[0].render).toBe(false);
  expect(r.plan.scenes[0].event.participants).toHaveLength(2);
  s.world.playerJob = null; s.characters[s.playerId].occupation = 'University student';
  expect(planHouseMeal(s).plan.scenes[0].event.participants).toContain(s.playerId);
  s.world.slot = 'slot1';
  expect(planHouseMeal(s).plan.scenes).toEqual([]);
});

it('first-night dinner gathers all six, overrides outside plans, and cannot be skipped or slept through', () => {
  const s = freeHouse(1); s.world.slot = 'evening';
  for (const c of housemates(s)) { c.location = 'cafe'; c.lastAction = 'work'; c.activityUntil = 180; }
  const r = planSlot(s, { type: 'sleep' });
  const ev = r.plan.scenes[0].event;
  expect(ev.tags).toContain('welcome-dinner');
  expect(ev.participants).toHaveLength(6);
  expect(r.plan.scenes[0].render).toBe(true);
  expect(housemates(r.state).every(c => c.location === 'kitchen' && c.lastAction === 'eat')).toBe(true);
  expect(() => finishSlot(s)).toThrow(/welcome dinner/);
  const before = freeHouse(1); before.world.slot = 'slot3'; before.world.minutes = 180;
  before.world.flags.sleepUntilMorning = true;
  const stopped = finishSlot(before);
  expect(stopped.world.slot).toBe('evening');
  expect(stopped.world.flags.sleepUntilMorning).toBeUndefined();
});

it('welcome dinner waits for everyone to arrive and for their introductions', () => {
  const s = createGame({ seed: 7, moveInDay: true, communalMeals: true }); s.world.slot = 'evening';
  expect(planHouseMeal(s).plan.scenes).toEqual([]);
  for (const c of Object.values(s.characters)) c.status = 'inHouse';
  expect(planHouseMeal(s).plan.scenes).toEqual([]);
  for (const c of housemates(s)) s.world.flags[`introduced_${c.id}`] = true;
  expect(planHouseMeal(s).plan.scenes[0].event.participants).toHaveLength(6);
});

it('meals feed everyone once, spend groceries, add dishes and memories, and finish eating time', () => {
  const s = freeHouse(1); s.world.slot = 'evening'; s.house.fridge = {};
  for (const c of housemates(s)) { c.persona.diet = 'vegan'; c.persona.kashrut = 'strict'; c.persona.keepsShabbat = true; }
  s.world.weekday = 5; s.house.kitchen.meatPanClean = false; s.house.kitchen.dairyPanClean = false;
  const r = planHouseMeal(s); const ev = r.plan.scenes[0].event;
  const result = resolveScene(r.state, ev, {}, {}).state;
  expect(result.world.minutes).toBe(40);
  expect(result.house.groceryBudget).toBe(s.house.groceryBudget - 24);
  expect(result.house.dishes).toBe(s.house.dishes + 18);
  const recipe = content().recipes.find(r => r.id === 'onigiri-set')!;
  for (const id of ev.participants) {
    expect(canEat(result.characters[id], recipe)).toBe(true);
    expect(result.characters[id].needs.hunger).toBe(50);
    expect(result.memory[id].some(m => m.text.includes('shared dinner'))).toBe(true);
  }
  expect(planHouseMeal(result).plan.scenes).toEqual([]);
  const twice = resolveScene(result, ev, {}, {}).state;
  expect(twice.house.groceryBudget).toBe(result.house.groceryBudget);
  expect(twice.house.dishes).toBe(result.house.dishes);
  expect(twice.characters[s.playerId].needs.hunger).toBe(50);
});

it('unserved meals survive a saved-state round trip and the next day has a new breakfast', () => {
  const s = freeHouse();
  const pending = planHouseMeal(s);
  const loaded = JSON.parse(JSON.stringify(pending.state));
  const resumed = planHouseMeal(loaded);
  expect(resumed.plan.scenes[0].event.participants).toEqual(pending.plan.scenes[0].event.participants);
  const done = resolveScene(resumed.state, resumed.plan.scenes[0].event, {}, {}).state;
  expect(planHouseMeal(done).plan.scenes).toEqual([]);
  done.world.episode++; done.world.minutes = 0;
  expect(planHouseMeal(done).plan.scenes[0].event.title).toBe('breakfast together');
});

it('does not consume or certify unmarked fridge food for the shared kosher spread', () => {
  const s = freeHouse();
  s.house.kitchen.kosherShelf = [];
  const fridge = structuredClone(s.house.fridge);
  const meal = planHouseMeal(s);
  const result = resolveScene(meal.state, meal.plan.scenes[0].event, {}, {}).state;
  expect(result.house.fridge).toEqual(fridge);
  expect(result.house.kitchen.kosherShelf).toEqual([]);
  expect(result.house.groceryBudget).toBeLessThan(s.house.groceryBudget);
  expect(result.characters[s.playerId].needs.hunger).toBe(50);
});

it('shared meals remain deterministic and schema-valid through multiple days', () => {
  const run = (seed: number) => simulateSeason({ seed, communalMeals: true, seasonLength: 8, policy: {
    action: s => ['morning', 'evening'].includes(s.world.slot) ? { type: 'house', activity: 'hangout' } : { type: 'skip' },
  } });
  for (const seed of [1, 7, 21]) {
    const result = run(seed);
    expect(GameState.safeParse(result.state).success).toBe(true);
    expect(result.state.seasonOver).toBe(true);
    expect(result.state.log.some(l => l.kind === 'domestic' && l.text.includes('shared breakfast'))).toBe(true);
    expect(result.state.log.some(l => l.kind === 'domestic' && l.text.includes('shared dinner'))).toBe(true);
  }
  expect(run(7)).toEqual(run(7));
});
