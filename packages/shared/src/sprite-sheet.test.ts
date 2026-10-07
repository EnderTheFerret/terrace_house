import { expect, it } from 'vitest';
import { createGame, joinNewPlayer } from './engine/loop';
import { DEFAULT_PLAYER } from './engine/castgen';
import { depart, processArrivals } from './engine/leave';
import { mulberry32 } from './rng';
import { spritePixels } from './pixel';
import { SPRITE_DIRECTIONS, spriteSheetPixels } from './sprite-sheet';

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

it('slices 4x4 walk sheets into real frames without erasing white clothes, jittering strides or trusting the right row', () => {
  const s = 4, cell = 32 * s, w = cell * 4; // a 512 sheet drawn at 4x, like the model's
  const data = new Uint8ClampedArray(w * w * 4).fill(255);
  const paint = (row: number, col: number, x0: number, x1: number, y0: number, y1: number, rgb: number[]) => {
    for (let y = y0 * s; y < y1 * s; y++) for (let x = x0 * s; x < x1 * s; x++) data.set([...rgb, 255], ((row * cell + y) * w + col * cell + x) * 4);
  };
  for (let row = 0; row < 4; row++) for (let col = 0; col < 4; col++) {
    paint(row, col, 10, 22, 4, 28, [32, 48, 64]); // body
    paint(row, col, 13, 19, 10, 18, [255, 255, 255]); // white shirt inside the outline
    paint(row, col, col === 2 ? 20 : 12, (col === 2 ? 20 : 12) + 2, 28, 31, [200, 40, 40]); // stepping foot
  }
  paint(2, 0, 2, 5, 2, 5, [0, 200, 0]); // stray mark in the (ignored) right row
  paint(0, 1, 2, 3, 1, 2, [0, 200, 0]); // isolated mark in a used cell must not change the crop
  const frames = spriteSheetPixels(data, w, w);
  expect(frames.map(d => d.length)).toEqual([3, 3, 3, 3]);
  for (const f of frames.flat()) expect([f.length, f[0].length]).toEqual([40, 32]);
  expect(frames[0][1].flat()).toContain('#ffffff');
  expect(frames[0][1].findIndex(row => row.some(Boolean))).toBe(0);
  expect(frames[0][0]).not.toEqual(frames[0][2]);
  // shared crop: body pixels stay put between frames, only the foot moves
  expect(frames[0][0].slice(0, 30)).toEqual(frames[0][2].slice(0, 30));
  expect(frames[3]).toEqual(frames[2].map(f => f.map(r => r.slice().reverse())));
  expect(frames.flat(2)).not.toContain('#00c800');
  expect(() => spriteSheetPixels(new Uint8ClampedArray(0), 0, 0)).toThrow('invalid');
  expect(() => spriteSheetPixels(new Uint8ClampedArray(16 * 16 * 4).fill(255), 16, 16)).toThrow('empty');
});
