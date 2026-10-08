import { SLOTS, type GameState, type PlayerAction, type Slot } from '../model';
import type { Rng } from '../rng';
import { content } from '../content';
import { clamp, uk } from '../util';
import { addFact, addLog, addMemory, addRel, attracted, clockLabel, firstName, housemates, isRoom, learn, nextId, notePlan, npcs, placeName, planFactId, player, rel, SLOT_MINUTES, SLOT_START } from './core';
import { bedroomOf, chooseAction, coordinateOutings, durationFor, hasJobNow, isShabbat, resolveLocations, satisfy, type AgentAction } from './agents';
import { dayForEpisode, weekdayOf, WEEKDAY_NAMES } from './calendar';
import { inviteDecision } from './talk';
import { maybeDrink } from './drink';
import { logInteraction, resolveColocation, resolveRemote } from './interactions';
import { applyProposal, sanitizeProposal, sharedTimeAffinity } from './relationships';
import { apologize } from './social';
import { resolveConfession } from './outcome';
import { postGroupChat, workCareerTick } from './house';
import { ACTIVITY_MINUTES, reachability } from './city';
import { completeHouseholds, startNpcHouseholds } from './household';
import { offerPerformances, rememberPerformance, startPerformances } from './performances';

/** Gifts and the hobby that makes them land; price levels are in budget.ts (GIFT_PRICE). */
export const GIFT_ITEMS: Record<string, { hobby?: string }> = {
  flowers: { hobby: 'gardening' }, book: { hobby: 'reading' }, vinyl: { hobby: 'music' }, coffee: {}, plant: { hobby: 'plants' }, snacks: {},
};

export function recordActivity(s: GameState, text: string) {
  s.timeline.push({ episode: s.world.episode, slot: s.world.slot, clock: clockLabel(s.world.slot, s.world.minutes), text });
  if (s.timeline.length > 60) s.timeline.splice(0, s.timeline.length - 60);
}

export function observeRoutines(s: GameState) {
  const P = player(s);
  for (const c of npcs(s)) {
    if (c.location !== P.location) continue;
    for (const h of c.persona.routine.habits) {
      if (h.slot !== s.world.slot || h.action !== c.lastAction || (h.weekdaysOnly && s.world.weekday >= 5)) continue;
      const seen = s.observedRoutines[c.id] ??= [];
      const text = `${h.action} in ${c.location}, ${h.slot}${h.weekdaysOnly ? ' on workdays' : ''}`;
      if (!seen.includes(text)) seen.push(text);
    }
  }
}

export function scheduleActivity(s: GameState, c: GameState['characters'][string], a: AgentAction, start = s.world.minutes) {
  if (a.kind === 'household' && c.actionHousehold) return;
  c.swimming = a.kind === 'swim';
  c.lastAction = a.kind;
  c.actionTarget = a.target;
  c.actionNode = a.node;
  c.actionCompanion = a.companion;
  c.actionThird = a.third;
  c.activityUntil = Math.min(SLOT_MINUTES, start + durationFor(a));
}

export function addFeedPost(s: GameState, from: string, text: string, withId?: string, kind: 'photo' | 'story' = s.feed.length % 3 === 0 ? 'story' : 'photo') {
  if (isShabbat(s, s.characters[from])) return;
  const likes = npcs(s).filter((c) => c.id !== from && !isShabbat(s, c) && rel(s, c.id, from).affinity > 15).map((c) => c.id);
  const people = [from, withId].filter((id): id is string => !!id && !!s.characters[id]).map((id) => {
    const c = s.characters[id];
    return { appearance: structuredClone(c.appearance), gender: c.gender, seed: c.portraitSeed };
  });
  s.feed.push({ id: nextId(s, 'post'), from, text, with: withId, kind, location: s.characters[from].location, people, likes, episode: s.world.episode, slot: s.world.slot });
  if (withId && from !== withId) {
    const f = addFact(s, { subject: from, about: withId, kind: 'event', content: `${firstName(s, from)} posted a photo with ${firstName(s, withId)}. A photo alone does not establish a romance.`, truth: true, sensitivity: 0.4 });
    for (const c of housemates(s)) if (!isShabbat(s, c)) learn(s, c.id, f.id, 'groupchat', from, 0.8);
  }
  if (s.feed.length > 40) s.feed.splice(0, s.feed.length - 40);
}

/** Commitments have one resolution at the end of their scheduled block. */
export function settlePlans(s: GameState) {
  for (const p of s.invitations) {
    if (!['pending', 'accepted'].includes(p.status) || p.episode > s.world.episode || (p.episode === s.world.episode && p.slot !== s.world.slot)) continue;
    const a = s.characters[p.from];
    const b = s.characters[p.to];
    if (p.status === 'pending') { p.status = 'declined'; continue; }
    const kept = a?.status === 'inHouse' && b?.status === 'inHouse' && a.location === p.node && b.location === p.node;
    p.status = kept ? 'kept' : 'broken';
    if (a && b) {
      addRel(s, a.id, b.id, 'trust', kept ? 4 : -5);
      addRel(s, b.id, a.id, 'trust', kept ? 4 : -5);
      if (kept) { addRel(s, a.id, b.id, 'closeness', 4); addRel(s, b.id, a.id, 'closeness', 4); }
      if (kept && p.performance) rememberPerformance(s, p);
      // a private plan's outcome reaches only those who know about the plan (the log's fact gate)
      const secret = !!s.facts[planFactId(p)];
      addLog(s, { kind: secret ? 'summary' : 'system', factId: secret ? planFactId(p) : undefined, text: `${firstName(s, a.id)} and ${firstName(s, b.id)} ${kept ? 'kept' : 'missed'} their plan at ${content().city.nodes.find((n) => n.id === p.node)?.name ?? p.node}.`, participants: [a.id, b.id], salience: 0.4 });
    }
  }
}

export function validPlanPlace(s: GameState, destination: string, from: string, to: string) {
  const room = content().house.rooms.find((r) => r.id === destination);
  if (!room) return true;
  if (['bathroom', 'smallBathroom', 'stairs', 'stairsUp'].includes(destination)) return false;
  if (!room.private) return true;
  return [from, to].some((id) => { const c = s.characters[id]; return c && [bedroomOf(c), c.gender === 'man' ? 'balconyM' : 'balconyW'].includes(destination); });
}

/** "right now", "today at 16:00", "tomorrow at 10:00" or "on Fri at 20:00" for a planned block. */
export function planWhen(s: GameState, p: { episode: number; slot: Slot }): string {
  if (p.episode === s.world.episode && p.slot === s.world.slot) return 'right now';
  const at = `at ${clockLabel(p.slot, 0)}`;
  return p.episode === s.world.episode ? `today ${at}` : p.episode === s.world.episode + 1 ? `tomorrow ${at}` : `on ${WEEKDAY_NAMES[weekdayOf(dayForEpisode(p.episode))]} ${at}`;
}

const PLAN_ROOMS: [string, RegExp][] = [['backyard', /\b(?:backyard|pool)\b/i], ['living', /\b(?:living room|lounge|sofa|couch)\b/i], ['kitchen', /\bkitchen\b/i]];
/** City places by id or by a name word no other place shares ("coffee", "port", "yarkon"). */
function planPlace(text: string): string | undefined {
  const nodes = content().city.nodes.filter((n) => !['home', 'workplace'].includes(n.type));
  // a full name settles it: "Dizengoff Square" shares each word with another place
  const lower = text.toLowerCase();
  const named = nodes.filter((n) => lower.includes(n.name.toLowerCase())).sort((a, b) => b.name.length - a.name.length)[0];
  if (named) return named.id;
  const keys = nodes.map((n) => [n.id, ...n.type.split('-'), ...(n.name.toLowerCase().match(/\p{L}{4,}/gu) ?? [])]);
  const count = new Map<string, number>();
  for (const k of keys) for (const w of new Set(k)) count.set(w, (count.get(w) ?? 0) + 1);
  const words = new Set(text.toLowerCase().match(/\p{L}+/gu) ?? []);
  // a distinctive name word outweighs a bare id: "flea market" is Jaffa's, plain "market" is Carmel
  const score = keys.map((k, i) => (words.has(nodes[i].id) ? 1 : 0) + 1.5 * [...new Set(k)].filter((w) => count.get(w) === 1 && words.has(w)).length);
  const best = Math.max(...score);
  return best > 0 ? nodes[score.indexOf(best)].id : PLAN_ROOMS.find(([, re]) => re.test(text))?.[0];
}

const INVITING = /\?\s*$|\b(?:want to|wanna|let'?s|shall we|should we|how about|would you|come with|join me|are you free|you free|up for|with me|together|meet (?:me|up))\b/i;
const COMPANY = /\bwith (?:the |some |a few |my |our |all the )?(?:others?|people|friends|everyone|everybody|guys|girls|housemates|roommates|group|crew|them)\b/i;
/** words that turn a plan with other people into an invitation to the listener */
const ASKS_YOU = /\b(?:(?:want|wanna|would|will|can|could|should|shall|do) you|you (?:want|wanna|should|can|could|free|coming|in)|join|come|let'?s|how about you|with me|meet (?:me|up))\b|(?<!\bI )\b(?:want to|wanna)\b/i;
/** asking someone out rather than hanging out: the plan becomes a private date */
const DATE_WORDS = /\b(?:a date|on a date|date night|just (?:the two of )?us|romantic)\b/i;
export type TalkPlan = { node: string; episode: number; slot: Slot; date?: boolean };
const TIME_WORDS: [RegExp, Slot][] = [[/\b(?:late night|midnight)\b/i, 'lateNight'], [/\bbreakfast\b/i, 'morning'], [/\b(?:lunch|noon|afternoon)\b/i, 'slot2'], [/\b(?:after work|sunset)\b/i, 'slot3'], [/\b(?:evening|tonight|dinner)\b/i, 'evening'], [/\b(?:morning|brunch)\b/i, 'slot1']];

/**
 * A later meet-up the player proposes in their own words ("cafe tomorrow morning?", "beach at 4?"): a place plus a day or
 * time that is still ahead. Going somewhere right now stays the invite button's job.
 * ponytail: English keyword reading; an LLM extraction pass only if typed plans routinely slip through.
 */
export function proposedPlan(s: GameState, text: string, to: string[] = []): TalkPlan | null {
  // the place has to be in an inviting sentence: "Drinking at the bar later. Want some gossip?" invites nobody to the bar
  const asks = (text.match(/[^.!?]+[.!?]*/g) ?? [text]).filter((t) => INVITING.test(t)).join(' ');
  if (!asks) return null;
  // "I'm going out with the others tomorrow" tells them about a plan; it doesn't invite them
  const withOthers = COMPANY.test(text) || Object.values(s.characters).some((c) => !c.isPlayer && !to.includes(c.id) && new RegExp(`\\bwith ${firstName(s, c.id)}\\b`, 'i').test(text));
  if (withOthers && !ASKS_YOU.test(text)) return null;
  const node = planPlace(asks);
  if (!node) return null;
  const weekday = WEEKDAY_NAMES.findIndex((d) => new RegExp(`\\b${d}[a-z]*day\\b`, 'i').test(text));
  let ahead = /\btomorrow\b/i.test(text) ? 1 : /\b(?:today|tonight|later|this (?:morning|afternoon|evening))\b/i.test(text) ? 0
    : weekday >= 0 ? (weekday - s.world.weekday + 7) % 7 || 7 : undefined;
  const clock = text.match(/\b(?:at|around|by)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b|\b(\d{1,2})(?::\d{2})?\s*(am|pm)\b/i);
  let slot: Slot | undefined;
  if (clock) {
    let h = Number(clock[1] ?? clock[4]);
    const half = (clock[3] ?? clock[5])?.toLowerCase();
    if (half === 'pm' && h < 12) h += 12;
    else if (half === 'am' && h === 12) h = 0;
    else if (!half && (h < 7 || h < 12 && /\b(?:tonight|evening|dinner)\b/i.test(text))) h += 12;
    slot = h >= 23 || h < 2 ? 'lateNight' : [...SLOTS].reverse().find((sl) => SLOT_START[sl] <= h);
  } else slot = TIME_WORDS.find(([re]) => re.test(text))?.[1];
  if (ahead === undefined && !slot) return null;
  const now = SLOTS.indexOf(s.world.slot);
  if (ahead === undefined) ahead = SLOTS.indexOf(slot!) > now ? 0 : 1;
  slot ??= ahead ? 'slot1' : SLOTS[now + 1];
  if (!slot || ahead === 0 && SLOTS.indexOf(slot) <= now) return null;
  return { node, episode: s.world.episode + ahead, slot, ...(DATE_WORDS.test(text) ? { date: true } : {}) };
}

/** Would housemate `id` agree to meet then? The same feelings read as a spot invitation, checked against that block's work, Shabbat and plans. */
export function planDecision(s: GameState, id: string, plan: TalkPlan, transcript: { speaker: string; text: string }[], seed: string): { accept: boolean; reason: string } {
  const reason = planConflict(s, id, plan);
  if (reason) return { accept: false, reason };
  const then: GameState = { ...s, world: { ...s.world, episode: plan.episode, slot: plan.slot, minutes: 0, weekday: weekdayOf(dayForEpisode(plan.episode)) }, characters: { ...s.characters, [id]: { ...s.characters[id], lastAction: undefined } } };
  return inviteDecision(then, id, transcript, { date: !!plan.date, seed });
}

/**
 * Why housemate `id` can't meet then (work, place, another plan elsewhere), or '' when nothing stands in the way.
 * Plans with `moving` (the person they are rearranging with) don't count against it.
 */
export function planConflict(s: GameState, id: string, plan: TalkPlan, moving?: string): string {
  const c = s.characters[id];
  if (!c) return 'is not around';
  const then: GameState = { ...s, world: { ...s.world, episode: plan.episode, slot: plan.slot, minutes: 0, weekday: weekdayOf(dayForEpisode(plan.episode)) }, characters: { ...s.characters, [id]: { ...c, lastAction: undefined } } };
  if (hasJobNow(then, c)) return 'has work then';
  if (!validPlanPlace(s, plan.node, s.playerId, id)) return 'would rather not meet there';
  // already going there then (their own DJ set, say): the player is welcome to come along
  if (s.invitations.some((p) => [p.from, p.to].includes(id) && !(moving && [p.from, p.to].includes(moving)) && p.episode === plan.episode && p.slot === plan.slot && p.node !== plan.node && ['pending', 'accepted'].includes(p.status))) return 'already has plans then';
  return '';
}

/** A place (id or name) and a "when" in words ("tomorrow at 10:00", "tonight at 21:30") as a calendar block still ahead. */
export function planFromWords(s: GameState, place: string, when: string, date = false): TalkPlan | null {
  const node = planPlace(place);
  const p = node ? proposedPlan(s, `Want to meet at ${placeName(node)} ${when}?`) : null;
  return p && { node: node!, episode: p.episode, slot: p.slot, ...(date ? { date: true } : {}) };
}

/** What the model read off a conversation: a meet-up both agreed to, or a call-off of their plans. */
export type PlanRead = { plan?: TalkPlan; cancel?: boolean };

/**
 * Bring the calendar in line with what two people settled in words: a new plan is added, an open plan they moved
 * (new time or place) is updated, a pending one they said yes to is accepted, and a called-off one is declined.
 */
export function applyPlanRead(s0: GameState, a: string, b: string, read: PlanRead): GameState {
  const s = structuredClone(s0);
  const now = SLOTS.indexOf(s.world.slot);
  const open = s.invitations.filter((p) => [p.from, p.to].includes(a) && [p.from, p.to].includes(b) && !p.performance && ['pending', 'accepted'].includes(p.status)
    && (p.episode > s.world.episode || (p.episode === s.world.episode && SLOTS.indexOf(p.slot) >= now)));
  if (read.cancel) {
    for (const p of open) p.status = 'declined';
    if (open.length) addLog(s, { kind: 'calendar', text: `${firstName(s, a)} and ${firstName(s, b)} called off their plan.`, participants: [a, b], salience: 0.3 });
    return s;
  }
  const plan = read.plan;
  if (!plan) return s0;
  const moved = open.find((p) => p.node === plan.node && p.episode === plan.episode && p.slot === plan.slot)
    ?? open.find((p) => p.node === plan.node || (p.episode === plan.episode && p.slot === plan.slot)) ?? (open.length === 1 ? open[0] : undefined);
  if (!moved) return addTalkPlan(s, a, b, plan);
  if (moved.node === plan.node && moved.episode === plan.episode && moved.slot === plan.slot && moved.status === 'accepted') return s0;
  Object.assign(moved, { node: plan.node, episode: plan.episode, slot: plan.slot, status: 'accepted' });
  addLog(s, { kind: 'calendar', text: `${firstName(s, a)} and ${firstName(s, b)} settled on ${placeName(plan.node)} ${planWhen(s, plan)}.`, participants: [a, b], salience: 0.3 });
  return s;
}

/** An agreed talk or text plan goes on the shared calendar; startPlans and settlePlans then run it like any other. */
export function addTalkPlan(s0: GameState, from: string, to: string, plan: TalkPlan): GameState {
  const s = structuredClone(s0);
  s.invitations.push({ id: nextId(s, 'plan'), from, to, ...plan, status: 'accepted' });
  notePlan(s, s.invitations.at(-1)!);
  addLog(s, { kind: 'calendar', text: `${firstName(s, to)} agreed to meet ${firstName(s, from)} at ${placeName(plan.node)} ${planWhen(s, plan)}.`, participants: [from, to], salience: 0.3 });
  return s;
}

/** Open to the sky: weather (rain, heat) reaches it. Every other house room and city place is indoors. */
export const isOutdoors = (place: string) =>
  ['backyard', 'balconyW', 'balconyM'].includes(place) || ['beach', 'park', 'scenic', 'harbor'].includes(content().city.nodes.find((n) => n.id === place)?.type ?? '');

export function startPlans(s: GameState) {
  startPerformances(s);
  for (const p of s.invitations.filter((p) => !p.performance && p.status === 'accepted' && p.episode === s.world.episode && p.slot === s.world.slot)) {
    if (s.world.flags[`planStarted_${p.id}`]) continue;
    s.world.flags[`planStarted_${p.id}`] = true;
    if (!validPlanPlace(s, p.node, p.from, p.to)) { p.status = 'declined'; continue; }
    if (isOutdoors(p.node) &&['rain', 'heatwave', 'typhoon'].includes(s.world.weather)) {
      p.status = 'declined';
      postGroupChat(s, p.from, `Let's postpone ${content().city.nodes.find((n) => n.id === p.node)?.name ?? p.node}: ${s.world.weather}. No hard feelings.`);
      addLog(s, { kind: 'system', text: `Weather postponed the plan with ${firstName(s, p.from)}.`, participants: [p.from, p.to], salience: 0.3 });
      continue;
    }
    const sharedPlayerTrip = s.world.carUsedBy === s.playerId && [p.from, p.to].includes(s.playerId) && player(s).location === p.node;
    const route = !isRoom(p.node) ? reachability('house', p.slot, 3, s.world.carUsedBy === null || sharedPlayerTrip, s.world.minutes, s.world.weekday).find((r) => r.node === p.node) : undefined;
    if (!isRoom(p.node) && !route?.reachable) {
      p.status = 'declined';
      addLog(s, { kind: 'system', text: `The plan was postponed: ${content().city.nodes.find((n) => n.id === p.node)?.name ?? p.node} is closed or too far to reach and return.`, participants: [p.from, p.to], salience: 0.3 });
      continue;
    }
    if (route?.needsCar && [p.from, p.to].some((id) => isShabbat({ ...s, world: { ...s.world, minutes: s.world.minutes + route.minutes * 2 + ACTIVITY_MINUTES } }, s.characters[id]))) {
      p.status = 'declined';
      continue;
    }
    for (const id of [p.from, p.to]) {
      const c = s.characters[id];
      if (!c || c.isPlayer || c.status !== 'inHouse' || isShabbat(s, c) || c.lastAction === 'work') continue;
      c.location = p.node;
      c.swimming = false;
      c.lastAction = 'goOut';
      c.activityUntil = SLOT_MINUTES;
      c.actionNode = p.node;
      maybeDrink(s, c, p.node, 0.1);
      if (route?.needsCar && s.world.carUsedBy === null) s.world.carUsedBy = c.id;
    }
  }
}

function hourlyLife(s: GameState, rng: Rng) {
  offerPerformances(s, rng);
  const P = player(s);
  const actions: Record<string, AgentAction> = Object.fromEntries(npcs(s).map((c) => [c.id, { kind: (c.lastAction ?? 'retreat') as AgentAction['kind'], target: c.actionTarget, third: c.actionThird, node: c.actionNode, household: c.actionHousehold }]));
  for (const ix of resolveColocation(s, rng, actions, P.id)) {
    // Short overheard moments grow relationships more slowly than full conversations.
    for (const changes of [ix.proposal.affinityDeltas, ix.proposal.romanceDeltas, ix.proposal.trustDeltas, ix.proposal.tensionDeltas, ix.proposal.moodDeltas]) for (const d of changes) d.delta *= 0.12;
    applyProposal(s, sanitizeProposal(ix.proposal, [ix.a, ix.b]), [ix.a, ix.b]);
    if (ix.type === 'confess') resolveConfession(s, rng, ix.a, ix.b, {});
    if (ix.type === 'apology') apologize(s, rng, ix.a, ix.b);
    logInteraction(s, ix);
  }
  resolveRemote(s, rng, actions, P.id);
  const available = npcs(s).filter((c) => !['work', 'sleep', 'nap', 'shower'].includes(c.lastAction ?? '') && isRoom(c.location));
  const initiator = available.find((c) => c.actionTarget === P.id && c.lastAction === 'seek') ?? (available.length && rng.chance(0.3) ? rng.pick(available) : undefined);
  if (initiator && isRoom(P.location) && !s.approaches.some((a) => a.from === initiator.id) && s.approaches.length < 3) {
    s.approaches.push({ id: nextId(s, 'approach'), from: initiator.id, text: `${firstName(s, initiator.id)}: got a minute? ${P.location.startsWith('bedroom') ? 'A knock at your door.' : 'Come sit with me.'}` });
  }
  if (available.length && rng.chance(0.35)) {
    const c = rng.pick(available);
    const mate = available.find((o) => o.id !== c.id && o.location === c.location);
    addFeedPost(s, c.id, `${c.persona.routine.hobbies[0]} break${mate ? ` with ${firstName(s, mate.id)}` : ''}.`, mate?.id);
  }
  if (available.length && s.invitations.filter((p) => ['pending', 'accepted'].includes(p.status)).length < 6 && rng.chance(0.25)) {
    const a = rng.pick(available);
    const b = housemates(s).filter((c) => c.id !== a.id).sort((x, y) => rel(s, a.id, y.id).affinity - rel(s, a.id, x.id).affinity)[0];
    const node = rng.pick(['market', 'cafe', 'park']);
    if (b) {
      const p = { id: nextId(s, 'plan'), from: a.id, to: b.id, episode: s.world.episode + 1, slot: 'slot1' as const, node, status: b.isPlayer ? 'pending' as const : 'accepted' as const, ...(attracted(a, b) && rel(s, a.id, b.id).romance >= 30 ? { date: true } : {}) };
      s.invitations.push(p);
      notePlan(s, p);
      if (b.isPlayer && !isShabbat(s, a)) {
        (s.chats[uk(a.id, b.id)] ??= []).push({ from: a.id, text: `${content().city.nodes.find((n) => n.id === node)?.name ?? node} tomorrow morning? Check your plans.`, tick: s.world.tick, readBy: [], ignoredBy: [] });
      }
    }
  }
  observeRoutines(s);
}

/** Advance on activity deadlines and hourly boundaries, independent of how the player splits an action. */
export function advanceLiving(s: GameState, rng: Rng, to: number, protectedIds: Set<string> = new Set()) {
  const end = Math.min(SLOT_MINUTES, Math.max(s.world.minutes, Math.round(to)));
  if (end <= s.world.minutes) return;
  const reschedule = () => {
    const due = npcs(s).filter((c) => !protectedIds.has(c.id) && c.activityUntil <= s.world.minutes);
    const fixed = Object.fromEntries(housemates(s).filter((c) => c.isPlayer || !due.includes(c)).map((c) => [c.id, c.location]));
    const actions: Record<string, AgentAction> = {};
    for (const c of due) actions[c.id] = chooseAction(s, rng, c);
    coordinateOutings(actions);
    for (const c of due) {
      if (actions[c.id].useCar) {
        if (s.world.carUsedBy === null) s.world.carUsedBy = c.id;
        else if (s.world.carUsedBy !== actions[c.id].companion) actions[c.id] = { kind: 'hobby' };
      }
      if (actions[c.id].kind === 'work') workCareerTick(s, rng, c);
    }
    startNpcHouseholds(s, rng, actions);
    resolveLocations(s, actions, fixed);
    for (const c of due) {
      scheduleActivity(s, c, actions[c.id]);
      satisfy(c, actions[c.id].kind, durationFor(actions[c.id]) / SLOT_MINUTES);
      if (actions[c.id].kind === 'goOut' && actions[c.id].node) maybeDrink(s, c, actions[c.id].node!);
    }
    startPlans(s);
  };
  completeHouseholds(s);
  reschedule();
  while (s.world.minutes < end) {
    const now = s.world.minutes;
    const expiry = Math.min(end, ...housemates(s).filter((c) => c.activityUntil > now && (c.actionHousehold || !c.isPlayer && !protectedIds.has(c.id))).map((c) => c.activityUntil));
    const nextHour = (Math.floor(now / 60) + 1) * 60;
    const sundown = s.world.slot === 'slot3' && now < 120 && [5, 6].includes(s.world.weekday) ? 120 : SLOT_MINUTES;
    const next = Math.min(expiry, nextHour, sundown, end);
    sharedTimeAffinity(s, next - now);
    s.world.minutes = next;
    completeHouseholds(s);
    if (s.world.minutes === 120 && s.world.slot === 'slot3') for (const c of npcs(s)) {
      if (isShabbat(s, c) && ['cook', 'work', 'text', 'goOut'].includes(c.lastAction ?? '')) { c.activityUntil = s.world.minutes; c.actionNode = undefined; }
    }
    if (s.world.minutes < SLOT_MINUTES) reschedule();
    if (s.world.minutes % 60 === 0) hourlyLife(s, rng);
    // only at stops every chunking shares (expiries, hours), so a split conversation sees what an unsplit one does
    if (s.world.minutes === expiry || s.world.minutes % 60 === 0) observeRoutines(s);
  }
}

export function socialAction(s: GameState, a: PlayerAction): { talk?: string } {
  const P = player(s);
  switch (a.type) {
    case 'plan': {
      const other = s.characters[a.target];
      const accepted = rel(s, other.id, P.id).trust >= 20 && !isShabbat(s, other) && (!a.date || attracted(other, P));
      s.invitations.push({ id: nextId(s, 'plan'), from: P.id, to: a.target, episode: a.episode, slot: a.slot, node: a.node, status: accepted ? 'accepted' : 'declined', ...(a.date ? { date: true } : {}) });
      notePlan(s, s.invitations.at(-1)!);
      addLog(s, { kind: 'system', text: `${firstName(s, other.id)} ${accepted ? 'accepted' : 'declined'} your invitation.`, participants: [P.id, other.id], salience: 0.3 });
      break;
    }
    case 'respondPlan': {
      const p = s.invitations.find((p) => p.id === a.id)!;
      p.status = a.accept ? 'accepted' : 'declined';
      break;
    }
    case 'approach': {
      const p = s.approaches.find((p) => p.id === a.id)!;
      s.approaches = s.approaches.filter((x) => x.id !== p.id);
      if (a.accept) { P.location = s.characters[p.from].location; return { talk: p.from }; }
      addRel(s, p.from, P.id, 'affinity', -1);
      break;
    }
    case 'gift':
    case 'favor': {
      const c = s.characters[a.target];
      const item = a.type === 'gift' ? a.item : a.kind;
      if (a.type === 'gift') s.inventory.splice(s.inventory.indexOf(item), 1);
      const taste = GIFT_ITEMS[item]?.hobby;
      const fit = !taste || c.persona.routine.hobbies.some((h) => h.toLowerCase().includes(taste)) ? 1 : 0.35;
      addRel(s, c.id, P.id, 'affinity', 4 * fit);
      addRel(s, c.id, P.id, 'trust', 2 * fit);
      addMemory(s, c.id, `${P.name} ${a.type === 'gift' ? `gave me ${item}` : item === 'coffee' ? 'made me coffee' : 'left a kind note on the fridge'}.`, [c.id, P.id], 0.5);
      addLog(s, { kind: 'system', text: `${c.name} ${fit === 1 ? 'appreciated' : 'politely accepted'} your ${item}.`, participants: [c.id, P.id], salience: 0.3 });
      break;
    }
    case 'post': addFeedPost(s, P.id, a.text, undefined, a.kind ?? 'photo'); break;
    case 'like': {
      const p = s.feed.find((p) => p.id === a.id)!;
      if (!p.likes.includes(P.id)) { p.likes.push(P.id); addRel(s, p.from, P.id, 'affinity', 0.5); }
      break;
    }
  }
  s.invitations = s.invitations.slice(-60);
  return {};
}

export function relationshipUpkeep(s: GameState) {
  for (const a of housemates(s)) for (const b of housemates(s)) {
    if (a.id === b.id) continue;
    const spentTime = (s.memory[a.id] ?? []).some((m) => m.episode === s.world.episode && m.participants.includes(b.id));
    if (!spentTime) addRel(s, a.id, b.id, 'closeness', -0.6);
  }
  for (const c of housemates(s)) if (s.world.weather === 'heatwave') c.mood = clamp(c.mood - 0.05, -1, 1);
}

/**
 * The player knocks on the other bedroom's door. Whoever inside is awake and trusts them most answers; they let the
 * player in for this block, or say not now. Nobody (or only sleepers) inside = no answer. The house hears about it.
 */
export function knock(s: GameState, room: string): 'in' | 'refused' | 'nobody' {
  const P = player(s);
  const inside = npcs(s).filter((c) => c.location === room && !['sleep', 'nap', 'shower'].includes(c.lastAction ?? ''))
    .sort((a, b) => rel(s, b.id, P.id).trust - rel(s, a.id, P.id).trust);
  const who = inside[0];
  const name = content().house.rooms.find((r) => r.id === room)?.name ?? room;
  if (!who) {
    addLog(s, { kind: 'domestic', text: `${P.name.split(' ')[0]} knocked on the ${name} door. Nobody answered.`, participants: [P.id], salience: 0.15 });
    return 'nobody';
  }
  const r = rel(s, who.id, P.id);
  const ok = r.trust + r.affinity * 0.6 + r.romance * 0.4 - r.tension * 0.5 >= 38;
  if (ok) {
    s.world.flags[`knockOk_${room}`] = `${s.world.episode}:${s.world.slot}`;
    addRel(s, who.id, P.id, 'closeness', 2);
    addMemory(s, who.id, `let ${P.name.split(' ')[0]} into the ${name}`, [who.id, P.id], 0.35);
    // the rest of the house notices: who went into whose room is exactly what the house talks about
    const f = addFact(s, { subject: P.id, about: who.id, kind: 'event', content: `${P.name.split(' ')[0]} was let into the ${name} by ${firstName(s, who.id)}`, truth: true, sensitivity: 0.35 });
    learn(s, who.id, f.id, 'witnessed');
    learn(s, P.id, f.id, 'self');
    for (const c of npcs(s)) if (c.id !== who.id && isRoom(c.location) && content().house.rooms.find((x) => x.id === c.location)?.floor === 1) learn(s, c.id, f.id, 'overheard', who.id);
  } else {
    addRel(s, P.id, who.id, 'tension', 1);
    addMemory(s, who.id, `told ${P.name.split(' ')[0]} "not now" through the ${name} door`, [who.id, P.id], 0.3);
  }
  addLog(s, { kind: 'domestic', text: ok ? `${firstName(s, who.id)} opened the ${name} door and let ${P.name.split(' ')[0]} in.` : `${firstName(s, who.id)} answered the knock: "not now."`, participants: [P.id, who.id], salience: 0.3 });
  return ok ? 'in' : 'refused';
}

export function canVisit(s: GameState, room: string, invite?: string) {
  const r = content().house.rooms.find((r) => r.id === room);
  if (!r) return false;
  if (!r.private) return true;
  const own = bedroomOf(player(s));
  if (room === own || room === (own === 'bedroomM' ? 'balconyM' : 'balconyW')) return true;
  if (['bathroom', 'smallBathroom'].includes(room)) return !npcs(s).some((c) => c.location === room);
  if (s.world.flags[`knockOk_${room}`] === `${s.world.episode}:${s.world.slot}`) return true;
  return !!invite && s.characters[invite]?.location === room && s.invitations.some((p) => p.node === room && p.episode === s.world.episode && p.slot === s.world.slot && p.status === 'accepted' && [p.from, p.to].includes(s.playerId) && [p.from, p.to].includes(invite));
}
