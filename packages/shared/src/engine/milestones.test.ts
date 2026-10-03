import { describe, expect, it } from 'vitest';
import { autoChoices, createGame, makeEvent, proposeOutcome, resolveScene } from './loop';
import { housemates, milestoneOf } from './core';
import { evalAll } from './conditions';
import { content } from '../content';
import type { GameState } from '../model';

const LADDER = ['first-date', 'second-date', 'hand-holding', 'first-kiss'];

describe('romance milestones', () => {
  it('opens exactly one rung at a time, and each scene climbs it', () => {
    let s: GameState = createGame({ seed: 4, seasonLength: 0 });
    const a = s.playerId;
    const b = 'ren';
    for (const [x, y] of [[a, b], [b, a]]) Object.assign(s.rel[x][y], { romance: 80, trust: 80, affinity: 60, tension: 0 });
    const ids = housemates(s).map((c) => c.id);
    for (let rung = 0; rung < LADDER.length; rung++) {
      const open = LADDER.filter((id) => evalAll(s, content().eventById.get(id)!.pre, { a, b }, null, ids));
      expect(open).toEqual([LADDER[rung]]);
      const ev = makeEvent(s, content().eventById.get(LADDER[rung])!, { a, b }, 'cafe');
      const auto = autoChoices(s, ev, 'flirt');
      const prop = proposeOutcome(auto.state, ev, auto.choices);
      s = resolveScene(prop.state, ev, prop.proposal, auto.choices).state;
      for (const [x, y] of [[a, b], [b, a]]) Object.assign(s.rel[x][y], { romance: 80, trust: 80, tension: 0 });
      expect(milestoneOf(s, b, a)).toBe(rung + 1);
    }
    expect(LADDER.filter((id) => evalAll(s, content().eventById.get(id)!.pre, { a, b }, null, ids))).toEqual([]);
  });
});
