import { describe, expect, it } from 'vitest';
import { content } from '../content';
import { reachability } from './city';
import { playerBudget } from './budget';
import { createGame, finishSlot, planSlot } from './loop';
import { applyDrinks, bodyState, conditionOf, drunkSpeech, lineEmotion, orderDrinks, servesDrinks, venueDrinks } from './drink';
import { debugEdit } from './debugedit';

describe('drinking', () => {
  it('only bars, karaoke and venues serve drinks', () => {
    const types = (ids: string[]) => ids.map((id) => servesDrinks(id));
    expect(types(['bar', 'karaoke', 'livehouse'])).toEqual([true, true, true]);
    expect(types(['cafe', 'beach', 'konbini'])).toEqual([false, false, false]);
  });

  it('a player who drinks out gets drunk, the night catches up as a hangover, and the afternoon clears it', () => {
    const s0 = createGame({ seed: 7 });
    s0.characters[s0.playerId].occupation = 'consultant';
    let stop: { slot: (typeof s0.world.slot); node: string; needsCar: boolean } | undefined;
    for (const slot of ['slot1', 'slot2', 'slot3', 'evening'] as const) {
      const r = reachability('house', slot, playerBudget(s0), true, 0, s0.world.weekday).find((x) => x.reachable && servesDrinks(x.node) && x.afford !== 'out' && content().city.nodes.find((n) => n.id === x.node)!.activities.includes('wander'));
      if (r) { stop = { slot, node: r.node, needsCar: r.needsCar }; break; }
    }
    if (!stop) throw new Error('fixture: no reachable drinks spot');
    s0.world.slot = stop.slot;
    const sober = planSlot(s0, { type: 'goOut', node: stop.node, activity: 'wander', useCar: stop.needsCar }).state;
    expect(sober.characters[s0.playerId].drunk).toBe(0);
    const out = planSlot(s0, { type: 'goOut', node: stop.node, activity: 'wander', useCar: stop.needsCar, drink: true }).state;
    expect(out.characters[s0.playerId]).toMatchObject({ drunk: 2, drunkPeak: 2 });
    // the next block: a level wears off, the peak is remembered
    out.world.slot = 'lateNight';
    const morning = finishSlot(out);
    expect(morning.characters[s0.playerId]).toMatchObject({ drunk: 0, hangover: 1 });
    expect(conditionOf(morning.characters[s0.playerId])).toBe('hungover');
    morning.world.slot = 'slot2';
    expect(finishSlot(morning).characters[s0.playerId].hangover).toBe(0);
  });

  it('shows in dialogue: prompt notes, mock slurring, and the view', () => {
    const s = createGame({ seed: 7 });
    const c = s.characters.ren;
    expect(bodyState(c)).toBeNull();
    c.drunk = 3;
    expect(bodyState(c)).toMatch(/very drunk/);
    expect(drunkSpeech('I am so happy to see you.', 3)).not.toBe('I am so happy to see you.');
    expect(drunkSpeech('I am so happy to see you.', 1)).toBe('I am so happy to see you.');
    c.drunk = 0; c.hangover = 2;
    expect(bodyState(c)).toMatch(/badly hungover/);
  });

  it('a scene already running at a bar catches up, and replay reproduces it', () => {
    const s0 = createGame({ seed: 7 });
    s0.world.slot = 'evening';
    const ev = { participants: [s0.playerId, 'ren', 'kaito', 'mika', 'ayumi', 'haru'].filter((id) => s0.characters[id]), location: 'bar' };
    const { state, changes } = venueDrinks(s0, ev);
    expect(Object.keys(changes).length).toBeGreaterThan(0);
    for (const [id, level] of Object.entries(changes)) expect(state.characters[id].drunk).toBe(level);
    expect(venueDrinks(state, ev).changes).toEqual({}); // once per block
    const replayed = applyDrinks(s0, changes);
    for (const [id, level] of Object.entries(changes)) expect(replayed.characters[id].drunk).toBe(level);
  });

  it('asking for drinks in chat gets the player drunk (shots hit harder) and others may join; refusals and plain talk do nothing', () => {
    const s0 = createGame({ seed: 7 });
    const others = ['ren', 'kaito', 'mika', 'ayumi', 'haru'].filter((id) => s0.characters[id]);
    const beer = orderDrinks(s0, "I'll have a beer", others)!;
    expect(beer.state.characters[s0.playerId].drunk).toBe(1);
    const shots = orderDrinks(s0, "let's do shots!", others)!;
    expect(shots.state.characters[s0.playerId].drunk).toBe(2);
    expect(shots.what).toBe('shots');
    expect(Object.keys(shots.changes).length).toBeGreaterThan(1); // someone joined
    const more = orderDrinks(shots.state, 'another round of shots', others)!;
    expect(more.state.characters[s0.playerId].drunk).toBe(3);
    expect(orderDrinks(s0, "no thanks, I don't drink beer", others)).toBeNull();
    expect(orderDrinks(s0, 'how was your day?', others)).toBeNull();
    expect(lineEmotion(shots.state.characters[s0.playerId], 'happy')).toBe('drunk');
    expect(lineEmotion(beer.state.characters[s0.playerId], 'happy')).toBe('happy');
  });

  it('debug can set drunk and hangover', () => {
    const s = debugEdit(createGame({ seed: 7 }), { id: 'ren', drunk: 2, hangover: 1 });
    expect(s.characters.ren).toMatchObject({ drunk: 2, drunkPeak: 2, hangover: 1 });
  });
});
