import { expect, it } from 'vitest';
import { createGame, passTime } from './loop';
import { affinityFit } from './castgen';
import { sharedTimeAffinity } from './relationships';
import { pairSummaryText } from './memory';
import { GameState } from '../model';

function pair(matched: boolean) {
  const s = createGame({ seed: 31 });
  for (const c of Object.values(s.characters)) {
    c.status = c.isPlayer || c.id === 'ren' ? 'inHouse' : 'left';
    c.location = 'living';
    c.lastAction = 'hobby';
    c.activityUntil = 180;
  }
  const a = s.characters[s.playerId], b = s.characters.ren;
  for (const c of [a, b]) {
    c.persona.traits = [0.5, 0.5, 0.5, 0.95, 0.05];
    c.persona.values = ['loyalty', 'family', 'security'];
    c.persona.conflictStyle = 'mediate';
    c.persona.attachment = 'secure';
    c.persona.diet = 'omnivore';
    c.persona.kashrut = 'none';
    c.persona.keepsShabbat = false;
    c.persona.speech.humor = 'dry';
  }
  if (!matched) {
    a.persona.traits = [0, 0.5, 0, 0.1, 0.9]; b.persona.traits = [1, 0.5, 1, 0.1, 0.9];
    a.persona.values = ['honesty', 'ambition', 'freedom']; b.persona.values = ['harmony', 'fun', 'family'];
    a.persona.conflictStyle = 'confront'; b.persona.conflictStyle = 'avoid';
    a.persona.attachment = 'anxious'; b.persona.attachment = 'avoidant';
    b.persona.diet = 'vegan'; b.persona.keepsShabbat = true;
  }
  s.rel[a.id][b.id].affinity = s.rel[b.id][a.id].affinity = 0;
  return { s, a, b };
}

it.each([true, false])('drifts both ways slowly during shared time, with chunk-stable replay inputs (matched=%s)', (matched) => {
  const { s, a, b } = pair(matched);
  const whole = passTime(s, 20, [b.id]);
  const split = passTime(passTime(passTime(s, 5, [b.id]), 5, [b.id]), 10, [b.id]);
  expect(split).toEqual(whole);
  const affinity = whole.rel[a.id][b.id].affinity;
  expect(matched ? affinity > 0 : affinity < 0).toBe(true);
  expect(Math.abs(affinity)).toBeLessThanOrEqual(0.6);
  expect(whole.rel[b.id][a.id].affinity).toBe(affinity);
  expect(whole.rel[a.id][b.id].romance).toBe(s.rel[a.id][b.id].romance);
  expect(whole.rel[a.id][b.id].trust).toBe(s.rel[a.id][b.id].trust);
  expect(GameState.safeParse(whole).success).toBe(true);
  expect(pairSummaryText(whole, a.id, b.id)).toContain(matched ? 'brings them closer' : 'wears on them');
});

it('does not drift apart when separated, sleeping, working, showering, or absent', () => {
  for (const mode of ['separate', 'sleep', 'work', 'shower', 'left', 'arriving']) {
    const { s, a, b } = pair(false);
    if (mode === 'separate') b.location = 'kitchen';
    else if (mode === 'left' || mode === 'arriving') b.status = mode;
    else b.lastAction = mode;
    sharedTimeAffinity(s, 120);
    expect(s.rel[a.id][b.id].affinity, mode).toBe(0);
    expect(pairSummaryText(s, a.id, b.id)).not.toContain('Time together');
  }
});

it('includes attachment, diet, kashrut and Shabbat fit, while retaining fresh diary notes', () => {
  const { s, a, b } = pair(true);
  const good = affinityFit(a.persona, b.persona).score;
  a.persona.attachment = 'anxious'; b.persona.attachment = 'avoidant';
  b.persona.diet = 'vegan'; b.persona.kashrut = 'strict'; b.persona.keepsShabbat = true;
  const fit = affinityFit(a.persona, b.persona);
  expect(fit.score).toBeLessThan(good);
  expect(fit.reasons).toEqual(['needs for reassurance and space', 'meal routines', 'Shabbat routines']);
  sharedTimeAffinity(s, 60);
  s.pairNotes[`${a.id}>${b.id}`] = { episode: s.world.episode, text: 'We laughed over coffee. '.repeat(20) };
  const text = pairSummaryText(s, a.id, b.id);
  expect(text).toContain('We laughed over coffee.');
  expect(text).toContain('Time together');
  expect(text.length).toBeLessThanOrEqual(300);
  // Stronger clashes can cross zero and stop at the existing affinity boundary.
  const bad = pair(false);
  bad.s.rel[bad.a.id][bad.b.id].affinity = -99.9;
  sharedTimeAffinity(bad.s, 120);
  expect(bad.s.rel[bad.a.id][bad.b.id].affinity).toBe(-100);
});
