import { describe, expect, it } from 'vitest';
import { content } from '../content';
import { isOpen, node, reachability, shiftToday, shortestTimes, ACTIVITY_MINUTES } from './city';
import { afford, playerBudget } from './budget';
import { SLOT_MINUTES } from './core';
import { createGame, finishSlot, planSlot } from './loop';
import { debugEdit } from './debugedit';

describe('city exploration', () => {
  it('graph is connected on foot except car-only spots, which the car unlocks', () => {
    const walk = shortestTimes('house', false);
    const drive = shortestTimes('house', true);
    for (const n of content().city.nodes) expect(Number.isFinite(drive[n.id]), n.id).toBe(true);
    expect(Number.isFinite(walk.lighthouse)).toBe(false);
    expect(drive.konbini).toBeLessThanOrEqual(walk.konbini);
  });
  it('shortest path uses intermediate nodes (Dijkstra)', () => {
    const d = shortestTimes('house', false);
    expect(d.records).toBe(10 + 10 + 5); // house→station→arcade→records
  });
  it('opening hours respect slot windows, including past-midnight venues', () => {
    expect(isOpen(node('market'), 'slot1')).toBe(true);
    expect(isOpen(node('market'), 'slot3')).toBe(false);
    expect(isOpen(node('bar'), 'slot1')).toBe(false);
    expect(isOpen(node('bar'), 'slot3')).toBe(true);
    expect(isOpen(node('karaoke'), 'evening')).toBe(true); // open until 5 a.m.
  });
  it('reachability: time budget, price levels and car constraints', () => {
    const r = Object.fromEntries(reachability('house', 'slot1', 3, false).map((x) => [x.node, x]));
    expect(r.cafe.reachable).toBe(true);
    expect(r.lighthouse.reachable).toBe(false);
    expect(r.lighthouse.reason).toBe('needs the car');
    expect(r.bar.reason).toBe('closed now');
    const car = Object.fromEntries(reachability('house', 'slot1', 3, true).map((x) => [x.node, x]));
    expect(car.lighthouse.reachable).toBe(true);
    expect(car.lighthouse.needsCar).toBe(true);
    for (const x of Object.values(car)) if (x.reachable) expect(x.minutes * 2 + ACTIVITY_MINUTES).toBeLessThanOrEqual(SLOT_MINUTES);
    const tight = reachability('house', 'slot1', 0, true);
    expect(tight.find((x) => x.node === 'riverside')!.afford).toBe('ok');
    expect(tight.filter((x) => x.price === 3).every((x) => x.afford === 'out')).toBe(true);
    expect(tight.filter((x) => x.price === 2).every((x) => x.afford === 'stretch')).toBe(true);
    expect(afford(2, 3)).toBe('ok');
  });
  it('a late student can still catch the end of a lecture, but not once the block is nearly over', () => {
    const uni = (elapsed: number, lecture: boolean) => reachability('house', 'slot1', 3, true, elapsed, 1, false, lecture).find((x) => x.node === 'university')!;
    expect(uni(120, false).reason).toBe('too far for this slot'); // 28 min each way + an hour doesn't fit, even by car
    expect(uni(120, true).reachable).toBe(true); // 28 min walk + 30 min of lecture still fits
    expect(uni(150, true).reason).toBe('too late: the lecture is nearly over');
  });
  it('going out uses the car for far trips and moves the player', () => {
    const s0 = createGame({ seed: 7 });
    s0.world.slot = 'slot1';
    const { state } = planSlot(s0, { type: 'goOut', node: 'lighthouse', activity: 'date', invite: 'ren' });
    expect(state.characters.player.location).toBe('lighthouse');
    expect(state.world.carUsedBy).toBe('player');
    expect(state.characters.ren.location).toBe('lighthouse');
  });
  it('an outing can bring several housemates, all in the scene', () => {
    const s0 = createGame({ seed: 7 });
    s0.world.slot = 'slot1';
    const { state, plan } = planSlot(s0, { type: 'goOut', node: 'beach', activity: 'invite', invite: 'ren', guests: ['kaito'] });
    expect(['ren', 'kaito'].map((id) => state.characters[id].location)).toEqual(['beach', 'beach']);
    const ev = plan.scenes.find((p) => p.event.isPlayerScene)!.event;
    expect(ev.participants).toEqual(expect.arrayContaining(['player', 'ren', 'kaito']));
    expect(`${ev.title} ${ev.premise}`).not.toMatch(/chance encounter|Neither of them planned/); // an invited outing is planned
  });
  it('a guest who can afford the place covers a player who is out of budget', () => {
    const s0 = createGame({ seed: 7 });
    s0.characters[s0.playerId].occupation = 'student';
    s0.characters.ren.occupation = 'founder';
    let place: ReturnType<typeof reachability>[number] | undefined;
    for (const slot of ['slot1', 'slot2', 'slot3', 'evening'] as const) {
      s0.world.slot = slot;
      place = reachability('house', slot, playerBudget(s0), true, 0, s0.world.weekday).find((r) => r.reachable && r.afford === 'out' && content().city.nodes.find((n) => n.id === r.node)!.activities.includes('date'));
      if (place) break;
    }
    if (!place) throw new Error('fixture: no reachable out-of-budget date spot');
    const go = (invite?: string) => () => planSlot(s0, { type: 'goOut', node: place!.node, activity: 'date', invite, useCar: place!.needsCar });
    expect(go()).toThrow(/budget/);
    expect(go('ren')).not.toThrow();
    // neither can afford it: only a plan they already keep there lets you join
    s0.characters.ren.occupation = 'student';
    expect(go('ren')).toThrow(/budget/);
    s0.invitations.push({ id: 'plan-join', from: 'ren', to: s0.playerId, episode: s0.world.episode, slot: s0.world.slot, node: place.node, status: 'accepted' });
    expect(go('ren')).not.toThrow();
  });
  it('debug-moving a housemate gives them an activity for the new place, not a hold for the whole block', () => {
    const s0 = createGame({ seed: 7 });
    s0.world.minutes = 0;
    const town = debugEdit(s0, { id: 'ren', location: 'beach' }).characters.ren;
    expect(town).toMatchObject({ location: 'beach', lastAction: 'goOut', actionNode: 'beach' });
    expect(town.activityUntil).toBeLessThan(SLOT_MINUTES);
    expect(debugEdit(s0, { id: 'ren', location: 'kitchen' }).characters.ren).toMatchObject({ location: 'kitchen', lastAction: 'snack' });
    expect(() => debugEdit(s0, { id: 'ren', location: 'nowhere' })).toThrow(/unknown location/);
  });
  it('part-time contract: fixed weekly shifts lift the budget a level; two missed shifts and you are let go', () => {
    const s0 = createGame({ seed: 7 });
    s0.world.slot = 'slot1';
    const { state: signed } = planSlot(s0, { type: 'goOut', node: 'konbini', activity: 'work', contract: true });
    const job = signed.world.playerJob!;
    expect(job).toMatchObject({ nodeId: 'konbini', slot: 'slot1' });
    expect(job.weekdays).toHaveLength(3);
    expect(playerBudget(signed)).toBe(Math.min(3, playerBudget(s0) + 1));
    // a later scheduled shift: working pays the contract wage, skipping counts as a miss
    const onShift = finishSlot(signed);
    onShift.world.slot = 'slot1';
    onShift.world.weekday = job.weekdays[1];
    expect(shiftToday(job, onShift.world.weekday, 'slot1')).toBe(true);
    const worked = planSlot(onShift, { type: 'goOut', node: 'konbini', activity: 'work' }).state;
    expect(worked.world.flags.workedShift).toBe(true);
    // a shift counts as missed when the block ends without the player working it
    const miss1 = finishSlot(planSlot(onShift, { type: 'idle' }).state);
    expect(miss1.world.flags.jobMissed).toBe(1);
    expect(miss1.world.playerJob).not.toBeNull();
    expect(finishSlot(worked).world.flags.jobMissed).toBeFalsy();
    const miss2 = finishSlot(planSlot({ ...miss1, world: { ...miss1.world, slot: 'slot1' } }, { type: 'idle' }).state);
    expect(miss2.world.playerJob).toBeNull();
  });
  it('unreachable destinations are refused (player stays home)', () => {
    const s0 = createGame({ seed: 7 });
    s0.world.slot = 'slot1';
    expect(() => planSlot(s0, { type: 'goOut', node: 'bar', activity: 'date' })).toThrow(/closed|budget/);
    expect(s0.characters.player.location).toBe('living');
  });
});
