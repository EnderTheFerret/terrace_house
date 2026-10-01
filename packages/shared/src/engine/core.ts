// Shared engine helpers. Internal functions mutate a state that the public API has already cloned.
import type { Character, Fact, GameState, KnowledgeSource, LogEntry, MemoryItem, PairRel, Slot } from '../model';
import { ROOMS } from '../model';
import { mulberry32, type Rng } from '../rng';
import { clamp, dk } from '../util';
import { content } from '../content';

export const MAX_SCENE_DELTA = 15;

export function cloneState(s: GameState): GameState {
  return structuredClone(s);
}

/** Run fn with an Rng seeded from state.rngState and persist the advanced state. */
export function withRng<T>(s: GameState, fn: (rng: Rng) => T): T {
  const rng = mulberry32(s.rngState);
  const out = fn(rng);
  s.rngState = rng.state() | 0;
  return out;
}

export const housemates = (s: GameState): Character[] =>
  Object.values(s.characters)
    .filter((c) => c.status === 'inHouse')
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

export const npcs = (s: GameState) => housemates(s).filter((c) => !c.isPlayer);
export const player = (s: GameState) => s.characters[s.playerId];
export const ch = (s: GameState, id: string) => {
  const c = s.characters[id];
  if (!c) throw new Error(`unknown character ${id}`);
  return c;
};
export const firstName = (s: GameState, id: string) => s.characters[id]?.name.split(' ')[0] ?? id;

export function defaultRel(): PairRel {
  return { affinity: 0, romance: 0, tension: 0, trust: 30, closeness: 0 };
}

export function rel(s: GameState, i: string, j: string): PairRel {
  s.rel[i] ??= {};
  return (s.rel[i][j] ??= defaultRel());
}

const RANGES: Record<keyof PairRel, [number, number]> = {
  affinity: [-100, 100],
  romance: [0, 100],
  tension: [0, 100],
  trust: [0, 100],
  closeness: [0, 100],
};

export function addRel(s: GameState, i: string, j: string, field: keyof PairRel, delta: number) {
  if (i === j || !Number.isFinite(delta)) return;
  const r = rel(s, i, j);
  const [lo, hi] = RANGES[field];
  r[field] = clamp(r[field] + delta, lo, hi);
}

export const asym = (s: GameState, i: string, j: string) => Math.abs(rel(s, i, j).affinity - rel(s, j, i).affinity);

/** romance gap: one-sided romance (unrequited) */
export const romanceGap = (s: GameState, i: string, j: string) => Math.max(0, rel(s, i, j).romance - rel(s, j, i).romance);

export function attracted(a: Character, b: Character): boolean {
  return a.interestedIn.includes(b.gender);
}

export const isRoom = (loc: string) => (ROOMS as readonly string[]).includes(loc);
export const inHouseLoc = (loc: string) => isRoom(loc);

export function placeName(loc: string): string {
  const room = content().house.rooms.find((r) => r.id === loc);
  if (room) return room.name;
  const node = content().city.nodes.find((n) => n.id === loc);
  if (node) return node.name;
  if (loc === 'phone') return 'phone';
  return loc;
}

export const SLOT_START: Record<Slot, number> = { morning: 7, slot1: 10, slot2: 13, slot3: 16, evening: 19 };
export const SLOT_MINUTES = 180;
export const isDaySlot = (slot: Slot) => slot === 'slot1' || slot === 'slot2' || slot === 'slot3';

export function nextId(s: GameState, prefix: string): string {
  s.counters[prefix] = (s.counters[prefix] ?? 0) + 1;
  return `${prefix}-${s.counters[prefix]}`;
}

export function addLog(s: GameState, e: Omit<LogEntry, 'tick' | 'episode' | 'slot'>) {
  s.log.push({ ...e, tick: s.world.tick, episode: s.world.episode, slot: s.world.slot });
  // keep state bounded; full log is persisted by the server in events_log
  if (s.log.length > 600) s.log.splice(0, s.log.length - 600);
}

export function addMemory(s: GameState, charId: string, text: string, participants: string[], salience: number) {
  (s.memory[charId] ??= []).push({
    episode: s.world.episode,
    tick: s.world.tick,
    text: text.slice(0, 200),
    participants,
    salience: clamp(salience, 0, 1),
  } satisfies MemoryItem);
}

export function addFact(s: GameState, f: Omit<Fact, 'id' | 'createdEp' | 'createdTick'> & { id?: string }): Fact {
  const fact: Fact = { ...f, id: f.id ?? nextId(s, 'fact'), createdEp: s.world.episode, createdTick: s.world.tick };
  s.facts[fact.id] = fact;
  return fact;
}

/** Character learns a fact. Never downgrades a better source. Returns true if newly learned. */
export function learn(s: GameState, charId: string, factId: string, source: KnowledgeSource, from?: string, confidence = 1): boolean {
  if (!s.facts[factId]) return false;
  const k = (s.knowledge[charId] ??= {});
  if (k[factId]) {
    k[factId].confidence = Math.max(k[factId].confidence, confidence);
    return false;
  }
  k[factId] = { source, from, confidence: clamp(confidence, 0, 1), learnedAt: s.world.tick };
  return true;
}

export const knows = (s: GameState, charId: string, factId: string) => !!s.knowledge[charId]?.[factId];

export function belief(s: GameState, observer: string, a: string, b: string) {
  s.beliefs[observer] ??= {};
  return (s.beliefs[observer][dk(a, b)] ??= { affinity: 0, romance: 0, conf: 0.05 });
}

export function flag(s: GameState, name: string) {
  return s.world.flags[name];
}

/**
 * Leaving follows the show: marked in episode E, announces to the house in E+1 (one last day), leaves the morning of E+2.
 * True on the day they walk out the door.
 */
export function departing(s: GameState, id: string) {
  const f = s.world.flags[`leaving_${id}`];
  return typeof f === 'number' && s.world.episode >= f + 2;
}

export function coupleOf(s: GameState, id: string) {
  return s.couples.find((c) => c.status === 'dating' && (c.a === id || c.b === id));
}

export function isCouple(s: GameState, a: string, b: string) {
  return s.couples.some((c) => c.status === 'dating' && ((c.a === a && c.b === b) || (c.a === b && c.b === a)));
}

export const traitsOf = (c: Character) => {
  const [O, C, E, A, N] = c.persona.traits;
  return { O, C, E, A, N };
};

/** depth ceiling for a pair from trust and closeness (Section 5.5K) */
export function depthCeiling(s: GameState, a: string, b: string): 'smalltalk' | 'personal' | 'vulnerable' {
  const t = Math.min(rel(s, a, b).trust + rel(s, a, b).closeness * 0.5, rel(s, b, a).trust + rel(s, b, a).closeness * 0.5);
  return t >= 70 ? 'vulnerable' : t >= 42 ? 'personal' : 'smalltalk';
}
