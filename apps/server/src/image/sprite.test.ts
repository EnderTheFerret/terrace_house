import { expect, it } from 'vitest';
import { createGame, DAILY_ROTATION, DEFAULT_PLAYER, occasionFor, outfitFor, playerFromSetup } from '@shared-roof/shared';
import { outfitPortraitRequest, portraitRequest, spriteRequest } from './requests';
import { placeholderSvg } from './mock';

it('draws every character sheet from its own portrait without palette feedback regenerating sheets', () => {
  const original = createGame({ seed: 1 }).characters.ren;
  const custom = playerFromSetup({ ...DEFAULT_PLAYER, name: 'New person', appearanceText: 'olive jacket with embroidered sleeves' }, 'player-2');
  for (const c of [original, custom]) {
    const request = spriteRequest(c, '/cache/portrait.png');
    expect(request.kind).toBe('sprite');
    expect([request.width, request.height]).toEqual([512, 512]);
    expect(request.reference).toBe('/cache/portrait.png');
    expect(spriteRequest(c).reference).toBeUndefined();
    expect(request.prompt).toContain('4 by 4 grid');
    expect(request.prompt).toContain(c.appearance.hairColor);
    expect(placeholderSvg(request)).toContain('viewBox="0 0 128 160"');
    expect(spriteRequest({ ...c, appearance: { ...c.appearance, palette: { hair: '#123456', skin: '#654321', outfit: '#abcdef' } } }, '/cache/portrait.png').prompt).toBe(request.prompt);
  }
  expect(spriteRequest(custom).prompt).toContain('embroidered sleeves');
  expect(spriteRequest({ ...custom, appearance: { ...custom.appearance, outfit: 'red jacket' } }).subjectKey).not.toBe(spriteRequest(custom).subjectKey);
});

it('rotates daily outfits from the signature look and re-dresses the approved portrait for them', () => {
  const ren = createGame({ seed: 1 }).characters.ren;
  const mio = createGame({ seed: 1 }).characters.mio;
  const week = Array.from({ length: DAILY_ROTATION * 2 }, (_, day) => outfitFor(ren, 'daily', day));
  expect(week[0]).toBe(ren.appearance.outfit);
  expect(new Set(week).size).toBe(DAILY_ROTATION);
  expect(week.slice(DAILY_ROTATION)).toEqual(week.slice(0, DAILY_ROTATION));
  expect(outfitFor(mio, 'date')).toMatch(/dress/);
  expect(outfitFor(ren, 'beach')).toMatch(/trunks|board shorts/);
  expect(outfitFor(mio, 'beach')).toBe(outfitFor(mio, 'beach'));
  const ev = { location: 'cafe', type: 'outing', tags: [] as string[], templateId: 'cafe-chat' };
  expect(occasionFor(ev)).toBe('daily');
  expect(occasionFor({ ...ev, location: 'beach', type: 'date' })).toBe('beach');
  expect(occasionFor({ ...ev, templateId: 'shared-car-date' })).toBe('date');
  expect(occasionFor({ ...ev, tags: ['overnight'] })).toBe('outdoor');

  expect(outfitPortraitRequest(ren, ren.appearance.outfit, '/p.png')).toEqual(portraitRequest(ren));
  const dressed = outfitPortraitRequest(ren, week[1], '/p.png');
  expect(dressed.reference).toBe('/p.png');
  expect(dressed.prompt).toContain(`change only the clothing to ${week[1]}`);
  expect(dressed.subjectKey).not.toBe(portraitRequest(ren).subjectKey);
  const sheet = spriteRequest(ren, '/dressed.png', week[1]);
  expect(sheet.prompt).toContain(week[1]);
  expect(sheet.subjectKey).not.toBe(spriteRequest(ren, '/dressed.png').subjectKey);
});
