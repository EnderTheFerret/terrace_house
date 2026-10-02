import { describe, expect, it } from 'vitest';
import { content } from '../content';
import { isOpen, node, reachability, shiftToday, shortestTimes, ACTIVITY_MINUTES, WAGE } from './city';
import { SLOT_MINUTES } from './core';
import { createGame, finishSlot, planSlot } from './loop';

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
  it('reachability: time budget, money and car constraints', () => {
    const r = Object.fromEntries(reachability('house', 'slot1', 20000, false).map((x) => [x.node, x]));
    expect(r.cafe.reachable).toBe(true);
    expect(r.lighthouse.reachable).toBe(false);
    expect(r.lighthouse.reason).toBe('needs the car');
    expect(r.bar.reason).toBe('closed now');
    const car = Object.fromEntries(reachability('house', 'slot1', 20000, true).map((x) => [x.node, x]));
    expect(car.lighthouse.reachable).toBe(true);
    expect(car.lighthouse.needsCar).toBe(true);
    for (const x of Object.values(car)) if (x.reachable) expect(x.minutes * 2 + ACTIVITY_MINUTES).toBeLessThanOrEqual(SLOT_MINUTES);
    const broke = Object.fromEntries(reachability('house', 'slot1', 1, false).map((x) => [x.node, x]));
    expect(broke.cafe.reason).toBe('not enough money');
    expect(broke.riverside.reachable).toBe(true);
  });
  it('going out charges money, uses the car for far trips and moves the player', () => {
    const s0 = createGame({ seed: 7 });
    s0.world.slot = 'slot1';
    const { state } = planSlot(s0, { type: 'goOut', node: 'lighthouse', activity: 'date', invite: 'ren' });
    expect(state.characters.player.location).toBe('lighthouse');
    expect(state.world.carUsedBy).toBe('player');
    expect(state.world.money).toBeLessThan(s0.world.money);
    expect(state.characters.ren.location).toBe('lighthouse');
  });
  it('part-time contract: fixed weekly shifts pay more; two missed shifts and you are let go', () => {
    const s0 = createGame({ seed: 7 });
    s0.world.slot = 'slot1';
    const { state: signed } = planSlot(s0, { type: 'goOut', node: 'konbini', activity: 'work', contract: true });
    const job = signed.world.playerJob!;
    expect(job).toMatchObject({ nodeId: 'konbini', slot: 'slot1' });
    expect(job.weekdays).toHaveLength(3);
    expect(signed.world.money - s0.world.money).toBeGreaterThan(WAGE.konbini - 300); // contract wage minus fare
    // a later scheduled shift: working pays the contract wage, skipping counts as a miss
    const onShift = finishSlot(signed);
    onShift.world.slot = 'slot1';
    onShift.world.weekday = job.weekdays[1];
    expect(shiftToday(job, onShift.world.weekday, 'slot1')).toBe(true);
    const worked = planSlot(onShift, { type: 'goOut', node: 'konbini', activity: 'work' }).state;
    expect(worked.world.money - onShift.world.money).toBeGreaterThanOrEqual(job.wage - 300);
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
    s0.world.money = 0;
    expect(() => planSlot(s0, { type: 'goOut', node: 'bar', activity: 'date' })).toThrow(/closed|money/);
    expect(s0.characters.player.location).toBe('living');
  });
});
