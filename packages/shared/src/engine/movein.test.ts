import { describe, expect, it } from 'vitest';
import { blockOver, createGame, finishSlot, planMoveInArrival, planSlot } from './loop';
import { housemates } from './core';

describe('move-in day', () => {
  it('retains the original random arrival order for legacy replay logs', () => {
    for (const seed of [1, 2, 3, 4]) {
      const s = createGame({ seed, moveInDay: true, moveInVersion: 1 });
      const order = String(s.world.flags.moveIn).split(',');
      const mine = order.indexOf(s.playerId);
      expect(housemates(s).map(c => c.id).sort()).toEqual(order.slice(0, mine + 1).sort());
      expect(s.world.flags.gradualMoveIn).toBeUndefined();
    }
  });
  it('always starts in the morning with exactly the player and one housemate', () => {
    for (const seed of [1, 2, 3, 4, 7, 21]) {
      const s = createGame({ seed, moveInDay: true });
      expect(s.world.slot).toBe('morning');
      expect(s.world.minutes).toBe(0);
      expect(housemates(s)).toHaveLength(2);
      const opening = planSlot(s, { type: 'idle' });
      expect(opening.plan.scenes).toHaveLength(1);
      expect(opening.plan.scenes[0].event.participants.sort()).toEqual(housemates(s).map(c => c.id).sort());
      expect(opening.state.world.minutes).toBe(0);
    }
  });

  it('does not skip or batch introductions when skipping blocks, and saves the last arrival for evening', () => {
    for (const seed of [1, 2, 3, 4]) {
      let s = createGame({ seed, moveInDay: true });
      const counts: number[] = [];
      const slots: string[] = [];
      for (let n = 0; n < 20 && housemates(s).length < 6; n++) {
        const result = planSlot(s, { type: 'skip' });
        s = result.state;
        if (result.plan.scenes.length) {
          expect(result.plan.scenes).toHaveLength(1);
          expect(result.plan.scenes[0].render).toBe(true);
          expect(result.plan.scenes[0].event.type).toBe('arrival');
          counts.push(housemates(s).length);
          slots.push(s.world.slot);
        }
        if (blockOver(s)) s = finishSlot(s);
      }
      expect(counts).toEqual([2, 3, 4, 5, 6]);
      expect(slots).toEqual(['morning', 'morning', 'slot1', 'slot2', 'evening']);
    }
  });

  it('makes a due arrival available inside a block and never announces it twice', () => {
    const s = planMoveInArrival(createGame({ seed: 2, moveInDay: true })).state;
    s.world.minutes = 29;
    expect(planMoveInArrival(s).plan.scenes).toHaveLength(0);
    s.world.minutes = 30;
    const next = planMoveInArrival(s);
    expect(next.plan.scenes[0].event.participants).toHaveLength(3);
    expect(planMoveInArrival(next.state).plan.scenes).toHaveLength(0);
    const loaded = JSON.parse(JSON.stringify(next.state));
    expect(planMoveInArrival(loaded).plan.scenes).toHaveLength(0);
  });
});
