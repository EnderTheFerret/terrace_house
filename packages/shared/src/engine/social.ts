// Social dynamics (Section 5.5H): mood, reputation, grudges, apologies, shared references, cliques.
import type { Character, GameState } from '../model';
import type { Rng } from '../rng';
import { clamp, mean } from '../util';
import { addRel, housemates, nextId, rel, traitsOf } from './core';

/** Mood decays toward baseline, spreads between co-located agents, modulated by needs/weather/stress. */
export function updateMoods(s: GameState) {
  const hm = housemates(s);
  const byLoc = new Map<string, Character[]>();
  for (const c of hm) {
    const arr = byLoc.get(c.location) ?? [];
    arr.push(c);
    byLoc.set(c.location, arr);
  }
  const prev = new Map(hm.map((c) => [c.id, c.mood]));
  for (const c of hm) {
    let m = prev.get(c.id)!;
    m += (c.moodBaseline - m) * 0.12;
    const group = byLoc.get(c.location) ?? [];
    if (group.length > 1) {
      const others = group.filter((o) => o.id !== c.id).map((o) => prev.get(o.id)!);
      const susceptibility = 0.06 + traitsOf(c).A * 0.06;
      m += (mean(others) - m) * susceptibility;
    }
    if (c.needs.hunger > 70) m -= 0.04;
    if (c.needs.energy > 75) m -= 0.05; // sleep debt
    if (c.needs.social > 80) m -= 0.03;
    if (c.needs.privacy > 80) m -= 0.03;
    if (s.world.weather === 'rain') m -= 0.01;
    if (s.world.weather === 'sunny') m += 0.01;
    const stress = hm.reduce((acc, o) => acc + (o.id === c.id ? 0 : rel(s, o.id, c.id).tension), 0) / 500;
    m -= stress * 0.05 * (0.5 + traitsOf(c).N);
    c.mood = clamp(m, -1, 1);
  }
}

/** Public behavior updates every in-house observer's view of subject. */
export function publicAct(s: GameState, subject: string, delta: number, observers?: string[]) {
  const obs = observers ?? housemates(s).map((c) => c.id);
  for (const o of obs) {
    if (o === subject) continue;
    s.house.reputation[o] ??= {};
    s.house.reputation[o][subject] = clamp((s.house.reputation[o][subject] ?? 0) + delta, -100, 100);
  }
}

export const reputationOf = (s: GameState, observer: string, subject: string) => s.house.reputation[observer]?.[subject] ?? 0;
export const publicReputation = (s: GameState, subject: string) =>
  mean(housemates(s).filter((c) => c.id !== subject).map((c) => reputationOf(s, c.id, subject)));

export function addGrudge(s: GameState, holder: string, target: string, strength: number, reason: string) {
  const k = `${holder}>${target}`;
  const g = s.grudges[k];
  if (g) {
    g.strength = clamp(g.strength + strength, 0, 100);
    g.since = s.world.episode; // reinforced
    g.reason = reason;
  } else s.grudges[k] = { strength: clamp(strength, 0, 100), since: s.world.episode, reason };
}

/** Forgetting curve: strength decays exponentially per episode unless reinforced. Grudges keep tension floored. */
export function decayGrudges(s: GameState) {
  for (const [k, g] of Object.entries(s.grudges)) {
    const age = s.world.episode - g.since;
    g.strength *= Math.exp(-1 / (2.5 + age * 0.2));
    if (g.strength < 3) {
      delete s.grudges[k];
      continue;
    }
    const [holder, target] = k.split('>');
    if (s.characters[holder] && s.characters[target]) {
      const r = rel(s, holder, target);
      r.tension = Math.max(r.tension, g.strength * 0.5);
    }
  }
}

/** Apology effectiveness: sincerity (value fit) × timing × recipient attachment. Returns effectiveness in [0,1]. */
export function apologize(s: GameState, rng: Rng, from: string, to: string): number {
  const a = s.characters[from];
  const b = s.characters[to];
  if (!a || !b) return 0;
  const vals = a.persona.values.slice(0, 4);
  const sincerity = clamp(0.45 + (vals.includes('honesty') ? 0.2 : 0) + (vals.includes('harmony') ? 0.15 : 0) + traitsOf(a).A * 0.2 + rng.normal(0, 0.05), 0.2, 1);
  const g = s.grudges[`${to}>${from}`];
  const epsSince = g ? s.world.episode - g.since : 0;
  const timing = 1 / (1 + 0.25 * epsSince);
  const receptive = b.persona.attachment === 'anxious' ? 1.15 : b.persona.attachment === 'avoidant' ? 0.7 : 1;
  const eff = clamp(sincerity * timing * receptive, 0, 1);
  if (g) {
    g.strength *= 1 - eff;
    if (g.strength < 3) delete s.grudges[`${to}>${from}`];
  }
  addRel(s, to, from, 'tension', -20 * eff);
  addRel(s, to, from, 'trust', 6 * eff);
  addRel(s, to, from, 'affinity', 5 * eff);
  return eff;
}

export function mintReference(s: GameState, kind: 'inside-joke' | 'nickname' | 'running-gag' | 'promise', text: string, members: string[]) {
  const existing = s.references.find((r) => r.text === text);
  if (existing) {
    existing.uses++;
    for (const m of members) if (!existing.members.includes(m)) existing.members.push(m);
    return existing;
  }
  const ref = { id: nextId(s, 'ref'), kind, text, members: [...new Set(members)], createdEp: s.world.episode, uses: 0 };
  s.references.push(ref);
  if (s.references.length > 40) s.references.splice(0, s.references.length - 40);
  return ref;
}

export const referencesFor = (s: GameState, ids: string[]) =>
  s.references.filter((r) => ids.filter((id) => r.members.includes(id)).length >= Math.min(2, ids.length));

/** Cliques: connected components of the mutual-liking graph (affinity & trust both ways above threshold). */
export function cliques(s: GameState): string[][] {
  const ids = housemates(s).map((c) => c.id);
  const adj = new Map(ids.map((i) => [i, [] as string[]]));
  for (const i of ids)
    for (const j of ids) {
      if (i >= j) continue;
      const ok = rel(s, i, j).affinity > 30 && rel(s, j, i).affinity > 30 && rel(s, i, j).trust > 45 && rel(s, j, i).trust > 45;
      if (ok) {
        adj.get(i)!.push(j);
        adj.get(j)!.push(i);
      }
    }
  const seen = new Set<string>();
  const out: string[][] = [];
  for (const i of ids) {
    if (seen.has(i)) continue;
    const comp: string[] = [];
    const st = [i];
    while (st.length) {
      const x = st.pop()!;
      if (seen.has(x)) continue;
      seen.add(x);
      comp.push(x);
      st.push(...adj.get(x)!);
    }
    if (comp.length > 1) out.push(comp.sort());
  }
  return out;
}

/** Group chat exclusion: a clique of ≥3 may kick someone everyone in it has tension with. */
export function maybeGroupChatExclusion(s: GameState, rng: Rng): string | null {
  for (const clique of cliques(s)) {
    if (clique.length < 3) continue;
    for (const target of s.house.groupChat.members) {
      if (clique.includes(target)) continue;
      const hostile = clique.every((m) => rel(s, m, target).tension > 50 && rel(s, m, target).affinity < -10);
      if (hostile && rng.chance(0.3)) {
        s.house.groupChat.members = s.house.groupChat.members.filter((m) => m !== target);
        return target;
      }
    }
  }
  return null;
}
