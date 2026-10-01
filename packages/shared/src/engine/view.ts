// Player-facing projection: only what the player knows, with reliability tags. Hidden state never leaves the server.
import type { Appearance, BeliefEntry, Character, GameState, KnowledgeSource, Prediction } from '../model';
import { ROOMS, TRAIT_NAMES } from '../model';
import { content } from '../content';
import { coupleOf, flag, housemates, isRoom, placeName, rel } from './core';
import { dateLabel } from './calendar';
import { jobOf } from './agents';
import { moodWord, teaserLine } from '../gen/mock';
import { uk } from '../util';

export type Reliability = 'self' | 'witnessed' | 'told' | 'rumor' | 'unknown';

export interface CharView {
  id: string;
  name: string;
  age: number;
  gender: string;
  occupation: string;
  hometown: string;
  appearance: Appearance;
  appearanceTags: string[];
  portraitSeed: number;
  isPlayer: boolean;
  status: 'inHouse' | 'left';
  leftReason?: string;
  arrivedEp: number;
  mood: string | null;
  moodValue: number | null;
  location: string | null;
  partner?: string;
  isNew: boolean;
  leaving: boolean;
  /** what they're doing right now (only when you can see them) */
  activity: string | null;
}

export interface BoardEdge {
  from: string;
  to: string;
  affinity: number;
  romance: number;
  trust: number;
  reliability: Reliability;
  conf: number;
}

export interface BibleEntry {
  id: string;
  backstory?: string;
  hobbies?: string[];
  /** where and when they work, once you know them a little */
  work?: string;
  traits?: string;
  goals?: string[];
  fears?: string[];
  tells?: string[];
  secret?: { text: string; reliability: Reliability };
  values?: string[];
  knownFacts: { text: string; reliability: Reliability }[];
}

export interface DigestEntry {
  text: string;
  reliability: Reliability;
  tick: number;
  distorted?: boolean;
}

export interface PlayerView {
  gameId: string;
  seed: number;
  episode: number;
  seasonLength: number;
  slot: string;
  weekday: number;
  dateLabel: string;
  weather: string;
  season: string;
  cityEvent: { id: string; name: string } | null;
  money: number;
  playerId: string;
  playerLocation: string;
  seasonOver: boolean;
  epilogues?: Record<string, string>;
  previously: string;
  teaser: string;
  canGraduate: string | null;
  /** your character graduated: create the next one to keep playing */
  awaitingPlayer: boolean;
  carFree: boolean;
  job: GameState['world']['playerJob'];
  characters: CharView[];
  occupancy: Record<string, string[]> | null;
  board: BoardEdge[];
  bible: BibleEntry[];
  digest: DigestEntry[];
  chats: { with: string; messages: { from: string; text: string; tick: number; read: boolean }[] }[];
  groupChat: { member: boolean; members: string[]; messages: { from: string; text: string; tick: number }[] };
  house: {
    fridge: Record<string, number>;
    dishes: number;
    laundry: number;
    trash: number;
    noise: number;
    aircon: number;
    choreRota: Record<string, string>;
    choreLedger: Record<string, { done: number; skipped: number }>;
    labeledFood: { item: string; owner: string; eaten: boolean }[];
    rules: string[];
    groceryBudget: number;
  };
  predictions: Prediction[];
  references: { text: string; kind: string; members: string[] }[];
  log: { tick: number; episode: number; slot: string; text: string; kind: string }[];
  couples: { a: string; b: string; status: string }[];
}

const tier = (b: BeliefEntry | undefined): Reliability => (!b || b.conf < 0.12 ? 'unknown' : b.conf >= 0.45 ? 'witnessed' : b.conf >= 0.25 ? 'told' : 'rumor');

export function reliabilityOf(source: KnowledgeSource | undefined): Reliability {
  if (!source) return 'unknown';
  if (source === 'self') return 'self';
  if (source === 'witnessed' || source === 'groupchat') return 'witnessed';
  if (source === 'told') return 'told';
  return 'rumor'; // rumor, overheard
}

export function projectForPlayer(s: GameState, digestSince = s.world.tick): PlayerView {
  const P = s.characters[s.playerId];
  const hm = housemates(s);
  const playerHome = isRoom(P.location);
  const kn = s.knowledge[P.id] ?? {};
  const characters: CharView[] = Object.values(s.characters).map((c) => {
    const visible = c.status === 'inHouse' && (c.isPlayer || (playerHome && isRoom(c.location)) || c.location === P.location);
    const cp = coupleOf(s, c.id);
    const partner = cp ? (cp.a === c.id ? cp.b : cp.a) : undefined;
    const partnerKnown = partner && (c.isPlayer || partner === P.id || Object.keys(kn).some((fid) => s.facts[fid]?.kind === 'couple' && [s.facts[fid].subject, s.facts[fid].about].includes(c.id)));
    return {
      id: c.id, name: c.name, age: c.age, gender: c.gender, occupation: c.occupation, hometown: c.hometown, appearance: c.appearance,
      appearanceTags: c.appearanceTags, portraitSeed: c.portraitSeed, isPlayer: c.isPlayer, status: c.status, leftReason: c.leftReason, arrivedEp: c.arrivedEp,
      mood: visible ? moodWord(c.mood) : null,
      moodValue: visible ? Math.round(c.mood * 100) / 100 : null,
      location: visible ? c.location : c.status === 'inHouse' && !isRoom(c.location) ? 'out' : null,
      partner: partnerKnown ? partner : undefined,
      isNew: !!flag(s, `new_${c.id}`) && (flag(s, `new_${c.id}`) as number) >= s.world.episode - 1,
      leaving: !!flag(s, `leaving_${c.id}`),
      activity: visible && !c.isPlayer ? (c.lastAction ?? null) : null,
    };
  });
  const occupancy = playerHome ? Object.fromEntries(ROOMS.map((r) => [r, hm.filter((c) => c.location === r).map((c) => c.id)])) : null;
  const board: BoardEdge[] = [];
  for (const a of hm)
    for (const b of hm) {
      if (a.id === b.id) continue;
      if (a.id === P.id) {
        const r = rel(s, a.id, b.id);
        board.push({ from: a.id, to: b.id, affinity: Math.round(r.affinity), romance: Math.round(r.romance), trust: Math.round(r.trust), reliability: 'self', conf: 1 });
      } else {
        const be = s.beliefs[P.id]?.[`${a.id}>${b.id}`];
        const t = tier(be);
        board.push({ from: a.id, to: b.id, affinity: Math.round(be?.affinity ?? 0), romance: Math.round(be?.romance ?? 0), trust: 0, reliability: t, conf: Math.round((be?.conf ?? 0) * 100) / 100 });
      }
    }
  const bible: BibleEntry[] = hm
    .filter((c) => !c.isPlayer)
    .map((c) => {
      const toMe = rel(s, c.id, P.id);
      const mine = rel(s, P.id, c.id);
      const closeness = Math.max(toMe.closeness, mine.closeness);
      const p = c.persona;
      const sec = p.secret && kn[p.secret.factId];
      const facts = Object.keys(kn)
        .map((fid) => s.facts[fid])
        .filter((f) => f && f.subject === c.id && f.kind !== 'event' && f.id !== p.secret?.factId)
        .slice(-5)
        .map((f) => ({ text: f.content, reliability: reliabilityOf(kn[f.id].source) }));
      const traitWords = p.traits.map((t, i) => (t > 0.7 ? `high ${TRAIT_NAMES[i]}` : t < 0.3 ? `low ${TRAIT_NAMES[i]}` : null)).filter(Boolean).join(', ');
      return {
        id: c.id,
        hobbies: closeness >= 8 ? p.routine.hobbies : undefined,
        work: closeness >= 8 ? workLine(c) : undefined,
        traits: closeness >= 18 ? traitWords || 'hard to read' : undefined,
        values: closeness >= 25 ? p.values.slice(0, 3) : undefined,
        tells: closeness >= 30 ? p.tells : undefined,
        goals: toMe.trust >= 45 ? [p.goals.long.text, p.goals.short.text] : undefined,
        fears: toMe.trust >= 60 ? p.fears : undefined,
        backstory: toMe.trust >= 55 ? p.backstory : undefined,
        secret: sec && p.secret ? { text: p.secret.content, reliability: reliabilityOf(sec.source) } : undefined,
        knownFacts: facts,
      };
    });
  const digest: DigestEntry[] = Object.entries(kn)
    .filter(([fid, e]) => e.learnedAt >= digestSince && e.source !== 'self' && s.facts[fid] && s.facts[fid].subject !== P.id && s.facts[fid].about !== P.id)
    .map(([fid, e]) => ({ text: s.facts[fid].content, reliability: reliabilityOf(e.source), tick: e.learnedAt, distorted: e.source === 'rumor' }))
    .sort((a, b) => a.tick - b.tick)
    .slice(-12);
  const chats = hm
    .filter((c) => !c.isPlayer)
    .map((c) => ({
      with: c.id,
      messages: (s.chats[uk(P.id, c.id)] ?? []).slice(-30).map((m) => ({ from: m.from, text: m.text, tick: m.tick, read: m.readBy.includes(c.id) || m.from === c.id })),
    }))
    .filter((t) => t.messages.length);
  const member = s.house.groupChat.members.includes(P.id);
  const visibleLog = s.log
    .filter((l) => l.participants.includes(P.id) || (l.factId && kn[l.factId]) || l.kind === 'system' || l.kind === 'calendar' || l.kind === 'arrival' || l.kind === 'departure')
    .slice(-40)
    .map((l) => ({ tick: l.tick, episode: l.episode, slot: l.slot, text: l.text, kind: l.kind }));
  const ce = s.world.cityEvent ? content().calendar.events.find((e) => e.id === s.world.cityEvent) : null;
  return {
    gameId: s.gameId,
    seed: s.seed,
    episode: s.world.episode,
    seasonLength: s.seasonLength,
    slot: s.world.slot,
    weekday: s.world.weekday,
    dateLabel: dateLabel(s.world.day),
    weather: s.world.weather,
    season: s.world.season,
    cityEvent: ce ? { id: ce.id, name: ce.name } : null,
    money: s.world.money,
    playerId: P.id,
    playerLocation: P.location,
    seasonOver: s.seasonOver,
    epilogues: s.epilogues,
    previously: s.previously,
    teaser: teaserLine(s),
    canGraduate: (flag(s, 'canGraduate') as string) ?? null,
    awaitingPlayer: s.awaitingPlayer,
    carFree: s.world.carUsedBy === null,
    job: s.world.playerJob,
    characters,
    occupancy,
    board,
    bible,
    digest,
    chats,
    groupChat: { member, members: s.house.groupChat.members, messages: member ? s.house.groupChat.messages.slice(-30).map((m) => ({ from: m.from, text: m.text, tick: m.tick })) : [] },
    house: {
      fridge: s.house.fridge,
      dishes: Math.round(s.house.dishes),
      laundry: Math.round(s.house.laundry),
      trash: Math.round(s.house.trash),
      noise: Math.round(s.house.noise),
      aircon: s.house.aircon,
      choreRota: s.house.choreRota,
      choreLedger: s.house.choreLedger,
      labeledFood: s.house.labeledFood.map((f) => ({ item: f.item, owner: f.owner, eaten: !!f.eatenBy })),
      rules: s.house.rules,
      groceryBudget: s.house.groceryBudget,
    },
    predictions: s.predictions,
    references: s.references.filter((r) => r.members.includes(P.id)).map((r) => ({ text: r.text, kind: r.kind, members: r.members })),
    log: visibleLog,
    couples: s.couples.filter((c) => c.a === P.id || c.b === P.id || characters.find((x) => x.id === c.a)?.partner).map((c) => ({ a: c.a, b: c.b, status: c.status })),
  };
}

export const roomName = (id: string) => placeName(id);

const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const SLOT_WORD: Record<string, string> = { morning: 'mornings', slot1: 'late mornings', slot2: 'afternoons', slot3: 'early evenings', evening: 'nights' };
/** "night shifts at Minatohama Hospital, Mon/Wed/Fri/Sat" */
export function workLine(c: Character): string {
  const slots = c.persona.routine.jobSlots;
  if (!slots.length) return `${c.occupation}, no fixed hours`;
  const job = jobOf(c.occupation);
  const where = !job ? '' : job.place === 'house' ? ' (from home)' : ` at ${placeName(job.place)}`;
  return `${c.occupation}${where}: ${slots.map((j) => SLOT_WORD[j.slot]).join(' + ')}, ${slots[0].weekdays.map((d) => DAY[d]).join('/')}`;
}