import { describe, expect, it } from 'vitest';
import { GameState, HOUSEHOLD_ACTIVITIES, PlayerAction } from '../model';
import { content } from '../content';
import { mulberry32 } from '../rng';
import { candidateActions, pull, queueNpcPlans } from './agents';
import { HOUSEHOLD, completeHouseholds, householdProblem, joinHousehold, startHousehold, startNpcHouseholds } from './household';
import { createGame, makeEvent, passTime, planSlot, resolveScene } from './loop';
import { addFact, housemates, learn, player, rel } from './core';
import { interactionProposal, jealousyReason, logInteraction, rememberInteraction, resolveColocation } from './interactions';
import { projectForPlayer } from './view';
import { apologize, decayGrudges } from './social';

const empty = { affinityDeltas: [], romanceDeltas: [], trustDeltas: [], tensionDeltas: [], moodDeltas: [], newMemories: [] };
function home() {
  const s = createGame({ seed: 21 });
  s.world.episode = 2; s.world.slot = 'slot1'; s.world.weekday = 0; s.world.minutes = 0; s.world.weather = 'sunny';
  s.world.flags.startedBlock = '2:slot1';
  for (const c of Object.values(s.characters)) {
    c.status = 'inHouse'; c.location = 'living'; c.lastAction = 'hobby'; c.activityUntil = 180;
    c.persona.routine.jobSlots = []; c.persona.keepsShabbat = false; c.persona.diet = 'omnivore'; c.persona.kashrut = 'none'; c.needs.hunger = 80;
  }
  s.house.fridge = Object.fromEntries(content().recipes.flatMap(r => Object.keys(r.ingredients)).map(k => [k, 100]));
  s.house.kitchen.kosherShelf = Object.keys(s.house.fridge);
  return s;
}

describe('ordinary shared activities', () => {
  it.each(HOUSEHOLD_ACTIVITIES)('%s works alone without a minigame or compulsory conversation', activity => {
    const s = home();
    const result = planSlot(s, { type: 'household', activity });
    expect(result.plan.scenes).toHaveLength(0);
    expect(result.state.world.minutes).toBe(HOUSEHOLD[activity].minutes);
    expect(player(result.state).actionHousehold).toBeUndefined();
    expect(result.state.log.some(l => l.templateId === `household-${activity}` && l.participants.includes(s.playerId))).toBe(true);
    expect(GameState.safeParse(result.state).success).toBe(true);
    expect(s.world.minutes).toBe(0);
  });

  it('finishes dishes during typed conversation and never completes twice', () => {
    const s = home(); s.house.dishes = 80;
    const other = housemates(s).find(c => !c.isPlayer)!;
    const { state, plan } = planSlot(s, { type: 'household', activity: 'dishes', target: other.id });
    expect(plan.scenes[0].event.premise).toContain('while doing it');
    expect(state.house.dishes).toBe(80);
    expect(state.world.minutes).toBe(2);
    const during = passTime(state, 3, [s.playerId, other.id]);
    expect(during.house.dishes).toBe(40);
    expect(during.house.choreLedger[s.playerId].done).toBe(s.house.choreLedger[s.playerId].done + 0.5);
    const completed = resolveScene(during, plan.scenes[0].event, empty, {}).state;
    expect(completed.house.dishes).toBe(40);
    expect(completed.log.filter(l => l.templateId === 'household-dishes')).toHaveLength(1);
    expect(completed.memory[other.id].some(m => m.text.includes('wash dishes'))).toBe(true);
  });

  it('finishes the remaining chore time when the player ends the talk early', () => {
    const s = home(); s.house.laundry = 80;
    const other = housemates(s).find(c => !c.isPlayer)!;
    const result = planSlot(s, { type: 'household', activity: 'laundry', target: other.id });
    const end = resolveScene(result.state, result.plan.scenes[0].event, empty, {}).state;
    expect(end.world.minutes).toBe(20);
    expect(end.house.laundry).toBe(45);
    expect(end.house.choreLedger[other.id].done).toBe(s.house.choreLedger[other.id].done + 0.5);
  });

  it('joins a housemate partway through a meal, consumes ingredients once and feeds both plus other residents', () => {
    const s = home(); const cook = housemates(s).find(c => !c.isPlayer)!;
    expect(startHousehold(s, mulberry32(4), cook, 'meal')).toBe(true);
    const reserved = structuredClone(s.house.fridge);
    s.world.minutes = 15;
    const r = planSlot(s, { type: 'household', activity: 'meal', target: cook.id, join: true });
    expect(r.state.house.fridge).toEqual(reserved);
    const end = resolveScene(r.state, r.plan.scenes[0].event, empty, {}).state;
    expect(end.world.minutes).toBe(40);
    expect(end.house.fridge).toEqual(reserved);
    expect(end.characters[cook.id].needs.hunger).toBe(50);
    expect(player(end).needs.hunger).toBe(50);
    expect(housemates(end).filter(c => c.needs.hunger === 50).length).toBeGreaterThanOrEqual(3);
    expect(end.log.filter(l => l.templateId === 'household-meal')).toHaveLength(1);
  });

  it('chooses a meal a vegan cooking partner can share', () => {
    const s = home(); const other = housemates(s).find(c => !c.isPlayer)!; other.persona.diet = 'vegan';
    const r = planSlot(s, { type: 'household', activity: 'meal', target: other.id });
    const recipe = content().recipes.find(x => x.id === player(r.state).actionRecipe)!;
    expect(recipe.diet).toBe('vegan');
    const end = resolveScene(r.state, r.plan.scenes[0].event, empty, {}).state;
    expect(end.characters[other.id].needs.hunger).toBe(50);
  });

  it('shares one meal when NPC cooks independently choose the kitchen, reserving only one set of ingredients', () => {
    const s = home(); const [a, b, c] = housemates(s).filter(c => !c.isPlayer);
    startHousehold(s, mulberry32(3), a, 'meal');
    const reserved = structuredClone(s.house.fridge);
    expect(householdProblem(s, b, 'meal')).toMatch(/already cooking/);
    const actions = { [b.id]: { kind: 'cook' as const }, [c.id]: { kind: 'cook' as const } };
    startNpcHouseholds(s, mulberry32(3), actions);
    expect(b.actionHouseholdOwner).toBe(a.id);
    expect(actions[c.id].kind).toBe('retreat');
    expect(s.house.fridge).toEqual(reserved);
    const recipe = content().recipes.find(r => r.id === a.actionRecipe)!;
    s.world.minutes = 40; completeHouseholds(s);
    expect(housemates(s).filter(person => person.needs.hunger === 50)).toHaveLength(Math.min(recipe.serves, housemates(s).length));
  });

  it('joining respects the reserved meal’s kitchen preparation and the helper’s routine', () => {
    const s = home(); const [cook, helper] = housemates(s).filter(c => !c.isPlayer);
    startHousehold(s, mulberry32(3), cook, 'meal');
    helper.persona.kashrut = 'strict'; s.house.kitchen.kosherShelf = [];
    expect(joinHousehold(s, helper, cook)).toBe(false);
    expect(helper.actionHousehold).toBeUndefined();
    helper.persona.kashrut = 'none'; helper.persona.keepsShabbat = true;
    s.world.weekday = 6; s.world.slot = 'slot1';
    expect(joinHousehold(s, helper, cook)).toBe(false);
  });

  it('lets NPCs choose specific chores and join one another, including in fallback mode', () => {
    const s = home(); const [a, b] = housemates(s).filter(c => !c.isPlayer);
    expect(candidateActions(s, a).filter(x => x.kind === 'household')).toHaveLength(HOUSEHOLD_ACTIVITIES.length);
    startHousehold(s, mulberry32(3), a, 'laundry');
    expect(candidateActions(s, b)).toContainEqual({ kind: 'household', household: 'laundry', target: a.id, duration: 20 });
    b.activityUntil = 0;
    queueNpcPlans(s, { [b.id]: { kind: 'household', household: 'laundry', target: a.id } });
    const after = passTime(s, 1, [a.id], 5);
    expect(after.characters[b.id].actionHouseholdOwner).toBe(a.id);
    expect(after.characters[a.id].actionCompanion).toBe(b.id);
  });

  it('NPC meal completion actually serves food while the player is elsewhere', () => {
    const s = home(); const cook = housemates(s).find(c => !c.isPlayer)!;
    s.house.fridge = { ...content().recipes.find(r => r.id === 'nabe')!.ingredients };
    cook.activityUntil = 0;
    queueNpcPlans(s, { [cook.id]: { kind: 'household', household: 'meal' } });
    const after = passTime(s, 8, [], 5);
    expect(after.log.some(l => l.templateId === 'household-meal' && l.participants.includes(cook.id))).toBe(true);
    expect(player(after).needs.hunger).toBe(50);
  });

  it('refusals respect busyness and grudges without moving or feeding the invited housemate', () => {
    const s = home(); const other = housemates(s).find(c => !c.isPlayer)!; other.lastAction = 'work';
    const result = planSlot(s, { type: 'household', activity: 'music', target: other.id });
    expect(result.plan.scenes).toHaveLength(0);
    expect(result.state.log.at(-1)?.text).toContain('declined');
    expect(result.state.characters[other.id].location).toBe('living');
    other.lastAction = 'hobby'; s.grudges[`${other.id}>${s.playerId}`] = { strength: 30, since: 2, reason: 'needed some space' };
    expect(planSlot(s, { type: 'household', activity: 'music', target: other.id }).state.log.at(-1)?.text).toContain('space');
  });

  it('checks block time, weather, ingredients and both people’s Shabbat routines', () => {
    const s = home(); s.world.minutes = 175;
    expect(() => planSlot(s, { type: 'household', activity: 'clean' })).toThrow(/enough time/);
    s.world.minutes = 0; s.world.weather = 'rain';
    expect(householdProblem(s, player(s), 'plants')).toMatch(/rain/);
    s.house.fridge = {};
    expect(householdProblem(s, player(s), 'meal')).toMatch(/ingredients/);
    s.world.weekday = 5; s.world.slot = 'slot3'; s.world.minutes = 110; player(s).persona.keepsShabbat = true;
    expect(householdProblem(s, player(s), 'meal')).toMatch(/Shabbat/);
    expect(PlayerAction.safeParse({ type: 'household', activity: 'made-up' }).success).toBe(false);
  });

  it('persists reserved ingredients and completion deadlines through a save round trip', () => {
    const s = home(); const cook = housemates(s).find(c => !c.isPlayer)!;
    startHousehold(s, mulberry32(3), cook, 'meal');
    const loaded = GameState.parse(JSON.parse(JSON.stringify(s)));
    const one = passTime(s, 8, [], 5); const two = passTime(loaded, 8, [], 5);
    expect(two).toEqual(one);
  });

  it('keeps activity completion deterministic when time advances in small pieces', () => {
    const s = home(); const other = housemates(s).find(c => !c.isPlayer)!;
    startHousehold(s, mulberry32(3), player(s), 'dishes', other);
    const once = passTime(s, 4, [other.id], 5);
    let pieces = s;
    for (let i = 0; i < 4; i++) pieces = passTime(pieces, 1, [other.id], 5);
    expect(pieces).toEqual(once);
  });

  it('shows active chores publicly but protects private room activity', () => {
    const s = home(); const other = housemates(s).find(c => !c.isPlayer)!;
    startHousehold(s, mulberry32(3), other, 'dishes');
    expect(projectForPlayer(s).characters.find(c => c.id === other.id)?.activityLabel).toBe('wash dishes');
    other.location = 'bedroomW';
    expect(projectForPlayer(s).characters.find(c => c.id === other.id)?.household).toBeUndefined();
  });

  it('does not award the shared-time bonus repeatedly in one block', () => {
    const s = home(); const other = housemates(s).find(c => !c.isPlayer)!;
    startHousehold(s, mulberry32(3), player(s), 'dishes', other); s.world.minutes = 15; completeHouseholds(s);
    const close = rel(s, s.playerId, other.id).closeness;
    startHousehold(s, mulberry32(3), player(s), 'sort', other); s.world.minutes = 35; completeHouseholds(s);
    expect(rel(s, s.playerId, other.id).closeness).toBe(close);
  });
});

describe('daily social realism', () => {
  it('keeps cold shoulders in memory and avoidance, with apologies helping repair them', () => {
    const s = home(); const [a, b] = housemates(s).filter(c => !c.isPlayer);
    const before = pull(s, b, a);
    rememberInteraction(s, a.id, b.id, 'cold', 'A kept their distance over an unresolved disagreement.');
    expect(pull(s, b, a)).toBeLessThan(before);
    expect(s.memory[b.id].at(-1)?.text).toContain('distance');
    s.world.episode++; decayGrudges(s);
    expect(s.grudges[`${b.id}>${a.id}`]).toBeDefined();
    apologize(s, mulberry32(4), a.id, b.id);
    expect(s.grudges[`${b.id}>${a.id}`]?.strength ?? 0).toBeLessThan(3);
  });

  it('jealousy requires a known recent event rather than hidden romances', () => {
    const s = home(); const [a, b, c] = housemates(s).filter(c => !c.isPlayer);
    a.interestedIn = [b.gender]; rel(s, a.id, b.id).romance = 60;
    const f = addFact(s, { subject: b.id, about: c.id, kind: 'romance', content: 'They flirted at the counter.', truth: true, sensitivity: 0.4 });
    expect(jealousyReason(s, a.id, b.id)).toBeUndefined();
    learn(s, a.id, f.id, 'witnessed');
    expect(jealousyReason(s, a.id, b.id)).toContain('counter');
    expect(interactionProposal(s, mulberry32(3), 'jealousy', a.id, b.id).affinityDeltas[0].delta).toBeLessThan(0);
    s.world.episode += 2;
    expect(jealousyReason(s, a.id, b.id)).toBeUndefined();
  });

  it('does not hold conversations with sleeping, showering or absent action participants', () => {
    const s = home(); const [a, b] = housemates(s).filter(c => !c.isPlayer);
    const actions = { [a.id]: { kind: 'seek' as const, target: b.id }, [b.id]: { kind: 'nap' as const } };
    expect(resolveColocation(s, mulberry32(3), actions, s.playerId)).toHaveLength(0);
    expect(resolveColocation(s, mulberry32(3), { [a.id]: actions[a.id] }, s.playerId)).toHaveLength(0);
  });

  it('caps repeated friction memories and grudge reinforcement in one block', () => {
    const s = home(); const [a, b] = housemates(s).filter(c => !c.isPlayer);
    const ix = { a: a.id, b: b.id, type: 'bicker' as const, location: 'living', salience: 0.4, proposal: empty, summary: 'They disagreed about the dishes.' };
    logInteraction(s, ix); logInteraction(s, ix);
    expect(s.grudges[`${a.id}>${b.id}`].strength).toBe(3);
    expect(s.memory[a.id].filter(m => m.text === ix.summary)).toHaveLength(1);
  });

  it('records the person avoiding contact as the one giving a cold shoulder', () => {
    const s = home(); const [a, b] = housemates(s).filter(c => !c.isPlayer);
    const interactions = resolveColocation(s, mulberry32(3), { [a.id]: { kind: 'seek', target: b.id }, [b.id]: { kind: 'avoid', target: a.id } }, s.playerId);
    const ix = interactions.find(ix => ix.type === 'cold')!;
    expect(ix.a).toBe(b.id);
    expect(ix.b).toBe(a.id);
    expect(ix.proposal.affinityDeltas[0]).toEqual({ from: a.id, to: b.id, delta: -2 });
    logInteraction(s, ix);
    expect(s.grudges[`${a.id}>${b.id}`].strength).toBe(6);
    expect(s.grudges[`${b.id}>${a.id}`]).toBeUndefined();
  });

  it('NPC cold shoulders still matter when the player ignores their scene', () => {
    const s = home(); const [a, b] = housemates(s).filter(c => !c.isPlayer);
    const ev = makeEvent(s, content().eventById.get('ix-awkward')!, { a: a.id, b: b.id }, 'living', { tags: ['interaction-cold'], premise: 'They are keeping their distance.' });
    const after = resolveScene(s, ev, empty, {}, 'ignore').state;
    expect(after.grudges[`${b.id}>${a.id}`].strength).toBe(6);
    expect(after.memory[b.id].some(m => m.text.includes('distance'))).toBe(true);
  });
});
