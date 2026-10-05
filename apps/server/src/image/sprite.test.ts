import { expect, it } from 'vitest';
import { createGame, DAILY_ROTATION, DEFAULT_PLAYER, occasionFor, outfitFor, playerFromSetup, palette, spritePixels, makeEvent, eventTemplate, planSlot } from '@shared-roof/shared';
import { freezeRequest, outfitPortraitRequest, portraitRequest, spriteRequest } from './requests';
import { placeholderSvg } from './mock';
import { AssetLibrary } from './queue';
import { config } from '../config';

it('requests proportional knees-up portraits and bypasses old full-body artwork for portraits and outfits', () => {
  const c = createGame({ seed: 1 }).characters.ren;
  const portrait = portraitRequest(c);
  expect(portrait.prompt).toContain('full-length standing reference');
  expect(portrait.framing).toBe('knees');
  expect(portrait.prompt).toContain('small proportional head');
  expect(portrait.prompt).toContain(config.stylePrefix);
  const corrected = portraitRequest(c, false, '/approved-original.png');
  expect(corrected.prompt).toContain('exact original 16-bit pixel art style');
  expect(corrected.reference).toBe('/approved-original.png');
  expect(portrait.negative).toContain('oversized head');
  expect(portrait.subjectKey).toContain(':knees-up-v3');
  const assets = new AssetLibrary(config.assetsDir);
  const oldKey = portrait.subjectKey.replace(':knees-up-v3', ':thigh-up-v1');
  expect(assets.file(oldKey)).toBeTruthy();
  expect(assets.file(portrait.subjectKey)).not.toBe(assets.file(oldKey));
  const outfit = outfitPortraitRequest(c, 'blue jacket', '/new-portrait.png');
  expect(outfit.subjectKey).toContain(':knees-up-v3');
  expect(outfit.prompt).toContain('entire head through both knees');
  expect(outfit.prompt).toContain('small proportional head');
  expect(outfit.framing).toBeUndefined();
  expect(spriteRequest(c).subjectKey).not.toContain(':knees-up-v3');
});

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

it('does not reuse default player artwork for another age or gender', () => {
  const original = playerFromSetup(DEFAULT_PLAYER);
  const portrait = portraitRequest(original);
  expect(portrait.subjectKey).not.toContain(':identity:');
  for (const patch of [{ age: 30 }, { gender: 'man' as const }]) {
    const changed = playerFromSetup({ ...DEFAULT_PLAYER, ...patch });
    expect(portraitRequest(changed).subjectKey).not.toBe(portrait.subjectKey);
    expect(spriteRequest(changed).subjectKey).not.toBe(spriteRequest(original).subjectKey);
  }
});

it('changes and fixes walking sprites independently of the portrait', () => {
  const original = playerFromSetup(DEFAULT_PLAYER);
  const setup = { ...DEFAULT_PLAYER, spriteSeed: 1234, spriteInstructions: 'Keep the glasses visible and fix the feet' };
  const changed = playerFromSetup(setup);
  const request = spriteRequest(changed, '/approved-portrait.png');
  expect(portraitRequest(changed)).toEqual(portraitRequest(original));
  expect(request.seed).toBe(1234);
  expect(request.reference).toBe('/approved-portrait.png');
  expect(request.prompt).toContain(setup.spriteInstructions);
  expect(request.subjectKey).not.toBe(spriteRequest(original).subjectKey);
  expect(spriteRequest({ ...changed, spriteSeed: 5678 }).subjectKey).not.toBe(request.subjectKey);
  expect(spriteRequest({ ...changed, spriteInstructions: 'Fix the hands' }).subjectKey).not.toBe(request.subjectKey);
  expect(changed).toMatchObject({ spriteSeed: 1234, spriteInstructions: setup.spriteInstructions });
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

it('describes current pool swimwear without portrait references and changes cached stills when outfits change', () => {
  const s = createGame({ seed: 1 });
  for (const c of Object.values(s.characters)) { c.persona.routine.jobSlots = []; c.lastAction = 'hobby'; }
  const pool = planSlot(s, { type: 'pool', mode: 'enter', with: ['mio'] }).state;
  const ev = makeEvent(pool, eventTemplate('casual-chat'), { a: pool.playerId, b: 'mio' }, 'backyard');
  ev.tags.push('swim');
  const request = freezeRequest(pool, ev, (r) => r.subjectKey.includes(':outfit:') ? `/cache/${r.subjectKey}.png` : r.kind === 'portrait' ? '/cache/base.png' : null);
  const expected = outfitFor(pool.characters.mio, 'beach', pool.world.day);
  expect(request.prompt).toContain(expected);
  expect(request.references).toBeUndefined();
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
  expect(dressed.prompt).toContain(`Replace the entire outfit with ${week[1]}`);
  expect(dressed.subjectKey).not.toBe(portraitRequest(ren).subjectKey);
  const sheet = spriteRequest(ren, '/dressed.png', week[1]);
  expect(sheet.prompt).toContain(week[1]);
  expect(sheet.subjectKey).not.toBe(spriteRequest(ren, '/dressed.png').subjectKey);
});

it('redresses without carrying signature clothing or accessories into edits and bypasses old outfit assets', () => {
  const c = { ...createGame({ seed: 21 }).characters.ren, appearanceText: 'wearing an apron and a kitchen towel' };
  const outfit = outfitFor(c, 'formal');
  expect(outfit).toMatch(/suit|tuxedo/);
  const r = outfitPortraitRequest(c, outfit, '/approved.png');
  expect(r.prompt).toContain(outfit);
  expect(r.prompt).not.toContain(c.appearanceText);
  expect(r.meta?.appearance).toMatchObject({ outfit, accessory: 'none' });
  expect(r.subjectKey).toContain(':outfit:v2:');
  expect(new AssetLibrary(config.assetsDir).file(r.subjectKey)).toBeNull();
  const walk = spriteRequest(c, '/dressed.png', outfit);
  expect(walk.prompt).not.toContain(c.appearanceText);
  expect(walk.meta?.appearance).toMatchObject({ accessory: 'none' });
  const s = createGame({ seed: 21 });
  s.characters.ren = { ...c, swimming: true };
  const ev = makeEvent(s, eventTemplate('casual-chat'), { a: 'ren', b: 'mio' }, 'backyard');
  const still = freezeRequest(s, ev);
  expect(still.prompt).not.toContain(c.appearanceText);
  expect(still.meta?.people).toEqual(expect.arrayContaining([expect.objectContaining({ appearance: expect.objectContaining({ outfit: outfitFor(c, 'beach'), accessory: 'none' }) })]));
});
