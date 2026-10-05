// Cast: default cast, archetype-based generator with farthest-point sampling + dynamics constraints (5.5C),
// replacement housemates maximizing disruption (5.5M), and the player character.
import type { Archetype, CastEntry } from '../contentSchema';
import type { Appearance, Character, Gender, GameState, Persona, Speech } from '../model';
import type { Rng } from '../rng';
import { hashSeed } from '../rng';
import { clamp, euclid } from '../util';
import { content } from '../content';
import { compileAppearanceTags } from '../appearance';
import { jobOf, jobSchedule } from './agents';

// ---------- features & compatibility ----------
const ATT = ['secure', 'anxious', 'avoidant'] as const;
const STY = ['confront', 'avoid', 'passive-aggressive', 'deflect-with-humor', 'mediate'] as const;

export interface PersonaLike {
  traits: number[];
  attachment: (typeof ATT)[number];
  conflictStyle: (typeof STY)[number];
  values: string[];
  humor: string;
  formality: number;
  sentenceLen: number;
  fillerRate: number;
}

export const personaLike = (p: Persona): PersonaLike => ({
  traits: p.traits,
  attachment: p.attachment,
  conflictStyle: p.conflictStyle,
  values: p.values,
  humor: p.speech.humor,
  formality: p.speech.formality,
  sentenceLen: p.speech.sentenceLen.mean,
  fillerRate: p.speech.fillerRate,
});

export const archetypeLike = (a: Archetype): PersonaLike => ({
  traits: a.traits,
  attachment: a.attachment,
  conflictStyle: a.conflictStyle,
  values: a.values,
  humor: a.humor,
  formality: a.formality,
  sentenceLen: a.sentenceLen,
  fillerRate: a.fillerRate,
});

/** Joint trait/attachment/speech feature vector. */
export function features(p: PersonaLike): number[] {
  return [
    ...p.traits,
    ...ATT.map((a) => (a === p.attachment ? 0.6 : 0)),
    ...STY.map((s) => (s === p.conflictStyle ? 0.4 : 0)),
    p.formality,
    p.sentenceLen / 15,
    p.fillerRate,
  ];
}

const CLASH: Record<string, string[]> = {
  confront: ['avoid', 'passive-aggressive'],
  'passive-aggressive': ['confront', 'deflect-with-humor'],
  avoid: ['confront'],
  'deflect-with-humor': ['passive-aggressive'],
  mediate: [],
};
const VALUE_CLASH: [string, string][] = [
  ['honesty', 'harmony'],
  ['freedom', 'security'],
  ['ambition', 'fun'],
  ['freedom', 'family'],
];

export function styleClash(a: PersonaLike, b: PersonaLike) {
  return CLASH[a.conflictStyle].includes(b.conflictStyle) || CLASH[b.conflictStyle].includes(a.conflictStyle);
}
export function valueClash(a: PersonaLike, b: PersonaLike) {
  const ta = a.values.slice(0, 2);
  const tb = b.values.slice(0, 2);
  return VALUE_CLASH.some(([x, y]) => (ta.includes(x) && tb.includes(y)) || (ta.includes(y) && tb.includes(x)));
}

/** Expected affinity compatibility in [-1, 1]. */
export function compat(a: PersonaLike, b: PersonaLike): number {
  const [Oa, , Ea, Aa, Na] = a.traits;
  const [Ob, , Eb, Ab, Nb] = b.traits;
  const overlap = a.values.slice(0, 3).filter((v) => b.values.slice(0, 3).includes(v)).length / 3;
  let c = (Aa + Ab) * 0.45 - 0.45 - Math.abs(Oa - Ob) * 0.4 + overlap * 0.5 - (Na + Nb) * 0.15 + (1 - Math.abs(Ea - Eb)) * 0.1;
  if (styleClash(a, b)) c -= 0.35;
  if (valueClash(a, b)) c -= 0.3;
  if (a.humor === b.humor && a.humor !== 'none') c += 0.15;
  if (a.conflictStyle === 'mediate' || b.conflictStyle === 'mediate') c += 0.15;
  return clamp(c, -1, 1);
}

export function romancePull(a: { gender: Gender; interestedIn: Gender[]; p: PersonaLike }, b: { gender: Gender; p: PersonaLike }) {
  if (!a.interestedIn.includes(b.gender)) return 0;
  return clamp(0.45 + compat(a.p, b.p) * 0.4 + b.p.traits[2] * 0.15 + (b.p.traits[0] - 0.5) * 0.1, 0, 1);
}

export interface DynamicsReport {
  compatible: number;
  friction: number;
  triangle: boolean;
  stabilizer: boolean;
  ok: boolean;
}

export function checkDynamics(cast: { gender: Gender; interestedIn: Gender[]; p: PersonaLike }[]): DynamicsReport {
  let compatible = 0;
  let friction = 0;
  for (let i = 0; i < cast.length; i++)
    for (let j = i + 1; j < cast.length; j++) {
      const c = compat(cast[i].p, cast[j].p);
      if (c > 0.25) compatible++;
      if (c < -0.05 || styleClash(cast[i].p, cast[j].p) || valueClash(cast[i].p, cast[j].p)) friction++;
    }
  let triangle = false;
  for (let j = 0; j < cast.length && !triangle; j++) {
    const fans = cast.filter((_, i) => i !== j && romancePull(cast[i], cast[j]) > 0.55);
    if (fans.length >= 2) triangle = true;
  }
  const stabilizer = cast.some((c) => c.p.conflictStyle === 'mediate' || c.p.traits[3] >= 0.8);
  return { compatible, friction, triangle, stabilizer, ok: compatible >= 2 && friction >= 2 && triangle && stabilizer };
}

// ---------- building characters ----------
export function baseCharacter(
  id: string,
  e: Omit<CastEntry, 'id' | 'persona'> & { persona: Persona },
  opts: { isPlayer?: boolean; arrivedEp?: number; archetypeId?: string; quirks?: string[] } = {},
): Character {
  const p = e.persona;
  const baseline = clamp(0.25 - p.traits[4] * 0.35 + p.traits[2] * 0.1, -0.5, 0.6);
  const c: Character = {
    id,
    name: e.name,
    age: e.age,
    gender: e.gender,
    interestedIn: e.interestedIn,
    occupation: e.occupation,
    hometown: e.hometown,
    traits: p.traits,
    tastes: p.routine.tastes,
    appearance: e.appearance,
    appearanceText: '',
    appearanceTags: [],
    portraitSeed: e.portraitSeed,
    voiceNotes: e.voiceNotes,
    persona: p,
    quirks: opts.quirks ?? [],
    mood: baseline,
    moodBaseline: baseline,
    energy: 80,
    needs: { energy: 20, hunger: 30, social: 40, privacy: 20, romance: 30, achievement: 30 },
    status: 'inHouse',
    isPlayer: !!opts.isPlayer,
    location: 'living',
    arrivedEp: opts.arrivedEp ?? 1,
    contractEp: e.contractEp,
    archetypeId: opts.archetypeId,
    lowMoodStreak: 0,
    activityUntil: 0,
    swimming: false,
  };
  c.appearanceTags = compileAppearanceTags(c);
  return c;
}

/** Terrace House is always three men and three women: the five housemates who complete the player's half. */
export const castGenders = (player: Gender): Gender[] => (player === 'man' ? ['woman', 'woman', 'woman', 'man', 'man'] : ['woman', 'woman', 'man', 'man', 'man']);

/** The hand-written cast (three of each): all six, or the five in file order that fill `castGenders(player)`. */
export function defaultCast(player?: Gender): Character[] {
  const need = player ? castGenders(player) : null;
  const take = (g: Gender) => {
    if (!need) return true;
    const i = need.indexOf(g);
    if (i < 0) return false;
    need.splice(i, 1);
    return true;
  };
  return content().cast.filter((e) => take(e.gender)).map((e) => baseCharacter(e.id, e));
}

function speechFromArchetype(a: Archetype, rng: Rng): Speech {
  const E = a.traits[2];
  return {
    sentenceLen: { mean: a.sentenceLen, sd: Math.max(1, a.sentenceLen * 0.3) },
    formality: a.formality,
    fillers: a.fillers.slice(0, 6),
    fillerRate: a.fillerRate,
    humor: a.humor,
    catchphrase: a.catchphrases.length ? { text: rng.pick(a.catchphrases), maxRate: 0.08 } : null,
    trailing: a.trailing,
    chat: {
      stampRate: clamp(E * 0.6, 0, 1),
      punctuation: E > 0.75 ? 'heavy' : a.formality > 0.6 ? 'normal' : 'none',
      replyLatency: a.attachment === 'anxious' ? 'instant' : a.attachment === 'avoidant' ? 'slow' : 'erratic',
      readIgnoreProb: a.attachment === 'avoidant' ? 0.35 : a.attachment === 'anxious' ? 0.02 : 0.08,
    },
    exemplars: a.exemplars,
    doNot: ['meta commentary', 'mentioning cameras unless in persona'],
    slang: a.slang,
  };
}

/** Instantiate a full Character from an archetype. */
export function fromArchetype(s: Pick<GameState, 'counters'> | null, rng: Rng, a: Archetype, gender: Gender, usedNames: Set<string>, arrivedEp: number, seasonLength: number): Character {
  const pool = content().names[gender];
  const fresh = rng.shuffle(pool).find((n) => !usedNames.has(n));
  const first = fresh ?? rng.pick(pool);
  usedNames.add(first);
  const fam = rng.pick(content().names.family);
  // name pool exhausted (long seasons): a repeated first name still needs a unique id
  const id = `${first.toLowerCase()}-${arrivedEp}${fresh ? '' : `-${rng.int(100, 1000)}`}`;
  const jitter = (v: number) => clamp(v + rng.normal(0, 0.06), 0, 1);
  const traits = a.traits.map(jitter);
  const [, C, E, A, N] = traits;
  const opts = content().appearanceOptions;
  const appearance: Appearance = {
    hairStyle: rng.pick(opts.hairStyle),
    hairColor: rng.pick(opts.hairColor),
    eyeColor: rng.pick(opts.eyeColor),
    build: rng.pick(opts.build),
    outfit: rng.pick(opts.outfit),
    accessory: rng.pick(opts.accessory),
    skinTone: rng.pick(opts.skinTone),
  };
  const toGoal = (g: { text: string; kind: string }, i: number) => ({
    id: `${id}-goal-${i}`,
    text: g.text,
    kind: (['partner', 'career', 'audience', 'avoidDrama', 'honesty', 'marriage', 'exposure', 'savings', 'creative', 'friends'].includes(g.kind) ? g.kind : 'friends') as Persona['goals']['long']['kind'],
  });
  const secretText = rng.pick(a.secrets);
  const occupation = rng.pick(a.occupations);
  const name = `${first} ${fam}`;
  const persona: Persona = {
    kashrut: a.kashrut,
    diet: a.diet,
    keepsShabbat: a.keepsShabbat,
    traits,
    attachment: a.attachment,
    conflictStyle: a.conflictStyle,
    values: a.values,
    needsProfile: {
      energy: 7 + rng.int(0, 3),
      hunger: 10 + rng.int(0, 3),
      social: 3 + E * 10,
      privacy: 2 + (1 - E) * 9,
      romance: 2 + A * 3 + (a.attachment === 'anxious' ? 3 : 0),
      achievement: 2 + C * 7,
    },
    goals: { long: toGoal(a.goals[0], 0), short: toGoal(a.goals[1], 1) },
    secret: { factId: `secret-${id}`, content: `${first} ${secretText}.`, exposureCost: 0.3 + N * 0.4 },
    fears: a.fears,
    tells: a.tells,
    speech: speechFromArchetype(a, rng),
    routine: {
      jobSlots: jobOf(occupation) ? jobSchedule(rng, jobOf(occupation)!) : [{ slot: rng.pick(['slot1', 'slot2'] as const), weekdays: rng.shuffle([0, 1, 2, 3, 4]).slice(0, 3).sort() }],
      habits: [{ slot: 'evening', action: 'hobby', room: rng.pick(['living', 'backyard']) }, { slot: 'morning', action: rng.pick(['exercise', 'cook', 'eat']), room: 'kitchen' }, { slot: 'lateNight', action: a.traits[2] < .4 ? 'sleep' : 'retreat', room: gender === 'man' ? 'balconyM' : 'balconyW' }],
      hobbies: a.hobbies.slice(0, 3),
      tastes: a.tastes.map((t) => clamp(t + rng.normal(0, 0.1), -1, 1)),
    },
    backstory: `${first} grew up in ${rng.pick(content().hometowns)} and works as a ${occupation}. A ${a.label} by temperament, they moved to the Tel Aviv house looking for a change.${a.kashrut !== 'none' ? ' Keeping a familiar kosher kitchen is one way they stay connected to family.' : ''}${a.keepsShabbat ? ' They put the phone away on Shabbat and cook Friday dinner before sundown.' : ''}`,
    homesickness: clamp(0.2 + N * 0.4 + rng.normal(0, 0.1), 0, 1),
    gossipiness: a.gossipiness,
  };
  return baseCharacter(
    id,
    {
      name,
      age: 21 + rng.int(0, 13),
      gender,
      interestedIn: [gender === 'man' ? 'woman' : gender === 'woman' ? 'man' : rng.pick(['woman', 'man'] as const)],
      occupation,
      hometown: rng.pick(content().hometowns),
      appearance,
      voiceNotes: a.voiceNotes.slice(0, 200),
      portraitSeed: hashSeed(id) % 100000,
      // some housemates have no fixed stay: they leave only for a reason, or stay until the finale
      contractEp: ((planned: number) => (hashSeed(`stay:${id}`) % 5 < 2 ? 999 : planned))(Math.min(seasonLength, 12 + rng.int(0, 10))),
      persona,
    },
    { arrivedEp, archetypeId: a.id },
  );
}

/** Farthest-point sampling over archetypes, then resample until dynamics constraints hold. */
export function generateCast(rng: Rng, genders: Gender[], player: Character | null, seasonLength: number): Character[] {
  const arch = content().archetypes;
  const feats = arch.map((a) => features(archetypeLike(a)));
  let best: { cast: Character[]; score: number } | null = null;
  for (let attempt = 0; attempt < 60; attempt++) {
    const chosen: number[] = [rng.int(0, arch.length)];
    while (chosen.length < genders.length) {
      let bi = -1;
      let bd = -1;
      for (let i = 0; i < arch.length; i++) {
        if (chosen.includes(i)) continue;
        const d = Math.min(...chosen.map((j) => euclid(feats[i], feats[j]))) + rng.next() * 0.05;
        if (d > bd) {
          bd = d;
          bi = i;
        }
      }
      chosen.push(bi);
    }
    const used = new Set<string>(player ? [player.name.split(' ')[0]] : []);
    const cast = chosen.map((ai, k) => fromArchetype(null, rng, arch[ai], genders[k], used, 1, seasonLength));
    const all = [...cast, ...(player ? [player] : [])].map((c) => ({ gender: c.gender, interestedIn: c.interestedIn, p: personaLike(c.persona) }));
    const rep = checkDynamics(all);
    const minDist = Math.min(...chosen.flatMap((i, x) => chosen.slice(x + 1).map((j) => euclid(feats[i], feats[j]))));
    const score = (rep.ok ? 10 : 0) + rep.compatible * 0.3 + rep.friction * 0.3 + (rep.triangle ? 1 : 0) + (rep.stabilizer ? 1 : 0) + minDist;
    if (!best || score > best.score) best = { cast, score };
    if (rep.ok && minDist > 0.35) return cast;
  }
  return best!.cast;
}

/** Initial relationships from expected compatibility (+ seeded noise). */
export function initRelationships(s: GameState, rng: Rng, ids: string[]) {
  for (const i of ids)
    for (const j of ids) {
      if (i === j) continue;
      const a = s.characters[i];
      const b = s.characters[j];
      const c = compat(personaLike(a.persona), personaLike(b.persona));
      const pull = romancePull({ gender: a.gender, interestedIn: a.interestedIn, p: personaLike(a.persona) }, { gender: b.gender, p: personaLike(b.persona) });
      s.rel[i] ??= {};
      s.rel[i][j] = {
        affinity: clamp(Math.round(c * 22 + rng.normal(0, 6)), -100, 100),
        romance: clamp(Math.round(pull * 18 + (pull > 0 ? rng.next() * 10 : 0)), 0, 100),
        tension: clamp(Math.round(Math.max(0, -c) * 18 + rng.next() * 4), 0, 100),
        trust: clamp(Math.round(28 + c * 8 + rng.normal(0, 4)), 0, 100),
        closeness: 0,
      };
    }
}

/**
 * Replacement housemate: same gender as the leaver, chosen to maximize expected disruption
 * (new triangle around a dating/high-romance pair, friction with the most-settled pair) while staying far
 * from the existing cast in persona space.
 */
export function replacementCandidate(s: GameState, rng: Rng, gender: Gender): Character {
  const cast = Object.values(s.characters).filter((c) => c.status === 'inHouse');
  const used = new Set(Object.values(s.characters).map((c) => c.name.split(' ')[0]));
  const castFeats = cast.map((c) => features(personaLike(c.persona)));
  // most settled pair: highest mutual affinity
  let settled: [string, string] | null = null;
  let settledV = -Infinity;
  let romantic: [string, string] | null = null;
  let romV = -Infinity;
  for (const a of cast)
    for (const b of cast) {
      if (a.id >= b.id) continue;
      const m = (s.rel[a.id]?.[b.id]?.affinity ?? 0) + (s.rel[b.id]?.[a.id]?.affinity ?? 0);
      if (m > settledV) {
        settledV = m;
        settled = [a.id, b.id];
      }
      const r = (s.rel[a.id]?.[b.id]?.romance ?? 0) + (s.rel[b.id]?.[a.id]?.romance ?? 0);
      if (r > romV) {
        romV = r;
        romantic = [a.id, b.id];
      }
    }
  let best: { c: Character; score: number } | null = null;
  for (const a of rng.shuffle(content().archetypes).slice(0, 8)) {
    const cand = fromArchetype(s, rng, a, gender, new Set(used), s.world.episode, s.seasonLength);
    const cp = personaLike(cand.persona);
    let disruption = 0;
    if (romantic) {
      for (const id of romantic) {
        const t = s.characters[id];
        disruption += romancePull({ gender: cand.gender, interestedIn: cand.interestedIn, p: cp }, { gender: t.gender, p: personaLike(t.persona) });
      }
    }
    if (settled) for (const id of settled) if (compat(cp, personaLike(s.characters[id].persona)) < 0) disruption += 0.6;
    const dist = Math.min(...castFeats.map((f) => euclid(f, features(cp))));
    const score = disruption + dist * 1.5 + rng.next() * 0.05;
    if (!best || score > best.score) best = { c: cand, score };
  }
  return best!.c;
}

// ---------- player ----------
export interface PlayerSetup {
  name: string;
  age: number;
  gender: Gender;
  interestedIn: Gender[];
  hometown: string;
  occupation: string;
  traits: number[];
  quirks: string[];
  tastes: number[];
  hobbies: string[];
  appearance: Appearance;
  portraitSeed?: number;
  spriteSeed?: number;
  spriteInstructions?: string;
  appearanceText?: string;
  kashrut?: Persona['kashrut'];
  diet?: Persona['diet'];
  keepsShabbat?: boolean;
}

export function playerFromSetup(p: PlayerSetup, id = 'player'): Character {
  if (p.age < 20 || p.age > 35) throw new Error('player age must be 20–35');
  const quirks = content().quirks.filter((q) => p.quirks.includes(q.id));
  const eff = Object.assign({}, ...quirks.map((q) => q.effect)) as Record<string, any>;
  const traits = p.traits.map((t, i) => clamp(t + ([eff.openness, eff.conscientiousness, eff.extraversion, eff.agreeableness, eff.neuroticism][i] ?? 0), 0, 1));
  const [O, C, E, A, N] = traits;
  const values = ['honesty', 'fun', 'loyalty', 'harmony', 'freedom'] as Persona['values'];
  if (eff.value && !values.includes(eff.value)) values.unshift(eff.value);
  const persona: Persona = {
    kashrut: p.kashrut ?? 'none',
    diet: p.diet ?? 'omnivore',
    keepsShabbat: p.keepsShabbat ?? false,
    traits,
    attachment: eff.attachment ?? (N > 0.65 ? 'anxious' : E < 0.3 ? 'avoidant' : 'secure'),
    conflictStyle: eff.conflictStyle ?? (A > 0.7 ? 'mediate' : E > 0.7 ? 'deflect-with-humor' : O > 0.7 ? 'confront' : 'avoid'),
    values: values.slice(0, 6),
    needsProfile: {
      energy: 8 + (eff.energyDecay ?? 0),
      hunger: 11,
      social: 3 + E * 9 + (eff.socialDecay ?? 0),
      privacy: 2 + (1 - E) * 8 + (eff.privacyDecay ?? 0),
      romance: 4 + (eff.romanceDecay ?? 0),
      achievement: 3 + C * 5 + (eff.achievementDecay ?? 0),
    },
    goals: {
      long: { id: `${id}-long`, text: 'leave the house with someone worth it', kind: 'partner' },
      short: { id: `${id}-short`, text: 'figure out who everyone really is', kind: 'friends' },
    },
    secret: null,
    fears: [],
    tells: ['laughs a little too long'],
    speech: {
      sentenceLen: { mean: 6 + Math.round(E * 5), sd: 2 },
      formality: clamp(C * 0.5 + (1 - E) * 0.3, 0, 1),
      fillers: N > 0.6 ? ['um'] : E > 0.7 ? ['like'] : [],
      fillerRate: N > 0.6 || E > 0.7 ? 0.2 : 0.05,
      humor: eff.humor ?? (E > 0.6 ? 'teasing' : 'dry'),
      catchphrase: null,
      trailing: 'none',
      chat: { stampRate: E * 0.5, punctuation: 'normal', replyLatency: 'instant', readIgnoreProb: 0 },
      exemplars: ['Hey. Got a minute?', "Honestly? I didn't expect that.", "Okay, that's actually really funny."],
      doNot: ['meta commentary'],
      slang: [],
    },
    routine: { jobSlots: [], habits: [], hobbies: (p.hobbies.length >= 3 ? p.hobbies : [...p.hobbies, 'reading', 'walks', 'music']).slice(0, 3), tastes: p.tastes },
    backstory: `${p.name} is a ${p.occupation} from ${p.hometown} who moved into the share house.`,
    homesickness: clamp(0.3 + (eff.homesickness ?? 0), 0, 1),
    gossipiness: 0,
  };
  const character = baseCharacter(
    id,
    {
      name: p.name,
      age: p.age,
      gender: p.gender,
      interestedIn: p.interestedIn,
      occupation: p.occupation,
      hometown: p.hometown,
      appearance: p.appearance,
      voiceNotes: `The player. ${E > 0.6 ? 'Outgoing' : 'Reserved'}, ${A > 0.6 ? 'warm' : 'direct'}.`,
      portraitSeed: p.portraitSeed ?? hashSeed(p.name) % 100000,
      contractEp: 99,
      persona,
    },
    { isPlayer: true, quirks: p.quirks },
  );
  character.appearanceText = p.appearanceText ?? '';
  if (p.spriteSeed !== undefined) character.spriteSeed = p.spriteSeed;
  if (p.spriteInstructions) character.spriteInstructions = p.spriteInstructions;
  return character;
}

/** What the player may change about their character mid-run (looks, job and background; not who they are underneath). */
export type PlayerEdit = Partial<Pick<PlayerSetup, 'name' | 'age' | 'hometown' | 'occupation' | 'interestedIn' | 'hobbies' | 'appearance' | 'appearanceText'>>;

export function editPlayer(s0: GameState, e: PlayerEdit): GameState {
  if (e.age !== undefined && (e.age < 20 || e.age > 35)) throw new Error('player age must be 20–35');
  if (e.name !== undefined && !e.name.trim()) throw new Error('your character needs a name');
  const s = structuredClone(s0);
  const c = s.characters[s.playerId];
  if (e.name !== undefined) c.name = e.name.trim();
  if (e.age !== undefined) c.age = e.age;
  if (e.hometown !== undefined) c.hometown = e.hometown;
  if (e.occupation !== undefined) c.occupation = e.occupation.trim() || c.occupation;
  if (e.interestedIn?.length) c.interestedIn = e.interestedIn;
  if (e.hobbies?.length) c.persona.routine.hobbies = (e.hobbies.length >= 3 ? e.hobbies : [...e.hobbies, 'reading', 'walks', 'music']).slice(0, 3);
  if (e.appearance) c.appearance = { ...e.appearance, palette: undefined }; // the portrait is redrawn, so its sampled colours are too
  if (e.appearanceText !== undefined) c.appearanceText = e.appearanceText;
  c.persona.backstory = `${c.name} is a ${c.occupation} from ${c.hometown} who moved into the share house.`;
  c.appearanceTags = compileAppearanceTags(c);
  return s;
}

export const DEFAULT_PLAYER: PlayerSetup = {
  name: 'Noa Barak',
  age: 24,
  gender: 'woman',
  interestedIn: ['man'],
  hometown: 'Haifa',
  occupation: 'graphic designer',
  traits: [0.6, 0.55, 0.55, 0.65, 0.45],
  quirks: ['foodie', 'night-owl', 'music-lover'],
  tastes: [0.3, 0.5, 0.2, 0.6, 0.3, 0.4],
  hobbies: ['sketching', 'karaoke', 'baking'],
  appearance: { hairStyle: 'shoulder-length bob', hairColor: 'dark brown', eyeColor: 'brown', build: 'average', outfit: 'oversized cardigan and jeans', accessory: 'none', skinTone: 'light' },
};
