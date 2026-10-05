import { expect, it } from 'vitest';
import { createGame, passTime } from '@shared-roof/shared';
import { replayEvents } from './replay';

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
