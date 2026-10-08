// Relationship deltas: validation, clamping, application, drama scalar.
import type { DeltaProposal, GameState } from '../model';
import { DeltaProposal as DeltaProposalSchema } from '../model';
import { clamp, uk } from '../util';
import { FEELING_SCALE, MAX_SCENE_DELTA, addMemory, addRel, asym, attracted, belief, firstName, housemates, rel, romanceGap } from './core';
import { affinityFit } from './castgen';

export const hasFeelingDeltas = (p: DeltaProposal) =>
  [p.affinityDeltas, p.romanceDeltas, p.tensionDeltas, p.trustDeltas].some((ds) => ds.some((d) => d.delta !== 0));

/** A small affinity drift per half-hour together, independent of action chunk sizes. */
export function sharedTimeAffinity(s: GameState, minutes: number) {
  const awake = housemates(s).filter((c) => !['sleep', 'nap', 'shower', 'work'].includes(c.lastAction ?? '') && !['bathroom', 'smallBathroom', 'house'].includes(c.location));
  for (let i = 0; i < awake.length; i++) for (const b of awake.slice(i + 1)) {
    const a = awake[i];
    if (a.location !== b.location) continue;
    const key = `sharedMinutes:${uk(a.id, b.id)}`;
    const before = Number(s.world.flags[key] ?? 0);
    const after = before + minutes;
    s.world.flags[key] = after;
    const steps = Math.floor(after / 30) - Math.floor(before / 30);
    if (!steps) continue;
    const delta = steps * Math.round(0.15 * affinityFit(a.persona, b.persona).score * 1e6) / 1e6;
    for (const [from, to] of [[a.id, b.id], [b.id, a.id]]) {
      addRel(s, from, to, 'affinity', delta);
      rel(s, from, to).affinity = Math.round(rel(s, from, to).affinity * 1e6) / 1e6;
    }
  }
}

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

/** Model-written memories sometimes use ids ("Hana and player make plans"); write them with the people's real first names. */
export function nameMemories(s: GameState, p: DeltaProposal): DeltaProposal {
  const ids = Object.keys(s.characters).sort((a, b) => b.length - a.length);
  const byId = new Map(ids.map((id) => [id.toLowerCase(), id]));
  const re = new RegExp(`\\b(?:the )?(${ids.map((id) => id.replace(/[-]/g, '\\-')).join('|')})\\b`, 'gi');
  // "the player" → "Adam" as well as "hana" → "Noga"
  const fix = (t: string) => t.replace(re, (_, w: string) => firstName(s, byId.get(w.toLowerCase())!));
  return { ...p, newMemories: p.newMemories.map((m) => ({ ...m, text: fix(m.text) })) };
}

/** Romance only grows where the feeling one is attracted to the other; a model reading can't make Ron fall for Adam. */
export function dropUnattracted(s: GameState, p: DeltaProposal): DeltaProposal {
  return { ...p, romanceDeltas: p.romanceDeltas.filter((d) => d.delta < 0 || (s.characters[d.from] && s.characters[d.to] && attracted(s.characters[d.from], s.characters[d.to]))) };
}

export function applyProposal(s: GameState, p: DeltaProposal, participants: string[]) {
  for (const d of p.affinityDeltas) addRel(s, d.from, d.to, 'affinity', d.delta * FEELING_SCALE);
  for (const d of p.romanceDeltas) addRel(s, d.from, d.to, 'romance', d.delta * FEELING_SCALE);
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

type Directed = DeltaProposal['affinityDeltas'];
/** a·ka − b·kb per from→to pair, dropping pairs that cancel out. */
function minus(a: Directed, b: Directed, ka = 1, kb = 1): Directed {
  const net = new Map<string, number>();
  for (const [list, k] of [[a, ka], [b, -kb]] as const) for (const d of list) net.set(`${d.from}>${d.to}`, (net.get(`${d.from}>${d.to}`) ?? 0) + k * d.delta);
  return [...net].filter(([, delta]) => Math.abs(delta) >= 0.05).map(([k, delta]) => { const [from, to] = k.split('>'); return { from, to, delta }; });
}

/**
 * What re-reading a scene changes: the model's fresh read minus what the scene already applied, plus the fresh memories.
 * `appliedScale` is the FEELING_SCALE the scene was applied under (1 before scaling existed), so older scenes are re-based
 * to today's scale. The result is the exact change to apply; trust and tension are unscaled.
 */
export function rereadChange(next: DeltaProposal, applied: DeltaProposal, appliedScale = 1): DeltaProposal {
  // a pair the reading leaves out keeps what the scene gave it: silence about trust is not a verdict of "no trust gained"
  const read = (a: Directed, b: Directed) => b.filter((d) => a.some((x) => x.from === d.from && x.to === d.to));
  return {
    affinityDeltas: minus(next.affinityDeltas, read(next.affinityDeltas, applied.affinityDeltas), FEELING_SCALE, appliedScale),
    romanceDeltas: minus(next.romanceDeltas, read(next.romanceDeltas, applied.romanceDeltas), FEELING_SCALE, appliedScale),
    tensionDeltas: minus(next.tensionDeltas, read(next.tensionDeltas, applied.tensionDeltas)),
    trustDeltas: minus(next.trustDeltas, read(next.trustDeltas, applied.trustDeltas)),
    newMemories: next.newMemories,
    moodDeltas: [], // ponytail: mood is not re-derived; add if re-reads should move moods too
  };
}

/** Apply the net correction and fresh memories without a second dose of shared-time closeness. */
export function applyReread(s: GameState, sceneId: string, change: DeltaProposal, participants: string[], markReread = true, boardChange = change, episode?: number) {
  for (const field of ['affinity', 'romance'] as const) for (const d of field === 'affinity' ? change.affinityDeltas : change.romanceDeltas) {
    addRel(s, d.from, d.to, field, d.delta);
  }
  for (const field of ['affinity', 'romance'] as const) for (const d of field === 'affinity' ? boardChange.affinityDeltas : boardChange.romanceDeltas) {
    // Keep the player's noisy estimate, correcting only the conversation they experienced.
    const known = s.beliefs[s.playerId]?.[`${d.from}>${d.to}`];
    if (d.from !== s.playerId && (participants.includes(s.playerId) || (known?.conf ?? 0) >= 0.12)) {
      const be = belief(s, s.playerId, d.from, d.to);
      be[field] = clamp(be[field] + d.delta, field === 'affinity' ? -100 : 0, 100);
      be.conf = Math.max(be.conf, 0.45);
    }
  }
  for (const d of change.tensionDeltas) addRel(s, d.from, d.to, 'tension', d.delta);
  for (const d of change.trustDeltas) addRel(s, d.from, d.to, 'trust', d.delta);
  for (const m of change.newMemories) {
    addMemory(s, m.charId, m.text, participants, m.salience);
    // a scene from an earlier day is remembered as that day's, not today's
    if (episode !== undefined) s.memory[m.charId].at(-1)!.episode = episode;
  }
  if (markReread) s.world.flags[`reread:${sceneId}`] = true;
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
