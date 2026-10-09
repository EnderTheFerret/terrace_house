// Slot loop. Public API is pure: (state, action) → new state (+ plan); randomness only via state.rngState.
//   createGame → [planSlot → resolveScene* → finishSlot]*
import type { EventTemplate } from '../contentSchema';
import type { Character, DeltaProposal, EventInstance, GameState, PlayerAction, Room, Slot } from '../model';
import { SCHEMA_VERSION, SLOTS } from '../model';
import { mulberry32, type Rng } from '../rng';
import { clamp, fill } from '../util';
import { content } from '../content';
import { applyPool, validatePool } from './pool';
import {
  addFact, addLog, addMemory, attracted, ch, cloneState, coupleOf, departing, isCouple, depthCeiling, firstName, flag, housemates, isRoom, knows, learn,
  nextId, npcs, placeName, player, rel, withRng, MINUTES_PER_LINE, SLOT_MINUTES, SLOT_START, clockLabel,
} from './core';
import { applyCalendar, chooseTyphoonDay } from './calendar';
import { bedroomOf, chooseAction, coordinateOutings, decayNeeds, isShabbat, outingProblem, resolveLocations, satisfy, type AgentAction } from './agents';
import { candidates, expectedDrama, housemateRoles, sample, type Candidate } from './director';
import { logInteraction, rememberInteraction, resolveColocation, resolveRemote, type Interaction } from './interactions';
import { arcCandidates, careerChanges, initArc, refreshJobArc } from './arcs';
import { applySceneOutcome, engineProposal, npcIntent, type SceneChoices, type SceneResolution } from './outcome';
import { applyProposal, sanitizeProposal } from './relationships';
import { autoGroceries, houseTick, initHouse, playerGroceries, rotateChores, workCareerTick } from './house';
import { HOUSEHOLD, householdCompanyProblem, householdProblem, joinHousehold, startHousehold, startNpcHouseholds } from './household';
import { decayGrudges, maybeGroupChatExclusion, updateMoods } from './social';
import { depart, departLeaving, evaluateLeaves, invitePartnerToLeave, markLeaving, processArrivals } from './leave';
import { expirePredictions } from './predictions';
import { missionsToTexts } from './matchmaker';
import { compactAll, previouslyRecap, updatePairSummaries } from './memory';
import { pruneFacts } from './knowledge';
import { communalMeal, serveCommunalMeal, welcomeDinnerDue } from './meals';
import { castGenders, defaultCast, DEFAULT_PLAYER, generateCast, initRelationships, playerFromSetup, type PlayerSetup } from './castgen';
import { fridgeTotal } from './conditions';
import { ACTIVITY_MINUTES, canUseCar, classToday, CONTRACT_BONUS, contractDays, MISSES_BEFORE_FIRED, reachability, shiftToday, WAGE } from './city';
import { epilogueFor } from './epilogue';
import { afford, budgetFor, canStretch, GIFT_PRICE, playerBudget } from './budget';

/** How the player's budget meets an outing (work and class never cost; a gift is priced by the gift). */
function spendFit(s: GameState, a: Extract<PlayerAction, { type: 'goOut' }>, price: 1 | 2 | 3) {
  if (a.activity === 'work' || a.activity === 'class') return 'ok';
  return afford(playerBudget(s), a.activity === 'gift' && a.item ? GIFT_PRICE[a.item] ?? 1 : price);
}
import { airEpisode, airingTonight } from './broadcast';
import { outsiderMoment, returningResident } from './outsiders';
import { performanceScene } from './performances';
import { leaveOnTrip, maybeNpcTrip, maybeOfferTrip, returningFromTrip, tripProblem, TRIPS } from './trips';
import { getDrunk, maybeDrink, servesDrinks, soberUp } from './drink';
import { advanceLiving, canVisit, GIFT_ITEMS, knock, observeRoutines, queueFollowUps, recordActivity, relationshipUpkeep, scheduleActivity, settlePlans, socialAction, startPlans, validPlanPlace, weatherRefusal } from './living';

export interface NewGameOptions {
  seed: number;
  player?: PlayerSetup;
  randomizeCast?: boolean;
  seasonLength?: number;
  gameId?: string;
  /** Episode 1 starts with the player and one housemate; the others arrive through evening. */
  moveInDay?: boolean;
  moveInVersion?: 1 | 2;
  /** New sessions enable this; older event logs keep their original scheduling. */
  communalMeals?: boolean;
}

/** Legacy saves: which block each arrival comes through the door. */
const MOVE_IN_BLOCK = [0, 1, 2, 3, 4, 4];

/** Move-in day arrivals due by the current block come through the door. Returns who arrived. */
function moveInArrivals(s: GameState): Character[] {
  const order = String(s.world.flags.moveIn ?? '').split(',').filter(Boolean);
  const due = order.filter((id, i) => MOVE_IN_BLOCK[i] <= SLOTS.indexOf(s.world.slot) && s.characters[id]?.status === 'arriving');
  for (const id of due) {
    const c = s.characters[id];
    c.status = 'inHouse';
    c.location = 'entrance';
    s.world.flags[`new_${id}`] = s.world.episode;
    addLog(s, { kind: 'arrival', text: `${c.name}, ${c.age}, ${c.occupation}, arrived at the house with a suitcase.`, participants: [id], salience: 0.7 });
  }
  return due.map((id) => s.characters[id]);
}

export function createGame(o: NewGameOptions): GameState {
  const rng = mulberry32(o.seed);
  const seasonLength = o.seasonLength ?? 0;
  const P = playerFromSetup(o.player ?? DEFAULT_PLAYER);
  const cast: Character[] = o.randomizeCast ? generateCast(rng, castGenders(P.gender), P, seasonLength) : defaultCast(P.gender);
  const all = [...cast, P];
  const s: GameState = {
    schemaVersion: SCHEMA_VERSION,
    gameId: o.gameId ?? `game-${o.seed}`,
    seed: o.seed,
    rngState: 0,
    seasonLength,
    playerId: P.id,
    world: {
      day: 0, episode: 1, slot: 'morning', minutes: 0, tick: 0, weather: 'sunny', forecast: 'sunny', weekday: 3, season: 'spring', cityEvent: null,
      playerNode: 'house', carUsedBy: null, playerJob: null, flags: {}, typhoonDay: -1,
    },
    characters: Object.fromEntries(all.map((c) => [c.id, c])),
    rel: {},
    beliefs: {},
    facts: {},
    knowledge: Object.fromEntries(all.map((c) => [c.id, {}])),
    memory: Object.fromEntries(all.map((c) => [c.id, []])),
    pairSummary: {},
    house: initHouse(all.map((c) => c.id).sort()),
    chats: {},
    npcPlans: {},
    predictions: [],
    arcs: {},
    references: [],
    grudges: {},
    log: [],
    history: [],
    couples: [],
    budgets: { confessions: 0, farewells: 0 },
    recurring: Object.fromEntries(content().npcs.map((n) => [n.id, { metPlayer: 0, lastSeenEp: 0 }])),
    recentPlayerTargets: [],
    seasonOver: false,
    counters: {},
    pendingArrivals: [],
    previously: '',
    awaitingPlayer: false,
    finaleEpisode: null, invitations: [], approaches: [], missions: [], feed: [], inventory: [], observedRoutines: {}, timeline: [], panelRemarks: [], panelNicknames: {}, diaries: {}, pairNotes: {}, memoryArchive: {},
  };
  const ids = all.map((c) => c.id).sort();
  initRelationships(s, rng, ids);
  // the player starts as a stranger: everyone's opinion of them is a blank slate
  for (const id of ids) if (id !== P.id) {
    s.rel[id][P.id] = { affinity: 0, romance: 0, tension: 0, trust: 25, closeness: 0 };
    s.rel[P.id][id] = { affinity: 0, romance: 0, tension: 0, trust: 25, closeness: 0 };
  }
  for (const c of all) {
    if (c.persona.secret) {
      addFact(s, { id: c.persona.secret.factId, subject: c.id, kind: 'secret', content: c.persona.secret.content, truth: true, sensitivity: 0.8 });
      learn(s, c.id, c.persona.secret.factId, 'self');
    }
    initArc(s, c);
  }
  s.world.typhoonDay = chooseTyphoonDay(rng, seasonLength || 365);
  applyCalendar(s, rng);
  rotateChores(s);
  s.world.flags.communalMeals = o.communalMeals ?? false;
  s.world.flags[`new_${P.id}`] = 1; // the player is the newcomer at the door in episode 1
  if (o.moveInDay && o.moveInVersion === 1) {
    const order = rng.shuffle(all.map(c => c.id));
    const mine = order.indexOf(P.id);
    s.world.flags.moveIn = order.join(',');
    s.world.slot = SLOTS[MOVE_IN_BLOCK[mine]] as Slot;
    order.forEach((id, i) => {
      if (id === P.id) return;
      if (i > mine) s.characters[id].status = 'arriving';
      else s.world.flags[`introduced_${id}`] = true;
    });
  } else if (o.moveInDay) {
    const order = [P.id, ...rng.shuffle(cast.map((c) => c.id))];
    s.world.flags.moveIn = order.join(',');
    s.world.flags.gradualMoveIn = true;
    P.location = 'entrance';
    order.forEach((id, i) => {
      if (id === P.id) return;
      if (i > 1) s.characters[id].status = 'arriving';
      else { s.characters[id].location = 'entrance'; s.world.flags[`introduced_${id}`] = true; }
    });
  }
  s.rngState = rng.state() | 0;
  addLog(s, { kind: 'system', text: `Episode 1. ${P.name} arrives at the share house.`, participants: [P.id], salience: 0.5 });
  return s;
}

// ---------------------------------------------------------------- planning

export interface PlannedScene {
  event: EventInstance;
  /** rendered as a dialogue scene (false = resolved silently into the log) */
  render: boolean;
  /** NPC–NPC conversation the player can see: offer join / eavesdrop / ignore */
  visible: boolean;
  /** LLM budget priority: player 3 > arc 2 > visible 1.5 > npc 1 */
  priority: number;
}

export interface SlotPlan {
  scenes: PlannedScene[];
  npcActions: Record<string, AgentAction>;
}

function names(s: GameState, b: Record<string, string>, location: string) {
  const out: Record<string, string> = { place: placeName(location) };
  for (const [r, id] of Object.entries(b)) out[r] = s.characters[id] ? firstName(s, id) : (content().npcs.find((n) => n.id === id)?.name ?? id);
  return out;
}

/** Facts a speaker knows that concern the other participants (knowledge invariant: only known facts). */
function factRefsFor(s: GameState, speaker: string, participants: string[]): string[] {
  const k = s.knowledge[speaker] ?? {};
  return Object.keys(k)
    .filter((fid) => {
      const f = s.facts[fid];
      return f && (participants.includes(f.subject) || (f.about && participants.includes(f.about))) && f.sensitivity >= 0.3;
    })
    .sort((a, b) => s.facts[b].sensitivity - s.facts[a].sensitivity || (a < b ? -1 : 1))
    .slice(0, 2);
}

export function makeEvent(s: GameState, t: EventTemplate, binding: Record<string, string>, location: string, extra: Partial<EventInstance> = {}): EventInstance {
  const roles = housemateRoles(t);
  const participants = roles.map((r) => binding[r]).filter((id) => id && s.characters[id]);
  const factRefs: Record<string, string[]> = {};
  for (const id of participants) factRefs[id] = factRefsFor(s, id, participants);
  const d = expectedDrama(s, t, binding);
  const P = player(s);
  const isPlayerScene = participants.includes(P.id);
  return {
    id: nextId(s, 'ev'),
    templateId: t.id,
    type: t.type,
    title: t.title,
    tags: t.tags,
    roles: binding,
    participants,
    location,
    premise: fill(t.premise, names(s, binding, location)),
    isPlayerScene,
    playerPresent: isPlayerScene || (location !== 'phone' && P.location === location),
    intents: t.intents,
    factRefs,
    salience: clamp((t.peak ? 0.75 : 0.35) + Math.abs(d) / 60, 0, 1),
    episode: s.world.episode,
    slot: s.world.slot,
    tick: s.world.tick,
    depthCeiling: participants.length >= 2 ? depthCeiling(s, participants[0], participants[1]) : 'smalltalk',
    freeze: t.freeze,
    ...extra,
  };
}

function gather(s: GameState, ev: EventInstance) {
  if (ev.location === 'phone') return;
  for (const id of ev.participants) {
    s.characters[id].location = ev.location;
    if (ev.location !== 'backyard') s.characters[id].swimming = false;
  }
}

const MOVE_IN_MINUTES = [0, 0, 30, 210, 420, 780];

/** One arrival at a time, including when a conversation crosses the scheduled minute. */
export function planMoveInArrival(s0: GameState): { state: GameState; plan: SlotPlan } {
  const s = cloneState(s0);
  const plan: SlotPlan = { scenes: [], npcActions: {} };
  if (s.world.episode !== 1 || !s.world.flags.gradualMoveIn) return { state: s, plan };
  const order = String(s.world.flags.moveIn).split(',');
  const now = (SLOT_START[s.world.slot] - 7) * 60 + s.world.minutes;
  const id = !s.world.flags[`introduced_${s.playerId}`] ? s.playerId : order.find((id, i) => s.characters[id]?.status === 'arriving' && now >= MOVE_IN_MINUTES[i]);
  if (!id) return { state: s, plan };
  const c = s.characters[id];
  if (c.status === 'arriving') {
    c.status = 'inHouse';
    s.world.flags[`new_${id}`] = 1;
    addLog(s, { kind: 'arrival', text: `${c.name}, ${c.age}, ${c.occupation}, arrived at the house with a suitcase.`, participants: [id], salience: 0.7 });
  }
  const crowd = housemates(s);
  const greeter = c.isPlayer ? crowd.find(o => !o.isPlayer)! : player(s);
  const participants = [id, greeter.id, ...crowd.filter(o => o.id !== id && o.id !== greeter.id).map(o => o.id)];
  const premise = c.isPlayer
    ? `It is the first morning. Only ${c.name} and ${greeter.name} are home. They introduce themselves, learn each other's name, age and job, and begin a relaxed conversation. The other housemates have not arrived yet.`
    : `The doorbell rings: ${c.name} (${c.age}, ${c.occupation}, from ${c.hometown}) arrives. ${participants.length === 3 ? 'They introduce themselves and join the conversation already in progress.' : 'The conversation pauses so everyone can welcome the new housemate. Afterwards the player chooses whom to keep talking with.'}`;
  const ev = makeEvent(s, content().eventById.get('arrival-intro')!, { a: id, b: greeter.id }, 'entrance', {
    participants, premise, isPlayerScene: true, playerPresent: true, freeze: false,
    factRefs: Object.fromEntries(participants.map(p => [p, factRefsFor(s, p, participants)])),
  });
  s.world.flags[`introduced_${id}`] = true;
  gather(s, ev);
  for (const p of participants) if (p !== s.playerId) { s.characters[p].lastAction = 'seek'; s.characters[p].activityUntil = Math.min(SLOT_MINUTES, s.world.minutes + 30); }
  plan.scenes.push({ event: ev, render: true, visible: false, priority: 4 });
  return { state: s, plan };
}

export function planHouseMeal(s0: GameState): { state: GameState; plan: SlotPlan } {
  const s = cloneState(s0);
  const plan: SlotPlan = { scenes: [], npcActions: {} };
  if (welcomeDinnerDue(s) && !Object.values(s.characters).some(c => c.status === 'arriving')) {
    const until = Math.max(s.world.minutes, ...housemates(s).filter(c => c.actionHousehold).map(c => c.activityUntil));
    withRng(s, rng => advanceLiving(s, rng, until, new Set(housemates(s).map(c => c.id))));
  }
  const meal = communalMeal(s);
  if (!meal) return { state: s, plan };
  const { participants, kind, mandatory } = meal;
  const ev = makeEvent(s, content().eventById.get('casual-chat')!, { a: participants[0], b: participants[1] }, 'kitchen', {
    participants, isPlayerScene: participants.includes(s.playerId), playerPresent: participants.includes(s.playerId),
    title: mandatory ? 'welcome dinner · the whole house' : kind === 'breakfast' ? 'breakfast together' : 'house dinner',
    tags: ['light', 'group', 'communal-meal', kind, ...(mandatory ? ['welcome-dinner'] : [])],
    premise: `${mandatory ? 'Everyone has finally moved in. All six residents put aside their plans for the mandatory first-night welcome dinner.' : kind === 'breakfast' ? 'A small breakfast before the day begins; only housemates free from work or class join the table.' : 'The house gathers for its evening dinner; anyone working, out or resting keeps their own schedule.'} ${participants.map(id => firstName(s, id)).join(', ')} sit together in the kitchen, sharing ready-to-eat hummus and pita with vegan food and kosher preparation for everyone. They can talk about their day, get to know each other or just listen.`,
    factRefs: Object.fromEntries(participants.map(id => [id, factRefsFor(s, id, participants)])), freeze: false,
  });
  gather(s, ev);
  for (const id of participants) scheduleActivity(s, s.characters[id], { kind: 'eat', duration: kind === 'breakfast' ? 20 : 40 });
  s.world.playerNode = participants.includes(s.playerId) ? 'house' : s.world.playerNode;
  plan.scenes.push({ event: ev, render: ev.isPlayerScene, visible: false, priority: mandatory ? 4 : 3 });
  return { state: s, plan };
}

function planMoveInDayAction(s: GameState, action: PlayerAction): { state: GameState; plan: SlotPlan } {
  const pending = planMoveInArrival(s);
  if (pending.plan.scenes.length) return pending;
  const acts = Object.fromEntries(npcs(s).map(c => [c.id, { kind: 'retreat' as const }]));
  const plan: SlotPlan = { scenes: [], npcActions: acts };
  withRng(s, rng => {
    const { invite, talk } = applyPlayerAction(s, action);
    const order = String(s.world.flags.moveIn).split(',');
    const next = order.findIndex(id => s.characters[id]?.status === 'arriving');
    const due = next >= 0 ? MOVE_IN_MINUTES[next] - (SLOT_START[s.world.slot] - 7) * 60 : Infinity;
    const end = Math.min(SLOT_MINUTES, s.world.minutes + (action.type === 'text' ? 5 : actionMinutes(action)), Math.max(s.world.minutes, due));
    advanceLiving(s, rng, end, new Set(action.type === 'talk' ? [action.target, ...(action.guests ?? [])] : []));
    const ev = planPlayerScene(s, rng, action, acts, invite, talk);
    if (ev) { gather(s, ev); plan.scenes.push({ event: ev, render: true, visible: false, priority: 3 }); }
  });
  const arrival = planMoveInArrival(s);
  return arrival.plan.scenes.length ? arrival : { state: s, plan };
}

const HOUSE_ROOM: Record<string, (c: Character) => string> = {
  hangout: () => 'living', cook: () => 'kitchen', tidy: () => 'kitchen', rest: (c) => bedroomOf(c), backyard: () => 'backyard', hobby: () => 'living',
};

/** Why a calendar plan from the player can't be made, or '' when it can. */
export function planProblem(s: GameState, a: Extract<PlayerAction, { type: 'plan' }>): string {
  const P = player(s);
  if (a.episode < s.world.episode || a.episode > s.world.episode + 7 || (a.episode === s.world.episode && SLOTS.indexOf(a.slot) <= SLOTS.indexOf(s.world.slot))) return 'choose a future block within seven episodes';
  if (!content().city.nodes.some((n) => n.id === a.node) && !isRoom(a.node)) return 'unknown meeting place';
  if (!validPlanPlace(s, a.node, P.id, a.target)) return 'a private meeting needs a resident invitation';
  if (s.invitations.filter((p) => ['pending', 'accepted'].includes(p.status)).length >= 12) return 'resolve some plans first';
  if (s.invitations.some((p) => p.status === 'accepted' && p.episode === a.episode && p.slot === a.slot && [p.from, p.to].some((id) => [P.id, a.target].includes(id)))) return 'one of you already has a plan then';
  return '';
}

/**
 * Minutes an action takes before any talking (talk itself is added per spoken line, see passTime).
 * Outings, rest and letting time pass take the whole block.
 */
export function actionMinutes(a: PlayerAction): number {
  if (a.type === 'household') return HOUSEHOLD[a.activity].minutes;
  if (a.type === 'house') return { hangout: 10, cook: 60, tidy: 30, rest: SLOT_MINUTES, backyard: 20, hobby: 60 }[a.activity];
  if (a.type === 'talk') return 5;
  if (a.type === 'text' || a.type === 'visit' || a.type === 'like' || a.type === 'pool' || a.type === 'askBack') return 0;
  if (['endSeason', 'plan', 'respondPlan', 'post'].includes(a.type)) return 5;
  if (a.type === 'gift' || a.type === 'approach') return 5;
  if (a.type === 'favor') return 10;
  return SLOT_MINUTES; // goOut, idle, graduate
}

/** Talking takes as long as the conversation: each spoken line the player was there for moves the clock. */
export function passTime(s0: GameState, lines: number, participants: string[] = [], minutesPerLine = MINUTES_PER_LINE): GameState {
  const s = cloneState(s0);
  const protectedIds = new Set<string>();
  for (const id of participants) protectedIds.add(id);
  withRng(s, (rng) => advanceLiving(s, rng, s.world.minutes + Math.max(0, lines) * minutesPerLine, protectedIds));
  return s;
}

export const blockOver = (s: GameState) => s.world.minutes >= SLOT_MINUTES;

export function respondToPlan(s0: GameState, action: Extract<PlayerAction, { type: 'respondPlan' }>): GameState {
  const s = cloneState(s0);
  validateAction(s, action);
  socialAction(s, action);
  return s;
}

function validateAction(s: GameState, a: PlayerAction) {
  const P = player(s);
  if (s.awaitingPlayer) throw new Error('create your next housemate first');
  if (s.world.flags.communalMeals && s.world.flags.moveIn && s.world.episode === 1 && s.world.flags.mealDinner !== 1 && ['graduate', 'trip'].includes(a.type)) throw new Error('Have the first-night welcome dinner before leaving the house or taking an overnight trip.');
  if (a.type === 'pool') validatePool(s, a);
  if (a.type === 'endSeason' && (s.world.episode < 3 || s.finaleEpisode !== null)) throw new Error('wrap is available after episode 3, once per season');
  if ('target' in a && a.target && (a.target === P.id || s.characters[a.target]?.status !== 'inHouse')) throw new Error('that housemate is not available');
  if ((a.type === 'talk' || a.type === 'house' && a.target) && 'target' in a && a.target && (!isRoom(s.characters[a.target].location) ||
    s.characters[a.target].activityUntil > s.world.minutes && ['work', 'sleep', 'nap', 'shower'].includes(s.characters[a.target].lastAction ?? ''))) throw new Error('this housemate is busy; visit their workplace or message them later');
  if (a.type === 'talk' && a.room) {
    const room = content().house.rooms.find(r => r.id === a.room);
    if (!room || room.private) throw new Error('choose a shared room to invite housemates');
    if (a.room === 'backyard' && s.world.weather === 'typhoon') throw new Error('the storm keeps everyone indoors');
    for (const id of a.guests ?? []) {
      const c = s.characters[id];
      if (id === P.id || id === a.target || c?.status !== 'inHouse' || !isRoom(c.location) || ['work', 'sleep', 'nap', 'shower'].includes(c.lastAction ?? '')) throw new Error('your guest is unavailable');
    }
  }
  if (a.type === 'talk' && a.guests?.length && !a.room) throw new Error('choose a shared room for your guests');
  if (a.type === 'text') for (const id of a.guests ?? []) if (id === P.id || id === a.target || s.characters[id]?.status !== 'inHouse') throw new Error('that housemate is not available');
  if (isShabbat(s, P) && (a.type === 'goOut' && (a.useCar || a.activity === 'work') || a.type === 'house' && a.activity === 'cook')) throw new Error('this activity waits until after Shabbat');
  const later = { ...s, world: { ...s.world, minutes: Math.min(SLOT_MINUTES, s.world.minutes + actionMinutes(a)) } };
  if (!isShabbat(s, P) && isShabbat(later, P) && (a.type === 'goOut' && a.activity === 'work' || a.type === 'house' && a.activity === 'cook')) throw new Error('this activity would run past Shabbat sundown');
  if (a.type === 'trip') { const why = tripProblem(s, a.node, a.with); if (why) throw new Error(why); }
  if (a.type === 'visit' && !a.knock && !canVisit(s, a.room, a.invite)) throw new Error('this private room needs an invitation, or the bathroom is occupied');
  if (a.type === 'plan') { const why = planProblem(s, a); if (why) throw new Error(why); }
  if (a.type === 'respondPlan' && !s.invitations.some((p) => p.id === a.id && p.to === P.id && p.status === 'pending')) throw new Error('invitation is no longer pending');
  if (a.type === 'approach' && !s.approaches.some((p) => p.id === a.id && s.characters[p.from]?.status === 'inHouse' && (!a.accept || isRoom(s.characters[p.from].location) && !['work', 'sleep', 'nap', 'shower'].includes(s.characters[p.from].lastAction ?? '')))) throw new Error('that invitation has expired; they are busy now');
  if (a.type === 'gift' && !s.inventory.includes(a.item)) throw new Error('buy this gift in town first');
  if (a.type === 'like' && !s.feed.some((p) => p.id === a.id)) throw new Error('post is no longer available');
  if (a.type === 'goOut') {
    const n = content().city.nodes.find((n) => n.id === a.node);
    const activity = a.activity === 'gift' ? 'shop' : a.activity;
    if (!n || !n.activities.includes(activity)) throw new Error('this place does not offer that activity');
    // going alone is always allowed; a heatwave or typhoon only matters to open-air places and to whoever you ask along
    for (const g of [a.invite, ...(a.guests ?? [])]) { const no = g && weatherRefusal(s, g, a.node, `${s.world.tick}`); if (no) throw new Error(`${firstName(s, g)} ${no}`); }
    if (s.world.weather === 'rain' && ['beach', 'park', 'scenic'].includes(n.type) && a.activity === 'date') throw new Error('rain cancelled the outdoor date; choose an indoor place');
    for (const g of [a.invite, ...(a.guests ?? [])]) {
      if (!g) continue;
      const no = g === P.id || !s.characters[g] ? 'is not available' : outingProblem(s, s.characters[g]);
      if (no) throw new Error(g === P.id || !s.characters[g] ? 'your guest is unavailable' : `${firstName(s, g)} can't come: ${no}`);
    }
    const r = reachability('house', s.world.slot, playerBudget(s), canUseCar(s, a.node), s.world.minutes, s.world.weekday, a.useCar, a.activity === 'class').find((r) => r.node === a.node);
    if (!r?.reachable) throw new Error(r?.reason ?? 'no route');
    if (a.activity === 'gift' && (!a.item || !GIFT_ITEMS[a.item])) throw new Error('choose a gift');
    const fit = spendFit(s, a, r.price);
    // someone already out with you who can afford it covers your share: don't strand them
    // joining a plan someone already keeps here never leaves them hanging over money
    const joining = !!a.invite && a.activity !== 'gift' && s.invitations.some((p) => p.status === 'accepted' && !p.performance && p.node === a.node && p.episode === s.world.episode && p.slot === s.world.slot && [p.from, p.to].includes(P.id) && [p.from, p.to].includes(a.invite!));
    const covered = fit === 'out' && !!a.invite && a.activity !== 'gift' && (joining || afford(budgetFor(s, a.invite), r.price) !== 'out');
    if (fit === 'out' && !covered) throw new Error(a.activity === 'gift' ? 'that gift is out of your budget' : 'that is out of your budget');
    if (fit === 'stretch' && !joining && !canStretch(s)) throw new Error('you stretched your budget recently; pick something cheaper for now');
    if (a.invite && fit !== 'ok' && !joining && afford(budgetFor(s, a.invite), r.price) === 'out') throw new Error(`neither of you can afford ${placeName(a.node)} right now`);
    if (r.needsCar && isShabbat(s, P)) throw new Error('the shared car waits until after Shabbat');
    const returned = { ...s, world: { ...s.world, minutes: s.world.minutes + r.minutes * 2 + ACTIVITY_MINUTES } };
    if (r.needsCar && isShabbat(returned, P)) throw new Error('the car trip would run past Shabbat sundown');
  }
}

function actionLabel(s: GameState, a: PlayerAction, start: number) {
  const clock = clockLabel(s.world.slot, start);
  const text = a.type === 'house' ? a.activity : a.type === 'talk' ? `talked with ${firstName(s, a.target)}` : a.type === 'goOut' ? `${a.activity} at ${placeName(a.node)} (return journey included)` : a.type === 'visit' ? `visited ${placeName(a.room)}` : a.type;
  return `${clock} · ${text}`;
}

/** Apply the player's chosen action: location, money, car, invitations. Returns invited NPC (if any). */
function applyPlayerAction(s: GameState, a: PlayerAction): { invite?: string; talk?: string } {
  const P = player(s);
  P.lastAction = a.type;
  if (['house', 'goOut', 'sleep', 'trip', 'graduate', 'skip', 'idle'].includes(a.type)) P.swimming = false;
  const job = s.world.playerJob;
  switch (a.type) {
    case 'house':
      P.location = HOUSE_ROOM[a.activity](P);
      s.world.playerNode = 'house';
      satisfy(P, a.activity === 'rest' ? 'sleep' : a.activity === 'cook' ? 'cook' : a.activity === 'tidy' ? 'tidy' : a.activity === 'hangout' ? 'seek' : 'hobby');
      if (a.activity === 'tidy') {
        s.house.dishes = clamp(s.house.dishes - 40, 0, 100);
        s.house.choreLedger[P.id] ??= { done: 0, skipped: 0 };
        s.house.choreLedger[P.id].done++;
        s.house.kitchen.meatPanClean = true;
        s.house.kitchen.dairyPanClean = true;
      }
      return { talk: a.target };
    case 'talk': {
      const t = s.characters[a.target];
      P.location = a.room ?? (t && isRoom(t.location) ? t.location : 'living');
      if (P.location !== 'backyard') P.swimming = false;
      s.world.playerNode = 'house';
      satisfy(P, 'seek');
      return { talk: a.target };
    }
    case 'goOut': {
      const r = reachability('house', s.world.slot, playerBudget(s), canUseCar(s, a.node), s.world.minutes, s.world.weekday, a.useCar, a.activity === 'class').find((x) => x.node === a.node)!;
      P.location = a.node;
      s.world.playerNode = a.node;
      const fit = spendFit(s, a, r.price);
      if (fit === 'out' && a.invite) {
        s.rel[a.invite][P.id].affinity = clamp(s.rel[a.invite][P.id].affinity + 2, -100, 100);
        addLog(s, { kind: 'system', text: `${firstName(s, a.invite)} covered your share at ${placeName(a.node)}: it is beyond your budget.`, participants: [P.id, a.invite], salience: 0.3 });
      } else if (fit === 'stretch') {
        // a splurge: allowed now and then, it strains you, and a date notices (it reads as serious)
        s.world.flags.stretchEp = s.world.episode;
        P.mood = clamp(P.mood - 0.04, -1, 1);
        if (a.invite && a.activity === 'date' && attracted(s.characters[a.invite], P)) s.rel[a.invite][P.id].romance = clamp(s.rel[a.invite][P.id].romance + 3, 0, 100);
        addLog(s, { kind: 'system', text: `You splurged on ${a.activity === 'gift' ? 'a gift' : placeName(a.node)}${a.invite ? ` with ${firstName(s, a.invite)}` : ''}: a stretch for your budget.`, participants: a.invite ? [P.id, a.invite] : [P.id], salience: 0.35 });
      }
      if (a.invite && fit !== 'out' && a.activity !== 'work' && afford(budgetFor(s, a.invite), r.price) !== 'ok') {
        s.rel[a.invite][P.id].affinity = clamp(s.rel[a.invite][P.id].affinity + 2, -100, 100);
        addLog(s, { kind: 'system', text: `You treated ${firstName(s, a.invite)}: ${placeName(a.node)} is beyond their budget.`, participants: [P.id, a.invite], salience: 0.3 });
      }
      if (r.needsCar) s.world.carUsedBy = P.id;
      if (a.activity === 'work') {
        if (a.contract && job?.nodeId !== a.node) {
          s.world.playerJob = { nodeId: a.node, slot: s.world.slot, weekdays: contractDays(s.world.weekday), wage: Math.round((WAGE[a.node] ?? 100) * CONTRACT_BONUS) };
          refreshJobArc(s, P);
          s.world.flags.jobMissed = 0;
          addLog(s, { kind: 'system', text: `You signed on at ${placeName(a.node)}: fixed shifts every week.`, participants: [P.id], salience: 0.4 });
        }
        const j = s.world.playerJob;
        if (j?.nodeId === a.node) s.world.flags.workedShift = true;
        satisfy(P, 'work');
      } else if (a.activity === 'class') {
        s.world.flags.attendedClass = true;
        satisfy(P, 'work');
      } else satisfy(P, 'goOut');
      if (a.activity === 'gift' && a.item) s.inventory.push(a.item);
      if (a.activity === 'shop' && playerGroceries(s, content().city.nodes.find((n) => n.id === a.node)?.type ?? '')) {
        addLog(s, { kind: 'domestic', text: `${firstName(s, P.id)} came home from ${placeName(a.node)} with groceries for the shared fridge.`, participants: [P.id], salience: 0.35 });
      }
      for (const g of [a.invite, ...(a.guests ?? [])]) if (g) {
        s.characters[g].location = a.node;
        s.characters[g].activityUntil = SLOT_MINUTES;
      }
      // a night out: the player drinks by choice, and the company may follow their lead
      if (a.drink && servesDrinks(a.node) && !['work', 'class'].includes(a.activity)) getDrunk(s, P, 2, a.node);
      for (const g of [a.invite, ...(a.guests ?? [])]) if (g) maybeDrink(s, s.characters[g], a.node, a.drink ? 0.4 : 0);
      return { invite: a.invite && s.characters[a.invite]?.status === 'inHouse' ? a.invite : undefined };
    }
    case 'text':
      satisfy(P, 'text');
      return { talk: a.target };
    case 'visit':
      if (a.knock && !canVisit(s, a.room, a.invite) && knock(s, a.room) !== 'in') return {};
      P.location = a.room;
      if (a.room !== 'backyard') P.swimming = false;
      s.world.playerNode = 'house';
      observeRoutines(s);
      return {};
    case 'endSeason':
      s.finaleEpisode = s.world.episode + 1;
      for (const c of npcs(s)) if (!coupleOf(s, c.id)) {
        for (const other of housemates(s)) if (other.id !== c.id && attracted(c, other)) s.rel[c.id][other.id].romance = clamp(s.rel[c.id][other.id].romance + 5, 0, 100);
      }
      addLog(s, { kind: 'system', text: `The house knows: episode ${s.finaleEpisode} will be the finale. One last week for unfinished conversations.`, participants: housemates(s).map((c) => c.id), salience: 1 });
      return {};
    case 'sleep':
      P.location = bedroomOf(P);
      satisfy(P, 'sleep');
      s.world.flags.sleepUntilMorning = true;
      return {};
    case 'skip': return {};
    case 'trip':
      leaveOnTrip(s, a.node, [P.id, ...a.with], a.roommate && a.with.includes(a.roommate) ? a.roommate : undefined);
      return {};
    case 'graduate': {
      // you can always leave alone; leaving *with* someone needs them to be your partner (or to have asked you)
      const requested = a.with && s.characters[a.with]?.status === 'inHouse' && isCouple(s, P.id, a.with) ? a.with : undefined;
      markLeaving(s, P.id, 'graduated alone');
      const w = requested ? invitePartnerToLeave(s, P.id) : null;
      if (w) s.world.flags[`leaveReason_${P.id}`] = `graduated with ${firstName(s, w)}`;
      s.world.flags.playerGraduated = w ?? 'alone';
      P.location = 'entrance';
      return {};
    }
    default:
      return socialAction(s, a);
  }
}

/** Is an NPC free to be pulled into a scene? (in the house, not working, not asleep) */
const available = (s: GameState, c: Character, acts: Record<string, AgentAction>) =>
  c.status === 'inHouse' && !c.swimming && isRoom(c.location) && !['sleep', 'nap', 'shower', 'work'].includes(c.lastAction ?? acts[c.id]?.kind ?? '');

function planPlayerScene(s: GameState, rng: Rng, a: PlayerAction, acts: Record<string, AgentAction>, invite?: string, talk?: string): EventInstance | null {
  const P = player(s);
  const ev = (c: Candidate | null) => (c ? makeEvent(s, c.template, c.binding, c.location) : null);
  const withPlayer = (cs: Candidate[]) => cs.filter((c) => Object.values(c.binding).includes(P.id) && (!talk || Object.values(c.binding).includes(talk)));
  if (!['house', 'talk', 'text', 'goOut'].includes(a.type) && !(a.type === 'approach' && talk)) return null;
  if (a.type === 'text') {
    const t = content().eventById.get('chat-exchange')!;
    return makeEvent(s, t, { a: P.id, b: a.target }, 'phone');
  }
  if (talk && !available(s, s.characters[talk], acts) && !(P.swimming && s.characters[talk].swimming && P.location === 'backyard')) {
    addLog(s, { kind: 'system', text: `${firstName(s, talk)} is busy now; catch them later.`, participants: [P.id, talk], salience: 0.2 });
    return null;
  }
  if (a.type === 'goOut' && !isRoom(P.location)) {
    const node = P.location;
    const show = performanceScene(s);
    if (show && !['work', 'class', 'gift', 'shop'].includes(a.activity)) {
      const host = show.participants![0];
      return makeEvent(s, content().eventById.get('chance-encounter')!, { a: host, b: P.id }, node, {
        ...show, factRefs: Object.fromEntries(show.participants!.map(id => [id, factRefsFor(s, id, show.participants!)])),
      });
    }
    const guests = a.type === 'goOut' ? (a.guests ?? []).filter((id) => s.characters[id]?.status === 'inHouse') : [];
    const here = housemates(s).filter((c) => c.id === P.id || c.id === invite || guests.includes(c.id) || c.location === node);
    let cs = withPlayer(candidates(s, rng, { location: node, pool: here, isPlayerScene: true, activity: a.activity, focus: invite }));
    if (invite) cs = cs.filter((c) => Object.values(c.binding).includes(invite));
    const pick = sample(rng, cs);
    let out: EventInstance;
    // an arranged outing is not a chance meeting
    const together = [invite, ...guests].filter((id): id is string => !!id);
    const planned = together.length ? {
      title: a.activity === 'date' ? 'a date in town' : 'out together in town',
      premise: `${firstName(s, P.id)} and ${together.map((id) => firstName(s, id)).join(' and ')} arranged to come to ${placeName(node)} together. This outing was planned, not a chance meeting.`,
    } : {};
    if (!pick) {
      const others = here.filter((c) => c.id !== P.id);
      const t = content().eventById.get(others.length ? 'chance-encounter' : 'solo-wander')!;
      out = makeEvent(s, t, others.length ? { a: P.id, b: invite ?? others[0].id } : { a: P.id }, node, planned);
    } else {
      out = ev(pick)!;
      // a picked template may still be the "ran into each other" one; the invitation decides how they got here
      if (planned.premise) out = { ...out, ...(out.templateId === 'chance-encounter' ? planned : { premise: `${planned.premise} ${out.premise}` }) };
    }
    // everyone who came along is in the scene, not just the one who was asked first
    const company = guests.filter((id) => !out.participants.includes(id));
    if (company.length) {
      const participants = [...out.participants, ...company];
      out = { ...out, participants, factRefs: { ...out.factRefs, ...Object.fromEntries(company.map((id) => [id, factRefsFor(s, id, participants)])) } };
    }
    // recurring outsiders keep their schedule: the café owner is at the café, the clerk at the konbini…
    const regular = content().npcs.find((n) => n.location === node && n.schedule.slots.includes(s.world.slot) && n.schedule.weekdays.includes(s.world.weekday) && !n.linkedTo);
    if (regular && !Object.values(out.roles).includes(regular.id)) out.roles = { ...out.roles, x: regular.id };
    return out;
  }
  // house scenes
  const room = P.location;
  if (P.swimming && room === 'backyard' && talk && s.characters[talk]?.swimming) {
    const participants = housemates(s).filter((c) => c.swimming && c.location === room).map((c) => c.id).slice(0, 6);
    const e = makeEvent(s, content().eventById.get('casual-chat')!, { a: P.id, b: talk }, room);
    return { ...e, title: 'a conversation in the pool', premise: 'The housemates chat together while floating in the pool, wearing their swimwear.', tags: [...new Set([...e.tags, 'swim', 'light'])], participants, factRefs: Object.fromEntries(participants.map((id) => [id, factRefsFor(s, id, participants)])) };
  }
  if (a.type === 'house' && a.activity === 'rest') return null;
  const pool = housemates(s).filter((c) => c.id === P.id || (available(s, c, acts) && !departing(s, c.id)) || c.id === talk);
  const inRoom = pool.filter((c) => c.location === room || c.id === P.id || c.id === talk);
  const usePool = inRoom;
  // light conversations pull in everyone else hanging out in the room, like the show's living-room talks
  const company = (e: EventInstance | null) => {
    if (!e || !e.tags.includes('light') || !isRoom(e.location)) return e;
    const extra = pool.filter((c) => c.location === e.location && c.id !== P.id && !e.participants.includes(c.id)).slice(0, 3).map((c) => c.id);
    if (!extra.length) return e;
    const participants = [...e.participants, ...extra];
    return { ...e, participants, factRefs: { ...e.factRefs, ...Object.fromEntries(extra.map((id) => [id, factRefsFor(s, id, participants)])) } };
  };
  const cs = withPlayer(candidates(s, rng, { location: room, pool: usePool, isPlayerScene: true, focus: talk }));
  const pick = sample(rng, cs);
  if (pick) return company(ev(pick));
  const partner = talk ?? usePool.find((c) => c.id !== P.id)?.id;
  if (!partner) return null;
  return company(makeEvent(s, content().eventById.get('casual-chat')!, { a: P.id, b: partner }, room));
}

const titles: Partial<Record<Interaction['type'], string>> = { help: 'checking in after a long day', household: 'talking while helping around the house', cold: 'a cold shoulder', jealousy: 'a jealous worry' };
const IX_TEMPLATE: Record<string, string> = {
  chat: 'ix-chat', deep: 'ix-deep', flirt: 'ix-flirt', bicker: 'ix-bicker', awkward: 'ix-awkward', joke: 'ix-joke', confess: 'ix-confess', apology: 'ix-apology', gossip: 'ix-gossip',
  help: 'ix-deep', household: 'ix-chat', cold: 'ix-awkward', jealousy: 'ix-bicker',
};

export interface PlanOptions {
  /** render top-k salient NPC scenes even when the player isn't there */
  renderTopK?: number;
  /** Replay texts logged before instant phone exchanges were introduced. */
  legacyText?: boolean;
}

export function planSlot(s0: GameState, action: PlayerAction, opts: PlanOptions = {}): { state: GameState; plan: SlotPlan } {
  const result = planAction(s0, action, opts);
  const { state: s, plan } = result;
  const airs = !s.seasonOver && action.type !== 'text' && s.world.slot === 'evening' ? airingTonight(s) : null;
  if (airs !== null) {
    const participants = housemates(s).filter(c => isRoom(c.location) && !['work', 'sleep', 'nap', 'shower'].includes(c.lastAction ?? '') && (!c.isPlayer || !['skip', 'sleep'].includes(action.type))).map(c => c.id);
    if (participants.length >= 2) {
      const premise = airEpisode(cloneState(s), airs, participants);
      const ev = makeEvent(s, content().eventById.get('broadcast-watch')!, { a: participants[0], b: participants[1] }, 'living', {
        participants, premise, factRefs: Object.fromEntries(participants.map(id => [id, factRefsFor(s, id, participants)])),
        isPlayerScene: participants.includes(s.playerId), playerPresent: participants.includes(s.playerId),
      });
      plan.scenes.push({ event: ev, render: !['skip', 'sleep'].includes(action.type), visible: false, priority: 2 });
    }
  }
  return result;
}

/** Queued TV scenes move and inform the audience only when the watch actually begins. */
export function beginBroadcast(s: GameState, ev: EventInstance): boolean {
  if (ev.templateId !== 'broadcast-watch' || s.world.flags.broadcastWatchId === ev.id) return false;
  const airs = airingTonight(s);
  if (airs === null) return false;
  ev.premise = airEpisode(s, airs, ev.participants);
  s.world.flags.broadcastWatchId = ev.id;
  gather(s, ev);
  ev.factRefs = Object.fromEntries(ev.participants.map(id => [id, factRefsFor(s, id, ev.participants)]));
  return true;
}

function planAction(s0: GameState, action: PlayerAction, opts: PlanOptions): { state: GameState; plan: SlotPlan } {
  const s = cloneState(s0);
  const plan: SlotPlan = { scenes: [], npcActions: {} };
  if (s.seasonOver) return { state: s, plan };
  if (action.type === 'text' && !opts.legacyText) {
    validateAction(s, action);
    return { state: s, plan };
  }
  if (welcomeDinnerDue(s)) {
    const arrival = planMoveInArrival(s);
    if (arrival.plan.scenes.length) return arrival;
  }
  if (welcomeDinnerDue(s) || action.type === 'house' && action.activity === 'hangout' && !action.target) {
    const meal = planHouseMeal(s);
    if (meal.plan.scenes.length) return meal;
  }
  validateAction(s, action);
  if (action.type === 'household') {
    const P = player(s);
    const other = action.target ? s.characters[action.target] : undefined;
    const owner = action.join ? other : undefined;
    if (action.join && (!owner?.actionHousehold || owner.actionHousehold !== action.activity || owner.actionHouseholdOwner !== owner.id || owner.activityUntil <= s.world.minutes || owner.actionCompanion)) throw new Error('That activity has finished or already has company.');
    const remaining = owner ? owner.activityUntil - s.world.minutes : HOUSEHOLD[action.activity].minutes;
    const problem = householdProblem(s, P, action.activity, remaining, !!owner);
    if (problem) throw new Error(problem);
    if (other) {
      const refusal = householdCompanyProblem(s, P, other) ?? householdProblem(s, other, action.activity, remaining, !!owner) ??
        (!owner && other.actionHousehold && other.activityUntil > s.world.minutes ? 'They are already doing something. You can join them instead.' : undefined);
      if (refusal) {
        addLog(s, { kind: 'system', text: `${firstName(s, other.id)} declined: ${refusal}`, participants: [P.id, other.id], salience: 0.2 });
        withRng(s, rng => advanceLiving(s, rng, s.world.minutes + 2));
        return { state: s, plan };
      }
    }
    withRng(s, rng => {
      const block = `${s.world.episode}:${s.world.slot}`;
      if (s.world.flags.startedBlock !== block) {
        s.world.flags.startedBlock = block;
        for (const c of housemates(s)) decayNeeds(c);
        houseTick(s, rng, {});
      }
      const ok = owner ? joinHousehold(s, P, owner) : startHousehold(s, rng, P, action.activity, other);
      if (!ok) throw new Error('This activity is no longer available.');
      s.world.playerNode = 'house';
      const until = P.activityUntil;
      advanceLiving(s, rng, other ? Math.min(until, s.world.minutes + 2) : until, new Set([P.id, ...(other ? [other.id] : [])]));
      if (other) {
        const task = HOUSEHOLD[action.activity];
        const ev = makeEvent(s, content().eventById.get('casual-chat')!, { a: P.id, b: other.id }, task.room, {
          title: `${task.label} together`,
          premise: `${firstName(s, P.id)} and ${firstName(s, other.id)} ${action.join ? 'are continuing' : 'have started'} to ${task.label}. ${task.detail} They can talk naturally while doing it; there is no need to discuss only the task.`,
          tags: ['light', 'household', `household-${action.activity}`],
        });
        plan.scenes.push({ event: ev, render: true, visible: false, priority: 3 });
      }
    });
    const arrival = planMoveInArrival(s);
    if (arrival.plan.scenes.length && !plan.scenes.length) return arrival;
    return { state: s, plan };
  }
  if (action.type === 'talk' && (action.room || content().house.rooms.find(r => r.id === s.characters[action.target].location)?.private)) {
    const room = action.room ?? s.characters[action.target].location as Room;
    const company = action.room ? action.guests ?? [] : housemates(s).filter(c => c.id !== s.playerId && c.id !== action.target && c.location === room && !['work', 'sleep', 'nap', 'shower', 'cook'].includes(c.lastAction ?? '')).slice(0, 3).map(c => c.id);
    const participants = [s.playerId, action.target, ...company];
    applyPlayerAction(s, action);
    withRng(s, rng => advanceLiving(s, rng, Math.min(SLOT_MINUTES, s.world.minutes + actionMinutes(action)), new Set(participants)));
    const ev = makeEvent(s, content().eventById.get('casual-chat')!, { a: s.playerId, b: action.target }, room, {
      participants,
      premise: action.room ? `The selected housemates moved to the ${placeName(room)} together at the player's invitation. Continue their conversation here.` : `${firstName(s, s.playerId)} joins ${participants.filter(id => id !== s.playerId).map(id => firstName(s, id)).join(' and ')} in the ${placeName(room)}. Only the people here take part in this conversation.`,
      factRefs: Object.fromEntries(participants.map(id => [id, factRefsFor(s, id, participants)])),
    });
    gather(s, ev);
    // whoever accepted the invitation came to talk: they put their phone down and can be addressed
    if (action.room) for (const id of participants) if (id !== s.playerId) { s.characters[id].lastAction = 'seek'; s.characters[id].activityUntil = Math.min(SLOT_MINUTES, s.world.minutes + 30); }
    plan.scenes.push({ event: ev, render: true, visible: false, priority: 3 });
    return { state: s, plan };
  }
  if (s.world.episode === 1 && s.world.flags.gradualMoveIn && !['pool', 'visit', 'goOut', 'trip', 'graduate', 'sleep'].includes(action.type)) return planMoveInDayAction(s, action);
  if (action.type === 'pool') {
    applyPool(s, action);
    return { state: s, plan };
  }
  if (action.type === 'visit') {
    applyPlayerAction(s, action);
    return { state: s, plan };
  }
  const began = s.world.minutes;
  const end = Math.min(SLOT_MINUTES, began + (action.type === 'text' && opts.legacyText ? 5 : actionMinutes(action)));
  const blockKey = `${s.world.episode}:${s.world.slot}`;
  withRng(s, (rng) => {
    // the block's first action moves the whole world; later actions in the same block only plan the player's scene
    const fresh = s.world.flags.startedBlock !== blockKey;
    s.world.flags.startedBlock = blockKey;
    const P = player(s);
    if (!fresh) {
      const acts = Object.fromEntries(npcs(s).map((c) => [c.id, { kind: (c.lastAction ?? 'retreat') as AgentAction['kind'] }]));
      const { invite, talk } = applyPlayerAction(s, action);
      if (action.type === 'goOut' && action.activity === 'work') workCareerTick(s, rng, P);
      advanceLiving(s, rng, end, new Set(action.type === 'talk' ? [action.target, ...(action.guests ?? [])] : []));
      startPlans(s);
      plan.npcActions = acts;
      const ev = action.type === 'graduate' ? graduationFarewell(s) : planPlayerScene(s, rng, action, acts, invite, talk);
      if (ev) {
        gather(s, ev);
        plan.scenes.push({ event: ev, render: true, visible: false, priority: 3 });
      }
      return;
    }
    s.world.carUsedBy = null;
    const moveInDay = s.world.episode === 1 && !!s.world.flags.moveIn;
    if (moveInDay && !s.world.flags.gradualMoveIn) moveInArrivals(s);
    for (const c of housemates(s)) decayNeeds(c);
    const { invite, talk } = applyPlayerAction(s, action);
    if (action.type === 'goOut' && action.activity === 'work') workCareerTick(s, rng, P);
    // weekend trips come up on their own: a Thursday invitation, or a pair going without the player on Friday
    maybeOfferTrip(s, rng);
    if (action.type !== 'trip') maybeNpcTrip(s, rng);
    // NPC actions
    const acts: Record<string, AgentAction> = {};
    for (const c of npcs(s)) {
      if (c.swimming && c.location === 'backyard' && c.activityUntil > began) acts[c.id] = { kind: 'swim', duration: c.activityUntil - began };
      else if (action.type === 'talk' && c.id === action.target) acts[c.id] = { kind: 'seek', target: P.id };
      else if (c.activityUntil > began && c.lastAction) acts[c.id] = {
        kind: c.lastAction as AgentAction['kind'], target: c.actionTarget, third: c.actionThird, node: c.actionNode, companion: c.actionCompanion, household: c.actionHousehold,
        room: c.lastAction === 'hobby' && isRoom(c.location) ? c.location as AgentAction['room'] : undefined,
        duration: c.activityUntil - began,
      };
      else if (departing(s, c.id)) acts[c.id] = { kind: 'retreat' };
      else if (action.type === 'goOut' && (c.id === invite || action.guests?.includes(c.id))) acts[c.id] = { kind: 'goOut', node: action.node };
      else acts[c.id] = chooseAction(s, rng, c);
    }
    coordinateOutings(acts);
    for (const c of npcs(s)) {
      const a = acts[c.id];
      if (a.kind === 'goOut' && a.useCar) {
        if (s.world.carUsedBy === null) s.world.carUsedBy = c.id;
        else if (s.world.carUsedBy !== a.companion) acts[c.id] = { kind: 'hobby' };
      }
    }
    resolveLocations(s, acts, { [P.id]: P.location });
    startNpcHouseholds(s, rng, acts);
    for (const c of npcs(s)) {
      scheduleActivity(s, c, acts[c.id]);
    }
    startPlans(s);
    for (const c of npcs(s)) {
      if (c.lastAction === 'goOut' && c.activityUntil === SLOT_MINUTES && s.invitations.some((p) => p.status === 'accepted' && p.episode === s.world.episode && p.slot === s.world.slot && p.node === c.location && [p.from, p.to].includes(c.id))) acts[c.id] = { kind: 'goOut', node: c.location, duration: SLOT_MINUTES };
      satisfy(c, acts[c.id].kind);
    }
    if (s.world.slot === 'morning' && fridgeTotal(s) < 6) {
      const buyer = npcs(s).sort((x, y) => y.persona.traits[1] - x.persona.traits[1])[0];
      if (buyer) autoGroceries(s, buyer.id);
    }
    houseTick(s, rng, { ...Object.fromEntries(Object.entries(acts).map(([k, v]) => [k, v.kind])), [P.id]: action.type === 'house' ? action.activity : action.type });
    plan.npcActions = acts;

    const busy = new Set<string>();
    // farewell scenes take priority in the morning
    const leavers = housemates(s).filter((c) => flag(s, `leaving_${c.id}`) && !c.isPlayer);
    let playerEv: EventInstance | null = null;
    const witness = (lv: string) => (P.status === 'inHouse' && isRoom(P.location) ? P.id : npcs(s).find((c) => c.id !== lv && !flag(s, `leaving_${c.id}`))?.id);
    /** Plan a leaver's house scene; returns it when the player is in it. */
    const housePlan = (templateId: string, lv: string, room: string): EventInstance | null => {
      const other = witness(lv);
      if (!other) return null;
      const ev = makeEvent(s, content().eventById.get(templateId)!, { a: lv, b: other }, room);
      ev.participants.forEach((id) => busy.add(id));
      gather(s, ev);
      if (ev.isPlayerScene) return ev;
      plan.scenes.push({ event: ev, render: true, visible: false, priority: 2 });
      return null;
    };
    // the player graduates: their own goodbye at the door, with whoever they leave with (or the closest housemate)
    if (action.type === 'graduate') {
      playerEv = graduationFarewell(s);
      if (playerEv) {
        playerEv.participants.forEach((id) => busy.add(id));
        gather(s, playerEv);
      }
    }
    // back from an overnight trip: the group comes through the door; the ones who stayed home want details
    const back = returningFromTrip(s);
    if (back && back.group.length >= 2 && !playerEv) {
      const stayed = npcs(s).filter((c) => !back.group.includes(c.id) && available(s, c, acts)).slice(0, 2).map((c) => c.id);
      const ev = makeEvent(s, content().eventById.get('trip-return')!, { a: back.group[0], b: back.group[1] }, 'entrance');
      const participants = [...back.group, ...(!back.group.includes(P.id) && isRoom(P.location) ? [P.id] : []), ...stayed].slice(0, 6);
      Object.assign(ev, { participants, isPlayerScene: participants.includes(P.id), playerPresent: participants.includes(P.id), factRefs: Object.fromEntries(participants.map((id) => [id, factRefsFor(s, id, participants)])) });
      participants.forEach((id) => busy.add(id));
      gather(s, ev);
      if (ev.isPlayerScene) playerEv = ev;
      else plan.scenes.push({ event: ev, render: true, visible: false, priority: 2 });
    }
    const leavingToday = leavers.find((c) => departing(s, c.id) && !busy.has(c.id));
    if (leavingToday && s.world.slot === 'morning' && !playerEv) playerEv = housePlan('farewell-door', leavingToday.id, 'entrance') ?? playerEv;
    // the day after deciding, the leaver tells the whole house (the show's "I've decided to graduate")
    const announcer = leavers.find((c) => !departing(s, c.id) && !flag(s, `announced_${c.id}`) && flag(s, `leaving_${c.id}`) !== s.world.episode);
    if (announcer && !busy.size && (s.world.slot === 'morning' || s.world.slot === 'evening')) playerEv = housePlan('leave-announcement', announcer.id, 'living') ?? playerEv;
    // newcomer introductions
    for (const c of housemates(s)) {
      if (!flag(s, `new_${c.id}`) || flag(s, `introduced_${c.id}`) || playerEv) continue;
      if (!moveInDay && s.world.slot !== 'morning' && s.world.slot !== 'evening') continue;
      const t = content().eventById.get('arrival-intro')!;
      const greeter = c.isPlayer ? npcs(s).filter((o) => available(s, o, acts)).sort((x, y) => y.persona.traits[2] - x.persona.traits[2])[0] : P;
      if (!greeter || (greeter.isPlayer && !isRoom(P.location))) continue;
      const ev = makeEvent(s, t, { a: c.id, b: greeter.id }, 'entrance');
      if (c.returnedEp === s.world.episode) Object.assign(ev, {
        title: `${firstName(s, c.id)} is back`,
        premise: `${c.name} rings the doorbell with a suitcase: they lived here from day ${c.arrivedEp} to day ${c.leftEp} and are moving back in (${c.returnReason}). Whoever lived with them remembers them and how they left; anyone who arrived since meets them for the first time. Use only what each person knows.`,
      });
      if (moveInDay) {
        // move-in day: everyone already here comes to the door for introductions (name, age, job)
        const extra = housemates(s).filter((o) => !ev.participants.includes(o.id) && (o.isPlayer ? isRoom(P.location) : available(s, o, acts)) && !busy.has(o.id)).slice(0, 3).map((o) => o.id);
        const participants = [...ev.participants, ...extra];
        Object.assign(ev, { participants, isPlayerScene: participants.includes(P.id), playerPresent: ev.playerPresent || participants.includes(P.id), premise: `The doorbell rings: ${c.name} (${c.age}, ${c.occupation}) is moving in today, with one suitcase and a nervous smile. Everyone already here introduces themselves: name, age, job.`, factRefs: Object.fromEntries(participants.map((id) => [id, factRefsFor(s, id, participants)])) });
      }
      if (ev.isPlayerScene) playerEv = ev;
      else plan.scenes.push({ event: ev, render: true, visible: false, priority: 2 });
      ev.participants.forEach((id) => busy.add(id));
      gather(s, ev);
    }
    // a house meeting the housemates agreed on: everyone who is free comes to the room, whatever else the slot had planned
    const meeting = s.invitations.find((p) => p.meeting && p.status === 'accepted' && p.episode === s.world.episode && p.slot === s.world.slot && !flag(s, `meetingHeld_${p.id}`));
    if (meeting && !playerEv) {
      s.world.flags[`meetingHeld_${meeting.id}`] = true;
      const crowd = housemates(s).filter((c) => !busy.has(c.id) && !departing(s, c.id) && (c.isPlayer ? isRoom(P.location) : available(s, c, acts))).map((c) => c.id);
      const host = [meeting.from, meeting.to].find((id) => id !== P.id && crowd.includes(id)) ?? crowd.find((id) => id !== P.id);
      const other = crowd.find((id) => id !== host);
      if (host && other) {
        const participants = [host, ...crowd.filter((id) => id !== host)].slice(0, 6);
        const ev = makeEvent(s, content().eventById.get('house-meeting-called')!, { a: host, b: other }, meeting.node, {
          premise: `${firstName(s, host)} called the whole house together in the ${placeName(meeting.node).toLowerCase()} to talk about ${meeting.meeting!.topic}. Everyone who is home came; the group chat told them beforehand.`,
        });
        Object.assign(ev, { participants, isPlayerScene: participants.includes(P.id), playerPresent: participants.includes(P.id), factRefs: Object.fromEntries(participants.map((id) => [id, factRefsFor(s, id, participants)])) });
        participants.forEach((id) => busy.add(id));
        gather(s, ev);
        if (ev.isPlayerScene) playerEv = ev;
        else plan.scenes.push({ event: ev, render: true, visible: false, priority: 2 });
      }
    }
    if (!playerEv) playerEv = planPlayerScene(s, rng, action, acts, invite, talk);
    if (playerEv) {
      playerEv.participants.forEach((id) => busy.add(id));
      gather(s, playerEv);
    }
    const visitHosts = housemates(s).filter((c) => !busy.has(c.id) && !departing(s, c.id) && c.id !== talk && c.id !== invite && (c.isPlayer
      ? isRoom(P.location) && action.type === 'idle'
      : available(s, c, acts)));
    const visit = returningResident(s, rng, visitHosts.filter((c) => !c.isPlayer || !playerEv));
    if (visit) {
      visit.guest.lastAction = 'hobby';
      visit.guest.swimming = false;
      visit.guest.activityUntil = SLOT_MINUTES;
      const ev = makeEvent(s, content().eventById.get('former-housemate')!, { a: visit.guest.id, b: visit.host.id }, 'living', { title: visit.title, premise: visit.premise });
      if (!playerEv && visitHosts.some((c) => c.id === P.id) && !ev.participants.includes(P.id)) {
        ev.participants.push(P.id);
        ev.isPlayerScene = ev.playerPresent = true;
        ev.factRefs[P.id] = factRefsFor(s, P.id, ev.participants);
      }
      ev.participants.forEach((id) => busy.add(id));
      gather(s, ev);
      if (ev.isPlayerScene) playerEv = ev;
      else plan.scenes.push({ event: ev, render: true, visible: ev.playerPresent, priority: 2 });
    }
    // arc beats: at most one per slot
    const genericPlayerScene = !playerEv || playerEv.type !== 'performance' && ['casual-chat', 'chance-encounter', 'solo-wander', 'work-shift'].includes(playerEv.templateId);
    const avail = new Set(housemates(s).filter((c) => !c.swimming && !['sleep', 'nap', 'shower'].includes(c.lastAction ?? '') && (!busy.has(c.id) || genericPlayerScene && playerEv?.participants.includes(c.id))).map((c) => c.id));
    if (playerEv && !genericPlayerScene) avail.delete(P.id);
    if (playerEv && !genericPlayerScene) for (const id of playerEv.participants) if (id !== P.id) avail.delete(id);
    // a leaver with feelings says it on their last day ("would you leave with me?")
    const lastDay = s.world.slot === 'slot3' || s.world.slot === 'evening' || s.world.slot === 'lateNight';
    const confessor = lastDay ? (s.finaleEpisode === s.world.episode ? npcs(s) : leavers).find((c) => !departing(s, c.id) && avail.has(c.id) && !coupleOf(s, c.id) && !flag(s, `lastConfession_${c.id}`)) : undefined;
    const crush = confessor && housemates(s)
      .filter((o) => o.id !== confessor.id && avail.has(o.id) && !flag(s, `leaving_${o.id}`) && attracted(confessor, o) && rel(s, confessor.id, o.id).romance >= 45)
      .sort((x, y) => rel(s, confessor.id, y.id).romance - rel(s, confessor.id, x.id).romance)[0];
    const arcs = confessor && crush ? [] : arcCandidates(s, rng, avail);
    if (confessor && crush) {
      s.world.flags[`lastConfession_${confessor.id}`] = true;
      const ev = makeEvent(s, content().eventById.get('last-confession')!, { a: confessor.id, b: crush.id }, 'backyard');
      ev.salience = 0.95;
      if (ev.isPlayerScene) playerEv = ev;
      else plan.scenes.push({ event: ev, render: true, visible: ev.playerPresent, priority: 2 });
      ev.participants.forEach((id) => busy.add(id));
      gather(s, ev);
    }
    if (arcs.length) {
      const pick = arcs[s.world.tick % arcs.length];
      const t = content().eventById.get(pick.templateId)!;
      const loc = pick.location;
      const ev = makeEvent(s, t, pick.binding, loc, { arcBeat: { charId: pick.charId, beatId: pick.beatId } });
      ev.salience = Math.max(ev.salience, 0.8);
      if (ev.isPlayerScene) {
        playerEv = ev; // an arc beat involving the player replaces a generic player scene
      } else plan.scenes.push({ event: ev, render: true, visible: ev.playerPresent, priority: 2 });
      ev.participants.forEach((id) => busy.add(id));
      gather(s, ev);
    }
    if (playerEv) plan.scenes.unshift({ event: playerEv, render: true, visible: false, priority: 3 });

    // NPC director event
    const npcPool = npcs(s).filter((c) => available(s, c, acts) && !busy.has(c.id) && !departing(s, c.id));
    if (npcPool.length >= 2 && rng.chance(s.world.slot === 'evening' ? 0.75 : 0.5)) {
      const cs = candidates(s, rng, { location: '*house', pool: npcPool, isPlayerScene: false, npcOnly: true });
      const pick = sample(rng, cs);
      if (pick) {
        const ev = makeEvent(s, pick.template, pick.binding, pick.location);
        ev.participants.forEach((id) => busy.add(id));
        gather(s, ev);
        plan.scenes.push({ event: ev, render: false, visible: ev.playerPresent, priority: 1 });
      }
    }

    // co-location interactions (skip anyone already in a scene)
    const ixActs = Object.fromEntries(Object.entries(acts).filter(([id]) => !busy.has(id)));
    const ixs = resolveColocation(s, rng, ixActs, P.id).filter((ix) => !busy.has(ix.a) && !busy.has(ix.b));
    resolveRemote(s, rng, acts, P.id);
    const ixScenes: { ix: Interaction; ev: EventInstance }[] = [];
    for (const ix of ixs) {
      const t = content().eventById.get(IX_TEMPLATE[ix.type])!;
      const ev = makeEvent(s, t, { a: ix.a, b: ix.b }, ix.location, { title: titles[ix.type] ?? t.title, salience: ix.salience, premise: ix.summary, tags: [...t.tags, `interaction-${ix.type}`] });
      ixScenes.push({ ix, ev });
    }

    // render filter: player co-present, top-k salience, or arc beat
    const k = opts.renderTopK ?? 1;
    const npcSc = plan.scenes.filter((p) => !p.event.isPlayerScene && !p.event.arcBeat && p.priority === 1);
    const pool = [...npcSc.map((p) => ({ sal: p.event.salience, p })), ...ixScenes.map((x) => ({ sal: x.ev.salience, x }))].sort((a, b) => b.sal - a.sal);
    let rendered = plan.scenes.filter((p) => p.render && !p.event.isPlayerScene).length;
    for (const item of pool) {
      const ev = 'p' in item ? item.p!.event : item.x!.ev;
      const visible = ev.playerPresent && !ev.isPlayerScene;
      const top = rendered < k && item.sal >= 0.45;
      if ('p' in item) {
        item.p!.render = visible || top;
        item.p!.visible = visible;
        if (item.p!.render) rendered++;
      } else if (visible || top) {
        plan.scenes.push({ event: ev, render: true, visible, priority: visible ? 1.5 : 1 });
        rendered++;
      } else if (['confess', 'apology'].includes(item.x!.ix.type)) {
        plan.scenes.push({ event: ev, render: false, visible: false, priority: 1 });
      } else {
        applyProposal(s, sanitizeProposal(item.x!.ix.proposal, [ix(item).a, ix(item).b]), [ix(item).a, ix(item).b]);
        logInteraction(s, item.x!.ix);
      }
    }
    for (const p of plan.scenes) if (p.visible) p.priority = Math.max(p.priority, 1.5);
    // A recurring outsider can ring the bell, rather than existing only as a city contact.
    const visitorHosts = npcs(s).filter((c) => available(s, c, acts) && !busy.has(c.id));
    if (!plan.scenes.some((p) => p.event.isPlayerScene) && isRoom(P.location) && visitorHosts.length && (s.world.flags.coworkerVisitor ? visitorHosts.some((c) => c.id === s.world.flags.coworkerVisitor) : rng.chance(0.16))) {
      const host = visitorHosts.find((c) => c.id === s.world.flags.coworkerVisitor) ?? rng.pick(visitorHosts);
      // half the time it is someone from the host's own life: family on the phone, an old friend, an ex
      if (!s.world.flags.coworkerVisitor && rng.chance(0.5)) {
        const kind = rng.pick(['family', 'friend', 'ex'] as const);
        const m = outsiderMoment(host, kind, !!flag(s, `leaving_${host.id}`));
        const ev = makeEvent(s, content().eventById.get('casual-chat')!, { a: host.id, b: P.id }, m.at, { title: m.title, premise: m.premise });
        addMemory(s, host.id, m.title, [host.id], 0.45);
        gather(s, ev);
        plan.scenes.unshift({ event: ev, render: true, visible: false, priority: 3 });
        advanceLiving(s, rng, end, new Set(plan.scenes.flatMap((p) => p.event.participants)));
        observeRoutines(s);
        return;
      }
      const visitor = content().npcs.find((n) => n.linkedTo === host.id) ?? rng.pick(content().npcs);
      const t = content().eventById.get('casual-chat')!;
      const ev = makeEvent(s, t, { a: P.id, b: host.id, x: visitor.id }, 'entrance', { title: `${visitor.name} at the door`, premise: `${visitor.name}, ${s.world.flags.coworkerVisitor ? `a coworker of ${host.name}` : visitor.role}, rings the doorbell to see ${host.name}. They catch up in the house; the visitor has their own perspective.` });
      delete s.world.flags.coworkerVisitor;
      gather(s, ev);
      plan.scenes.unshift({ event: ev, render: true, visible: false, priority: 3 });
    }
    advanceLiving(s, rng, end, new Set(plan.scenes.flatMap((p) => p.event.participants)));
    observeRoutines(s);
  });
  if (action.type === 'trip') {
    // the trip replaces whatever the block would have been for the player: the drive, then a night far from the house
    const t = TRIPS[action.node];
    const group = [s.playerId, ...action.with];
    const drive = makeEvent(s, content().eventById.get('trip-travel')!, { a: s.playerId, b: action.with[0] }, action.node);
    Object.assign(drive, { participants: group, premise: `The shared car, a playlist argument and gas-station snacks: the drive to ${t.name} (${t.blurb}).` });
    const roommate = action.roommate && action.with.includes(action.roommate) ? action.roommate : action.with[0];
    const night = makeEvent(s, content().eventById.get('trip-night')!, { a: s.playerId, b: roommate }, action.node);
    night.premise = night.premise.replace(action.node, t.name);
    plan.scenes = [drive, night].map((event) => ({ event, render: true, visible: false, priority: 3 })).concat(plan.scenes.filter((p) => !p.event.participants.some((id) => group.includes(id))));
  }
  if (action.type === 'sleep' || action.type === 'skip') for (const p of plan.scenes) { p.render = false; p.visible = false; }
  recordActivity(s, actionLabel(s, action, began));
  return { state: s, plan };
}

const ix = (item: { x?: { ix: Interaction } }) => item.x!.ix;

/** The player's own goodbye at the door, with whoever they leave with (or the closest housemate). */
function graduationFarewell(s: GameState): EventInstance | null {
  const P = player(s);
  const w = flag(s, 'playerGraduated');
  const b = typeof w === 'string' && w !== 'alone' ? w : npcs(s).sort((x, y) => rel(s, y.id, P.id).affinity - rel(s, x.id, P.id).affinity)[0]?.id;
  return b ? makeEvent(s, content().eventById.get('farewell-door')!, { a: P.id, b }, 'entrance') : null;
}

// ---------------------------------------------------------------- resolution

/** NPC intents for a scene's choice beats (player intent supplied by the caller). */
export function autoChoices(s0: GameState, ev: EventInstance, playerIntent?: string): { state: GameState; choices: SceneChoices } {
  const s = cloneState(s0);
  const choices: SceneChoices = {};
  withRng(s, (rng) => {
    const t = content().eventById.get(ev.templateId)!;
    for (const id of ev.participants) {
      if (s.characters[id].isPlayer) {
        if (playerIntent && (t.intents as string[]).includes(playerIntent)) choices[id] = playerIntent as SceneChoices[string];
        continue;
      }
      choices[id] = npcIntent(s, rng, s.characters[id], t, ev.participants.filter((x) => x !== id));
    }
  });
  return { state: s, choices };
}

/** Default engine/mock proposal for a scene. */
export function proposeOutcome(s0: GameState, ev: EventInstance, choices: SceneChoices): { state: GameState; proposal: DeltaProposal } {
  const s = cloneState(s0);
  const proposal = withRng(s, (rng) => engineProposal(s, rng, ev, choices));
  return { state: s, proposal };
}

/** Apply a scene outcome (proposal from LLM or engine; always sanitized). */
export function resolveScene(
  s0: GameState,
  ev: EventInstance,
  proposal: unknown,
  choices: SceneChoices,
  response?: 'join' | 'eavesdrop' | 'ignore',
): { state: GameState; result: SceneResolution } {
  const s = cloneState(s0);
  let e = ev;
  beginBroadcast(s, ev);
  if (ev.tags.includes('household') || ev.tags.includes('communal-meal')) {
    const until = Math.max(s.world.minutes, ...ev.participants.filter(id => ev.tags.includes('communal-meal') || s.characters[id]?.actionHousehold).map(id => s.characters[id].activityUntil));
    withRng(s, rng => advanceLiving(s, rng, until, new Set(ev.participants)));
  }
  if (response === 'join' && !ev.participants.includes(s.playerId)) {
    e = { ...ev, participants: [...ev.participants, s.playerId], isPlayerScene: true };
    player(s).location = ev.location;
  }
  const result = withRng(s, (rng) => applySceneOutcome(s, rng, e, proposal, choices, response));
  serveCommunalMeal(s, e);
  if (e.templateId === 'job-mishap' && e.roles.a) rememberMishap(s, e.roles.a, e.location);
  queueFollowUps(s, e, result.proposal);
  const interaction = ev.tags.find(tag => tag.startsWith('interaction-'))?.slice('interaction-'.length);
  if (interaction) rememberInteraction(s, ev.roles.a, ev.roles.b, interaction, ev.premise);
  // outsiders remember the player
  for (const [, id] of Object.entries(ev.roles)) if (s.recurring[id] && e.participants.includes(s.playerId)) {
    s.recurring[id].metPlayer++;
    s.recurring[id].lastSeenEp = s.world.episode;
  }
  return { state: s, result };
}

/** A bad shift comes home with you: housemates you're close to hear about it and may bring it up later. */
function rememberMishap(s: GameState, who: string, place: string) {
  const hungover = (s.characters[who]?.hangover ?? 0) > 0;
  const f = addFact(s, { subject: who, kind: 'event', content: `${firstName(s, who)} had a rough shift at ${placeName(place)}${hungover ? ' while hungover' : ''}.`, truth: true, sensitivity: 0.3 });
  learn(s, who, f.id, 'self');
  for (const h of housemates(s)) {
    if (h.id === who || rel(s, who, h.id).closeness < 15) continue;
    learn(s, h.id, f.id, 'told', who);
    addMemory(s, h.id, `${firstName(s, who)} told me work went badly today${hungover ? ' (they were hungover)' : ''}.`, [h.id, who], 0.35);
  }
}

// ---------------------------------------------------------------- slot end

export function finishSlot(s0: GameState): GameState {
  const s = cloneState(s0);
  if (s.seasonOver) return s;
  if (welcomeDinnerDue(s)) throw new Error('Have the welcome dinner with the whole house before ending move-in day.');
  withRng(s, (rng) => {
    advanceLiving(s, rng, SLOT_MINUTES);
    settlePlans(s);
    updateMoods(s);
    const slot = s.world.slot;
    const job = s.world.playerJob;
    if (job && shiftToday(job, s.world.weekday, slot) && !['heatwave', 'typhoon'].includes(s.world.weather) && !isShabbat(s, player(s)) && !flag(s, 'workedShift')) {
      const missed = ((flag(s, 'jobMissed') as number) ?? 0) + 1;
      s.world.flags.jobMissed = missed;
      const place = placeName(job.nodeId);
      if (missed >= MISSES_BEFORE_FIRED) s.world.playerJob = null;
      addLog(s, { kind: 'system', text: missed >= MISSES_BEFORE_FIRED ? `The manager at ${place} let you go after missed shifts.` : `You missed your shift at ${place}. The manager noticed.`, participants: [s.playerId], salience: 0.5 });
    }
    if (classToday(player(s).occupation, s.world.weekday, slot) && !isShabbat(s, player(s)) && !['heatwave', 'typhoon'].includes(s.world.weather) && !flag(s, 'attendedClass')) {
      const missed = ((flag(s, 'classMissed') as number) ?? 0) + 1;
      s.world.flags.classMissed = missed;
      const exam = !!s.world.flags.examWeek;
      player(s).mood = clamp(player(s).mood - (exam ? 0.15 : 0.05), -1, 1);
      addLog(s, { kind: 'system', text: exam ? 'You missed an exam. There is a resit, but everyone at the department noticed.' : missed >= 3 ? 'The department emailed: one more missed lecture and you fail the course.' : 'You skipped class today. The notes will have to come from someone else.', participants: [s.playerId], salience: exam || missed >= 3 ? 0.5 : 0.3 });
    }
    delete s.world.flags.attendedClass;
    delete s.world.flags.workedShift;
    delete s.world.flags.startedBlock;
    s.world.minutes = 0;
    s.world.tick++;
    missionsToTexts(s);
    s.approaches = [];
    player(s).location = 'living';
    s.world.playerNode = 'house';
    for (const c of housemates(s)) {
      if (c.swimming) { c.swimming = false; c.lastAction = 'hobby'; }
      c.activityUntil = 0;
    }
    if (slot === 'morning') departLeaving(s);
    if (slot === 'slot3') processArrivals(s, rng);
    if (flag(s, 'playerGraduated')) graduatePlayer(s); // the season goes on; the player's next housemate moves in
    if (slot !== 'lateNight') {
      soberUp(s, false);
      s.world.slot = SLOTS[SLOTS.indexOf(slot) + 1] as Slot;
      return;
    }
    soberUp(s, true);
    // ---- end of episode
    for (const c of Object.values(s.characters)) if (c.status === 'arriving') c.status = 'inHouse'; // nobody is left on the doorstep
    evaluateLeaves(s, rng);
    careerChanges(s, rng);
    expirePredictions(s);
    decayGrudges(s);
    relationshipUpkeep(s);
    compactAll(s);
    updatePairSummaries(s);
    pruneFacts(s);
    const kicked = maybeGroupChatExclusion(s, rng);
    if (kicked) addLog(s, { kind: 'chat', text: `A new group chat appeared. ${firstName(s, kicked)} isn't in it.`, participants: [kicked], salience: 0.6 });
    for (const c of housemates(s)) {
      c.needs.energy = clamp(c.needs.energy - 45, 0, 100); // night's sleep
      c.needs.hunger = clamp(c.needs.hunger - 10, 0, 100);
      if (flag(s, `new_${c.id}`) && (flag(s, `new_${c.id}`) as number) < s.world.episode) s.world.flags[`introduced_${c.id}`] = true;
    }
    s.house.labeledFood = s.house.labeledFood.filter((f) => !f.eatenBy);
    s.previously = previouslyRecap(s, s.world.episode);
    const remaining = housemates(s).filter((c) => !flag(s, `leaving_${c.id}`)).length;
    const replacementsComing = s.pendingArrivals.length > 0 || s.awaitingPlayer || s.seasonLength === 0 || s.world.episode < s.seasonLength;
    if ((s.seasonLength > 0 && s.world.episode >= s.seasonLength) || (s.finaleEpisode !== null && s.world.episode >= s.finaleEpisode) || (remaining <= 3 && !replacementsComing)) {
      endSeason(s);
      return;
    }
    s.world.episode++;
    s.world.slot = 'morning';
    s.world.flags.examWeek = s.world.episode % 6 === 5; // students sit exams every sixth episode
    applyCalendar(s, rng);
    rotateChores(s);
    addLog(s, { kind: 'system', text: `Episode ${s.world.episode}.`, participants: [], salience: 0.2 });
    if (s.world.cityEvent && s.world.cityEvent !== 'friday-dinner') addLog(s, { kind: 'calendar', text: `Today: ${content().calendar.events.find((e) => e.id === s.world.cityEvent)?.name}.`, participants: [], salience: 0.4 });
  });
  if (s.world.flags.sleepUntilMorning) {
    if (welcomeDinnerDue(s)) { delete s.world.flags.sleepUntilMorning; return s; }
    if (s.world.slot === 'morning' || s.seasonOver || s.awaitingPlayer) delete s.world.flags.sleepUntilMorning;
    else {
      const planned = planSlot(s, { type: 'skip' });
      let next = planned.state;
      for (const p of planned.plan.scenes) {
        const auto = autoChoices(next, p.event);
        const proposal = proposeOutcome(auto.state, p.event, auto.choices);
        next = resolveScene(proposal.state, p.event, proposal.proposal, auto.choices).state;
      }
      return finishSlot(next);
    }
  }
  return s;
}

/** The player's character walks out (with their partner, if any). Their partner's place is refilled as usual. */
function graduatePlayer(s: GameState) {
  const P = player(s);
  const w = flag(s, 'playerGraduated');
  const partner = typeof w === 'string' && s.characters[w]?.status === 'inHouse' ? s.characters[w] : null;
  const cp = partner ? s.couples.find((c) => c.status === 'dating' && [c.a, c.b].includes(P.id) && [c.a, c.b].includes(partner.id)) : undefined;
  if (partner) depart(s, partner);
  depart(s, P);
  if (cp) cp.status = 'left-together';
  delete s.world.flags.playerGraduated;
  delete s.world.flags.canGraduate;
  s.awaitingPlayer = true;
}

/**
 * The player's next character moves in after their previous one graduated: a stranger to everyone, wired into every
 * system like any newcomer, greeted at the door next slot.
 */
export function joinNewPlayer(s0: GameState, setup: PlayerSetup): GameState {
  const s = cloneState(s0);
  if (!s.awaitingPlayer) throw new Error('nobody is waiting to move in');
  const old = s.characters[s.playerId];
  old.isPlayer = false;
  const n = Object.keys(s.characters).filter((id) => id === 'player' || id.startsWith('player-')).length + 1;
  const P = playerFromSetup(setup, `player-${n}`);
  P.arrivedEp = s.world.episode;
  P.location = 'entrance';
  s.characters[P.id] = P;
  s.playerId = P.id;
  s.rel[P.id] = {};
  for (const h of housemates(s)) {
    if (h.id === P.id) continue;
    s.rel[P.id][h.id] = { affinity: 0, romance: 0, tension: 0, trust: 25, closeness: 0 };
    s.rel[h.id][P.id] = { affinity: 0, romance: 0, tension: 0, trust: 25, closeness: 0 };
  }
  s.knowledge[P.id] = {};
  s.memory[P.id] = [];
  s.house.choreLedger[P.id] = { done: 0, skipped: 0 };
  s.house.groupChat.members.push(P.id);
  s.world.flags[`new_${P.id}`] = s.world.episode;
  s.world.playerJob = null;
  s.world.playerNode = 'house';
  delete s.world.flags.jobMissed;
  s.recentPlayerTargets = [];
  s.awaitingPlayer = false;
  initArc(s, P);
  addLog(s, { kind: 'arrival', text: `${P.name}, ${P.age}, ${P.occupation}, moved into the house.`, participants: [P.id], salience: 0.8 });
  return s;
}

function endSeason(s: GameState) {
  departLeaving(s, true); // anyone marked leaving goes out the door with the finale
  s.seasonOver = true;
  for (const p of s.predictions) if (p.resolved === null) { p.resolved = false; p.resolvedEp = s.world.episode; }
  s.epilogues = Object.fromEntries(Object.values(s.characters).map((c) => [c.id, epilogueFor(s, c)]));
  addLog(s, { kind: 'system', text: 'The season ends.', participants: [], salience: 1 });
}

/** Convenience used by tests/sim: does any character know a fact? */
export const anyoneKnows = (s: GameState, factId: string) => Object.keys(s.knowledge).some((id) => knows(s, id, factId));
export { ch, attracted };
