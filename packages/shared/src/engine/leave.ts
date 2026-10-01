// Leave / graduation rules, departures and replacement arrivals (Sections 5.4, 5.5M).
import type { Character, GameState } from '../model';
import type { Rng } from '../rng';
import { addFact, addLog, addRel, coupleOf, firstName, housemates, learn, rel } from './core';
import { initArc } from './arcs';
import { initRelationships, replacementCandidate } from './castgen';
import { publicReputation } from './social';
import { postGroupChat } from './house';
import { resolveOn } from './predictions';

export type LeaveReason = 'couple' | 'rejection' | 'mood' | 'contract';

/** Which leave conditions currently apply to c (deterministic part, before chance rolls). */
export function leaveReasons(s: GameState, c: Character): LeaveReason[] {
  const out: LeaveReason[] = [];
  const ep = s.world.episode;
  const cp = coupleOf(s, c.id);
  if (cp) {
    const other = cp.a === c.id ? cp.b : cp.a;
    if (ep - cp.since >= 2 && rel(s, c.id, other).romance >= 70 && rel(s, other, c.id).romance >= 70) out.push('couple');
  }
  const rej = s.world.flags[`rejected_${c.id}`];
  const rejBy = s.world.flags[`rejectedBy_${c.id}`];
  if (typeof rej === 'number' && typeof rejBy === 'string' && ep - rej >= 2 && s.characters[rejBy] && rel(s, c.id, rejBy).romance >= 50) out.push('rejection');
  if (c.lowMoodStreak >= 3) out.push('mood');
  if (ep - c.arrivedEp + 1 >= c.contractEp) out.push('contract');
  return out;
}

const REASON_TEXT: Record<LeaveReason, string> = {
  couple: 'graduated as a couple',
  rejection: 'left after an unanswered confession',
  mood: 'decided the house was not for them',
  contract: 'reached the end of their stay',
};

export function markLeaving(s: GameState, id: string, reason: string) {
  s.world.flags[`leaving_${id}`] = s.world.episode;
  s.world.flags[`leaveReason_${id}`] = reason;
  resolveOn(s, 'leave', id);
}

/** Evaluate leave rules at episode end. Returns ids marked as leaving. Player never auto-leaves. */
export function evaluateLeaves(s: GameState, rng: Rng): string[] {
  const marked: string[] = [];
  let solo = 0;
  for (const c of housemates(s)) {
    if (c.isPlayer || s.world.flags[`leaving_${c.id}`]) continue;
    c.lowMoodStreak = c.mood < -0.35 ? c.lowMoodStreak + 1 : 0;
    const reasons = leaveReasons(s, c);
    if (reasons.includes('couple')) {
      const cp = coupleOf(s, c.id)!;
      const other = cp.a === c.id ? cp.b : cp.a;
      if (s.characters[other].isPlayer) {
        s.world.flags.canGraduate = other;
        continue;
      }
      if (rng.chance(0.45)) {
        for (const id of [c.id, other]) if (!marked.includes(id)) marked.push(id);
        markLeaving(s, c.id, REASON_TEXT.couple);
        markLeaving(s, other, REASON_TEXT.couple);
        cp.status = 'left-together';
      }
      continue;
    }
    if (solo >= 2) continue;
    let reason: LeaveReason | null = null;
    if (reasons.includes('contract')) reason = 'contract';
    else if (reasons.includes('rejection') && rng.chance(0.4)) reason = 'rejection';
    else if (reasons.includes('mood') && rng.chance(0.5)) reason = 'mood';
    if (reason) {
      marked.push(c.id);
      solo++;
      markLeaving(s, c.id, REASON_TEXT[reason]);
    }
  }
  return marked;
}

/** Characters marked leaving actually depart (after the farewell scene). Schedules replacements. */
export function departLeaving(s: GameState) {
  for (const c of housemates(s)) {
    if (c.isPlayer || !s.world.flags[`leaving_${c.id}`]) continue;
    c.status = 'left';
    c.leftEp = s.world.episode;
    c.leftReason = String(s.world.flags[`leaveReason_${c.id}`] ?? 'left');
    delete s.world.flags[`leaving_${c.id}`];
    s.house.groupChat.members = s.house.groupChat.members.filter((m) => m !== c.id);
    const cp = coupleOf(s, c.id);
    if (cp) cp.status = s.characters[cp.a === c.id ? cp.b : cp.a].status === 'left' ? 'left-together' : 'broken';
    s.budgets.farewells++;
    addLog(s, { kind: 'departure', text: `${c.name} ${c.leftReason}.`, participants: [c.id], salience: 0.9 });
    // the cast stays at six until the endgame
    if (s.world.episode <= s.seasonLength - 3) s.pendingArrivals.push({ gender: c.gender, ep: s.world.episode });
  }
}

/** Process pending arrivals: generate a replacement and wire them into every system. */
export function processArrivals(s: GameState, rng: Rng): Character[] {
  const arrived: Character[] = [];
  const due = s.pendingArrivals.filter((p) => p.ep <= s.world.episode);
  s.pendingArrivals = s.pendingArrivals.filter((p) => p.ep > s.world.episode);
  for (const p of due) {
    if (housemates(s).length >= 6) continue;
    const c = replacementCandidate(s, rng, p.gender);
    c.location = 'entrance';
    s.characters[c.id] = c;
    const ids = housemates(s).map((h) => h.id);
    // only initialize pairs involving the newcomer
    const saved = structuredClone(s.rel);
    initRelationships(s, rng, ids);
    for (const i of Object.keys(saved)) for (const j of Object.keys(saved[i])) if (i !== c.id && j !== c.id) s.rel[i][j] = saved[i][j];
    // reputation colors the newcomer's first impressions (they've heard things)
    for (const id of ids) if (id !== c.id) addRel(s, c.id, id, 'affinity', publicReputation(s, id) * 0.3);
    s.house.choreLedger[c.id] = { done: 0, skipped: 0 };
    s.house.groupChat.members.push(c.id);
    s.memory[c.id] = [];
    s.knowledge[c.id] = {};
    if (c.persona.secret) {
      addFact(s, { id: c.persona.secret.factId, subject: c.id, kind: 'secret', content: c.persona.secret.content, truth: true, sensitivity: 0.8 });
      learn(s, c.id, c.persona.secret.factId, 'self');
    }
    initArc(s, c);
    s.world.flags[`new_${c.id}`] = s.world.episode;
    addLog(s, { kind: 'arrival', text: `${c.name}, ${c.age}, ${c.occupation}, moved into the house.`, participants: [c.id], salience: 0.8 });
    const greeter = housemates(s).filter((h) => h.id !== c.id && !h.isPlayer).sort((a, b) => b.persona.traits[2] - a.persona.traits[2])[0];
    if (greeter) postGroupChat(s, greeter.id, `welcome ${c.name.split(' ')[0]}!! (added you)`, { subject: c.id, kind: 'event', content: `${c.name} joined the house group chat.`, sensitivity: 0.1 });
    arrived.push(c);
  }
  return arrived;
}

export const leaveSummary = (s: GameState, id: string) => `${firstName(s, id)}: ${s.characters[id].leftReason ?? 'still in the house'}`;
