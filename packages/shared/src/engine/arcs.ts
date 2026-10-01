// Personal arcs (Section 5.5F): condition-triggered state machines; beats feed the director as forced candidates.
import type { Arc } from '../contentSchema';
import type { Character, GameState } from '../model';
import type { Rng } from '../rng';
import { content } from '../content';
import { evalAll, type Binding } from './conditions';
import { flag, housemates, rel } from './core';

export function arcFor(c: Character): Arc | undefined {
  const arcs = content().arcs;
  const own = arcs.find((a) => a.charId === c.id);
  if (own) return own;
  const tplId = c.archetypeId ? content().archetypes.find((a) => a.id === c.archetypeId)?.arcTemplate : undefined;
  return tplId ? arcs.find((a) => a.template === tplId) : undefined;
}

export function initArc(s: GameState, c: Character) {
  if (c.isPlayer) return;
  const arc = arcFor(c);
  if (arc) s.arcs[c.id] = { arcId: arc.id, act: 1, done: [], pending: null };
}

export interface ArcBeatCandidate {
  charId: string;
  beatId: string;
  templateId: string;
  binding: Binding;
}

/** Eligible next arc beats this slot (≤1 per character per episode). `available` = ids free to take part. */
export function arcCandidates(s: GameState, rng: Rng, available: Set<string>): ArcBeatCandidate[] {
  const out: ArcBeatCandidate[] = [];
  const hm = housemates(s);
  const ids = hm.map((c) => c.id);
  for (const c of hm) {
    const st = s.arcs[c.id];
    if (!st || st.outcome || !available.has(c.id)) continue;
    if (flag(s, `arcEp_${c.id}`) === s.world.episode || flag(s, `leaving_${c.id}`)) continue;
    const arc = content().arcs.find((a) => a.id === st.arcId);
    if (!arc) continue;
    const beat = arc.beats.find((b) => !st.done.includes(b.id));
    if (!beat) continue;
    const tpl = content().eventById.get(beat.event);
    if (!tpl || !tpl.slots.includes(s.world.slot)) continue;
    const relEp = s.world.episode - c.arrivedEp + 1;
    const minEp = Math.max(0, ...beat.pre.filter((p) => p.episodeMin !== undefined).map((p) => p.episodeMin!));
    if (relEp < minEp) continue;
    // partner "b": the available housemate self trusts most
    const others = hm.filter((o) => o.id !== c.id && available.has(o.id)).sort((x, y) => rel(s, c.id, y.id).trust + rel(s, c.id, y.id).affinity * 0.3 - (rel(s, c.id, x.id).trust + rel(s, c.id, x.id).affinity * 0.3) || (x.id < y.id ? -1 : 1));
    const b = others[0];
    if (!b) continue;
    const binding: Binding = { self: c.id, b: b.id };
    for (const [role, spec] of Object.entries(tpl.roles)) if (spec.outsider) binding[role] = spec.outsider;
    const rest = beat.pre.filter((p) => p.episodeMin === undefined);
    if (!evalAll(s, rest, binding, rng, ids)) continue;
    out.push({ charId: c.id, beatId: beat.id, templateId: tpl.id, binding });
  }
  return out;
}

export function completeBeat(s: GameState, charId: string, beatId: string) {
  const st = s.arcs[charId];
  if (!st || st.done.includes(beatId)) return;
  st.done.push(beatId);
  const arc = content().arcs.find((a) => a.id === st.arcId);
  const beat = arc?.beats.find((b) => b.id === beatId);
  if (beat) st.act = Math.min(3, beat.act + 1);
  if (arc && st.done.length >= arc.beats.length) st.outcome = 'complete';
  s.world.flags[`arcEp_${charId}`] = s.world.episode;
}
