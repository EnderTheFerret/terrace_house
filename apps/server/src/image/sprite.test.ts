import { expect, it } from 'vitest';
import { createGame, DAILY_ROTATION, DEFAULT_PLAYER, occasionFor, outfitFor, playerFromSetup, palette, spritePixels, makeEvent, eventTemplate, planSlot } from '@shared-roof/shared';
import { freezeRequest, outfitPortraitRequest, portraitRequest, spriteRequest } from './requests';
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

it('renders distinct swimwear silhouettes with bare arms and legs while preserving character identity', () => {
  const base = createGame({ seed: 1 }).characters.ren.appearance;
  const colors = { hair: '#123456', skin: '#d1a171', outfit: '#e8817c' };
  for (const dir of ['down', 'up', 'left', 'right'] as const) for (const frame of [0, 1, 2]) {
    const clothes = ['coral two-piece bikini', 'navy one-piece swimsuit', 'blue swim trunks, shirtless'];
    const looks = clothes.map((outfit) => ({ ...base, hairStyle: 'short', outfit, palette: colors }));
    const frames = looks.map((a) => spritePixels(a, dir, frame));
    for (const [i, px] of frames.entries()) {
      const skin = palette(looks[i]).skin;
      expect(px.flat()).toContain(colors.hair);
      const daily = spritePixels({ ...looks[i], outfit: 'navy shirt and jeans' }, dir, frame);
      expect(px.slice(30).flat().filter((p) => p === skin).length).toBeGreaterThan(daily.slice(30).flat().filter((p) => p === skin).length);
      expect(px.flat()).not.toContain('#3a3036');
      expect(px.flat()).toContain(colors.outfit);
    }
    expect(frames[0]).not.toEqual(frames[1]);
    expect(frames[0]).not.toEqual(frames[2]);
  }
});

it('generates pool scene swimwear from dressed references and changes cached stills when outfits change', () => {
  const s = createGame({ seed: 1 });
  for (const c of Object.values(s.characters)) { c.persona.routine.jobSlots = []; c.lastAction = 'hobby'; }
  const pool = planSlot(s, { type: 'pool', mode: 'enter', with: ['mio'] }).state;
  const ev = makeEvent(pool, eventTemplate('casual-chat'), { a: pool.playerId, b: 'mio' }, 'backyard');
  ev.tags.push('swim');
  const request = freezeRequest(pool, ev, (r) => r.subjectKey.includes(':outfit:') ? `/cache/${r.subjectKey}.png` : r.kind === 'portrait' ? '/cache/base.png' : null);
  const expected = outfitFor(pool.characters.mio, 'beach', pool.world.day);
  expect(request.prompt).toContain(expected);
  expect(request.references?.some((p) => p.includes(':outfit:'))).toBe(true);
  expect(request.meta?.people).toEqual(expect.arrayContaining([expect.objectContaining({ appearance: expect.objectContaining({ outfit: expected }) })]));
  pool.characters.mio.swimming = false;
  pool.characters[pool.playerId].swimming = false;
  ev.tags = ev.tags.filter((t) => t !== 'swim');
  const usual = freezeRequest(pool, ev);
  expect(request.subjectKey).not.toBe(usual.subjectKey);
  expect(usual.prompt).toContain(pool.characters.mio.appearance.outfit);
});

it('keeps a swimmer in swimwear and a dry deck housemate in their daily outfit within the same still', () => {
  const s = createGame({ seed: 1 });
  s.characters.mio.swimming = true;
  s.characters.mio.location = 'backyard';
  s.characters.ren.location = 'backyard';
  const ev = makeEvent(s, eventTemplate('casual-chat'), { a: 'mio', b: 'ren' }, 'backyard');
  for (const tags of [ev.tags, [...ev.tags, 'swim']]) {
    const request = freezeRequest(s, { ...ev, tags });
    expect(request.prompt).toContain(outfitFor(s.characters.mio, 'beach', s.world.day));
    expect(request.prompt).toContain(outfitFor(s.characters.ren, 'daily', s.world.day));
    expect(request.meta?.people).toEqual([
      expect.objectContaining({ appearance: expect.objectContaining({ outfit: outfitFor(s.characters.mio, 'beach', s.world.day) }) }),
      expect.objectContaining({ appearance: expect.objectContaining({ outfit: outfitFor(s.characters.ren, 'daily', s.world.day) }) }),
    ]);
  }
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
