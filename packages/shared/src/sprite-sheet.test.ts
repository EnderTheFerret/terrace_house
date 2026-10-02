import { expect, it } from 'vitest';
import { createGame, joinNewPlayer } from './engine/loop';
import { DEFAULT_PLAYER } from './engine/castgen';
import { depart, processArrivals } from './engine/leave';
import { mulberry32 } from './rng';
import { spritePixels } from './pixel';
import { SPRITE_DIRECTIONS, spriteSheetPixels, spriteWalkPixels } from './sprite-sheet';

it('renders detailed default, randomized, arrival and replacement-player sprites in every direction and walking frame', () => {
  const state = createGame({ seed: 1 });
  depart(state, state.characters.ren);
  const arrivals = processArrivals(state, mulberry32(42));
  expect(arrivals).toHaveLength(1);
  state.awaitingPlayer = true;
  const joined = joinNewPlayer(state, { ...DEFAULT_PLAYER, name: 'Custom', appearance: { ...DEFAULT_PLAYER.appearance, hairColor: 'silver-dyed', outfit: 'olive jacket and jeans' } });
  const characters = [...Object.values(createGame({ seed: 1 }).characters), ...Object.values(createGame({ seed: 19, randomizeCast: true }).characters), ...arrivals, joined.characters[joined.playerId]];
  for (const c of characters) for (const dir of SPRITE_DIRECTIONS) for (const frame of [0, 1, 2]) {
    const pixels = spritePixels(c.appearance, dir, frame);
    expect(pixels).toHaveLength(40);
    expect(pixels.every(row => row.length === 32)).toBe(true);
    expect(pixels[0].every(value => value === null)).toBe(true);
    expect(pixels.flat().filter(Boolean).length).toBeGreaterThan(200);
    expect(new Set(pixels.flat().filter(Boolean)).size).toBeGreaterThan(8);
  }
  const a = arrivals[0].appearance;
  expect(spritePixels(a, 'down', 0)).not.toEqual(spritePixels(a, 'down', 2));
  expect(spritePixels(a, 'down', 1)).not.toEqual(spritePixels(a, 'up', 1));
  expect(spritePixels(a, 'down', 1)).toEqual(spritePixels(a, 'down', 1));
});

it('extracts transparent detailed sheets without erasing white clothes, mirrors profiles, and animates feet', () => {
  const w = 160, h = 60;
  const data = new Uint8ClampedArray(w * h * 4).fill(255);
  for (let column = 0; column < 4; column++) for (let y = 5; y < 55; y++) for (let x = 10; x < 30; x++) {
    const k = (y * w + column * 40 + x) * 4;
    data[k] = 32; data[k + 1] = 48; data[k + 2] = 64;
    if (x > 13 && x < 25 && y > 15 && y < 30) data[k] = data[k + 1] = data[k + 2] = 255;
  }
  const frames = spriteSheetPixels(data, w, h);
  expect(frames).toHaveLength(4);
  expect(frames[0][0].every(value => value === null)).toBe(true);
  expect(frames[0].flat()).toContain('#ffffff');
  expect(frames[3]).toEqual(frames[2].map(row => row.slice().reverse()));
  for (const dir of SPRITE_DIRECTIONS) expect(spriteWalkPixels(frames[0], dir, 0)).not.toEqual(spriteWalkPixels(frames[0], dir, 2));
  expect(() => spriteSheetPixels(new Uint8ClampedArray(0), 0, 0)).toThrow('invalid');
  expect(() => spriteSheetPixels(new Uint8ClampedArray(16 * 4).fill(255), 4, 4)).toThrow('empty');
});
