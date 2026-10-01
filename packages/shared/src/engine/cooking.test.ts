import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../rng';
import { content } from '../content';
import {
  applyCooking, availableSteps, beginStep, chopBeats, completeStep, quality, reception, receptionDeltas, recipeById, scoreBoil, scoreChop,
  scorePlate, scoreSaute, scoreSeason, startCooking, timeFactor,
} from './cooking';
import { createGame } from './loop';

const R = mulberry32(99);
const N = 400;
const inUnit = (x: number) => x >= 0 && x <= 1 && Number.isFinite(x);

describe('cooking step scores: always in [0,1]', () => {
  it('chop', () => {
    for (let i = 0; i < N; i++) {
      const beats = chopBeats({ beats: R.int(1, 16), bpm: R.int(60, 160) });
      const hits = Array.from({ length: R.int(0, 30) }, () => R.next() * 15000 - 500);
      expect(inUnit(scoreChop(beats, hits, R.int(50, 300)))).toBe(true);
    }
  });
  it('boil / season / plate / saute', () => {
    for (let i = 0; i < N; i++) {
      const lo = R.next() * 20;
      expect(inUnit(scoreBoil(R.next() * 40 - 5, [lo, lo + R.next() * 5]))).toBe(true);
      expect(inUnit(scoreSeason(R.next() * 2 - 0.5, R.next(), R.next() * 0.5 + 0.01))).toBe(true);
      const layout = [{ id: 'a', x: R.next(), y: R.next() }, { id: 'b', x: R.next(), y: R.next() }];
      expect(inUnit(scorePlate([{ id: 'a', x: R.next() * 3 - 1, y: R.next() }], layout))).toBe(true);
      const holds = Array.from({ length: R.int(0, 300) }, () => R.chance(0.5));
      expect(inUnit(scoreSaute(holds, { duration: 12, bandWidth: R.next(), bandSpeed: R.next(), heatRate: R.next(), coolRate: R.next() }))).toBe(true);
    }
  });
});

describe('cooking step scores: monotone in accuracy', () => {
  it('chop: closer hits never score lower', () => {
    for (let i = 0; i < N; i++) {
      const beats = chopBeats({ beats: R.int(2, 12), bpm: R.int(80, 140) });
      const w = R.int(80, 250);
      const offs = beats.map(() => (R.next() * 2 - 1) * w);
      const k = R.next();
      const far = beats.map((b, j) => b + offs[j]);
      const near = beats.map((b, j) => b + offs[j] * k);
      expect(scoreChop(beats, near, w)).toBeGreaterThanOrEqual(scoreChop(beats, far, w) - 1e-9);
    }
  });
  it('boil: stopping closer to the window never scores lower', () => {
    for (let i = 0; i < N; i++) {
      const lo = 5 + R.next() * 10;
      const hi = lo + 1 + R.next() * 3;
      const d1 = R.next() * 6;
      const d2 = d1 * R.next();
      expect(scoreBoil(hi + d2, [lo, hi])).toBeGreaterThanOrEqual(scoreBoil(hi + d1, [lo, hi]));
      expect(scoreBoil(lo - d2, [lo, hi])).toBeGreaterThanOrEqual(scoreBoil(lo - d1, [lo, hi]));
    }
    expect(scoreBoil(9, [8, 10])).toBe(1);
  });
  it('season and plate: closer to the optimum / layout never scores lower', () => {
    for (let i = 0; i < N; i++) {
      const o = R.next();
      const t = 0.1 + R.next() * 0.4;
      const d = R.next() * 0.6;
      expect(scoreSeason(o + d * R.next(), o, t)).toBeGreaterThanOrEqual(scoreSeason(o + d, o, t));
      const ref = [{ id: 'a', x: 0.5, y: 0.5 }];
      const dx = R.next() * 0.4;
      expect(scorePlate([{ id: 'a', x: 0.5 + dx * R.next(), y: 0.5 }], ref)).toBeGreaterThanOrEqual(scorePlate([{ id: 'a', x: 0.5 + dx, y: 0.5 }], ref));
    }
  });
  it('quality is a monotone weighted mean, penalized past the time budget', () => {
    const r = recipeById('curry-rice');
    for (let i = 0; i < N; i++) {
      const scores = Object.fromEntries(r.steps.map((s) => [s.id, R.next()]));
      const better = Object.fromEntries(Object.entries(scores).map(([k, v]) => [k, Math.min(1, v + R.next() * 0.3)]));
      const q = quality(r, scores, r.timeBudget);
      expect(inUnit(q)).toBe(true);
      expect(quality(r, better, r.timeBudget)).toBeGreaterThanOrEqual(q - 1e-9);
      expect(quality(r, scores, r.timeBudget * 1.5)).toBeLessThanOrEqual(q + 1e-9);
    }
    expect(quality(r, Object.fromEntries(r.steps.map((s) => [s.id, 1])), 10)).toBe(1);
    expect(timeFactor(300, 100)).toBe(0.5);
  });
  it('reception r = q·clamp(0.5+cos/2) and the delta map is monotone', () => {
    const t = [1, 0, 0, 0, 0, 0];
    expect(reception(1, t, [1, 0, 0, 0, 0, 0])).toBeCloseTo(1);
    expect(reception(1, t, [-1, 0, 0, 0, 0, 0])).toBeCloseTo(0);
    expect(reception(0.5, t, [0, 1, 0, 0, 0, 0])).toBeCloseTo(0.25);
    let prev = receptionDeltas(0);
    for (let x = 0.01; x <= 1; x += 0.01) {
      const d = receptionDeltas(x);
      expect(d.affinity).toBeGreaterThanOrEqual(prev.affinity);
      expect(d.mood).toBeGreaterThanOrEqual(prev.mood);
      prev = d;
    }
  });
});

describe('cooking state machine', () => {
  it('ships ≥8 recipes with varied DAGs that all validate', () => {
    const rs = content().recipes;
    expect(rs.length).toBeGreaterThanOrEqual(8);
    const shapes = new Set(rs.map((r) => r.steps.map((s) => `${s.type}:${s.deps.length}`).join(',')));
    expect(shapes.size).toBe(rs.length);
    for (const r of rs) for (const s of r.steps) for (const d of s.deps) expect(r.steps.some((x) => x.id === d)).toBe(true);
  });
  it('respects dependencies; independent steps in any order; finishes with a quality', () => {
    const r = recipeById('miso-soup');
    let cs = startCooking(r);
    expect(availableSteps(cs, r).map((s) => s.id).sort()).toEqual(['dashi', 'scallion', 'tofu']);
    expect(() => beginStep(cs, r, 'miso')).toThrow();
    for (const id of ['scallion', 'dashi', 'tofu', 'miso', 'plate']) {
      cs = beginStep(cs, r, id);
      cs = completeStep(cs, r, id, 0.8, 5);
    }
    expect(cs.done).toBe(true);
    expect(cs.quality).toBeCloseTo(0.8);
  });
  it('a co-op partner auto-plays a subset of steps (never plating)', () => {
    const r = recipeById('nabe');
    const cs = startCooking(r, { id: 'ren', skill: 0.9 }, mulberry32(1));
    const partnerSteps = r.steps.filter((s) => cs.steps[s.id].by === 'partner');
    expect(partnerSteps.length).toBeGreaterThan(0);
    expect(partnerSteps.some((s) => s.type === 'plate')).toBe(false);
  });
  it('applyCooking converts reception into affinity/mood deltas toward the cook', () => {
    const s = createGame({ seed: 2 });
    const before = s.rel.ren.player.affinity;
    const good = applyCooking(s, { recipeId: 'curry-rice', quality: 1, cook: 'player', servedTo: ['ren', 'kaito', 'mio'] });
    const bad = applyCooking(s, { recipeId: 'curry-rice', quality: 0, cook: 'player', servedTo: ['ren', 'kaito', 'mio'] });
    expect(good.state.rel.ren.player.affinity).toBeGreaterThan(bad.state.rel.ren.player.affinity);
    expect(bad.state.rel.ren.player.affinity).toBeLessThanOrEqual(before);
    expect(good.receptions).toHaveLength(3);
    expect(s.house.fridge.curry).toBe(1); // input untouched (pure)
    expect(good.state.house.fridge.curry).toBe(0);
  });
});
