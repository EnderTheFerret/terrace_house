import { expect, it } from 'vitest';
import { createGame, DEFAULT_PLAYER, playerFromSetup } from '@shared-roof/shared';
import { spriteRequest } from './requests';
import { placeholderSvg } from './mock';

it('uses the same style-reference pipeline for originals and arbitrary custom characters without palette feedback regenerating sheets', () => {
  const original = createGame({ seed: 1 }).characters.ren;
  const custom = playerFromSetup({ ...DEFAULT_PLAYER, name: 'New person', appearanceText: 'olive jacket with embroidered sleeves' }, 'player-2');
  for (const c of [original, custom]) {
    const request = spriteRequest(c);
    expect(request.kind).toBe('sprite');
    expect([request.width, request.height]).toEqual([1024, 384]);
    expect(request.reference).toMatch(/sprite-style\.jpg$/);
    expect(request.prompt).toContain(c.appearance.hairColor);
    expect(placeholderSvg(request)).toContain('viewBox="0 0 128 40"');
    expect(spriteRequest({ ...c, appearance: { ...c.appearance, palette: { hair: '#123456', skin: '#654321', outfit: '#abcdef' } } }).prompt).toBe(request.prompt);
  }
  expect(spriteRequest(custom).prompt).toContain('embroidered sleeves');
  expect(spriteRequest({ ...custom, appearance: { ...custom.appearance, outfit: 'red jacket' } }).subjectKey).not.toBe(spriteRequest(custom).subjectKey);
});
