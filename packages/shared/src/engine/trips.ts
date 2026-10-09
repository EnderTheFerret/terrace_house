// Overnight trips (the show's recurring big episodes): Friday afternoon in the shared car, back Saturday morning.
import type { GameState } from '../model';
import { addFact, addLog, attracted, firstName, housemates, isRoom, learn, npcs, player, rel } from './core';
import type { Rng } from '../rng';
import { afford, budgetFor, playerBudget, type Price } from './budget';
import { isShabbat } from './agents';
import { addFeedPost } from './living';

export const TRIPS: Record<string, { name: string; price: Price; blurb: string }> = {
  galilee: { name: 'a Galilee campsite', price: 2, blurb: 'tents by the Jordan, a campfire, stars, and nobody brought enough blankets' },
  deadsea: { name: 'the Dead Sea', price: 2, blurb: 'floating in the salt, mud on everyone, a guesthouse with thin walls' },
  eilat: { name: 'Eilat', price: 3, blurb: 'Red Sea snorkelling, a hotel balcony and a long drive through the desert' },
};

/** Why this trip can't happen now, or null. Shabbat observers don't drive into Shabbat; budgets must reach the place. */
export function tripProblem(s: GameState, node: string, withIds: string[]): string | null {
  const t = TRIPS[node];
  if (!t) return 'unknown destination';
  if (s.world.weekday !== 5 || !['morning', 'slot1', 'slot2'].includes(s.world.slot)) return 'weekend trips leave on Friday before the afternoon';
  if (s.world.flags.trip) return 'the shared car is away on a trip';
  if (s.world.carUsedBy !== null && s.world.carUsedBy !== s.playerId) return 'the shared car is taken';
  if (player(s).persona.keepsShabbat) return 'you keep Shabbat: no driving back on Saturday';
  for (const id of withIds) {
    const c = s.characters[id];
    if (!c || c.status !== 'inHouse' || c.isPlayer) return 'that housemate is not available';
    if (c.persona.keepsShabbat) return `${firstName(s, id)} keeps Shabbat and won't travel over it`;
    // asleep is fine (they get woken up for a weekend away); at work or out of the house is not
    if (!isRoom(c.location) || c.lastAction === 'work') return `${firstName(s, id)} is busy right now`;
  }
  if (afford(playerBudget(s), t.price) === 'out') return 'that trip is out of your budget';
  if (withIds.some((id) => afford(budgetFor(s, id), t.price) === 'out') && afford(playerBudget(s), t.price) !== 'ok') return 'not everyone can afford it, and you can\'t cover them';
  return null;
}

/** The house sees who left together; whoever stayed home will talk about it. `group` may or may not include the player. */
export function leaveOnTrip(s: GameState, node: string, group: string[], roommate?: string) {
  shareRoom(s, node, group[0], roommate ?? (group.length === 2 ? group[1] : undefined));
  const P = player(s);
  for (const id of group) {
    s.characters[id].location = node;
    if (id !== P.id) s.world.flags[`away_${id}`] = node; // NPCs stay there until the group comes home
  }
  s.world.carUsedBy = group[0];
  s.world.flags.trip = `${node}|${group.join(',')}`;
  s.world.flags.tripBack = s.world.episode + 1;
  if (group.includes(P.id)) s.world.flags.sleepUntilMorning = true;
  delete s.world.flags.tripOffer;
  const names = group.map((id) => firstName(s, id)).join(', ');
  const f = addFact(s, { subject: group[0], about: group[1], kind: 'event', content: `${names} went away overnight to ${TRIPS[node].name} together`, truth: true, sensitivity: group.length === 2 ? 0.55 : 0.3 });
  for (const id of group) learn(s, id, f.id, 'self');
  // whoever is home sees them go; the rest hear it from them
  const home = housemates(s).filter((c) => !group.includes(c.id) && isRoom(c.location) && !isShabbat(s, c));
  for (const c of home) learn(s, c.id, f.id, 'witnessed');
  for (const c of housemates(s)) if (!group.includes(c.id) && home[0] && !home.includes(c)) learn(s, c.id, f.id, 'told', home[0].id);
  addLog(s, { kind: 'system', text: `${names} left for ${TRIPS[node].name} in the shared car. Back tomorrow morning.`, participants: group, salience: 0.6 });
  if (group.includes(P.id)) return;
  // the ones left behind see it all on their phones: a post from the trip, and a photo for the player if they are close
  addFeedPost(s, group[0], `${TRIPS[node].name} 🌅 ${group.length > 2 ? 'the crew' : `with ${firstName(s, group[1])}`}`, group[1], 'photo');
  const friend = group.find((id) => rel(s, id, P.id).affinity >= 40);
  if (friend) (s.chats[[P.id, friend].sort().join('|')] ??= []).push({ from: friend, text: `wish you were here (${TRIPS[node].blurb.split(',')[0]})`, tick: s.world.tick, readBy: [friend], ignoredBy: [], photo: true, at: node });
}

/**
 * Who shares a room (or tent) with whom: a moment for the pair (attraction grows) and exactly what the house will
 * want to know. The rest of the house hears it as a rumour from the trip.
 */
function shareRoom(s: GameState, node: string, a: string, b?: string) {
  if (!b || !s.characters[b]) return;
  for (const [x, y] of [[a, b], [b, a]]) if ((rel(s, x, y).romance >= 20 || rel(s, x, y).affinity >= 40) && attracted(s.characters[x], s.characters[y])) s.rel[x][y].romance = Math.min(100, s.rel[x][y].romance + 3);
  const f = addFact(s, { subject: a, about: b, kind: 'romance', content: `${firstName(s, a)} and ${firstName(s, b)} shared a room at ${TRIPS[node].name}`, truth: true, sensitivity: 0.6 });
  learn(s, a, f.id, 'self');
  learn(s, b, f.id, 'self');
}

/** The trip group, if they are due back this morning (cleared once read). */
export function returningFromTrip(s: GameState): { node: string; group: string[] } | null {
  const t = s.world.flags.trip;
  if (typeof t !== 'string' || s.world.flags.tripBack !== s.world.episode || s.world.slot !== 'morning') return null;
  delete s.world.flags.trip;
  delete s.world.flags.tripBack;
  const [node, ids] = t.split('|');
  const group = ids.split(',').filter((id) => s.characters[id]?.status === 'inHouse');
  for (const id of group) {
    delete s.world.flags[`away_${id}`];
    s.characters[id].location = 'entrance';
  }
  return { node, group };
}

const canTravel = (s: GameState, id: string) => {
  const c = s.characters[id];
  return c?.status === 'inHouse' && !c.persona.keepsShabbat && !s.world.flags[`away_${id}`] && !s.world.flags[`leaving_${id}`];
};

/**
 * Thursday evening: a housemate who likes the player texts an invitation for the weekend. It shows up in the phone
 * and pre-fills Friday's trip panel. Returns true when an offer was made.
 */
export function maybeOfferTrip(s: GameState, rng: Rng): boolean {
  const P = player(s);
  if (s.world.weekday !== 4 || s.world.slot !== 'evening' || s.world.flags.tripOffer || P.persona.keepsShabbat) return false;
  const host = npcs(s).filter((c) => canTravel(s, c.id) && rel(s, c.id, P.id).affinity + rel(s, c.id, P.id).romance >= 30).sort((a, b) => rel(s, b.id, P.id).affinity - rel(s, a.id, P.id).affinity)[0];
  if (!host || !rng.chance(0.6)) return false;
  const node = rng.pick(Object.keys(TRIPS).filter((id) => afford(budgetFor(s, host.id), TRIPS[id].price) !== 'out'));
  if (!node) return false;
  s.world.flags.tripOffer = `${host.id}|${node}`;
  (s.chats[[P.id, host.id].sort().join('|')] ??= []).push({ from: host.id, text: `random idea: ${TRIPS[node].name} this weekend? leave friday morning, back saturday. you in?`, tick: s.world.tick, readBy: [], ignoredBy: [] });
  addLog(s, { kind: 'chat', text: `${firstName(s, host.id)} texted you about a weekend trip to ${TRIPS[node].name}.`, participants: [P.id, host.id], salience: 0.45 });
  return true;
}

/** The pending weekend invitation to the player, if any. */
export function tripOffer(s: GameState): { from: string; node: string } | null {
  const o = s.world.flags.tripOffer;
  if (typeof o !== 'string') return null;
  const [from, node] = o.split('|');
  return s.characters[from] && TRIPS[node] ? { from, node } : null;
}

/**
 * Friday late morning: if the player didn't go, a couple or a close pair (or the one who invited the player) goes
 * away without them. The house is quieter for a night, and the return is a scene.
 */
export function maybeNpcTrip(s: GameState, rng: Rng): string[] | null {
  if (s.world.weekday !== 5 || s.world.slot !== 'slot2' || s.world.flags.trip) return null;
  const offer = tripOffer(s);
  delete s.world.flags.tripOffer;
  const free = npcs(s).filter((c) => canTravel(s, c.id) && isRoom(c.location) && c.lastAction !== 'work');
  const pairs = free.flatMap((a) => free.filter((b) => a.id < b.id).map((b) => [a.id, b.id] as [string, string]))
    .map(([a, b]) => ({ a, b, w: rel(s, a, b).affinity + rel(s, b, a).affinity + 2 * (rel(s, a, b).romance + rel(s, b, a).romance) + (offer && [a, b].includes(offer.from) ? 40 : 0) }))
    .filter((p) => p.w >= 90)
    .sort((x, y) => y.w - x.w);
  const pick = pairs[0];
  if (!pick || !rng.chance(0.45)) return null;
  const node = offer && [pick.a, pick.b].includes(offer.from) ? offer.node : rng.pick(Object.keys(TRIPS));
  const short = [pick.a, pick.b].filter((id) => afford(budgetFor(s, id), TRIPS[node].price) === 'out');
  if (short.length) {
    // can't afford it yet: they pick up extra shifts this week, and the trip waits for next Friday
    for (const id of short) {
      s.world.flags[`extraShifts_${id}`] = s.world.episode + 7;
      addLog(s, { kind: 'system', text: `${firstName(s, id)} picked up extra shifts to afford ${TRIPS[node].name} with ${firstName(s, id === pick.a ? pick.b : pick.a)}.`, participants: [pick.a, pick.b], salience: 0.35 });
    }
    return null;
  }
  leaveOnTrip(s, node, [pick.a, pick.b]);
  return [pick.a, pick.b];
}
