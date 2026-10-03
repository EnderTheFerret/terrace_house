import { describe, expect, it } from 'vitest';
import { createGame, finishSlot, planSlot } from './loop';
import { housemates } from './core';

describe('move-in day', () => {
  it('brings the six in one at a time, the player at their place in the order, everyone in by the end of episode 1', () => {
    for (const seed of [1, 2, 3, 4]) {
      let s = createGame({ seed, moveInDay: true });
      const order = String(s.world.flags.moveIn).split(',');
      const mine = order.indexOf(s.playerId);
      expect(housemates(s).map((c) => c.id).sort()).toEqual(order.slice(0, mine + 1).sort());
      let intros = 0;
      while (s.world.episode === 1 && !s.seasonOver) {
        const p = planSlot(s, { type: 'idle' });
        intros += p.plan.scenes.filter((x) => x.event.templateId === 'arrival-intro').length;
        s = finishSlot(p.state);
      }
      expect(housemates(s)).toHaveLength(6);
      expect(intros).toBeGreaterThanOrEqual(Math.min(1, 5 - mine));
    }
  });
});
