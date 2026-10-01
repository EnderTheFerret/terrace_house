import { describe, expect, it } from 'vitest';
import { content } from '../content';
import { isOpen, node, reachability, shortestTimes, ACTIVITY_MINUTES } from './city';
import { SLOT_MINUTES } from './core';
import { createGame, planSlot } from './loop';

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
    for (const x of Object.values(car)) if (x.reachable) expect(x.minutes + ACTIVITY_MINUTES).toBeLessThanOrEqual(SLOT_MINUTES);
    const broke = Object.fromEntries(reachability('house', 'slot1', 100, false).map((x) => [x.node, x]));
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
  it('unreachable destinations are refused (player stays home)', () => {
    const s0 = createGame({ seed: 7 });
    s0.world.slot = 'slot1';
    s0.world.money = 0;
    const { state } = planSlot(s0, { type: 'goOut', node: 'bar', activity: 'date' });
    expect(state.characters.player.location).toBe('living');
  });
});
