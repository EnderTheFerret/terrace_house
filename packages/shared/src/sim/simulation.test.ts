// Section 5.5P required simulation tests (headless, mock LLM) + M2 200-seed acceptance.
import { beforeAll, describe, expect, it } from 'vitest';
import { activePolicy, idlePolicy, simulateSeason, type SimEvent } from './season';
import { GameState as GameStateSchema, type GameState } from '../model';
import { knows } from '../engine/core';
import { stableStringify } from '../util';
import type { PlannedScene } from '../engine/loop';

const SEEDS = Number(process.env.SIM_SEEDS ?? 200);

interface Sweep {
  errors: string[];
  rangeViolations: string[];
  knowledgeViolations: string[];
  chainViolations: string[];
  npcRomanceSeeds: number;
  meaningful: number[];
  departures: number[];
  arrivals: number[];
  arcBeats: number[];
  gossipChains: number;
  predictionsResolved: number;
  finals: GameState[];
}

function checkRanges(s: GameState, out: string[]) {
  for (const [i, row] of Object.entries(s.rel))
    for (const [j, r] of Object.entries(row)) {
      if (r.affinity < -100 || r.affinity > 100) out.push(`aff ${i}>${j}=${r.affinity}`);
      for (const k of ['romance', 'tension', 'trust', 'closeness'] as const) if (r[k] < 0 || r[k] > 100 || !Number.isFinite(r[k])) out.push(`${k} ${i}>${j}=${r[k]}`);
    }
  for (const c of Object.values(s.characters)) {
    if (c.mood < -1 || c.mood > 1 || !Number.isFinite(c.mood)) out.push(`mood ${c.id}`);
    for (const v of Object.values(c.needs)) if (v < 0 || v > 100) out.push(`need ${c.id}`);
    if (c.age < 20) out.push(`age ${c.id}`);
  }
}

function checkKnowledge(s: GameState, sc: PlannedScene, out: string[]) {
  for (const [speaker, refs] of Object.entries(sc.event.factRefs)) for (const fid of refs) if (!knows(s, speaker, fid)) out.push(`${speaker} references unknown ${fid}`);
}

/** Every told/rumor/overheard entry must come from someone who knew the fact (or its parent) no later. */
function checkChains(s: GameState, out: string[]) {
  for (const [holder, k] of Object.entries(s.knowledge))
    for (const [fid, e] of Object.entries(k)) {
      const f = s.facts[fid];
      if (!f) {
        out.push(`${holder} knows missing fact ${fid}`);
        continue;
      }
      if (e.source === 'self' || e.source === 'witnessed' || e.source === 'broadcast') { // the aired episode is its own source
        if (e.source === 'self' && f.parentId && !s.knowledge[holder]?.[f.parentId]) out.push(`${holder} invented ${fid} without parent`);
        continue;
      }
      if (!e.from) {
        out.push(`${holder}:${fid} has no source`);
        continue;
      }
      const src = s.knowledge[e.from]?.[fid] ?? (f.parentId ? s.knowledge[e.from]?.[f.parentId] : undefined);
      if (!src) out.push(`${holder}:${fid} from ${e.from} who never knew it`);
      else if (src.learnedAt > e.learnedAt) out.push(`${holder}:${fid} learned before source`);
    }
}

const MEANINGFUL = (e: SimEvent) => !e.templateId.startsWith('ix-chat') && !e.templateId.startsWith('ix-awkward') && e.templateId !== 'casual-chat';

function sweep(seeds: number, policyFor: (seed: number) => typeof idlePolicy): Sweep {
  const w: Sweep = { errors: [], rangeViolations: [], knowledgeViolations: [], chainViolations: [], npcRomanceSeeds: 0, meaningful: [], departures: [], arrivals: [], arcBeats: [], gossipChains: 0, predictionsResolved: 0, finals: [] };
  for (let seed = 1; seed <= seeds; seed++) {
    let romance = false;
    try {
      const r = simulateSeason({
        seed,
        policy: policyFor(seed),
        hooks: {
          onPlanned: (s, sc) => checkKnowledge(s, sc, w.knowledgeViolations),
          onSlotEnd: (s) => {
            checkRanges(s, w.rangeViolations);
            const ids = Object.values(s.characters).filter((c) => c.status === 'inHouse' && !c.isPlayer).map((c) => c.id);
            for (const a of ids) for (const b of ids) if (a < b && s.rel[a][b].romance > 60 && s.rel[b][a].romance > 60) romance = true;
          },
        },
      });
      checkChains(r.state, w.chainViolations);
      if (romance) w.npcRomanceSeeds++;
      w.meaningful.push(r.events.filter(MEANINGFUL).length);
      w.departures.push(Object.values(r.state.characters).filter((c) => c.status === 'left').length);
      w.arrivals.push(Object.values(r.state.characters).filter((c) => c.arrivedEp > 1).length);
      w.arcBeats.push(Object.values(r.state.arcs).reduce((a, x) => a + x.done.length, 0));
      if (r.state.log.some((l) => l.kind === 'gossip')) w.gossipChains++;
      w.predictionsResolved += r.state.predictions.filter((p) => p.resolved !== null).length;
      if (seed <= 5) w.finals.push(r.state);
      expect(r.state.seasonOver).toBe(true);
    } catch (e) {
      w.errors.push(`seed ${seed}: ${(e as Error).stack?.slice(0, 400)}`);
    }
  }
  return w;
}

describe(`season simulation, idle player, ${SEEDS} seeds × 24 episodes`, () => {
  let w: Sweep;
  beforeAll(() => {
    w = sweep(SEEDS, () => idlePolicy);
  });
  it('no exceptions', () => expect(w.errors).toEqual([]));
  it('matrices, moods and needs stay in range', () => expect(w.rangeViolations.slice(0, 5)).toEqual([]));
  it('knowledge invariant: no proposal references an unknown fact', () => expect(w.knowledgeViolations.slice(0, 5)).toEqual([]));
  it('gossip never creates a fact with no source chain', () => expect(w.chainViolations.slice(0, 5)).toEqual([]));
  it('NPC–NPC mutual romance emerges in a non-trivial fraction of seeds', () => {
    const frac = w.npcRomanceSeeds / SEEDS;
    expect(frac).toBeGreaterThan(0.05);
    expect(frac).toBeLessThan(0.95);
  });
  it('idle season still produces meaningful events, departures, arrivals, arc beats and gossip', () => {
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(Math.min(...w.meaningful)).toBeGreaterThanOrEqual(30);
    expect(Math.min(...w.departures)).toBeGreaterThanOrEqual(1);
    expect(avg(w.arrivals)).toBeGreaterThanOrEqual(1);
    expect(avg(w.arcBeats)).toBeGreaterThanOrEqual(5);
    expect(w.gossipChains / SEEDS).toBeGreaterThan(0.3);
  });
  it('predictions get resolved during seasons', () => expect(w.predictionsResolved).toBeGreaterThan(0));
  it('final states validate against the GameState schema', () => {
    for (const s of w.finals) {
      const r = GameStateSchema.safeParse(s);
      expect(r.success, r.success ? '' : r.error.message.slice(0, 500)).toBe(true);
    }
  });
});

describe('season simulation, active player', () => {
  it('runs 30 seeds without exceptions and with valid knowledge chains', () => {
    const w = sweep(30, (seed) => activePolicy(seed));
    expect(w.errors).toEqual([]);
    expect(w.rangeViolations.slice(0, 5)).toEqual([]);
    expect(w.knowledgeViolations.slice(0, 5)).toEqual([]);
    expect(w.chainViolations.slice(0, 5)).toEqual([]);
  });
});

describe('determinism', () => {
  it('same seed + same actions → identical event logs and final state', () => {
    for (const seed of [3, 17, 101]) {
      const a = simulateSeason({ seed, policy: activePolicy(seed) });
      const b = simulateSeason({ seed, policy: activePolicy(seed) });
      expect(stableStringify(a.events)).toBe(stableStringify(b.events));
      expect(stableStringify(a.state)).toBe(stableStringify(b.state));
    }
  });
  it('random-cast seasons are deterministic too', () => {
    const a = simulateSeason({ seed: 8, randomizeCast: true });
    const b = simulateSeason({ seed: 8, randomizeCast: true });
    expect(stableStringify(a.state.log)).toBe(stableStringify(b.state.log));
  });
});
