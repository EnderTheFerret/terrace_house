// Relationship deltas: validation, clamping, application, drama scalar.
import type { DeltaProposal, GameState } from '../model';
import { DeltaProposal as DeltaProposalSchema } from '../model';
import { clamp } from '../util';
import { MAX_SCENE_DELTA, addMemory, addRel, asym, housemates, rel, romanceGap } from './core';

/** Clamp every delta to ±MAX_SCENE_DELTA (mood to ±0.3), drop unknown ids/self pairs, merge duplicates. */
export function sanitizeProposal(raw: unknown, validIds: readonly string[], maxDelta = MAX_SCENE_DELTA): DeltaProposal {
  const parsed = DeltaProposalSchema.safeParse(raw);
  const p: DeltaProposal = parsed.success
    ? parsed.data
    : { affinityDeltas: [], romanceDeltas: [], tensionDeltas: [], trustDeltas: [], newMemories: [], moodDeltas: [] };
  const ok = new Set(validIds);
  const dir = (arr: DeltaProposal['affinityDeltas']) => {
    const merged = new Map<string, { from: string; to: string; delta: number }>();
    for (const d of arr) {
      if (!ok.has(d.from) || !ok.has(d.to) || d.from === d.to || !Number.isFinite(d.delta)) continue;
      const k = `${d.from}>${d.to}`;
      const cur = merged.get(k);
      const delta = clamp((cur?.delta ?? 0) + d.delta, -maxDelta, maxDelta);
      merged.set(k, { from: d.from, to: d.to, delta });
    }
    return [...merged.values()];
  };
  return {
    affinityDeltas: dir(p.affinityDeltas),
    romanceDeltas: dir(p.romanceDeltas),
    tensionDeltas: dir(p.tensionDeltas),
    trustDeltas: dir(p.trustDeltas),
    newMemories: p.newMemories.filter((m) => ok.has(m.charId)).slice(0, 12),
    moodDeltas: p.moodDeltas
      .filter((m) => ok.has(m.charId) && Number.isFinite(m.delta))
      .map((m) => ({ charId: m.charId, delta: clamp(m.delta, -0.3, 0.3) })),
  };
}

export function applyProposal(s: GameState, p: DeltaProposal, participants: string[]) {
  for (const d of p.affinityDeltas) addRel(s, d.from, d.to, 'affinity', d.delta);
  for (const d of p.romanceDeltas) addRel(s, d.from, d.to, 'romance', d.delta);
  for (const d of p.tensionDeltas) addRel(s, d.from, d.to, 'tension', d.delta);
  for (const d of p.trustDeltas) addRel(s, d.from, d.to, 'trust', d.delta);
  for (const m of p.moodDeltas) {
    const c = s.characters[m.charId];
    if (c) c.mood = clamp(c.mood + m.delta, -1, 1);
  }
  for (const m of p.newMemories) addMemory(s, m.charId, m.text, participants, m.salience);
  // shared time raises closeness
  for (const a of participants) for (const b of participants) if (a !== b) addRel(s, a, b, 'closeness', 2);
}

/** Drama = Σ_ij tension + asym + romanceGap over in-house ordered pairs. */
export function drama(s: GameState): number {
  const ids = housemates(s).map((c) => c.id);
  let d = 0;
  for (const i of ids)
    for (const j of ids) {
      if (i === j) continue;
      d += rel(s, i, j).tension + asym(s, i, j) / 2 + romanceGap(s, i, j);
    }
  return d;
}

/** Drama contribution of a single ordered pair, using hypothetical values. */
export function pairDrama(t: number, affIJ: number, affJI: number, romIJ: number, romJI: number) {
  return t + Math.abs(affIJ - affJI) / 2 + Math.max(0, romIJ - romJI);
}
