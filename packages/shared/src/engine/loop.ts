// Slot loop. Public API is pure: (state, action) → new state (+ plan); randomness only via state.rngState.
//   createGame → [planSlot → resolveScene* → finishSlot]*
import type { EventTemplate } from '../contentSchema';
import type { Character, DeltaProposal, EventInstance, GameState, PlayerAction, Slot } from '../model';
import { SCHEMA_VERSION, SLOTS } from '../model';
import { mulberry32, type Rng } from '../rng';
import { clamp, fill } from '../util';
import { content } from '../content';
import {
  addFact, addLog, attracted, ch, cloneState, depthCeiling, firstName, flag, housemates, isDaySlot, isRoom, knows, learn, nextId, npcs,
  placeName, player, withRng,
} from './core';
import { applyCalendar, chooseTyphoonDay } from './calendar';
import { bedroomOf, chooseAction, decayNeeds, resolveLocations, satisfy, type AgentAction } from './agents';
import { candidates, expectedDrama, housemateRoles, sample, type Candidate } from './director';
import { logInteraction, resolveColocation, resolveRemote, type Interaction } from './interactions';
import { arcCandidates, initArc } from './arcs';
import { applySceneOutcome, engineProposal, npcIntent, type SceneChoices, type SceneResolution } from './outcome';
import { applyProposal, sanitizeProposal } from './relationships';
import { autoGroceries, consume, houseTick, initHouse, rotateChores } from './house';
import { decayGrudges, maybeGroupChatExclusion, updateMoods } from './social';
import { departLeaving, evaluateLeaves, markLeaving, processArrivals } from './leave';
import { expirePredictions } from './predictions';
import { compactAll, previouslyRecap, updatePairSummaries } from './memory';
import { pruneFacts } from './knowledge';
import { defaultCast, DEFAULT_PLAYER, generateCast, initRelationships, playerFromSetup, type PlayerSetup } from './castgen';
import { fridgeTotal } from './conditions';
import { reachability, WAGE } from './city';
import { epilogueFor } from './epilogue';

export interface NewGameOptions {
  seed: number;
  player?: PlayerSetup;
  randomizeCast?: boolean;
  seasonLength?: number;
  gameId?: string;
}

export function createGame(o: NewGameOptions): GameState {
  const rng = mulberry32(o.seed);
  const seasonLength = o.seasonLength ?? 24;
  const P = playerFromSetup(o.player ?? DEFAULT_PLAYER);
  const genders = P.gender === 'man' ? (['woman', 'woman', 'woman', 'man', 'man'] as const) : (['woman', 'woman', 'man', 'man', 'man'] as const);
  const cast: Character[] = o.randomizeCast ? generateCast(rng, [...genders], P, seasonLength) : defaultCast();
  const all = [...cast, P];
  const s: GameState = {
    schemaVersion: SCHEMA_VERSION,
    gameId: o.gameId ?? `game-${o.seed}`,
    seed: o.seed,
    rngState: 0,
    seasonLength,
    playerId: P.id,
    world: {
      day: 0, episode: 1, slot: 'morning', tick: 0, weather: 'sunny', weekday: 3, season: 'spring', cityEvent: null,
      money: 20000, playerNode: 'house', carUsedBy: null, playerJob: null, flags: {}, typhoonDay: -1,
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
  s.world.typhoonDay = chooseTyphoonDay(rng, seasonLength);
  applyCalendar(s, rng);
  rotateChores(s);
  s.world.flags[`new_${P.id}`] = 1; // the player is the newcomer at the door in episode 1
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
  for (const id of ev.participants) s.characters[id].location = ev.location;
}

const HOUSE_ROOM: Record<string, (c: Character) => string> = {
  hangout: () => 'living', cook: () => 'kitchen', tidy: () => 'kitchen', rest: (c) => bedroomOf(c), rooftop: () => 'rooftop', hobby: () => 'living',
};

/** Apply the player's chosen action: location, money, car, invitations. Returns invited NPC (if any). */
function applyPlayerAction(s: GameState, a: PlayerAction): { invite?: string; talk?: string } {
  const P = player(s);
  P.lastAction = a.type;
  switch (a.type) {
    case 'house':
      P.location = HOUSE_ROOM[a.activity](P);
      s.world.playerNode = 'house';
      satisfy(P, a.activity === 'rest' ? 'sleep' : a.activity === 'cook' ? 'cook' : a.activity === 'tidy' ? 'tidy' : a.activity === 'hangout' ? 'seek' : 'hobby');
      if (a.activity === 'tidy') {
        s.house.dishes = clamp(s.house.dishes - 40, 0, 100);
        s.house.choreLedger[P.id] ??= { done: 0, skipped: 0 };
        s.house.choreLedger[P.id].done++;
      }
      return { talk: a.target };
    case 'talk': {
      const t = s.characters[a.target];
      const priv = content().house.rooms.find((r) => r.id === t?.location)?.private;
      // you knock on a bedroom/bathroom door and talk in the living room instead
      P.location = t && isRoom(t.location) && !priv ? t.location : 'living';
      s.world.playerNode = 'house';
      satisfy(P, 'seek');
      return { talk: a.target };
    }
    case 'goOut': {
      if (!isDaySlot(s.world.slot) || s.world.cityEvent === 'typhoon') {
        P.location = 'living';
        return {};
      }
      const r = reachability('house', s.world.slot, s.world.money, s.world.carUsedBy === null).find((x) => x.node === a.node);
      if (!r || !r.reachable) {
        P.location = 'living';
        return {};
      }
      P.location = a.node;
      s.world.playerNode = a.node;
      s.world.money -= r.cost;
      if (r.needsCar) s.world.carUsedBy = P.id;
      if (a.activity === 'work') {
        s.world.money += WAGE[a.node] ?? 2500;
        satisfy(P, 'work');
      } else satisfy(P, 'goOut');
      return { invite: a.invite && s.characters[a.invite]?.status === 'inHouse' ? a.invite : undefined };
    }
    case 'text':
      satisfy(P, 'text');
      return { talk: a.target };
    case 'graduate': {
      markLeaving(s, P.id, a.with ? `graduated with ${firstName(s, a.with)}` : 'graduated alone');
      if (a.with && s.characters[a.with]) markLeaving(s, a.with, `graduated with ${P.name.split(' ')[0]}`);
      s.world.flags.playerGraduated = a.with ?? 'alone';
      return {};
    }
    default:
      satisfy(P, 'retreat');
      return {};
  }
}

/** Is an NPC free to be pulled into a scene? (in the house, not working, not asleep) */
const available = (s: GameState, c: Character, acts: Record<string, AgentAction>) =>
  c.status === 'inHouse' && isRoom(c.location) && acts[c.id]?.kind !== 'sleep' && acts[c.id]?.kind !== 'work';

function planPlayerScene(s: GameState, rng: Rng, a: PlayerAction, acts: Record<string, AgentAction>, invite?: string, talk?: string): EventInstance | null {
  const P = player(s);
  const ev = (c: Candidate | null) => (c ? makeEvent(s, c.template, c.binding, c.location) : null);
  const withPlayer = (cs: Candidate[]) => cs.filter((c) => Object.values(c.binding).includes(P.id) && (!talk || Object.values(c.binding).includes(talk)));
  if (a.type === 'idle' || a.type === 'graduate') return null;
  if (a.type === 'text') {
    const t = content().eventById.get('chat-exchange')!;
    return makeEvent(s, t, { a: P.id, b: a.target }, 'phone');
  }
  if (a.type === 'goOut' && !isRoom(P.location)) {
    const node = P.location;
    const here = housemates(s).filter((c) => c.id === P.id || c.id === invite || c.location === node);
    let cs = withPlayer(candidates(s, rng, { location: node, pool: here, isPlayerScene: true, activity: a.activity, focus: invite }));
    if (invite) cs = cs.filter((c) => Object.values(c.binding).includes(invite));
    const pick = sample(rng, cs);
    let out: EventInstance;
    if (!pick) {
      const others = here.filter((c) => c.id !== P.id);
      const t = content().eventById.get(others.length ? 'chance-encounter' : 'solo-wander')!;
      out = makeEvent(s, t, others.length ? { a: P.id, b: invite ?? others[0].id } : { a: P.id }, node);
    } else out = ev(pick)!;
    // recurring outsiders keep their schedule: the café owner is at the café, the clerk at the konbini…
    const regular = content().npcs.find((n) => n.location === node && n.schedule.slots.includes(s.world.slot) && n.schedule.weekdays.includes(s.world.weekday) && !n.linkedTo);
    if (regular && !Object.values(out.roles).includes(regular.id)) out.roles = { ...out.roles, x: regular.id };
    return out;
  }
  // house scenes
  const room = P.location;
  if (a.type === 'house' && a.activity === 'rest') return null;
  const pool = housemates(s).filter((c) => c.id === P.id || (available(s, c, acts) && !flag(s, `leaving_${c.id}`)) || c.id === talk);
  const inRoom = pool.filter((c) => c.location === room || c.id === P.id || c.id === talk);
  const usePool = inRoom.length >= 2 ? inRoom : pool;
  const cs = withPlayer(candidates(s, rng, { location: room, pool: usePool, isPlayerScene: true, focus: talk }));
  const pick = sample(rng, cs);
  if (pick) return ev(pick);
  const partner = talk ?? usePool.find((c) => c.id !== P.id)?.id;
  if (!partner) return null;
  return makeEvent(s, content().eventById.get('casual-chat')!, { a: P.id, b: partner }, room);
}

const IX_TEMPLATE: Record<string, string> = {
  chat: 'ix-chat', deep: 'ix-deep', flirt: 'ix-flirt', bicker: 'ix-bicker', awkward: 'ix-awkward', joke: 'ix-joke', confess: 'ix-confess', apology: 'ix-apology', gossip: 'ix-gossip',
};

export interface PlanOptions {
  /** render top-k salient NPC scenes even when the player isn't there */
  renderTopK?: number;
}

export function planSlot(s0: GameState, action: PlayerAction, opts: PlanOptions = {}): { state: GameState; plan: SlotPlan } {
  const s = cloneState(s0);
  const plan: SlotPlan = { scenes: [], npcActions: {} };
  if (s.seasonOver) return { state: s, plan };
  withRng(s, (rng) => {
    s.world.carUsedBy = null;
    const P = player(s);
    for (const c of housemates(s)) decayNeeds(c);
    const { invite, talk } = applyPlayerAction(s, action);
    // NPC actions
    const acts: Record<string, AgentAction> = {};
    for (const c of npcs(s)) {
      if (flag(s, `leaving_${c.id}`)) acts[c.id] = { kind: 'retreat' };
      else if (c.id === invite && action.type === 'goOut') acts[c.id] = { kind: 'goOut', node: action.node };
      else acts[c.id] = chooseAction(s, rng, c);
      const a = acts[c.id];
      if (a.kind === 'goOut' && a.useCar) {
        if (s.world.carUsedBy === null) s.world.carUsedBy = c.id;
        else acts[c.id] = { kind: 'hobby' };
      }
      c.lastAction = acts[c.id].kind;
    }
    resolveLocations(s, acts, { [P.id]: P.location });
    for (const c of npcs(s)) satisfy(c, acts[c.id].kind);
    // cooking uses ingredients; empty fridge triggers a grocery run by the most conscientious cook
    for (const c of npcs(s)) if (acts[c.id].kind === 'cook' && !consume(s, pickIngredients(s, rng))) acts[c.id] = { kind: 'eat' };
    if (s.world.slot === 'morning' && fridgeTotal(s) < 6) {
      const buyer = npcs(s).sort((x, y) => y.persona.traits[1] - x.persona.traits[1])[0];
      if (buyer) autoGroceries(s, buyer.id);
    }
    houseTick(s, rng, Object.fromEntries(Object.entries(acts).map(([k, v]) => [k, v.kind])));
    plan.npcActions = acts;

    const busy = new Set<string>();
    // farewell scenes take priority in the morning
    const leavers = housemates(s).filter((c) => flag(s, `leaving_${c.id}`) && !c.isPlayer);
    let playerEv: EventInstance | null = null;
    if (leavers.length && s.world.slot === 'morning') {
      const t = content().eventById.get('farewell-door')!;
      const lv = leavers[0];
      const other = P.status === 'inHouse' && isRoom(P.location) ? P.id : npcs(s).find((c) => c.id !== lv.id && !flag(s, `leaving_${c.id}`))?.id;
      if (other) {
        const ev = makeEvent(s, t, { a: lv.id, b: other }, 'entrance');
        if (ev.isPlayerScene) playerEv = ev;
        else plan.scenes.push({ event: ev, render: true, visible: false, priority: 2 });
        ev.participants.forEach((id) => busy.add(id));
        gather(s, ev);
      }
    }
    // newcomer introductions
    for (const c of housemates(s)) {
      if (!flag(s, `new_${c.id}`) || flag(s, `introduced_${c.id}`) || playerEv) continue;
      if (s.world.slot !== 'morning' && s.world.slot !== 'evening') continue;
      const t = content().eventById.get('arrival-intro')!;
      const greeter = c.isPlayer ? npcs(s).sort((x, y) => y.persona.traits[2] - x.persona.traits[2])[0] : P;
      if (!greeter || (greeter.isPlayer && !isRoom(P.location))) continue;
      const ev = makeEvent(s, t, { a: c.id, b: greeter.id }, 'entrance');
      if (ev.isPlayerScene) playerEv = ev;
      else plan.scenes.push({ event: ev, render: true, visible: false, priority: 2 });
      ev.participants.forEach((id) => busy.add(id));
      gather(s, ev);
    }
    if (!playerEv) playerEv = planPlayerScene(s, rng, action, acts, invite, talk);
    if (playerEv) {
      playerEv.participants.forEach((id) => busy.add(id));
      gather(s, playerEv);
    }

    // arc beats: at most one per slot
    const avail = new Set(housemates(s).filter((c) => (c.isPlayer ? isRoom(c.location) : available(s, c, acts)) && !busy.has(c.id)).map((c) => c.id));
    if (playerEv && !['casual-chat', 'chance-encounter', 'solo-wander'].includes(playerEv.templateId)) avail.delete(P.id);
    if (playerEv) for (const id of playerEv.participants) if (id !== P.id) avail.delete(id);
    const arcs = arcCandidates(s, rng, avail);
    if (arcs.length) {
      const pick = arcs[s.world.tick % arcs.length];
      const t = content().eventById.get(pick.templateId)!;
      const loc = isRoom(t.location) ? t.location : t.location;
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
    const npcPool = npcs(s).filter((c) => available(s, c, acts) && !busy.has(c.id) && !flag(s, `leaving_${c.id}`));
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
      const ev = makeEvent(s, t, { a: ix.a, b: ix.b }, ix.location, { salience: ix.salience });
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
  });
  return { state: s, plan };
}

const ix = (item: { x?: { ix: Interaction } }) => item.x!.ix;

function pickIngredients(s: GameState, rng: Rng): Record<string, number> {
  const have = Object.entries(s.house.fridge).filter(([, n]) => n > 0).map(([k]) => k);
  if (have.length < 2) return { __none: 1 };
  const a = rng.pick(have);
  const b = rng.pick(have.filter((x) => x !== a));
  return { [a]: 1, [b]: 1 };
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
  if (response === 'join' && !ev.participants.includes(s.playerId)) {
    e = { ...ev, participants: [...ev.participants, s.playerId], isPlayerScene: true };
    player(s).location = ev.location;
  }
  const result = withRng(s, (rng) => applySceneOutcome(s, rng, e, proposal, choices, response));
  // outsiders remember the player
  for (const [, id] of Object.entries(ev.roles)) if (s.recurring[id] && e.participants.includes(s.playerId)) {
    s.recurring[id].metPlayer++;
    s.recurring[id].lastSeenEp = s.world.episode;
  }
  return { state: s, result };
}

// ---------------------------------------------------------------- slot end

export function finishSlot(s0: GameState): GameState {
  const s = cloneState(s0);
  if (s.seasonOver) return s;
  withRng(s, (rng) => {
    updateMoods(s);
    const slot = s.world.slot;
    s.world.tick++;
    if (slot === 'morning') departLeaving(s);
    if (slot === 'slot3') processArrivals(s, rng);
    if (flag(s, 'playerGraduated')) {
      endSeason(s);
      return;
    }
    if (slot !== 'evening') {
      s.world.slot = SLOTS[SLOTS.indexOf(slot) + 1] as Slot;
      return;
    }
    // ---- end of episode
    evaluateLeaves(s, rng);
    expirePredictions(s);
    decayGrudges(s);
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
    const replacementsComing = s.world.episode <= s.seasonLength - 3;
    if (s.world.episode >= s.seasonLength || (remaining <= 3 && !replacementsComing)) {
      endSeason(s);
      return;
    }
    s.world.episode++;
    s.world.slot = 'morning';
    applyCalendar(s, rng);
    rotateChores(s);
    addLog(s, { kind: 'system', text: `Episode ${s.world.episode}.`, participants: [], salience: 0.2 });
    if (s.world.cityEvent) addLog(s, { kind: 'calendar', text: `Today: ${content().calendar.events.find((e) => e.id === s.world.cityEvent)?.name}.`, participants: [], salience: 0.4 });
  });
  return s;
}

function endSeason(s: GameState) {
  departLeaving(s); // anyone marked leaving goes out the door with the finale
  s.seasonOver = true;
  s.epilogues = Object.fromEntries(Object.values(s.characters).map((c) => [c.id, epilogueFor(s, c)]));
  addLog(s, { kind: 'system', text: 'The season ends.', participants: [], salience: 1 });
}

/** Convenience used by tests/sim: does any character know a fact? */
export const anyoneKnows = (s: GameState, factId: string) => Object.keys(s.knowledge).some((id) => knows(s, id, factId));
export { ch, attracted };
