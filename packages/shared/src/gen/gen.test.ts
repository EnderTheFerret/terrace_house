import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../rng';
import { createGame, makeEvent } from '../engine/loop';
import { eventTemplate, content } from '../content';
import { mockBeatSheet, mockLine, mockCommentary, type LineContext } from './mock';
import { BeatSheet, Commentary, DeltaProposal } from '../model';
import { voiceDistanceMatrix, voiceCheck } from './voice';
import { engineProposal } from '../engine/outcome';
import { proposeCondition } from '../engine/predictions';
import { compileAppearancePrompt, compileAppearanceTags, sanitizePromptText, GLOBAL_NEGATIVE } from '../appearance';
import { simulateSeason, activePolicy } from '../sim/season';
import { palette, locationPixels, spritePixels } from '../pixel';

describe('mock LLM outputs validate for every schema', () => {
  it('beat sheets, deltas and commentary validate for all templates', () => {
    const s = createGame({ seed: 11 });
    const rng = mulberry32(1);
    let n = 0;
    for (const t of content().events) {
      const roles: Record<string, string> = {};
      const ids = ['player', 'ren', 'mio', 'kaito'];
      Object.keys(t.roles).forEach((r, i) => (roles[r] = t.roles[r].outsider ?? (r === 'self' ? 'ren' : ids[i % ids.length])));
      const ev = makeEvent(s, t, roles, t.location.startsWith('type:') || t.location === 'player-node' || t.location === 'any' ? 'living' : t.location);
      const sheet = mockBeatSheet(s, rng, ev).sheet;
      expect(BeatSheet.safeParse(sheet).success, t.id).toBe(true);
      expect(DeltaProposal.safeParse(engineProposal(s, rng, ev, {})).success, t.id).toBe(true);
      const cm = mockCommentary(s, rng, ev, undefined, proposeCondition(s, rng));
      expect(Commentary.safeParse(cm.commentary).success, t.id).toBe(true);
      n++;
    }
    expect(n).toBeGreaterThan(40);
  });

  it('commentary validates for 100% of mock outputs across a simulated season', () => {
    const r = simulateSeason({ seed: 4, policy: activePolicy(4) });
    const rng = mulberry32(2);
    let total = 0;
    for (const e of r.events.slice(0, 120)) {
      const t = eventTemplate(e.templateId);
      const roles: Record<string, string> = {};
      const live = Object.values(r.state.characters).map((c) => c.id);
      Object.keys(t.roles).forEach((role, i) => (roles[role] = t.roles[role].outsider ?? live[i % live.length]));
      const ev = makeEvent(r.state, t, roles, 'living');
      const cm = mockCommentary(r.state, rng, ev, e.outcome as never, proposeCondition(r.state, rng));
      expect(Commentary.safeParse(cm.commentary).success).toBe(true);
      total++;
    }
    expect(total).toBeGreaterThan(50);
  });
});

describe('voice', () => {
  function sample(seed: number) {
    const s = createGame({ seed });
    const rng = mulberry32(seed);
    const cast = ['ren', 'kaito', 'shun', 'mio', 'sora'];
    const out: Record<string, { lines: string[]; fillers: string[] }> = {};
    const ctx: LineContext = { place: 'kitchen', listener: 'Yui', catchphraseUses: {}, lineCounts: {} };
    for (const id of cast) out[id] = { lines: [], fillers: s.characters[id].persona.speech.fillers };
    const types = ['open', 'smalltalk', 'probe', 'tease', 'joke', 'comfort', 'close', 'conflict', 'deflect', 'flirt'] as const;
    for (let i = 0; i < 200; i++)
      for (const id of cast) {
        const bt = types[i % types.length];
        out[id].lines.push(mockLine(s, rng, { speaker: id, intent: bt, emotion: 'neutral', beatType: bt, subtext: '', depth: 'smalltalk', topic: 'dinner' }, ctx));
      }
    return { out, ctx, s };
  }
  it('default cast voices are distinct (mean pairwise distance above threshold)', () => {
    const { out } = sample(1);
    const { ids, matrix } = voiceDistanceMatrix(out);
    let sum = 0;
    let n = 0;
    let min = Infinity;
    for (let i = 0; i < ids.length; i++)
      for (let j = i + 1; j < ids.length; j++) {
        sum += matrix[i][j];
        n++;
        min = Math.min(min, matrix[i][j]);
      }
    expect(sum / n).toBeGreaterThan(0.35);
    expect(min).toBeGreaterThan(0.08);
  });
  it('catchphrase usage respects each persona cap', () => {
    const { out, s } = sample(2);
    for (const [id, { lines }] of Object.entries(out)) {
      const cp = s.characters[id].persona.speech.catchphrase;
      if (!cp) continue;
      const rate = lines.filter((l) => l.includes(cp.text)).length / lines.length;
      expect(rate, id).toBeLessThanOrEqual(cp.maxRate + 1e-9);
    }
  });
  it('voice check flags meta phrases and over-long sentences', () => {
    const s = createGame({ seed: 1 });
    const sp = s.characters.ren.persona.speech;
    expect(voiceCheck('Rice is ready...', sp).ok).toBe(true);
    expect(voiceCheck('As an AI language model I cannot cook.', sp).ok).toBe(false);
    expect(voiceCheck('I would like to take this opportunity to explain at very great length exactly how much I appreciate everyone in this lovely house today.', sp).ok).toBe(false);
  });
});

describe('compileAppearancePrompt', () => {
  const base = { age: 24, gender: 'woman' as const, appearance: { hairStyle: 'long', hairColor: 'black', eyeColor: 'brown', build: 'slim', outfit: 'school uniform cardigan', accessory: 'none', skinTone: 'fair' } };
  it('always includes an adult tag and safety negatives', () => {
    const p = compileAppearancePrompt(base, 'portrait');
    expect(p.positive).toContain('adult');
    expect(p.positive).toContain('24-year-old adult woman');
    expect(p.negative).toBe(GLOBAL_NEGATIVE);
    expect(p.negative).toContain('child');
  });
  it('strips minors-coded terms', () => {
    const p = compileAppearancePrompt(base, 'portrait', { scene: 'a teen schoolgirl in class' });
    expect(p.positive).not.toMatch(/school uniform|schoolgirl|\bteen\b/i);
    expect(sanitizePromptText('cute little girl smiling')).not.toMatch(/little girl/);
  });
  it('is deterministic with stable tag order and clamps age to ≥20', () => {
    expect(compileAppearancePrompt(base, 'bust')).toEqual(compileAppearancePrompt(base, 'bust'));
    expect(compileAppearanceTags({ ...base, age: 16 })[0]).toBe('20-year-old adult woman');
  });
});

it('uses sampled portrait colors in sprites and draws distinct house locations offline', () => {
  const a = createGame({ seed: 1 }).characters.ren.appearance;
  const sampled = { hair: '#123456', skin: '#654321', outfit: '#abcdef' };
  expect(palette({ ...a, palette: sampled })).toMatchObject(sampled);
  expect(spritePixels({ ...a, palette: sampled }, 'down', 1).flat()).toContain(sampled.outfit);
  expect(locationPixels('kitchen', 'day', 'sunny')).not.toEqual(locationPixels('living', 'day', 'sunny'));
  expect(locationPixels('house', 'night', 'sunny')).toEqual(locationPixels('house', 'night', 'sunny'));
});
