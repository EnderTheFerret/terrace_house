import { describe, expect, it } from 'vitest';
import { createGame, planSlot } from './loop';
import { houseTick } from './house';
import { rel } from './core';
import { mulberry32 } from '../rng';

describe('assigned chores', () => {
  it.each([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])('credits bathroom duty without a skipped chore when the player tidies (seed %s)', seed => {
    const s = createGame({ seed, moveInDay: false });
    s.house.choreRota = { bathroom: s.playerId };
    const before = s.house.choreLedger[s.playerId];
    const { state } = planSlot(s, { type: 'house', activity: 'tidy' });
    expect(state.house.choreLedger[s.playerId].done).toBeGreaterThan(before.done);
    expect(state.house.choreLedger[s.playerId].skipped).toBe(before.skipped);
  });

  it('raises tension and lowers reputation when an assigned chore is skipped', () => {
    const s = createGame({ seed: 9, moveInDay: false });
    s.house.choreRota = { bathroom: s.playerId };
    const other = Object.values(s.characters).find(c => !c.isPlayer && c.status === 'inHouse')!;
    const tension = rel(s, other.id, s.playerId).tension;
    const reputation = s.house.reputation[other.id]?.[s.playerId] ?? 0;
    const skipped = s.house.choreLedger[s.playerId].skipped;
    const rng = mulberry32(9);
    rng.chance = () => false;
    houseTick(s, rng, {});
    expect(s.house.choreLedger[s.playerId].skipped).toBe(skipped + 0.5);
    expect(rel(s, other.id, s.playerId).tension).toBeGreaterThan(tension);
    expect(s.house.reputation[other.id][s.playerId]).toBeLessThan(reputation);
  });
});
