// Schemas for content/*.json (validated at load time).
import { z } from 'zod';
import { Appearance, Gender, Intent, Persona, Slot, TasteVec, TraitVec, Value, Attachment, ConflictStyle, Humor } from './model';

/** Declarative precondition. Role names refer to event roles ("a", "b", "self", ...). */
export const Cond = z.object({
  weather: z.array(z.string()).optional(),
  season: z.array(z.string()).optional(),
  cityEvent: z.string().optional(),
  rel: z.enum(['affinity', 'romance', 'tension', 'trust', 'closeness']).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  asym: z.array(z.string()).length(2).optional(),
  house: z.enum(['dishes', 'laundry', 'trash', 'noise', 'fridgeTotal', 'groceryBudget', 'labeledEaten', 'bathroomQueue']).optional(),
  flag: z.string().optional(),
  is: z.union([z.boolean(), z.number(), z.string()]).optional(),
  notFlag: z.string().optional(),
  episodeMin: z.number().optional(),
  episodeMax: z.number().optional(),
  weekend: z.boolean().optional(),
  knowsSecretOf: z.array(z.string()).length(2).optional(),
  couple: z.array(z.string()).length(2).optional(),
  notCouple: z.array(z.string()).length(2).optional(),
  carFree: z.boolean().optional(),
  mood: z.string().optional(),
  chance: z.number().optional(),
  /** added to `chance` when role `a` is hungover (a rough morning makes a mishap likelier) */
  hungoverChance: z.number().optional(),
  lastDate: z.array(z.string()).length(2).optional(),
  /** romance ladder: the pair's current milestone (0 none, 1 first date, 2 second date, 3 hand-holding, 4 first kiss) equals `is` */
  milestone: z.array(z.string()).length(2).optional(),
  birthday: z.string().optional(),
  choreSkipper: z.string().optional(),
  newArrival: z.string().optional(),
  leaving: z.string().optional(),
  grudge: z.array(z.string()).length(2).optional(),
  knowsAbout: z.array(z.string()).length(2).optional(),
  typhoon: z.boolean().optional(),
  playerPresent: z.boolean().optional(),
  homesick: z.string().optional(),
  /** [eater, owner]: eater ate owner's labeled food */
  ateFoodOf: z.array(z.string()).length(2).optional(),
  needAbove: z.object({ role: z.string(), need: z.string(), value: z.number() }).optional(),
});
export type Cond = z.infer<typeof Cond>;

export const RoleSpec = z.object({
  gender: z.string().optional(), // 'woman' | 'man' | 'attractedTo:a' | 'sameAs:a'
  player: z.boolean().optional(),
  notPlayer: z.boolean().optional(),
  outsider: z.string().optional(), // recurring npc id (not a housemate)
});
export type RoleSpec = z.infer<typeof RoleSpec>;

const DeltaTriple = z.tuple([z.string(), z.string(), z.number()]);
export const DramaProfile = z.object({
  affinity: z.array(DeltaTriple).default([]),
  romance: z.array(DeltaTriple).default([]),
  tension: z.array(DeltaTriple).default([]),
  trust: z.array(DeltaTriple).default([]),
  mood: z.array(z.tuple([z.string(), z.number()])).default([]),
});
export type DramaProfile = z.infer<typeof DramaProfile>;

export const Effect = z.object({
  flag: z.string().optional(),
  value: z.union([z.boolean(), z.number(), z.string()]).optional(),
  revealSecretOf: z.string().optional(), // role whose secret becomes known to all participants
  couple: z.array(z.string()).length(2).optional(),
  leave: z.string().optional(), // role leaves (subject to leaveChance)
  leaveChance: z.number().optional(),
  leaveReason: z.string().optional(),
  money: z.number().optional(),
  house: z.record(z.string(), z.number()).optional(),
  fridge: z.record(z.string(), z.number()).optional(),
  reputation: z.object({ role: z.string(), delta: z.number() }).optional(),
  homesick: z.object({ role: z.string(), delta: z.number() }).optional(),
  reference: z.object({ kind: z.enum(['inside-joke', 'nickname', 'running-gag', 'promise']), text: z.string() }).optional(),
  fact: z.object({ subject: z.string(), about: z.string().optional(), kind: z.string(), content: z.string(), sensitivity: z.number() }).optional(),
  confession: z.array(z.string()).length(2).optional(), // [confessor, target] resolved by engine
  apology: z.array(z.string()).length(2).optional(),
  date: z.array(z.string()).length(2).optional(),
  /** the pair climbs one rung of the romance ladder (and the house can hear about it) */
  milestone: z.array(z.string()).length(2).optional(),
  groupChatKick: z.string().optional(),
});
export type Effect = z.infer<typeof Effect>;

export const EventTemplate = z.object({
  id: z.string(),
  type: z.string(),
  title: z.string(),
  tags: z.array(z.string()),
  slots: z.array(Slot),
  location: z.string(), // room id, 'city', 'player-node', 'phone', or city node type prefixed "type:"
  activity: z.array(z.string()).default([]),
  roles: z.record(z.string(), RoleSpec),
  pre: z.array(Cond).default([]),
  weight: z.number().default(1),
  drama: DramaProfile,
  beats: z.array(z.string()).min(3).max(9),
  intents: z.array(Intent).min(2).max(4),
  premise: z.string(),
  peak: z.boolean().default(false),
  freeze: z.boolean().default(false),
  arcOnly: z.boolean().default(false),
  requiresCar: z.boolean().default(false),
  npcOk: z.boolean().default(true),
  playerOnly: z.boolean().default(false),
  cost: z.number().default(0),
  effects: z.array(Effect).default([]),
  domestic: z.boolean().default(false),
  calendar: z.boolean().default(false),
  chat: z.boolean().default(false),
  /** system templates are only instantiated explicitly (interactions, fallbacks), never by director sampling */
  system: z.boolean().default(false),
});
export type EventTemplate = z.infer<typeof EventTemplate>;

export const CastEntry = z.object({
  id: z.string(),
  name: z.string(),
  age: z.number().int().min(20),
  gender: Gender,
  interestedIn: z.array(Gender),
  occupation: z.string(),
  hometown: z.string(),
  appearance: Appearance,
  voiceNotes: z.string().max(200),
  portraitSeed: z.number().int(),
  contractEp: z.number().int(),
  persona: Persona,
});
export type CastEntry = z.infer<typeof CastEntry>;

export const Archetype = z.object({
  kashrut: z.enum(['strict', 'style', 'none']).default('none'),
  diet: z.enum(['omnivore', 'vegetarian', 'vegan']).default('omnivore'),
  keepsShabbat: z.boolean().default(false),
  id: z.string(),
  label: z.string(),
  gender: Gender.optional(),
  occupations: z.array(z.string()).min(1),
  traits: TraitVec,
  attachment: Attachment,
  conflictStyle: ConflictStyle,
  humor: Humor,
  values: z.array(Value).min(3),
  formality: z.number(),
  sentenceLen: z.number(),
  fillers: z.array(z.string()),
  fillerRate: z.number(),
  trailing: z.enum(['none', 'ellipsis', 'exclaim', 'question']),
  slang: z.array(z.string()).default([]),
  catchphrases: z.array(z.string()),
  exemplars: z.array(z.string()).length(3),
  goals: z.array(z.object({ text: z.string(), kind: z.string() })).min(2),
  secrets: z.array(z.string()).min(1),
  fears: z.array(z.string()).min(1),
  tells: z.array(z.string()).min(1),
  hobbies: z.array(z.string()).min(3),
  tastes: TasteVec,
  arcTemplate: z.string(),
  voiceNotes: z.string(),
  gossipiness: z.number(),
});
export type Archetype = z.infer<typeof Archetype>;

export const Job = z.object({
  title: z.string(),
  /** city node id, or "house" (works from their room) */
  place: z.string(),
  shift: z.enum(['early', 'day', 'late', 'night', 'flex']),
  days: z.enum(['weekdays', 'weekends', 'mixed']),
  category: z.string(),
});
export type Job = z.infer<typeof Job>;

export const ArcBeat = z.object({
  id: z.string(),
  act: z.number().int().min(1).max(3),
  event: z.string(), // event template id (arcOnly)
  pre: z.array(Cond).default([]),
  outcomes: z.array(z.string()).optional(),
});
export const Arc = z.object({
  category: z.string().optional(),
  id: z.string(),
  charId: z.string().optional(), // default cast id
  template: z.string().optional(), // archetype arc template id
  title: z.string(),
  beats: z.array(ArcBeat).min(3),
});
export type Arc = z.infer<typeof Arc>;

export const Panelist = z.object({
  id: z.string(),
  name: z.string(),
  role: z.string(),
  persona: z.string(),
  style: z.enum(['dry', 'comic', 'romantic', 'earnest', 'cutting']),
  favorites: z.array(z.string()),
  petPeeves: z.array(z.string()),
  avatarSeed: z.number().int(),
  appearance: z.string(),
  lines: z.record(z.string(), z.array(z.string())),
});
export type Panelist = z.infer<typeof Panelist>;

export const RecurringNpc = z.object({
  id: z.string(),
  name: z.string(),
  role: z.string(),
  traits: z.array(z.string()).min(1).max(2),
  location: z.string(),
  schedule: z.object({ weekdays: z.array(z.number()), slots: z.array(Slot) }),
  linkedTo: z.string().optional(),
  lines: z.array(z.string()).min(2),
  returningLines: z.array(z.string()).min(1),
});
export type RecurringNpc = z.infer<typeof RecurringNpc>;

export const CityNode = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  district: z.string(),
  x: z.number(),
  y: z.number(),
  open: z.tuple([z.number(), z.number()]), // hours [from, to) 0-24 (to may be >24)
  openDays: z.record(z.string(), z.tuple([z.number(), z.number()])).optional(),
  activities: z.array(z.string()),
  cost: z.number().default(0),
  romantic: z.number().default(0),
  description: z.string(),
});
export type CityNode = z.infer<typeof CityNode>;
export const CityEdge = z.object({ a: z.string(), b: z.string(), minutes: z.number(), requiresCar: z.boolean().default(false) });
export const City = z.object({
  districts: z.array(z.object({ id: z.string(), name: z.string(), color: z.string() })),
  nodes: z.array(CityNode).min(14),
  edges: z.array(CityEdge),
  home: z.string(),
});
export type City = z.infer<typeof City>;

export const RecipeStep = z.object({
  id: z.string(),
  type: z.enum(['chop', 'boil', 'saute', 'season', 'plate']),
  label: z.string(),
  deps: z.array(z.string()),
  params: z.record(z.string(), z.any()),
  weight: z.number().default(1),
  seconds: z.number(),
});
export type RecipeStep = z.infer<typeof RecipeStep>;
export const Recipe = z.object({
  category: z.enum(['meat', 'dairy', 'parve']).default('parve'),
  kosher: z.boolean().default(true),
  diet: z.enum(['omnivore', 'vegetarian', 'vegan']).default('omnivore'),
  id: z.string(),
  name: z.string(),
  description: z.string(),
  ingredients: z.record(z.string(), z.number()),
  taste: z.array(z.number().min(0).max(1)).length(6),
  timeBudget: z.number(),
  steps: z.array(RecipeStep).min(3),
  serves: z.number().int(),
  difficulty: z.number().min(1).max(5),
});
export type Recipe = z.infer<typeof Recipe>;

export const HouseContent = z.object({
  width: z.number().int(),
  height: z.number().int(),
  rooms: z.array(
    z.object({ id: z.string(), name: z.string(), x: z.number(), y: z.number(), w: z.number(), h: z.number(), floor: z.number().int().default(0), material: z.string().default('wood'), private: z.boolean().default(false), spots: z.array(z.tuple([z.number(), z.number()])) }),
  ),
  doors: z.array(z.tuple([z.number(), z.number(), z.number().int()])),
  furniture: z.array(z.object({ type: z.string(), x: z.number(), y: z.number(), floor: z.number().int().default(0), w: z.number().default(1), h: z.number().default(1), solid: z.boolean().default(true), dir: z.enum(['up', 'down', 'left', 'right']).optional(), seats: z.number().int().min(1).max(6).optional() })),
  hotspots: z.array(z.object({ id: z.string(), label: z.string(), x: z.number(), y: z.number(), floor: z.number().int().default(0), action: z.string() })),
  ingredients: z.array(z.object({ id: z.string(), name: z.string(), price: z.number() })),
  startFridge: z.record(z.string(), z.number()),
  chores: z.array(z.string()),
  rules: z.array(z.string()),
  startGroceryBudget: z.number(),
});
export type HouseContent = z.infer<typeof HouseContent>;

export const Quirk = z.object({ id: z.string(), label: z.string(), effect: z.record(z.string(), z.any()).default({}) });
export const Quirks = z.object({ quirks: z.array(Quirk).min(9) });
export type Quirk = z.infer<typeof Quirk>;

export const CalendarEvent = z.object({ id: z.string(), name: z.string(), month: z.number(), dayFrom: z.number(), dayTo: z.number(), node: z.string().optional(), eventTemplate: z.string() });
export type CalendarEvent = z.infer<typeof CalendarEvent>;
