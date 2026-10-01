// Event Director (Section 5.1): candidates from templates, role binding, scoring, softmax sampling.
import type { EventTemplate } from '../contentSchema';
import type { Character, GameState } from '../model';
import type { Rng } from '../rng';
import { softmaxSample } from '../rng';
import { content } from '../content';
import { attracted, housemates, isRoom, rel } from './core';
import { evalAll, type Binding } from './conditions';
import { pairDrama } from './relationships';

export interface DirectorWeights {
  drama: number;
  variety: number;
  pacing: number;
  player: number;
}
export const DEFAULT_WEIGHTS: DirectorWeights = { drama: 1, variety: 1, pacing: 1, player: 1 };
export const MAX_CONFESSIONS = 8;
export const MAX_FAREWELLS = 12;

export interface Candidate {
  template: EventTemplate;
  binding: Binding;
  location: string;
  score: number;
  parts: { D: number; V: number; P: number; U: number };
}

export const housemateRoles = (t: EventTemplate) => Object.entries(t.roles).filter(([, r]) => !r.outsider).map(([k]) => k);

/** Expected ΔDrama of applying a template's drama profile under a binding. */
export function expectedDrama(s: GameState, t: EventTemplate, b: Binding): number {
  const touched = new Map<string, { aff: number; rom: number; ten: number }>();
  const get = (i: string, j: string) => {
    const k = `${i}>${j}`;
    if (!touched.has(k)) touched.set(k, { aff: 0, rom: 0, ten: 0 });
    return touched.get(k)!;
  };
  for (const [x, y, d] of t.drama.affinity) if (b[x] && b[y]) get(b[x], b[y]).aff += d;
  for (const [x, y, d] of t.drama.romance) if (b[x] && b[y]) get(b[x], b[y]).rom += d;
  for (const [x, y, d] of t.drama.tension) if (b[x] && b[y]) get(b[x], b[y]).ten += d;
  let delta = 0;
  for (const [k, d] of touched) {
    const [i, j] = k.split('>');
    if (!s.characters[i] || !s.characters[j]) continue;
    const r = rel(s, i, j);
    const rr = rel(s, j, i);
    const back = touched.get(`${j}>${i}`) ?? { aff: 0, rom: 0, ten: 0 };
    const before = pairDrama(r.tension, r.affinity, rr.affinity, r.romance, rr.romance);
    const after = pairDrama(
      Math.min(100, Math.max(0, r.tension + d.ten)),
      r.affinity + d.aff,
      rr.affinity + back.aff,
      Math.min(100, Math.max(0, r.romance + d.rom)),
      Math.min(100, Math.max(0, rr.romance + back.rom)),
    );
    delta += after - before;
  }
  // romance build-up also counts as drama potential (confession pressure)
  for (const [x, y, d] of t.drama.romance) if (b[x] && b[y] && d > 0) delta += d * 0.3;
  return delta;
}

export function varietyPenalty(s: GameState, t: EventTemplate): number {
  const recent = s.history.slice(-15);
  const sameType = recent.filter((h) => h.type === t.type).length;
  const sameId = s.history.slice(-30).filter((h) => h.templateId === t.id).length;
  return 0 - (0.6 * sameType + 0.8 * sameId);
}

export function pacingScore(s: GameState, t: EventTemplate): number {
  let p = 0;
  const last3 = s.history.slice(-3);
  const peakRecently = last3.some((h) => h.tags.includes('peak'));
  if (t.peak && peakRecently) p -= 1.5;
  if (t.peak && s.world.episode < 3) p -= 1;
  if (!t.peak && peakRecently && (t.tags.includes('quiet') || t.tags.includes('light'))) p += 0.5;
  if (t.tags.includes('confession') && s.budgets.confessions >= MAX_CONFESSIONS) p -= 6;
  if (t.tags.includes('farewell') && s.budgets.farewells >= MAX_FAREWELLS) p -= 6;
  // late season leans into romance peaks
  if (t.peak && s.world.episode > s.seasonLength * 0.6) p += 0.4;
  return p;
}

export function playerScore(s: GameState, b: Binding, focus?: string): number {
  const ids = Object.values(b);
  let u = 0;
  if (ids.some((id) => s.recentPlayerTargets.includes(id))) u += 0.8;
  if (focus && ids.includes(focus)) u += 1.5;
  if (ids.includes(s.playerId)) u += 0.3;
  return u;
}

export function scoreCandidate(s: GameState, t: EventTemplate, b: Binding, w: DirectorWeights = DEFAULT_WEIGHTS, focus?: string) {
  const D = expectedDrama(s, t, b) / 20;
  const V = varietyPenalty(s, t);
  const P = pacingScore(s, t);
  const U = playerScore(s, b, focus);
  return { score: Math.log(Math.max(t.weight, 0.01)) + w.drama * D + w.variety * V + w.pacing * P + w.player * U, parts: { D, V, P, U } };
}

/** Does candidate c satisfy role spec within binding b? */
function roleOk(s: GameState, t: EventTemplate, role: string, c: Character, b: Binding): boolean {
  const spec = t.roles[role];
  if (spec.player && !c.isPlayer) return false;
  if (spec.notPlayer && c.isPlayer) return false;
  if (spec.gender) {
    const [kind, ref] = spec.gender.split(':');
    if (kind === 'attractedTo') {
      const other = ref ? s.characters[b[ref]] : undefined;
      if (!other || !attracted(other, c)) return false;
    } else if (kind === 'sameAs') {
      const other = ref ? s.characters[b[ref]] : undefined;
      if (!other || other.gender !== c.gender) return false;
    } else if (c.gender !== kind) return false;
  }
  return true;
}

/**
 * Enumerate bindings for a template over a pool of characters. `fixed` pins roles (e.g. player, arc self).
 * Caps enumeration via seeded shuffle for 3+ roles to keep the director cheap.
 */
export function bindings(s: GameState, rng: Rng, t: EventTemplate, pool: Character[], fixed: Binding = {}, cap = 24): Binding[] {
  const roles = housemateRoles(t);
  const out: Binding[] = [];
  const order = roles.length >= 3 ? rng.shuffle(pool) : pool;
  const rec = (i: number, b: Binding) => {
    if (out.length >= cap) return;
    if (i === roles.length) {
      out.push({ ...b });
      return;
    }
    const role = roles[i];
    if (fixed[role]) {
      const c = s.characters[fixed[role]];
      if (c && !Object.entries(b).some(([r, v]) => r !== role && v === c.id) && roleOk(s, t, role, c, b)) rec(i + 1, { ...b, [role]: c.id });
      return;
    }
    for (const c of order) {
      if (Object.values(b).includes(c.id) || Object.values(fixed).includes(c.id)) continue;
      if (!roleOk(s, t, role, c, b)) continue;
      rec(i + 1, { ...b, [role]: c.id });
    }
  };
  rec(0, {});
  // outsider roles bind to recurring NPC ids
  for (const [role, spec] of Object.entries(t.roles)) if (spec.outsider) for (const b of out) b[role] = spec.outsider;
  return out;
}

/** Does a template's location fit a target location? */
export function locationFits(t: EventTemplate, loc: string, isPlayerScene: boolean): boolean {
  if (t.location === 'any') return true;
  if (t.location === 'phone') return false;
  if (t.location === 'player-node') return isPlayerScene && !isRoom(loc);
  if (t.location.startsWith('type:')) {
    const n = content().city.nodes.find((x) => x.id === loc);
    return !!n && n.type === t.location.slice(5);
  }
  return t.location === loc;
}

/** Score and sample one candidate from a list (softmax over scores, seeded). */
export function sample(rng: Rng, cands: Candidate[], temperature = 1): Candidate | null {
  if (!cands.length) return null;
  const i = softmaxSample(
    rng,
    cands.map((c) => c.score),
    temperature,
  );
  return cands[i];
}

export interface CandidateQuery {
  location: string;
  pool: Character[];
  fixed?: Binding;
  isPlayerScene: boolean;
  activity?: string;
  focus?: string;
  includeSystem?: boolean;
  npcOnly?: boolean;
}

/** Build scored candidates for a query. */
export function candidates(s: GameState, rng: Rng, q: CandidateQuery, w: DirectorWeights = DEFAULT_WEIGHTS): Candidate[] {
  const houseIds = housemates(s).map((c) => c.id);
  const out: Candidate[] = [];
  for (const t of content().events) {
    if (t.arcOnly) continue;
    if (t.system && !q.includeSystem) continue;
    if (!t.slots.includes(s.world.slot)) continue;
    if (q.npcOnly && (!t.npcOk || t.playerOnly)) continue;
    if (q.isPlayerScene && q.activity && t.activity.length && !t.activity.includes(q.activity)) continue;
    // '*house' = any fixed house room (NPC director events use the template's own room)
    const loc = q.location === '*house' ? (isRoom(t.location) ? t.location : null) : q.location;
    if (!loc || !locationFits(t, loc, q.isPlayerScene)) continue;
    if (t.requiresCar && s.world.carUsedBy !== null && s.world.carUsedBy !== s.playerId) continue;
    for (const b of bindings(s, rng, t, q.pool, q.fixed)) {
      if (q.fixed && Object.entries(q.fixed).some(([r, v]) => b[r] !== v)) continue;
      if (!evalAll(s, t.pre, b, rng, houseIds)) continue;
      const { score, parts } = scoreCandidate(s, t, b, w, q.focus);
      out.push({ template: t, binding: b, location: loc, score, parts });
    }
  }
  return out;
}
