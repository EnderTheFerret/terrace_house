// Game model: zod schemas + inferred types. Single source of truth for state shape.
import { z } from 'zod';

export const SCHEMA_VERSION = 1;

// ---------- primitives ----------
export const GENDERS = ['woman', 'man', 'nonbinary'] as const;
export const Gender = z.enum(GENDERS);
export type Gender = z.infer<typeof Gender>;

/** Big-Five: [openness, conscientiousness, extraversion, agreeableness, neuroticism] */
export const TraitVec = z.array(z.number().min(0).max(1)).length(5);
export type TraitVec = z.infer<typeof TraitVec>;
export const TRAIT_NAMES = ['openness', 'conscientiousness', 'extraversion', 'agreeableness', 'neuroticism'] as const;

/** Taste axes shared by recipes (intensity 0..1) and characters (preference -1..1). */
export const TASTE_AXES = ['salty', 'sweet', 'spicy', 'umami', 'rich', 'veggie'] as const;
export const TasteVec = z.array(z.number().min(-1).max(1)).length(TASTE_AXES.length);
export type TasteVec = z.infer<typeof TasteVec>;

export const NEEDS = ['energy', 'hunger', 'social', 'privacy', 'romance', 'achievement'] as const;
export type Need = (typeof NEEDS)[number];
export const NeedVec = z.object({
  energy: z.number(),
  hunger: z.number(),
  social: z.number(),
  privacy: z.number(),
  romance: z.number(),
  achievement: z.number(),
});
export type NeedVec = z.infer<typeof NeedVec>;

export const VALUES = ['honesty', 'loyalty', 'ambition', 'freedom', 'family', 'harmony', 'fun', 'security'] as const;
export const Value = z.enum(VALUES);
export type Value = z.infer<typeof Value>;

export const Attachment = z.enum(['secure', 'anxious', 'avoidant']);
export type Attachment = z.infer<typeof Attachment>;
export const ConflictStyle = z.enum(['confront', 'avoid', 'passive-aggressive', 'deflect-with-humor', 'mediate']);
export type ConflictStyle = z.infer<typeof ConflictStyle>;
export const Humor = z.enum(['dry', 'slapstick', 'self-deprecating', 'teasing', 'none']);
export type Humor = z.infer<typeof Humor>;

export const SLOTS = ['morning', 'slot1', 'slot2', 'slot3', 'evening', 'lateNight'] as const;
export const Slot = z.enum(SLOTS);
export type Slot = z.infer<typeof Slot>;

export const ROOMS = ['living', 'kitchen', 'backyard', 'smallBathroom', 'bathroom', 'bedroomW', 'bedroomM', 'balconyW', 'balconyM', 'entrance', 'stairs', 'stairsUp'] as const;
export type Room = (typeof ROOMS)[number];

export const WEATHERS = ['sunny', 'cloudy', 'rain', 'heatwave', 'typhoon', 'snow'] as const;
export const Weather = z.enum(WEATHERS);
export type Weather = z.infer<typeof Weather>;
export const SEASONS = ['spring', 'summer', 'autumn', 'winter'] as const;
export type Season = (typeof SEASONS)[number];

// ---------- persona ----------
export const Goal = z.object({
  id: z.string(),
  text: z.string(),
  kind: z.enum(['partner', 'career', 'audience', 'avoidDrama', 'honesty', 'marriage', 'exposure', 'savings', 'creative', 'friends']),
  targetPerson: z.string().optional(),
});
export type Goal = z.infer<typeof Goal>;

export const Speech = z.object({
  sentenceLen: z.object({ mean: z.number().min(2).max(30), sd: z.number().min(0).max(10) }),
  formality: z.number().min(0).max(1),
  fillers: z.array(z.string()).max(6),
  fillerRate: z.number().min(0).max(1),
  humor: Humor,
  catchphrase: z.object({ text: z.string(), maxRate: z.number().min(0).max(1) }).nullable(),
  trailing: z.enum(['none', 'ellipsis', 'exclaim', 'question']).default('none'),
  chat: z.object({
    stampRate: z.number().min(0).max(1),
    punctuation: z.enum(['none', 'normal', 'heavy']),
    replyLatency: z.enum(['instant', 'slow', 'erratic']),
    readIgnoreProb: z.number().min(0).max(1),
  }),
  exemplars: z.array(z.string()).length(3),
  doNot: z.array(z.string()).default([]),
  slang: z.array(z.string()).default([]),
});
export type Speech = z.infer<typeof Speech>;

export const Habit = z.object({ slot: Slot, action: z.string(), room: z.string().optional(), weekdaysOnly: z.boolean().optional() });
export const Routine = z.object({
  jobSlots: z.array(z.object({ slot: Slot, weekdays: z.array(z.number().int().min(0).max(6)) })),
  habits: z.array(Habit),
  hobbies: z.array(z.string()).length(3),
  tastes: TasteVec,
});
export type Routine = z.infer<typeof Routine>;

export const Persona = z.object({
  kashrut: z.enum(['strict', 'style', 'none']).default('none'),
  diet: z.enum(['omnivore', 'vegetarian', 'vegan']).default('omnivore'),
  keepsShabbat: z.boolean().default(false),
  traits: TraitVec,
  attachment: Attachment,
  conflictStyle: ConflictStyle,
  values: z.array(Value).min(3).max(8),
  needsProfile: NeedVec, // decay rates λ_k per slot
  goals: z.object({ long: Goal, short: Goal }),
  secret: z.object({ factId: z.string(), content: z.string(), exposureCost: z.number().min(0).max(1) }).nullable(),
  fears: z.array(z.string()),
  tells: z.array(z.string()),
  speech: Speech,
  routine: Routine,
  backstory: z.string().max(900),
  homesickness: z.number().min(0).max(1),
  gossipiness: z.number().min(0).max(1).default(0.3),
});
export type Persona = z.infer<typeof Persona>;

export const Appearance = z.object({
  palette: z.object({ hair: z.string().regex(/^#[0-9a-f]{6}$/i), skin: z.string().regex(/^#[0-9a-f]{6}$/i), outfit: z.string().regex(/^#[0-9a-f]{6}$/i) }).optional(),
  hairStyle: z.string(),
  hairColor: z.string(),
  eyeColor: z.string(),
  build: z.string(),
  outfit: z.string(),
  accessory: z.string(),
  skinTone: z.string(),
});
export type Appearance = z.infer<typeof Appearance>;

export const CharStatus = z.enum(['inHouse', 'left']);

export const Character = z.object({
  id: z.string(),
  name: z.string().min(1).max(40),
  age: z.number().int().min(20).max(80),
  gender: Gender,
  interestedIn: z.array(Gender),
  occupation: z.string(),
  hometown: z.string(),
  traits: TraitVec,
  tastes: TasteVec,
  appearance: Appearance,
  appearanceText: z.string().max(600).default(''),
  appearanceTags: z.array(z.string()),
  portraitSeed: z.number().int(),
  voiceNotes: z.string().max(200),
  persona: Persona,
  quirks: z.array(z.string()).default([]),
  mood: z.number().min(-1).max(1),
  moodBaseline: z.number().min(-1).max(1),
  energy: z.number().min(0).max(100),
  needs: NeedVec,
  status: CharStatus,
  isPlayer: z.boolean(),
  location: z.string(),
  arrivedEp: z.number().int(),
  leftEp: z.number().int().optional(),
  leftReason: z.string().optional(),
  contractEp: z.number().int(),
  archetypeId: z.string().optional(),
  lowMoodStreak: z.number().int().default(0),
  lastAction: z.string().optional(),
  activityUntil: z.number().default(0),
  actionTarget: z.string().optional(),
  actionNode: z.string().optional(),
  partnerId: z.string().optional(),
});
export type Character = z.infer<typeof Character>;

// ---------- relationships ----------
export const PairRel = z.object({
  affinity: z.number().min(-100).max(100),
  romance: z.number().min(0).max(100),
  tension: z.number().min(0).max(100),
  trust: z.number().min(0).max(100),
  /** shared time, raises conversation depth ceiling */
  closeness: z.number().min(0).max(100).default(0),
});
export type PairRel = z.infer<typeof PairRel>;
/** rel[i][j] directed i→j */
export const Relationships = z.record(z.string(), z.record(z.string(), PairRel));
export type Relationships = z.infer<typeof Relationships>;

// ---------- knowledge ----------
export const Fact = z.object({
  id: z.string(),
  subject: z.string(),
  about: z.string().optional(),
  kind: z.enum(['secret', 'romance', 'conflict', 'event', 'opinion', 'confession', 'couple', 'world']),
  content: z.string(),
  truth: z.boolean(),
  sensitivity: z.number().min(0).max(1),
  createdEp: z.number().int(),
  createdTick: z.number().int(),
  parentId: z.string().optional(),
});
export type Fact = z.infer<typeof Fact>;

export const KnowledgeSource = z.enum(['self', 'witnessed', 'told', 'rumor', 'overheard', 'groupchat']);
export type KnowledgeSource = z.infer<typeof KnowledgeSource>;
export const KnowledgeEntry = z.object({
  source: KnowledgeSource,
  from: z.string().optional(),
  confidence: z.number().min(0).max(1),
  learnedAt: z.number().int(),
});
export type KnowledgeEntry = z.infer<typeof KnowledgeEntry>;

/** observer's estimate of a→b feelings */
export const BeliefEntry = z.object({ affinity: z.number(), romance: z.number(), conf: z.number().min(0).max(1) });
export type BeliefEntry = z.infer<typeof BeliefEntry>;

// ---------- memory ----------
export const MemoryItem = z.object({
  episode: z.number().int(),
  tick: z.number().int(),
  text: z.string(),
  participants: z.array(z.string()),
  salience: z.number().min(0).max(1),
});
export type MemoryItem = z.infer<typeof MemoryItem>;

// ---------- house ----------
export const ChatMsg = z.object({
  from: z.string(),
  text: z.string(),
  tick: z.number().int(),
  stamp: z.string().optional(),
  readBy: z.array(z.string()).default([]),
  ignoredBy: z.array(z.string()).default([]),
});
export type ChatMsg = z.infer<typeof ChatMsg>;

export const HouseState = z.object({
  kitchen: z.object({ meatPanClean: z.boolean().default(true), dairyPanClean: z.boolean().default(true), kosherShelf: z.array(z.string()).default([]) }).default({ meatPanClean: true, dairyPanClean: true, kosherShelf: [] }),
  fridge: z.record(z.string(), z.number().int().min(0)),
  dishes: z.number().min(0).max(100),
  laundry: z.number().min(0).max(100),
  trash: z.number().min(0).max(100),
  noise: z.number().min(0).max(100),
  aircon: z.number(),
  choreRota: z.record(z.string(), z.string()),
  choreLedger: z.record(z.string(), z.object({ done: z.number(), skipped: z.number() })),
  labeledFood: z.array(z.object({ item: z.string(), owner: z.string(), eatenBy: z.string().optional() })),
  bathroomQueue: z.array(z.string()),
  rules: z.array(z.string()),
  groceryBudget: z.number(),
  groupChat: z.object({ members: z.array(z.string()), messages: z.array(ChatMsg) }),
  /** reputation[observer][subject] in [-100,100] */
  reputation: z.record(z.string(), z.record(z.string(), z.number())),
});
export type HouseState = z.infer<typeof HouseState>;

// ---------- world ----------
export const World = z.object({
  day: z.number().int(),
  episode: z.number().int().min(1),
  slot: Slot,
  /** minutes of the current block the player has used; the block ends at SLOT_MINUTES */
  minutes: z.number().int().default(0),
  tick: z.number().int(),
  weather: Weather,
  forecast: Weather.default('sunny'),
  weekday: z.number().int().min(0).max(6),
  season: z.enum(SEASONS),
  cityEvent: z.string().nullable(),
  money: z.number(),
  playerNode: z.string(),
  carUsedBy: z.string().nullable(),
  playerJob: z.object({ nodeId: z.string(), slot: Slot, weekdays: z.array(z.number()), wage: z.number() }).nullable(),
  flags: z.record(z.string(), z.union([z.number(), z.boolean(), z.string()])),
  typhoonDay: z.number().int(),
});
export type World = z.infer<typeof World>;

// ---------- panel ----------
export const PredictionCond = z.object({
  kind: z.enum(['confess', 'couple', 'leave', 'fight']),
  a: z.string(),
  b: z.string().optional(),
  byEpisode: z.number().int(),
});
export type PredictionCond = z.infer<typeof PredictionCond>;
export const Prediction = z.object({
  id: z.string(),
  by: z.string(),
  text: z.string(),
  madeEp: z.number().int(),
  condition: PredictionCond,
  resolved: z.boolean().nullable(),
  resolvedEp: z.number().int().optional(),
  calledBack: z.boolean().default(false),
});
export type Prediction = z.infer<typeof Prediction>;

// ---------- scenes ----------
export const BEAT_TYPES = [
  'open', 'smalltalk', 'probe', 'reveal', 'deflect', 'tease', 'flirt', 'conflict', 'comfort', 'silence',
  'interrupt', 'confess', 'accept', 'reject', 'apologize', 'joke', 'close',
] as const;
export const BeatType = z.enum(BEAT_TYPES);
export type BeatType = z.infer<typeof BeatType>;
export const EMOTIONS = ['neutral', 'happy', 'shy', 'awkward', 'annoyed', 'sad', 'excited', 'nervous', 'tender', 'angry'] as const;
export const Emotion = z.enum(EMOTIONS);
export type Emotion = z.infer<typeof Emotion>;
export const Depth = z.enum(['smalltalk', 'personal', 'vulnerable']);
export type Depth = z.infer<typeof Depth>;

export const Beat = z.object({
  speaker: z.string(),
  intent: z.string().max(120),
  emotion: Emotion,
  beatType: BeatType,
  subtext: z.string().max(160).default(''),
  depth: Depth.default('smalltalk'),
  topic: z.string().max(60).default('small talk'),
});
export type Beat = z.infer<typeof Beat>;
export const BeatSheet = z.object({ beats: z.array(Beat).min(2).max(8) });
export type BeatSheet = z.infer<typeof BeatSheet>;

export const INTENTS = ['honest', 'deflect', 'flirt', 'support', 'joke', 'tease', 'apologize', 'confront', 'confess', 'decline', 'listen'] as const;
export const Intent = z.enum(INTENTS);
export type Intent = z.infer<typeof Intent>;

const DirDelta = z.object({ from: z.string(), to: z.string(), delta: z.number() });
export const DeltaProposal = z.object({
  affinityDeltas: z.array(DirDelta).max(30).default([]),
  romanceDeltas: z.array(DirDelta).max(30).default([]),
  tensionDeltas: z.array(DirDelta).max(30).default([]),
  trustDeltas: z.array(DirDelta).max(30).default([]),
  newMemories: z.array(z.object({ charId: z.string(), text: z.string().max(200), salience: z.number().min(0).max(1) })).max(12).default([]),
  moodDeltas: z.array(z.object({ charId: z.string(), delta: z.number() })).max(12).default([]),
});
export type DeltaProposal = z.infer<typeof DeltaProposal>;

export const REACTIONS = ['laugh', 'gasp', 'cringe', 'aww', 'silence', 'groan'] as const;
export const Reaction = z.enum(REACTIONS);
export type Reaction = z.infer<typeof Reaction>;
export const Commentary = z.object({
  lines: z.array(z.object({ speaker: z.string(), text: z.string().max(240), reaction: Reaction })).min(1).max(8),
  freezeFrame: z.object({ caption: z.string().max(80) }).optional(),
  prediction: z.object({ text: z.string().max(160) }).optional(),
});
export type Commentary = z.infer<typeof Commentary>;

export const EventInstance = z.object({
  id: z.string(),
  templateId: z.string(),
  type: z.string(),
  title: z.string(),
  tags: z.array(z.string()),
  roles: z.record(z.string(), z.string()),
  participants: z.array(z.string()),
  location: z.string(),
  premise: z.string(),
  isPlayerScene: z.boolean(),
  playerPresent: z.boolean(),
  intents: z.array(Intent),
  factRefs: z.record(z.string(), z.array(z.string())),
  salience: z.number(),
  arcBeat: z.object({ charId: z.string(), beatId: z.string() }).optional(),
  outcomeKind: z.string().optional(),
  episode: z.number().int(),
  slot: Slot,
  tick: z.number().int(),
  depthCeiling: Depth,
  freeze: z.boolean().default(false),
});
export type EventInstance = z.infer<typeof EventInstance>;

export const LogEntry = z.object({
  tick: z.number().int(),
  episode: z.number().int(),
  slot: Slot,
  kind: z.enum(['scene', 'summary', 'gossip', 'departure', 'arrival', 'arc', 'prediction', 'system', 'chat', 'domestic', 'calendar', 'couple', 'confession']),
  text: z.string(),
  participants: z.array(z.string()),
  salience: z.number(),
  location: z.string().optional(),
  factId: z.string().optional(),
  templateId: z.string().optional(),
});
export type LogEntry = z.infer<typeof LogEntry>;

export const SharedRef = z.object({
  id: z.string(),
  kind: z.enum(['inside-joke', 'nickname', 'running-gag', 'promise']),
  text: z.string(),
  members: z.array(z.string()),
  createdEp: z.number().int(),
  uses: z.number().int().default(0),
});
export type SharedRef = z.infer<typeof SharedRef>;

export const Grudge = z.object({ strength: z.number(), since: z.number().int(), reason: z.string() });
export type Grudge = z.infer<typeof Grudge>;

export const ArcState = z.object({
  arcId: z.string(),
  act: z.number().int(),
  done: z.array(z.string()),
  pending: z.string().nullable(),
  outcome: z.string().optional(),
});
export type ArcState = z.infer<typeof ArcState>;

export const Couple = z.object({ a: z.string(), b: z.string(), since: z.number().int(), status: z.enum(['dating', 'left-together', 'broken']) });
export type Couple = z.infer<typeof Couple>;

export const Invitation = z.object({
  id: z.string(), from: z.string(), to: z.string(), episode: z.number().int(), slot: Slot, node: z.string(),
  status: z.enum(['pending', 'accepted', 'kept', 'broken', 'declined']),
});
export type Invitation = z.infer<typeof Invitation>;
export const FeedPost = z.object({
  id: z.string(), from: z.string(), text: z.string().max(200), with: z.string().optional(),
  kind: z.enum(['photo', 'story']).default('photo'), location: z.string().default('living'),
  people: z.array(z.object({ appearance: Appearance, gender: z.string(), seed: z.number().int() })).default([]),
  likes: z.array(z.string()), episode: z.number().int(), slot: Slot,
});
export type FeedPost = z.infer<typeof FeedPost>;

export const GameState = z.object({
  schemaVersion: z.number().int(),
  gameId: z.string(),
  seed: z.number().int(),
  rngState: z.number().int(),
  seasonLength: z.number().int(),
  playerId: z.string(),
  world: World,
  characters: z.record(z.string(), Character),
  rel: Relationships,
  /** beliefs[observer]["a>b"] = observer's estimate of a's feelings toward b */
  beliefs: z.record(z.string(), z.record(z.string(), BeliefEntry)),
  facts: z.record(z.string(), Fact),
  knowledge: z.record(z.string(), z.record(z.string(), KnowledgeEntry)),
  memory: z.record(z.string(), z.array(MemoryItem)),
  pairSummary: z.record(z.string(), z.string()),
  house: HouseState,
  chats: z.record(z.string(), z.array(ChatMsg)),
  predictions: z.array(Prediction),
  arcs: z.record(z.string(), ArcState),
  references: z.array(SharedRef),
  grudges: z.record(z.string(), Grudge),
  log: z.array(LogEntry),
  history: z.array(z.object({ templateId: z.string(), type: z.string(), tags: z.array(z.string()), episode: z.number(), tick: z.number() })),
  couples: z.array(Couple),
  budgets: z.object({ confessions: z.number(), farewells: z.number() }),
  recurring: z.record(z.string(), z.object({ metPlayer: z.number(), lastSeenEp: z.number() })),
  recentPlayerTargets: z.array(z.string()),
  seasonOver: z.boolean(),
  epilogues: z.record(z.string(), z.string()).optional(),
  counters: z.record(z.string(), z.number()),
  pendingArrivals: z.array(z.object({ gender: Gender, ep: z.number().int() })),
  previously: z.string().default(''),
  /** the player's character graduated; the game waits for the player's next housemate to move in */
  awaitingPlayer: z.boolean().default(false),
  finaleEpisode: z.number().int().nullable().default(null),
  invitations: z.array(Invitation).default([]),
  approaches: z.array(z.object({ id: z.string(), from: z.string(), text: z.string() })).default([]),
  feed: z.array(FeedPost).default([]),
  inventory: z.array(z.string()).default([]),
  observedRoutines: z.record(z.string(), z.array(z.string())).default({}),
  timeline: z.array(z.object({ episode: z.number().int(), slot: Slot, clock: z.string(), text: z.string() })).default([]),
});
export type GameState = z.infer<typeof GameState>;

// ---------- player actions ----------
export const PlayerAction = z.discriminatedUnion('type', [
  z.object({ type: z.literal('house'), activity: z.enum(['hangout', 'cook', 'tidy', 'rest', 'backyard', 'hobby']), target: z.string().optional() }),
  z.object({ type: z.literal('talk'), target: z.string() }),
  z.object({
    type: z.literal('goOut'),
    node: z.string(),
    activity: z.enum(['date', 'wander', 'work', 'shop', 'karaoke', 'eat', 'invite', 'gift']),
    item: z.string().max(60).optional(),
    invite: z.string().optional(),
    useCar: z.boolean().optional(),
    /** with activity 'work': sign a contract for this slot on fixed weekdays */
    contract: z.boolean().optional(),
  }),
  z.object({ type: z.literal('text'), target: z.string(), text: z.string().max(200).optional() }),
  z.object({ type: z.literal('idle') }),
  z.object({ type: z.literal('graduate'), with: z.string().optional() }),
  z.object({ type: z.literal('endSeason') }),
  z.object({ type: z.literal('skip') }),
  z.object({ type: z.literal('sleep') }),
  z.object({ type: z.literal('visit'), room: z.string(), invite: z.string().optional() }),
  z.object({ type: z.literal('plan'), target: z.string(), node: z.string(), episode: z.number().int().min(1), slot: Slot }),
  z.object({ type: z.literal('respondPlan'), id: z.string(), accept: z.boolean() }),
  z.object({ type: z.literal('approach'), id: z.string(), accept: z.boolean() }),
  z.object({ type: z.literal('gift'), target: z.string(), item: z.string().max(60) }),
  z.object({ type: z.literal('favor'), target: z.string(), kind: z.enum(['coffee', 'note']) }),
  z.object({ type: z.literal('post'), text: z.string().trim().min(1).max(200), kind: z.enum(['photo', 'story']).optional() }),
  z.object({ type: z.literal('like'), id: z.string() }),
]);
export type PlayerAction = z.infer<typeof PlayerAction>;

export const SceneResponse = z.enum(['join', 'eavesdrop', 'ignore']);
export type SceneResponse = z.infer<typeof SceneResponse>;
