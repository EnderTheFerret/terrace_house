// Leave / graduation rules, departures and replacement arrivals (Sections 5.4, 5.5M).
import type { Character, GameState } from '../model';
import type { Rng } from '../rng';
import { addFact, addLog, addMemory, addRel, coupleOf, departing, firstName, housemates, learn, rel } from './core';
import { initArc } from './arcs';
import { initRelationships, replacementCandidate } from './castgen';
import { publicReputation } from './social';
import { postGroupChat } from './house';
import { resolveOn } from './predictions';

export type LeaveReason = 'rejection' | 'mood' | 'contract' | 'goal';

/** Which leave conditions currently apply to c (deterministic part, before chance rolls). */
export function leaveReasons(s: GameState, c: Character): LeaveReason[] {
  const out: LeaveReason[] = [];
  const ep = s.world.episode;
  const rej = s.world.flags[`rejected_${c.id}`];
  const rejBy = s.world.flags[`rejectedBy_${c.id}`];
  if (typeof rej === 'number' && typeof rejBy === 'string' && ep - rej >= 2 && s.characters[rejBy] && rel(s, c.id, rejBy).romance >= 50) out.push('rejection');
  if (c.lowMoodStreak >= 3) out.push('mood');
  if (c.contractEp < 999 && ep - c.arrivedEp + 1 >= c.contractEp) out.push('contract');
  // on the show people graduate when the house has given them what they came for
  const arcEp = s.world.flags[`arcEp_${c.id}`];
  if (s.arcs[c.id]?.outcome === 'complete' && typeof arcEp === 'number' && ep - arcEp >= 2) out.push('goal');
  return out;
}

const REASON_TEXT: Record<LeaveReason, string> = {
  rejection: 'left after an unanswered confession',
  mood: 'decided the house was not for them',
  contract: 'reached the end of their stay',
  goal: 'graduated, having found what they came for',
};

export function markLeaving(s: GameState, id: string, reason: string) {
  s.world.flags[`leaving_${id}`] = s.world.episode;
  s.world.flags[`leaveReason_${id}`] = reason;
  resolveOn(s, 'leave', id);
}

/** Dating is not consent to graduate: each NPC needs their own reason and wants this partner. */
export function agreesToLeave(s: GameState, id: string, withId: string): boolean {
  const c = s.characters[id];
  if (!c || c.isPlayer || c.status !== 'inHouse') return false;
  const r = rel(s, id, withId);
  return r.romance >= 55 && r.affinity >= 0 && r.tension < 50 &&
    (!!s.world.flags[`leaving_${id}`] || leaveReasons(s, c).length > 0);
}

/** Offer a separate departure decision. The player answers through the graduate action. */
export function invitePartnerToLeave(s: GameState, leaver: string): string | null {
  const cp = coupleOf(s, leaver);
  if (!cp || !s.world.flags[`leaving_${leaver}`]) return null;
  const other = cp.a === leaver ? cp.b : cp.a;
  if (s.characters[other]?.status !== 'inHouse') return null;
  const desire = rel(s, leaver, other);
  if (!s.characters[leaver].isPlayer && (desire.romance < 55 || desire.affinity < 0 || desire.tension >= 50)) return null;
  if (s.world.flags[`leaveWith_${leaver}`] === other) return other;
  const key = `leaveAsked_${leaver}_${other}`;
  if (s.world.flags[key]) return s.world.flags[`leaveWith_${leaver}`] === other ? other : null;
  s.world.flags[key] = true;
  const recipient = s.characters[other];
  const agree = agreesToLeave(s, other, leaver);
  const text = recipient.isPlayer
    ? `${firstName(s, leaver)} asked ${firstName(s, other)} to graduate together. The decision is theirs.`
    : agree ? `${firstName(s, leaver)} asked ${firstName(s, other)} to graduate together; both agreed.`
    : `${firstName(s, other)} wants to stay in the house. ${firstName(s, leaver)} will leave alone; they are still dating.`;
  if (recipient.isPlayer) s.world.flags.canGraduate = leaver;
  if (agree) {
    markLeaving(s, other, `graduated with ${firstName(s, leaver)}`);
    s.world.flags[`leaving_${other}`] = s.world.flags[`leaving_${leaver}`];
    s.world.flags[`leaveWith_${leaver}`] = other;
    s.world.flags[`leaveWith_${other}`] = leaver;
  }
  const f = addFact(s, { subject: leaver, about: other, kind: 'event', content: text, truth: true, sensitivity: 0.3 });
  for (const id of [leaver, other]) {
    learn(s, id, f.id, 'self');
    addMemory(s, id, text, [leaver, other], 0.8);
  }
  addLog(s, { kind: 'departure', text, participants: [leaver, other], salience: 0.8, factId: f.id });
  return agree ? other : null;
}

/** Evaluate leave rules at episode end. Returns ids marked as leaving. Player never auto-leaves. */
export function evaluateLeaves(s: GameState, rng: Rng): string[] {
  const marked: string[] = [];
  let solo = 0;
  for (const c of housemates(s)) {
    if (c.isPlayer || s.world.flags[`leaving_${c.id}`]) continue;
    c.lowMoodStreak = c.mood < -0.35 ? c.lowMoodStreak + 1 : 0;
    const reasons = leaveReasons(s, c);
    if (solo >= 2) continue;
    let reason: LeaveReason | null = null;
    if (reasons.includes('contract')) reason = 'contract';
    else if (reasons.includes('rejection') && rng.chance(0.4)) reason = 'rejection';
    else if (reasons.includes('mood') && rng.chance(0.5)) reason = 'mood';
    else if (reasons.includes('goal')) {
      // someone in the house worth staying for keeps them around a while longer
      const anchor = Math.max(0, ...housemates(s).filter((o) => o.id !== c.id).map((o) => rel(s, c.id, o.id).romance));
      if (rng.chance(Math.max(0.05, 0.3 - anchor / 250))) reason = 'goal';
    }
    if (reason) {
      marked.push(c.id);
      solo++;
      markLeaving(s, c.id, REASON_TEXT[reason]);
    }
  }
  for (const id of [...marked]) {
    const partner = invitePartnerToLeave(s, id);
    if (partner && !marked.includes(partner)) marked.push(partner);
  }
  return marked;
}

/** Characters due to leave actually depart (after the farewell scene). Schedules replacements. `all` = season finale. */
export function departLeaving(s: GameState, all = false) {
  for (const c of housemates(s)) {
    if (c.isPlayer || !s.world.flags[`leaving_${c.id}`] || (!all && !departing(s, c.id))) continue;
    depart(s, c);
  }
}

/** One housemate walks out the door: status, couple, group chat, log, and a same-gender replacement is booked. */
export function depart(s: GameState, c: Character) {
  c.status = 'left';
  c.leftEp = s.world.episode;
  c.leftReason = String(s.world.flags[`leaveReason_${c.id}`] ?? 'left');
  delete s.world.flags[`leaving_${c.id}`];
  s.house.groupChat.members = s.house.groupChat.members.filter((m) => m !== c.id);
  const cp = coupleOf(s, c.id);
  if (cp) {
    const other = cp.a === c.id ? cp.b : cp.a;
    if (s.characters[other].status === 'left' && s.world.flags[`leaveWith_${c.id}`] === other) cp.status = 'left-together';
  }
  if (s.world.flags.canGraduate === c.id) delete s.world.flags.canGraduate;
  s.budgets.farewells++;
  addLog(s, { kind: 'departure', text: `${c.name} ${c.leftReason}.`, participants: [c.id], salience: 0.9 });
  // whoever graduates, someone new moves in (same gender, as on the show) unless the season ends today
  if (!c.isPlayer && (s.seasonLength === 0 || s.world.episode < s.seasonLength) && (s.finaleEpisode === null || s.world.episode < s.finaleEpisode)) s.pendingArrivals.push({ gender: c.gender, ep: s.world.episode });
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
