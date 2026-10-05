import type { GameState, PlayerAction } from '../model';
import type { Rng } from '../rng';
import { content } from '../content';
import { clamp, uk } from '../util';
import { addFact, addLog, addMemory, addRel, clockLabel, firstName, housemates, isRoom, learn, nextId, npcs, player, rel, SLOT_MINUTES } from './core';
import { bedroomOf, chooseAction, coordinateOutings, durationFor, isShabbat, resolveLocations, satisfy, type AgentAction } from './agents';
import { logInteraction, resolveColocation, resolveRemote } from './interactions';
import { applyProposal, sanitizeProposal } from './relationships';
import { apologize } from './social';
import { resolveConfession } from './outcome';
import { consume, postGroupChat, workCareerTick } from './house';
import { ACTIVITY_MINUTES, reachability } from './city';
import { npcRecipe } from './cooking';

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
      addLog(s, { kind: 'system', text: `${firstName(s, a.id)} and ${firstName(s, b.id)} ${kept ? 'kept' : 'missed'} their plan at ${content().city.nodes.find((n) => n.id === p.node)?.name ?? p.node}.`, participants: [a.id, b.id], salience: 0.4 });
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

/** Open to the sky: weather (rain, heat) reaches it. Every other house room and city place is indoors. */
export const isOutdoors = (place: string) =>
  ['backyard', 'balconyW', 'balconyM'].includes(place) || ['beach', 'park', 'scenic', 'harbor'].includes(content().city.nodes.find((n) => n.id === place)?.type ?? '');

export function startPlans(s: GameState) {
  for (const p of s.invitations.filter((p) => p.status === 'accepted' && p.episode === s.world.episode && p.slot === s.world.slot)) {
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
      if (route?.needsCar && s.world.carUsedBy === null) s.world.carUsedBy = c.id;
    }
  }
}

function hourlyLife(s: GameState, rng: Rng) {
  const P = player(s);
  const actions: Record<string, AgentAction> = Object.fromEntries(npcs(s).map((c) => [c.id, { kind: (c.lastAction ?? 'retreat') as AgentAction['kind'], target: c.actionTarget, third: c.actionThird, node: c.actionNode }]));
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
      const p = { id: nextId(s, 'plan'), from: a.id, to: b.id, episode: s.world.episode + 1, slot: 'slot1' as const, node, status: b.isPlayer ? 'pending' as const : 'accepted' as const };
      s.invitations.push(p);
      if (b.isPlayer && !isShabbat(s, a)) {
        (s.chats[uk(a.id, b.id)] ??= []).push({ from: a.id, text: `${content().city.nodes.find((n) => n.id === node)?.name ?? node} tomorrow morning? Check the shared calendar.`, tick: s.world.tick, readBy: [], ignoredBy: [] });
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
      if (actions[c.id].kind === 'cook') {
        const recipe = npcRecipe(c, s, rng);
        if (!recipe || !consume(s, recipe.ingredients)) actions[c.id] = { kind: 'retreat' };
      }
      if (actions[c.id].kind === 'work') workCareerTick(s, rng, c);
    }
    resolveLocations(s, actions, fixed);
    for (const c of due) { scheduleActivity(s, c, actions[c.id]); satisfy(c, actions[c.id].kind, durationFor(actions[c.id]) / SLOT_MINUTES); }
    startPlans(s);
  };
  reschedule();
  while (s.world.minutes < end) {
    const now = s.world.minutes;
    const expiry = Math.min(end, ...npcs(s).filter((c) => !protectedIds.has(c.id) && c.activityUntil > now).map((c) => c.activityUntil));
    const nextHour = (Math.floor(now / 60) + 1) * 60;
    const sundown = s.world.slot === 'slot3' && now < 120 && [5, 6].includes(s.world.weekday) ? 120 : SLOT_MINUTES;
    s.world.minutes = Math.min(expiry, nextHour, sundown, end);
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
      const accepted = rel(s, other.id, P.id).trust >= 20 && !isShabbat(s, other);
      s.invitations.push({ id: nextId(s, 'plan'), from: P.id, to: a.target, episode: a.episode, slot: a.slot, node: a.node, status: accepted ? 'accepted' : 'declined' });
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
