// Agent tick (Section 5.5D): needs, utility-based action choice with Gumbel sampling, movement.
import type { Character, GameState, Need, NeedVec } from '../model';
import { NEEDS } from '../model';
import type { Rng } from '../rng';
import { softmaxSample } from '../rng';
import { clamp } from '../util';
import { content } from '../content';
import { attracted, belief, coupleOf, flag, housemates, isCouple, isDaySlot, rel, traitsOf } from './core';
import { fridgeTotal } from './conditions';
import { gossipCandidate } from './knowledge';
import { isOpen, reachability } from './city';
import { reputationOf } from './social';

export type ActionKind =
  | 'sleep' | 'cook' | 'eat' | 'tidy' | 'work' | 'exercise' | 'hobby' | 'goOut'
  | 'seek' | 'avoid' | 'text' | 'gossip' | 'apologize' | 'confess' | 'retreat';

export interface AgentAction {
  kind: ActionKind;
  target?: string;
  third?: string;
  node?: string;
  useCar?: boolean;
  utility?: number;
}

/** s_k(a): how much each action satisfies each need (positive = reduces deficit). */
const SAT: Record<ActionKind, Partial<NeedVec>> = {
  sleep: { energy: 38, privacy: 12 },
  cook: { hunger: 30, achievement: 8, social: 3 },
  eat: { hunger: 34 },
  tidy: { achievement: 9 },
  work: { achievement: 26, energy: -10, social: 6 },
  exercise: { achievement: 10, energy: -12, social: 2 },
  hobby: { achievement: 15, privacy: 10 },
  goOut: { social: 12, achievement: 4, energy: -6, privacy: 6 },
  seek: { social: 22, privacy: -6 },
  avoid: { privacy: 16 },
  text: { social: 9 },
  gossip: { social: 16 },
  apologize: { social: 6 },
  confess: { romance: 40, social: 5 },
  retreat: { privacy: 26, energy: 8 },
};

export const bedroomOf = (c: Character) => (c.gender === 'man' ? 'bedroomM' : 'bedroomW');

export function decayNeeds(c: Character) {
  for (const k of NEEDS) c.needs[k] = clamp(c.needs[k] + c.persona.needsProfile[k], 0, 100);
  c.energy = clamp(100 - c.needs.energy, 0, 100);
}

export function satisfy(c: Character, kind: ActionKind, scale = 1) {
  for (const k of NEEDS) {
    const v = SAT[kind][k];
    if (v) c.needs[k] = clamp(c.needs[k] - v * scale, 0, 100);
  }
  c.energy = clamp(100 - c.needs.energy, 0, 100);
}

/** π_ij: approach/avoid pull of i toward j, from beliefs, affinity, romance, tension, reputation and attachment. */
export function pull(s: GameState, i: Character, j: Character): number {
  const r = rel(s, i.id, j.id);
  const attr = attracted(i, j) ? 1 : 0;
  const believed = belief(s, i.id, j.id, i.id); // i's estimate of j's feelings toward i
  let pos = Math.max(0, r.affinity) / 100 * 0.8 + attr * (r.romance / 100) * 1.3 + attr * (believed.romance / 100) * 0.4 + Math.max(0, believed.affinity) / 250;
  let neg = Math.max(0, -r.affinity) / 100 * 0.6 + r.tension / 100 * 1.1;
  pos += reputationOf(s, i.id, j.id) / 400;
  if (i.persona.attachment === 'avoidant') {
    pos *= 0.6;
    neg *= 1.4;
  } else if (i.persona.attachment === 'anxious') pos *= 1.25;
  const partner = coupleOf(s, i.id);
  if (partner && (partner.a === j.id || partner.b === j.id)) pos += 0.6;
  return pos - neg;
}

function valueFit(c: Character, kind: ActionKind): number {
  const vals = c.persona.values;
  const w = (v: string) => {
    const i = vals.indexOf(v as never);
    return i < 0 ? 0 : (vals.length - i) / vals.length;
  };
  switch (kind) {
    case 'apologize': return 0.35 * w('honesty') + 0.35 * w('harmony');
    case 'confess': return 0.25 * w('honesty') + 0.1 * w('freedom');
    case 'tidy': return 0.15 * w('harmony') + 0.12 * w('security') - 0.1 * w('freedom');
    case 'cook': return 0.12 * w('family') + 0.1 * w('harmony');
    case 'goOut': return 0.3 * w('fun') + 0.2 * w('freedom');
    case 'hobby': return 0.1 * w('fun') + 0.2 * w('ambition');
    case 'work': return 0.3 * w('ambition') + 0.2 * w('security');
    case 'retreat': return 0.12 * w('freedom');
    case 'gossip': return -0.3 * w('harmony') - 0.25 * w('loyalty') - 0.2 * w('honesty') + 0.15 * w('fun');
    case 'seek': return 0.1 * w('fun') + 0.1 * w('loyalty');
    default: return 0;
  }
}

function goalProgress(c: Character, a: AgentAction, s: GameState): number {
  let g = 0;
  for (const goal of [c.persona.goals.long, c.persona.goals.short]) {
    const tgt = a.target ? s.characters[a.target] : undefined;
    switch (goal.kind) {
      case 'career':
      case 'savings':
        if (a.kind === 'work') g += 0.45;
        if (a.kind === 'hobby') g += 0.15;
        break;
      case 'audience':
      case 'exposure':
        if (a.kind === 'goOut' || a.kind === 'hobby') g += 0.3;
        break;
      case 'creative':
        if (a.kind === 'hobby') g += 0.45;
        break;
      case 'partner':
      case 'marriage':
        if (tgt && attracted(c, tgt) && (a.kind === 'seek' || a.kind === 'text')) g += 0.15 + rel(s, c.id, tgt.id).romance / 200;
        if (a.kind === 'confess') g += 0.5;
        break;
      case 'friends':
        if (a.kind === 'seek' || a.kind === 'cook') g += 0.2;
        break;
      case 'avoidDrama':
        if (a.kind === 'avoid' || a.kind === 'retreat') g += 0.25;
        break;
      case 'honesty':
        if (a.kind === 'apologize') g += 0.35;
        break;
    }
  }
  return g;
}

export function confessThreshold(c: Character) {
  return c.persona.attachment === 'anxious' ? 35 : c.persona.attachment === 'avoidant' ? 60 : 45;
}

export function hasJobNow(s: GameState, c: Character) {
  return c.persona.routine.jobSlots.some((j) => j.slot === s.world.slot && j.weekdays.includes(s.world.weekday));
}

export function jobNode(c: Character): string {
  const occ = c.occupation.toLowerCase();
  if (occ.includes('nurse') || occ.includes('doctor') || occ.includes('pharm')) return 'hospital';
  if (occ.includes('cook') || occ.includes('chef')) return 'grill';
  if (occ.includes('cafe') || occ.includes('barista')) return 'cafe';
  if (occ.includes('music') || occ.includes('dj')) return 'livehouse';
  if (occ.includes('surf') || occ.includes('lifeguard')) return 'beach';
  return 'station'; // commute out of the neighbourhood
}

/** Enumerate candidate actions and score U_i(a). */
export function candidateActions(s: GameState, c: Character): AgentAction[] {
  const slot = s.world.slot;
  const day = isDaySlot(slot);
  const typhoon = s.world.cityEvent === 'typhoon';
  const others = housemates(s).filter((o) => o.id !== c.id);
  const acts: AgentAction[] = [
    { kind: 'sleep' }, { kind: 'eat' }, { kind: 'tidy' }, { kind: 'hobby' }, { kind: 'retreat' }, { kind: 'exercise' },
  ];
  if (fridgeTotal(s) >= 3) acts.push({ kind: 'cook' });
  if (hasJobNow(s, c) && !typhoon) acts.push({ kind: 'work', node: jobNode(c) });
  if (day && !typhoon) {
    const reach = reachability('house', slot, 99999, s.world.carUsedBy === null).filter((r) => r.reachable);
    const liked = reach.filter((r) => {
      const n = content().city.nodes.find((x) => x.id === r.node)!;
      return n.activities.some((a) => ['wander', 'date', 'eat', 'shop', 'karaoke'].includes(a)) && isOpen(n, slot);
    });
    for (const r of liked.slice(0, 18)) acts.push({ kind: 'goOut', node: r.node, useCar: r.needsCar });
  }
  for (const o of others) {
    acts.push({ kind: 'seek', target: o.id }, { kind: 'avoid', target: o.id }, { kind: 'text', target: o.id });
    if (rel(s, o.id, c.id).tension >= 30 || s.grudges[`${o.id}>${c.id}`]) acts.push({ kind: 'apologize', target: o.id });
    const be = belief(s, c.id, o.id, c.id);
    if (
      attracted(c, o) &&
      rel(s, c.id, o.id).romance >= 60 &&
      be.romance >= confessThreshold(c) &&
      !isCouple(s, c.id, o.id) &&
      !coupleOf(s, c.id) &&
      s.world.episode >= 3 &&
      !flag(s, `confessed_${c.id}_${o.id}`) &&
      s.budgets.confessions < 8
    )
      acts.push({ kind: 'confess', target: o.id });
    for (const k of others) {
      if (k.id === o.id || rel(s, c.id, k.id).trust < 40) continue;
      if (gossipCandidate(s, c.id, k.id, o.id)) acts.push({ kind: 'gossip', target: o.id, third: k.id });
    }
  }
  return acts;
}

export function utility(s: GameState, c: Character, a: AgentAction): number {
  let u = 0;
  for (const k of NEEDS as readonly Need[]) {
    const sat = SAT[a.kind][k] ?? 0;
    u += (c.needs[k] / 100) * (sat / 20);
  }
  if (a.kind === 'confess') u += (c.needs.romance / 100) * 0.5;
  u += goalProgress(c, a, s);
  u += valueFit(c, a.kind);
  const tgt = a.target ? s.characters[a.target] : undefined;
  const t = traitsOf(c);
  if (tgt) {
    const p = pull(s, c, tgt);
    if (a.kind === 'seek') u += p + (t.E - 0.5) * 0.3 + (attracted(c, tgt) ? (c.needs.romance / 100) * 0.4 * (rel(s, c.id, tgt.id).romance / 100) : 0);
    if (a.kind === 'text') u += p * 0.4 + (c.persona.attachment === 'anxious' ? 0.15 : 0) - 0.2;
    if (a.kind === 'avoid') u += -p * 0.8 - 0.3;
    if (a.kind === 'apologize') u += rel(s, tgt.id, c.id).tension / 100 + (s.grudges[`${tgt.id}>${c.id}`] ? 0.3 : 0) - 0.2;
    if (a.kind === 'confess') u += 1.2 + rel(s, c.id, tgt.id).romance / 100;
    if (a.kind === 'gossip') {
      u += c.persona.gossipiness * 0.9 + rel(s, c.id, tgt.id).tension / 120 - 0.2;
    }
  }
  // routine: jobs are near-mandatory, habits are strong preferences
  if (a.kind === 'work') u += 3;
  for (const h of c.persona.routine.habits) if (h.slot === s.world.slot && h.action === a.kind) u += 0.6;
  // costs
  if (c.needs.energy > 70 && (a.kind === 'exercise' || a.kind === 'goOut' || a.kind === 'work')) u -= 0.5;
  if (a.kind === 'sleep' && s.world.slot !== 'morning' && s.world.slot !== 'evening') u -= 0.3;
  if (a.kind === 'goOut') u += (t.O - 0.5) * 0.3 + (t.E - 0.5) * 0.2 - (a.useCar ? 0.15 : 0) - 0.15;
  if (a.kind === 'retreat') u += (0.5 - t.E) * 0.4;
  if (a.kind === 'tidy') u += (t.C - 0.5) * 0.4 + (s.house.dishes > 60 ? 0.25 : 0);
  if (a.kind === 'cook') u += c.persona.goals.short.kind === 'career' && c.occupation.includes('cook') ? 0.3 : 0;
  if (s.world.cityEvent === 'typhoon' && a.kind === 'seek') u += 0.25; // close quarters
  return u;
}

export const AGENT_TEMPERATURE = 0.35;

/** Choose an action for one agent: Gumbel-max over U/τ. */
export function chooseAction(s: GameState, rng: Rng, c: Character): AgentAction {
  const acts = candidateActions(s, c);
  const scores = acts.map((a) => utility(s, c, a));
  const i = softmaxSample(rng, scores, AGENT_TEMPERATURE);
  return { ...acts[i], utility: scores[i] };
}

/** Default room for an action (before relational resolution). */
export function roomFor(s: GameState, c: Character, a: AgentAction): string {
  switch (a.kind) {
    case 'sleep': return bedroomOf(c);
    case 'retreat': return traitsOf(c).O > 0.7 ? 'rooftop' : bedroomOf(c);
    case 'cook':
    case 'eat':
    case 'tidy': return 'kitchen';
    case 'exercise': return 'rooftop';
    case 'work': return a.node ?? 'station';
    case 'goOut': return a.node ?? 'konbini';
    case 'hobby': {
      const h = c.persona.routine.habits.find((x) => x.action === 'hobby' && x.slot === s.world.slot) ?? c.persona.routine.habits.find((x) => x.action === 'hobby');
      return h?.room ?? 'living';
    }
    default: return c.location && c.location !== 'phone' ? c.location : 'living';
  }
}

/**
 * Resolve locations for all agents given their actions. Relational actions follow their target
 * (seek/confess/apologize/gossip-listener), avoid picks a room without the target.
 */
export function resolveLocations(s: GameState, actions: Record<string, AgentAction>, fixed: Record<string, string> = {}) {
  const ids = Object.keys(actions).sort();
  const loc: Record<string, string> = { ...fixed };
  for (const id of ids) {
    const a = actions[id];
    if (!['seek', 'confess', 'apologize', 'gossip', 'avoid', 'text'].includes(a.kind)) loc[id] = roomFor(s, s.characters[id], a);
  }
  for (let pass = 0; pass < 3; pass++) {
    for (const id of ids) {
      const a = actions[id];
      const tgt = a.kind === 'gossip' ? a.third : a.target;
      if (!tgt || !['seek', 'confess', 'apologize', 'gossip'].includes(a.kind)) continue;
      const tl = loc[tgt];
      // can't follow someone to their workplace; stay in the shared living room instead
      if (tl && actions[tgt]?.kind !== 'work') loc[id] = tl;
      else if (pass === 2 && !loc[id]) loc[id] = 'living';
    }
  }
  for (const id of ids) {
    const a = actions[id];
    const c = s.characters[id];
    if (a.kind === 'avoid') {
      const tl = loc[a.target!];
      loc[id] = tl === bedroomOf(c) ? 'rooftop' : bedroomOf(c);
    }
    if (a.kind === 'text') loc[id] = roomFor(s, c, { kind: 'hobby' });
    loc[id] ??= 'living';
  }
  for (const id of ids) s.characters[id].location = loc[id];
}
