import { expect, it } from 'vitest';
import { createGame, passTime, planSlot } from '@shared-roof/shared';
import { replayEvents, type LoggedEvent } from './replay';

it('replays old and new conversation pacing together without changing legacy minutes', () => {
  const options = { seed: 41, moveInDay: false };
  const replayed = replayEvents([
    { seq: 1, kind: 'new', payload: options },
    { seq: 2, kind: 'time', payload: { lines: 10 } },
    { seq: 3, kind: 'time', payload: { lines: 10, minutesPerLine: 6 } },
  ]);
  expect(replayed.world.minutes).toBe(90);
  expect(replayed).toEqual(passTime(passTime(createGame(options), 10, [], 3), 10));
});

it('preserves legacy text action pacing in replay while new texts take no time', () => {
  for (const moveInDay of [false, true]) {
    const options = { seed: 41, moveInDay, moveInVersion: 2 as const };
    const events: LoggedEvent[] = [{ seq: 1, kind: 'new', payload: options }];
    let before = createGame(options);
    if (moveInDay) {
      const action = { type: 'idle' as const };
      before = planSlot(before, action).state;
      events.push({ seq: 2, kind: 'action', payload: { action } });
    }
    const action = { type: 'text' as const, target: Object.values(before.characters).find(c => !c.isPlayer && c.status === 'inHouse')!.id, text: 'Hey!' };
    const legacy = planSlot(before, action, { legacyText: true });
    expect(legacy.state.world.minutes).toBe(before.world.minutes + 5);
    expect(legacy.plan.scenes.length).toBeGreaterThan(0);
    expect(replayEvents([...events, { seq: events.length + 1, kind: 'action', payload: { action } }])).toEqual(legacy.state);
    expect(replayEvents([...events, { seq: events.length + 1, kind: 'action', payload: { action, textVersion: 1 } }])).toEqual(before);
  }
});
