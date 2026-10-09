import { expect, it } from 'vitest';
import { DAILY_ROTATION, outfitFor } from './wardrobe';
import { chatLine } from './gen/mock';
import { createGame } from './engine/loop';
import { mulberry32 } from './rng';

it('dresses each personality from its own closet, with distinct days and the signature on day 0', () => {
  const base = { id: 'x', gender: 'woman', appearance: { outfit: 'signature look' } };
  const week = (traits: number[]) => Array.from({ length: DAILY_ROTATION }, (_, d) => outfitFor({ ...base, persona: { traits } }, 'daily', d));
  const artsy = week([0.9, 0.3, 0.3, 0.3, 0.3]);
  const bold = week([0.3, 0.3, 0.9, 0.3, 0.3]);
  expect(artsy[0]).toBe('signature look');
  expect(new Set(artsy).size).toBe(DAILY_ROTATION);
  expect(artsy.slice(1)).not.toEqual(bold.slice(1));
  expect(outfitFor({ ...base, persona: { traits: [0.9, 0.3, 0.3, 0.3, 0.3] } }, 'date')).toBe(outfitFor({ ...base, persona: { traits: [0.9, 0.3, 0.3, 0.3, 0.3] } }, 'date'));
});

it('does not text the same line twice in a row on one thread', () => {
  const s = createGame({ seed: 5 });
  const [a, b] = Object.keys(s.characters).filter((id) => id !== s.playerId);
  const key = [a, b].sort().join('|');
  const rng = mulberry32(1);
  const seen = new Set<string>();
  for (let i = 0; i < 4; i++) {
    const text = chatLine(s, rng, a, b);
    seen.add(text.toLowerCase().replace(/[^a-z' ]/g, '').trim());
    (s.chats[key] ??= []).push({ from: a, text, tick: i, readBy: [], ignoredBy: [] });
  }
  expect(seen.size).toBeGreaterThan(2);
});
