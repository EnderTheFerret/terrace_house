// GameSession: owns the live GameState, runs slots and scenes, logs replayable events, autosaves.
// Only engine functions touch state.rngState, in a fixed order that scripts/replay.ts reproduces.
import type { Recall } from '../llm/recall';
import {
  PlayerAction, SceneResponse, Intent as IntentSchema, autoChoices, captionFor, confessionPreview, createGame, finishSlot, firstName, guestCharacter,
  FEELING_SCALE, knows, applyReread, rereadChange, sanitizeProposal, hasFeelingDeltas, panelPrediction, planSlot, planMoveInArrival, planHouseMeal, welcomeDinnerDue, predictionText, projectForPlayer, proposeOutcome, recordCommentary, resolveScene, content, placeName,
   type Commentary, type DeltaProposal, type Footage, type SceneChoices, type EventInstance, type GameState, type Intent, type LineContext, type NewGameOptions, type PlannedScene, airedBroadcast, BROADCAST_DAYS, broadcastDays, broadcastHighlights, broadcastPanel, beginBroadcast,
   type PlayerEdit, type PlayerSetup, type PredictionCond, type Emotion, type Beat, type ArtworkEdit, classifyIntent, debugEdit, type DebugEdit, debugPlan, type DebugPlan, lineEmotion, orderDrinks, venueDrinks, editPlayer, inviteDecision, joinNewPlayer, recordChat, recordPlayerWords, replyBeatType,
   passTime, recordDiary, reactionTo, feltEmotion, blockOver, isShabbat, SLOT_START, MINUTES_PER_LINE, occasionFor, occasionForCharacter, outfitFor, typedResponders, queueNpcPlans, SLOT_MINUTES, recordConversation, makeEvent, respondToPlan,
   addTalkPlan, declineTalkPlan, planDecision, planProblem, planWhen, proposedPlan, TYPED_MAX, applyPlanRead, planConflict, dropUnattracted, welcomedFlirts, askBack, nameMemories, followUpsDue, followUpTemplate, sendFollowUp, todaysMessages, weatherRefusal, proposedOuting, favorDecision, queueFavor, refusalBrief, proposedFavor, readyReports, reportBeats, tellMissions, type Favor,
} from '@shared-roof/shared';
import { z } from 'zod';
import type { Store } from '../db';
import { Budget, logTrace } from '../llm/structured';
import { Generator, speakerName, type Line } from './generate';
import type { ImageQueue } from '../image/queue';
import { PRIORITY } from '../image/queue';
import { freezeRequest, locationRequest, portraitRequest, outfitPortraitRequest } from '../image/requests';
import { config } from '../config';
import { applyCharacterSnapshot, enrichCharacter } from './personas';
import { OVERHEARD_TYPES } from '../prompts/studio';
import { decideActivities } from './autonomy';

export type Emit = (event: string, data: unknown) => void;

/** SEASON_LENGTH=0: the house never closes; housemates keep rotating. */
const REPLY_EMOTION: Partial<Record<Intent, Emotion>> = { flirt: 'shy', confront: 'annoyed', apologize: 'tender', support: 'tender', joke: 'happy', tease: 'happy', confess: 'nervous', decline: 'sad', listen: 'tender' };
const ChoiceSchema = z.object({ intent: IntentSchema.optional(), text: z.string().trim().min(1).max(TYPED_MAX).optional(), recipient: z.string().min(1).max(80).optional(), retry: z.boolean().optional(), edit: z.boolean().optional(), done: z.boolean().optional(), listen: z.boolean().optional(), hangout: z.boolean().optional(), via: z.enum(['button', 'key', 'typed', 'invite']).optional(), invite: z.object({ node: z.string(), date: z.boolean().optional(), with: z.string().optional() }).optional(), favor: z.object({ kind: z.enum(['match', 'snoop']), a: z.string(), b: z.string(), with: z.string().optional() }).optional() });
/** How many times the player can stay quiet and let a group keep talking in one scene. */
const MAX_LISTENS = 3;
/** A model's relationship reading made safe: clamped, romance only with attraction, real names in memories, welcomed flirts counted. */
const cleanReading = (s: GameState, raw: unknown, participants: string[], transcript: Line[]) =>
  welcomedFlirts(s, transcript, nameMemories(s, dropUnattracted(s, sanitizeProposal(raw, participants))));
/** Words that might settle, move or call off a plan; only then is the model asked to read the calendar off the talk. */
const PLAN_TALK = /\d|\b(?:tonight|tomorrow|today|later|morning|afternoon|evening|weekend|\w+day|see you|meet|come|coming|join|plans?|cancel|can'?t make it|rain ?check|another time|works)\b/i;

type Phase = 'new' | 'awaiting-response' | 'awaiting-choice' | 'reply' | 'retry' | 'edit' | 'listen' | 'post' | 'done';

interface SceneRun {
  id: string;
  planned: PlannedScene;
  ev: EventInstance;
  phase: Phase;
  response?: SceneResponse;
  beats?: Awaited<ReturnType<Generator['beatSheet']>>['beats'];
  choiceIndex: number;
  transcript: Line[];
  playerIntent?: Intent;
  /** the intent button the player actually picked (typed words set playerIntent only) */
  chosenIntent?: Intent;
  ctx: LineContext;
  result?: { confession?: string; leaving?: string[]; secretRevealed?: string; noticed?: boolean };
  commentary?: Commentary;
  freeze?: { caption: string; image?: string };
  rendered: boolean;
  /** what the player said in this scene, in order */
  said: string[];
  /** typed words waiting for a reply (phase 'reply') */
  pendingText?: string;
  pendingIntent?: Intent;
  pendingRecipient?: string;
  /** the player asked a housemate to come along somewhere; the answer is decided from how they feel (phase 'reply') */
  pendingInvite?: { node: string; date: boolean; target: string };
  /** the player asked a close housemate to play matchmaker or snoop around; the helper decides from closeness and personality (phase 'reply') */
  pendingFavor?: Favor & { helper: string };
  /** rounds the player stayed quiet and let the housemates talk among themselves */
  listened?: number;
  endedByPlayer?: boolean;
  /** a phone message typed before the scene started */
  openingText?: string;
  playerStarts?: boolean;
  phoneClosed?: boolean;
  /** memories recalled by meaning per speaker: they stay in that speaker's prompt for the rest of the scene */
  recalled?: Record<string, string[]>;
  timedLines?: number;
  interrupted?: boolean;
  retry?: { start: number; beats: Beat[]; intents: (Intent | undefined)[]; ctx: LineContext; replyTo?: { text: string; intent: Intent } };
  /** the player's last typed line (transcript index) can be reworded, but only when it changed nothing outside the talk (no plan, favor, invitation or drink) */
  edit?: { at: number; recipient?: string; ctx: LineContext };
}

export interface SceneSummary {
  id: string;
  title: string;
  premise: string;
  location: string;
  locationName: string;
  participants: string[];
  isPlayerScene: boolean;
  visible: boolean;
  rendered: boolean;
  phase: Phase;
  arc: boolean;
  chat: boolean;
}

export class GameSession {
  state: GameState | null = null;
  runs = new Map<string, SceneRun>();
  /** Outfits the player picked in the scene artwork editor; scene CGs draw them instead of the occasion's clothes. */
  outfitOverrides: Record<string, string> = {};
  order: string[] = [];
  budget = new Budget(config.llmCallsPerSlot);
  digestSince = 0;
  lastEpisodeShown = 0;
  logSeq = 0;
  busy = false;
  intermissionSince = 0;
  /** event-log seq the panel last talked over; scenes and overheard talk after it are fresh footage */
  private footageSeq = 0;
  pendingIntermission: 'mid' | 'end' | null = null;
  budgetBlock = '';
  private interruptedTalk?: { participants: string[]; transcript: Line[] };
  private intermissionResult?: Promise<{ at: 'mid' | 'end'; lines: Commentary['lines']; source: 'llm' | 'mock' }>;
  private lastWorldPulse = 0;
  private readingEpoch = 0;
  private readings = new Map<string, { apply?: () => void }>();

  private flushReadings() {
    if (this.busy) return;
    for (const [id, reading] of this.readings) if (reading.apply) {
      this.readings.delete(id);
      reading.apply();
    }
  }

  /**
   * Let the model read what two people settled in words ("9:30 works, see you then") and bring the calendar in line:
   * add, move, accept or call off their plan. `force` skips the cheap keyword gate (an explicit re-read).
   */
  private async readPlans(a: string, b: string, lines: { speaker: string; text: string }[], force = false) {
    const talk = lines.filter((l) => l.speaker !== 'narrator' && l.text);
    if (!force && !talk.slice(-2).some((l) => PLAN_TALK.test(l.text))) return false;
    const s = this.requireState();
    const read = await this.gen.planRead(s, a, b, talk);
    const other = a === s.playerId ? b : a;
    if (!read || (read.plan && planConflict(this.requireState(), other, read.plan, s.playerId))) return false;
    const next = applyPlanRead(this.requireState(), a, b, read);
    if (next === this.state) return false;
    this.state = next;
    this.log('plan-read', { a, b, read });
    return true;
  }

  /** Close the talk first; only its net relationship correction lands on the current state. */
  private async readPlayerTalk(snapshot: GameState, run: SceneRun, choices: SceneChoices, applied: DeltaProposal) {
    const epoch = this.readingEpoch;
    const reading: { apply?: () => void } = {};
    this.readings.set(run.id, reading);
    const release = this.images.hold();
    let proposal: DeltaProposal | null = null;
    try {
      const raw = await this.gen.deltas(snapshot, run.ev, run.transcript, choices, new Budget(2));
      if (raw) {
        const read = cleanReading(snapshot, raw, run.ev.participants, run.transcript);
        if (hasFeelingDeltas(read)) proposal = read;
      }
    } catch (e) {
      logTrace('reading-failed', { id: run.id, error: (e as Error).message });
    } finally { release(); }
    if (epoch !== this.readingEpoch || this.state?.gameId !== snapshot.gameId) return;
    const next = proposal;
    reading.apply = () => {
      const change = next ? rereadChange(next, applied, FEELING_SCALE) : undefined;
      if (change) applyReread(this.requireState(), run.id, change, run.ev.participants, false);
      this.log('reading', { id: run.id, participants: run.ev.participants, proposal: next ?? applied, change, boardChange: change, status: next ? 'applied' : 'fallback' });
      this.autosave();
    };
    this.flushReadings();
  }

  private async prepareActivities(through: number, protectedIds: string[] = []) {
    const s = this.requireState();
    const result = await decideActivities(this.gen.llm, s, Math.min(SLOT_MINUTES, through), protectedIds);
    if (!Object.keys(result.plans).length) return;
    queueNpcPlans(s, result.plans);
    this.log('autonomy', result);
  }

  async worldPulse(now = Date.now()) {
    const s = this.requireState();
    if (this.busy || s.seasonOver || s.awaitingPlayer || blockOver(s) ||
      now - this.lastWorldPulse < 20000 || this.order.some(id => this.runs.get(id)!.phase !== 'done'))
      return { view: this.view(), scenes: this.summaries() };
    this.lastWorldPulse = now;
    this.busy = true;
    const release = this.images.hold();
    try {
      await this.prepareActivities(s.world.minutes + 5);
      this.state = passTime(s, 1, [], 5);
      this.log('time', { lines: 1, protectedIds: [], minutesPerLine: 5 });
      const arrival = planMoveInArrival(this.state);
      if (arrival.plan.scenes.length) {
        this.state = arrival.state;
        this.log('move-in', {});
        for (const planned of arrival.plan.scenes) {
          const ev = planned.event;
          this.runs.set(ev.id, { id: ev.id, planned, ev, phase: 'new', choiceIndex: -1, transcript: [], ctx: { place: placeName(ev.location), catchphraseUses: {}, lineCounts: {} }, rendered: true, said: [] });
          this.order.push(ev.id);
          this.images.request(locationRequest(ev.location, ev.slot, this.state.world.weather), PRIORITY.currentScene);
        }
        await this.enrichNewCharacters(Object.keys(s.characters).filter(id => s.characters[id].status === 'inHouse'));
      }
      this.queueHouseMeal();
      this.autosave();
      return { view: this.view(), scenes: this.summaries() };
    } finally { release(); this.busy = false; this.flushReadings(); }
  }

  /** a recalled memory cools down for a few episodes after its scene, so the same callback isn't in every talk */
  private recallCooldown = new Map<string, number>();

  constructor(
    public store: Store,
    public gen: Generator,
    public images: ImageQueue,
    public recall: Recall | null = null,
  ) {}

  /** Add memories recalled by meaning for each upcoming speaker (embeddings; no-op without the model). */
  private async recallFor(run: SceneRun, speakers: string[], replyTo?: string) {
    if (!this.recall) return;
    const s = this.requireState();
    const query = [...run.transcript.slice(-2).map((l) => l.text), replyTo ?? ''].join(' ').trim() || run.ev.premise;
    for (const id of new Set(speakers)) {
      if (!s.characters[id] || s.characters[id].isPlayer) continue;
      const have = new Set(run.recalled?.[id] ?? []);
      const cooling = new Set([...this.recallCooldown].filter(([k, until]) => k.startsWith(`${id}\n`) && until > s.world.tick).map(([k]) => k.slice(id.length + 1)));
      const found = await this.recall.recallFor(s, id, query, new Set([...have, ...cooling]));
      if (found.length) ((run.recalled ??= {})[id] = [...have, ...found].slice(-4));
    }
  }

  private requireState(): GameState {
    if (!this.state) throw new Error('no game in progress');
    return this.state;
  }

  private log(kind: string, payload: unknown) {
    const s = this.requireState();
    this.logSeq = this.store.appendEvent(s.gameId, kind, payload);
  }

  view() {
    const s = this.requireState();
    return projectForPlayer(s, this.digestSince);
  }

  async newGame(o: { seed?: number; player?: PlayerSetup; randomizeCast?: boolean; seasonLength?: number; moveInDay?: boolean }) {
    if (this.busy) throw new Error('generation is running');
    this.readingEpoch++;
    this.readings.clear();
    const seed = o.seed ?? (config.seed ? Number(config.seed) : Math.floor(Math.random() * 2 ** 31));
    const gameId = `g${Date.now().toString(36)}${seed.toString(36)}`;
    const opts: NewGameOptions = { seed, player: o.player, randomizeCast: o.randomizeCast, seasonLength: o.seasonLength ?? config.seasonLength, gameId, moveInDay: o.moveInDay ?? true, moveInVersion: 2, communalMeals: true };
    this.state = createGame(opts);
    this.interruptedTalk = undefined;
    this.runs.clear();
    this.order = [];
    this.store.truncateEvents(gameId, 0);
    this.logSeq = 0;
    this.log('new', opts);
    this.budgetBlock = '';
    await this.enrichNewCharacters([]);
    this.digestSince = 0;
    this.intermissionSince = 0;
    this.footageSeq = this.logSeq;
    this.pendingIntermission = null;
    this.intermissionResult = undefined;
    this.lastEpisodeShown = 0;
    this.prefetchPortraits();
    this.autosave();
    return this.view();
  }

  /** After the player's character graduates, their next character moves in. */
  newPlayer(setup: PlayerSetup) {
    if (this.busy) throw new Error('generation is running');
    const s = this.requireState();
    // three men and three women: whoever moves in takes the graduate's place
    const old = s.characters[s.playerId];
    if (setup.gender !== old.gender) throw new Error(`your next housemate takes ${old.name}'s place, so they must be a ${old.gender}`);
    this.state = joinNewPlayer(s, setup);
    this.log('new-player', { setup });
    this.digestSince = this.state.world.tick;
    this.prefetchPortraits();
    this.autosave();
    return this.view();
  }

  load(saveId: number) {
    if (this.busy) throw new Error('generation is running');
    const r = this.store.load(saveId);
    if (!r) throw new Error('save not found');
    this.readingEpoch++;
    this.readings.clear();
    this.state = r.state;
    this.logSeq = r.row.log_seq;
    this.store.truncateEvents(r.state.gameId, r.row.log_seq); // continuing from a save branches the log
    this.runs.clear();
    this.order = [];
    this.restoreScenes(r.resume);
    this.digestSince = r.state.world.tick;
    this.intermissionSince = r.state.world.tick;
    this.footageSeq = this.logSeq;
    this.pendingIntermission = null;
    this.intermissionResult = undefined;
    this.budgetBlock = '';
    this.enableSavedMeals(r.resume);
    this.prefetchPortraits();
    return this.view();
  }

  resumeLatest(): boolean {
    const r = this.store.latestAutosave();
    if (!r) return false;
    this.readingEpoch++;
    this.readings.clear();
    this.state = r.state;
    this.runs.clear();
    this.order = [];
    this.logSeq = r.row.log_seq;
    this.restoreScenes(r.resume);
    this.digestSince = r.state.world.tick;
    this.intermissionSince = r.state.world.tick;
    this.footageSeq = this.logSeq;
    if (this.state.world.flags.communalMeals !== true && !this.state.seasonOver) {
      this.store.truncateEvents(r.state.gameId, r.row.log_seq);
      this.enableSavedMeals(r.resume);
    }
    return true;
  }

  private enableSavedMeals(resume?: unknown) {
    const s = this.requireState();
    if (s.world.flags.communalMeals === true || s.seasonOver) return;
    s.world.flags.communalMeals = true;
    this.log('meal-routines', {});
    this.store.save(0, s, `autosave · ep ${s.world.episode} ${s.world.slot}`, this.logSeq, resume);
  }

  private savedScenes() {
    const scenes = this.order.map(id => this.runs.get(id)!).filter(run => run.phase !== 'done');
    return scenes.length || this.interruptedTalk ? { scenes, interruptedTalk: this.interruptedTalk } : undefined;
  }

  private restoreScenes(resume?: { scenes?: SceneRun[]; interruptedTalk?: GameSession['interruptedTalk']; participants?: string[]; transcript?: Line[] }) {
    this.interruptedTalk = resume?.interruptedTalk;
    let scenes = resume?.scenes ?? [];
    // Older saves retained only the last twelve lines, without the original scene state.
    if (!resume?.scenes && resume?.participants?.length && resume.transcript?.length) {
      const s = this.requireState();
      const target = resume.participants.find(id => id !== s.playerId && s.characters[id]);
      if (target) {
        const ev = makeEvent(structuredClone(s), content().eventById.get('casual-chat')!, { a: s.playerId, b: target }, s.characters[s.playerId].location,
          { id: `resume:${s.gameId}:${this.logSeq}`, participants: resume.participants, title: 'continuing your conversation' });
        scenes = [{ id: ev.id, ev, planned: { event: ev, render: true, visible: false, priority: 3 }, phase: 'awaiting-choice', choiceIndex: -1, beats: [], transcript: resume.transcript,
          timedLines: resume.transcript.length, said: resume.transcript.filter(l => l.speaker === s.playerId).map(l => l.text), rendered: true, ctx: { place: placeName(ev.location), catchphraseUses: {}, lineCounts: {} } }];
      }
    }
    for (const run of scenes) {
      this.runs.set(run.id, run);
      this.order.push(run.id);
    }
    this.budget = new Budget(config.llmCallsPerScene);
  }

  /** Saves keep the pending scene queue, transcript and response controls. */
  save(slot: number, name?: string) {
    if (this.busy) throw new Error('wait for the current line to finish, then save');
    const s = this.requireState();
    const resume = this.savedScenes();
    return this.store.save(slot, s, name ?? `Episode ${s.world.episode} · ${s.world.slot}${resume ? ' · mid-conversation' : ''}`, this.logSeq, resume);
  }

  autosave() {
    const s = this.requireState();
    this.store.save(0, s, `autosave · ep ${s.world.episode} ${s.world.slot}`, this.logSeq, this.savedScenes());
  }

  prefetchPortraits() {
    const s = this.requireState();
    for (const c of Object.values(s.characters)) if (c.status === 'inHouse') this.images.request(portraitRequest(c), c.isPlayer ? PRIORITY.playerPortrait : c.location === s.characters[s.playerId].location ? PRIORITY.currentSprite : PRIORITY.prefetch);
  }

  setAppearancePalette(b: { id: string; portraitSeed: number; palette: { hair: string; skin: string; outfit: string } }) {
    const c = this.requireState().characters[b.id];
    if (!c || c.portraitSeed !== b.portraitSeed) return false;
    if (JSON.stringify(c.appearance.palette) === JSON.stringify(b.palette)) return true;
    c.appearance.palette = b.palette;
    this.log('appearance-palette', b);
    if (!this.busy && !this.order.some(id => this.runs.get(id)!.phase !== 'done')) this.autosave();
    return true;
  }

  /** Change the player's looks, job or background at any time (not mid-conversation); new portraits draw on demand. */
  editPlayer(edit: PlayerEdit) {
    if (this.busy || this.order.some(id => this.runs.get(id)!.phase !== 'done')) throw new Error('Finish the current conversation before editing your character.');
    this.state = editPlayer(this.requireState(), edit);
    this.log('edit-player', { edit });
    this.autosave();
    return this.view();
  }

  /** Author debug: move a character or tweak their state; not mid-conversation. */
  debugEdit(edit: DebugEdit) {
    if (this.busy || this.order.some(id => this.runs.get(id)!.phase !== 'done')) throw new Error('Finish the current conversation first.');
    this.state = debugEdit(this.requireState(), edit);
    this.log('debug-edit', { edit });
    this.autosave();
    return this.view();
  }

  /** Author debug: delete or re-date a calendar plan. */
  debugPlan(edit: DebugPlan) {
    if (this.busy) throw new Error('generation is running');
    this.state = debugPlan(this.requireState(), edit);
    this.log('debug-plan', { edit });
    this.autosave();
    return this.view();
  }

  // ------------------------------------------------------------ slots
  setArtwork(id: string, edit: ArtworkEdit) {
    if (this.busy || this.order.some(id => this.runs.get(id)!.phase !== 'done')) throw new Error('Finish the current conversation before editing sprites.');
    const c = this.requireState().characters[id];
    if (!c) throw new Error('unknown character');
    if (edit.kind === 'walk') {
      c.spriteSeed = edit.seed;
      c.spriteInstructions = edit.instructions;
    } else {
      c.expressionEdits = { ...c.expressionEdits, [edit.emotion!]: { seed: edit.seed, instructions: edit.instructions } };
    }
    this.log('artwork-edit', { id, edit });
    this.autosave();
    return this.view();
  }

  async act(raw: unknown) {
    if (this.busy) throw new Error('generation is running');
    this.busy = true;
    try { return await this.actUnlocked(raw); }
    finally { this.busy = false; this.flushReadings(); }
  }

  async retryText(target: string) {
    if (this.busy) throw new Error('generation is running');
    const s = this.requireState();
    const key = [s.playerId, target].sort().join('|');
    const thread = s.chats[key];
    const index = (thread?.length ?? 0) - 1;
    if (!thread || thread[index]?.from !== target || thread[index - 1]?.from !== s.playerId) throw new Error('no reply available to retry');
    this.busy = true;
    const release = this.images.hold();
    try {
      const snapshot = structuredClone(s);
      snapshot.chats[key].pop();
      const text = await this.gen.chat(snapshot, target, s.playerId, new Budget(1));
      if (!text) throw new Error('reply unavailable');
      thread[index].text = text;
      this.log('chat-retry', { key, index, text });
      this.autosave();
      return { view: this.view() };
    } finally { this.busy = false; release(); }
  }

  private async actUnlocked(raw: unknown) {
    const s = this.requireState();
    if (s.seasonOver) throw new Error('season is over');
    if (s.awaitingPlayer) throw new Error('your next housemate has to move in first');
    const parsed = PlayerAction.parse(raw);
    // a plan from the phone's plans tab is sent as a text too: the housemate answers it in the thread, and the same reply decides the calendar
    const asked = parsed.type === 'plan' ? { node: parsed.node, episode: parsed.episode, slot: parsed.slot, ...(parsed.date ? { date: true as const } : {}) } : null;
    if (parsed.type === 'plan') {
      const why = planProblem(s, parsed);
      if (why) throw new Error(why);
    }
    const action: PlayerAction = parsed.type === 'plan' && asked
      ? { type: 'text', target: parsed.target, text: `${parsed.date ? 'Would you like to go on a date to' : 'Want to hang out at'} ${placeName(asked.node)} ${planWhen(s, asked)}?` }
      : parsed;
    if (action.type === 'respondPlan') {
      this.state = respondToPlan(s, action);
      this.log('plan-response', { action });
      this.autosave();
      return { view: this.view(), scenes: this.summaries() };
    }
    if (action.type === 'askBack') {
      this.state = askBack(s, action.target);
      this.log('ask-back', { target: action.target });
      this.autosave();
      return { view: this.view(), scenes: this.summaries() };
    }
    if (action.type === 'text') {
      const state = planSlot(s, action).state;
      const text = action.text?.trim() || 'hey, are you free?';
      const a = state.playerId;
      const recipients = [action.target, ...(action.guests ?? [])];
      const later = asked ?? proposedPlan(state, text, recipients);
      // a group plan: every invitee decides for themselves, and each one who agrees gets a calendar entry with the player
      const answers = new Map<string, { lines: { speaker: string; text: string }[]; verdict?: ReturnType<typeof planDecision> }>();
      const release = this.images.hold();
      try {
        await Promise.all(recipients.map(async (b) => {
          const lines = [{ speaker: a, text }];
          const verdict = later ? planDecision(state, b, later, [], `${state.world.tick}:${text}`) : undefined;
          const others = recipients.filter(id => id !== b).map(id => firstName(state, id));
          const note = later && verdict ? `The text proposes meeting at ${placeName(later.node)} ${planWhen(state, later)}${others.length ? `, also sent to ${others.join(', ')}` : ''}. ${later.date ? 'It is a romantic date invitation, not a casual hangout.' : asked ? 'It is a casual hangout invitation, not a date.' : ''} ${verdict.accept ? 'Agree to that time and place.' : `Decline kindly: ${firstName(state, b)} ${verdict.reason}.`}` : undefined;
          const answer = await this.gen.chat(recordChat(state, a, b, lines), b, a, new Budget(1), note);
          if (answer) lines.push({ speaker: b, text: answer });
          answers.set(b, { lines, verdict });
        }));
      } finally { release(); }
      this.state = state;
      this.log('action', { action, textVersion: 1 });
      for (const b of recipients) {
        const { lines, verdict } = answers.get(b)!;
        const photoFrom = /\b(pic|pics|picture|photo|selfie)\b/i.test(text) ? b : undefined;
        this.state = recordChat(this.state!, a, b, lines, photoFrom);
        this.log('chat', { a, b, lines, photoFrom });
        this.state = recordPlayerWords(this.state, [a, b], [text]);
        this.log('words', { listeners: [a, b], words: [text] });
        if (later && verdict?.accept && lines.length > 1) {
          this.state = addTalkPlan(this.state, a, b, later);
          this.log('talk-plan', { from: a, to: b, plan: later });
        } else if (asked && later && verdict && !verdict.accept) {
          // a plan from the plans tab that was turned down stays on the calendar as declined, with the reason
          this.state = declineTalkPlan(this.state, a, b, later, verdict.reason);
          this.log('talk-plan-declined', { from: a, to: b, plan: later, reason: verdict.reason });
        } else if (lines.length > 1 && !asked) {
          // a plan agreed across several texts ("so a yes or no?" … "9:30 works, see you then")
          const thread = todaysMessages(this.state, this.state.chats[[a, b].sort().join('|')] ?? []).map((m) => ({ speaker: m.from, text: m.text }));
          await this.readPlans(a, b, thread);
        }
      }
      this.autosave();
      return { view: this.view(), scenes: this.summaries() };
    }
    if (this.order.some((id) => this.runs.get(id)!.phase !== 'done')) throw new Error('scenes still pending');
    const block = `${s.world.episode}:${s.world.slot}`;
    if (this.budgetBlock !== block) {
      this.budget = new Budget(config.llmCallsPerSlot);
      this.budgetBlock = block;
    }
    this.digestSince = s.world.tick;
    if (!['visit', 'pool', 'like'].includes(action.type)) await this.prepareActivities(s.world.minutes + 5,
      action.type === 'talk' ? [action.target, ...(action.guests ?? [])] : []);
    const { state, plan } = planSlot(s, action);
    this.state = state;
    if (action.type === 'pool' && action.mode === 'enter') for (const c of Object.values(state.characters).filter((c) => c.swimming)) {
      const portrait = this.images.localFile(portraitRequest(c));
      if (portrait) this.images.request(outfitPortraitRequest(c, outfitFor(c, 'beach', state.world.day), portrait), PRIORITY.prefetch);
      else this.images.request(portraitRequest(c), PRIORITY.prefetch);
    }
    this.log('action', { action });
    await this.enrichNewCharacters(Object.keys(s.characters));
    this.runs.clear();
    this.order = [];
    const sorted = [...plan.scenes].sort((a, b) => b.priority - a.priority);
    if (action.type === 'talk' && this.interruptedTalk?.participants.includes(action.target)) {
      const previous = this.interruptedTalk.transcript.slice(-6).map(line => `${speakerName(state, line.speaker)}: ${line.text}`).join('\n');
      const conversation = sorted.find(p => p.event.participants.includes(action.target) && p.event.type !== 'arrival');
      if (conversation) {
        conversation.event.title = 'continuing your conversation';
        conversation.event.premise = action.room
          ? `The housemates moved to the ${placeName(action.room)} together. Continue the conversation with ${firstName(state, action.target)} here. Pick up this topic rather than starting over:\n${previous}`
          : `The introductions are over. Continue the conversation with ${firstName(state, action.target)} that the doorbell interrupted. Pick up this topic rather than starting over:\n${previous}`;
      }
    }
    this.interruptedTalk = undefined;
    for (const p of sorted) {
      const run: SceneRun = {
        id: p.event.id,
        planned: p,
        ev: p.event,
        phase: p.render ? (p.visible ? 'awaiting-response' : 'new') : 'done',
        choiceIndex: -1,
        playerStarts: action.type === 'talk' && p.event.type !== 'arrival' && p.event.participants.includes(state.playerId),
        transcript: [],
        ctx: { place: placeName(p.event.location), catchphraseUses: {}, lineCounts: {} },
        rendered: p.render,
        said: [],
      };
      this.runs.set(run.id, run);
      this.order.push(run.id);
      if (!p.render) this.autoResolve(run);
      else this.images.request(locationRequest(p.event.location, p.event.slot, this.state.world.weather), PRIORITY.currentScene);
    }
    return { view: this.view(), scenes: this.summaries() };
  }

  summaries(): SceneSummary[] {
    return this.order.map((id) => {
      const r = this.runs.get(id)!;
      return {
        id,
        title: r.ev.title,
        premise: r.ev.premise,
        location: r.ev.location,
        locationName: placeName(r.ev.location),
        participants: r.ev.participants,
        isPlayerScene: r.ev.isPlayerScene,
        visible: r.planned.visible,
        rendered: r.rendered,
        phase: r.phase,
        arc: !!r.ev.arcBeat,
        chat: r.ev.location === 'phone',
      };
    });
  }

  private autoResolve(run: SceneRun, response?: SceneResponse) {
    let s = this.requireState();
    if (beginBroadcast(s, run.ev)) this.log('broadcast-start', { event: run.ev });
    const ac = autoChoices(s, run.ev);
    s = ac.state;
    const po = proposeOutcome(s, run.ev, ac.choices);
    s = po.state;
    const rs = resolveScene(s, run.ev, po.proposal, ac.choices, response);
    this.state = rs.state;
    run.result = { confession: rs.result.effects.confession, leaving: rs.result.effects.leaving, secretRevealed: rs.result.effects.secretRevealed };
    run.phase = 'done';
    run.rendered = false;
    this.log('scene', { eventId: run.id, response, choices: ac.choices, proposal: rs.result.proposal });
  }

  respond(id: string, raw: unknown) {
    const run = this.runs.get(id);
    if (!run || run.phase !== 'awaiting-response') throw new Error('no response pending for this scene');
    const response = SceneResponse.parse(raw);
    if (response === 'ignore') this.autoResolve(run, 'ignore');
    else {
      run.response = response;
      run.phase = 'new';
      if (response === 'join') run.ev = { ...run.ev, participants: [...run.ev.participants, this.requireState().playerId], isPlayerScene: true };
    }
    return this.summaries().find((x) => x.id === id);
  }

  /**
   * The player's turn: pick an intent button, type their own words (the housemate answers, then it's their turn
   * again, for as long as they like), or end a typed conversation.
   */
  choose(id: string, raw: unknown) {
    const run = this.runs.get(id);
    if (!run || run.phase !== 'awaiting-choice') throw new Error('no choice pending for this scene');
    const c = ChoiceSchema.parse(typeof raw === 'string' ? { intent: raw } : raw);
    logTrace('choose', { scene: id, title: run.ev.title, via: c.via ?? (c.text ? 'typed' : c.invite ? 'invite' : c.intent ? 'unknown' : 'control'), intent: c.intent, text: c.text, recipient: c.recipient, done: c.done, listen: c.listen, hangout: c.hangout, invite: c.invite });
    const recipients = this.listeners(run);
    if (c.retry) {
      if (this.busy || !run.retry) throw new Error('no reply available to retry');
      run.phase = 'retry';
      return;
    }
    if (c.edit) {
      if (this.busy || !run.edit || !c.text) throw new Error('no reply available to edit');
      run.pendingText = c.text;
      run.pendingRecipient = c.recipient ?? run.edit.recipient;
      run.phase = 'edit';
      return;
    }
    if (c.invite) {
      const s = this.requireState();
      const { node: where, date = false } = c.invite;
      const place = content().city.nodes.find((n) => n.id === where) ?? content().house.rooms.find((r) => r.id === where && !r.private);
      const others = run.ev.participants.filter((id) => id !== s.playerId && s.characters[id]);
      const target = c.invite.with ?? c.recipient ?? (others.length === 1 ? others[0] : undefined);
      if (!place || !target || !others.includes(target)) throw new Error('choose a place and who to invite');
      run.pendingInvite = { node: where, date, target };
      run.pendingText = c.text ?? (content().city.nodes.some((n) => n.id === where) ? `Want to ${date ? 'go out to' : 'go to'} ${placeName(where)} with me?` : `Want to head to the ${placeName(where)} together?`);
      run.pendingRecipient = recipients.includes(target) && recipients.length >= 2 ? target : undefined;
      run.phase = 'reply';
      return;
    }
    if (c.favor) {
      const s = this.requireState();
      const others = run.ev.participants.filter((id) => id !== s.playerId && s.characters[id]);
      const helper = c.favor.with ?? c.recipient ?? (others.length === 1 ? others[0] : undefined);
      if (!helper || !others.includes(helper) || [c.favor.a, c.favor.b].some((x) => x !== s.playerId && !s.characters[x])) throw new Error('choose who to ask and who it is about');
      if (c.favor.a === helper || c.favor.b === helper || c.favor.a === c.favor.b) throw new Error('the helper cannot be one of the people it is about');
      if (c.favor.a === helper || c.favor.b === helper || c.favor.a === c.favor.b) throw new Error('the helper cannot be one of the people it is about');
      run.pendingFavor = { kind: c.favor.kind, a: c.favor.a, b: c.favor.b, helper };
      const who = (id: string) => (id === s.playerId ? 'me' : firstName(s, id));
      const me = [c.favor.a, c.favor.b].includes(s.playerId);
      const other = c.favor.a === s.playerId ? c.favor.b : c.favor.a;
      run.pendingText = c.text ?? (c.favor.kind === 'match'
        ? me ? `Could you play matchmaker between me and ${who(other)}?` : `Could you play matchmaker for ${who(c.favor.a)} and ${who(c.favor.b)}?`
        : me ? `Could you snoop around and find out if ${who(other)} likes me?` : `Could you snoop around and find out if ${who(c.favor.a)} and ${who(c.favor.b)} have a thing?`);
      run.pendingRecipient = recipients.includes(helper) && recipients.length >= 2 ? helper : undefined;
      run.phase = 'reply';
      return;
    }
    if (c.recipient && !(c.recipient === 'everyone' ? recipients.length >= 2 : recipients.includes(c.recipient))) throw new Error('that housemate cannot respond in this conversation');
    if (c.text) {
      run.pendingText = c.text;
      run.pendingRecipient = c.recipient;
      run.phase = 'reply';
      return;
    }
    if (c.listen) {
      if ((run.listened ?? 0) >= MAX_LISTENS || this.listeners(run).length < 2) throw new Error('nobody else is talking');
      run.phase = 'listen';
      return;
    }
    if (c.done) {
      if (!run.said.length && !run.listened && !c.hangout) throw new Error('say something first'); // accepting an invitation leaves right away
      if (c.hangout && run.ev.location !== 'phone') this.interruptedTalk = { participants: [...run.ev.participants], transcript: [...run.transcript] };
      run.endedByPlayer = true;
      run.phase = 'post';
      return;
    }
    if (!c.intent || !run.ev.intents.includes(c.intent)) throw new Error('intent not offered in this scene');
    run.playerIntent = c.intent;
    run.chosenIntent = c.intent;
    if (recipients.length >= 2) {
      run.pendingIntent = c.intent;
      run.pendingRecipient = c.recipient;
      run.phase = 'reply';
    } else run.phase = 'post';
  }

  async endSlot() {
    if (this.busy) throw new Error('generation is running');
    const s = this.requireState();
    if (this.order.some((id) => this.runs.get(id)!.phase !== 'done')) throw new Error('scenes still pending');
    this.runs.clear();
    this.order = [];
    // time left in this block: the player picks what to do next
    if (!blockOver(s) && !s.awaitingPlayer && !s.seasonOver) {
      this.autosave();
      return { view: this.view(), newEpisode: false, seasonOver: false, intermission: null };
    }
    const prevEp = s.world.episode;
    const prevSlot = s.world.slot;
    this.state = finishSlot(s);
    this.log('end-slot', {});
    await this.sendFollowUps();
    await this.enrichNewCharacters(Object.keys(s.characters));
    this.autosave();
    const ns = this.state;
    void this.overheard(prevEp, prevSlot, s);
    if (ns.world.episode !== prevEp) {
      this.prefetchPortraits();
      void this.writeDiaries(prevEp);
    }
    const newEpisode = ns.world.episode !== prevEp || ns.seasonOver;
    // the show cuts to the studio halfway through the day and after the last scene
    this.pendingIntermission = newEpisode ? 'end' : prevSlot === 'slot2' ? 'mid' : null;
    this.intermissionResult = undefined;
    return { view: this.view(), newEpisode, seasonOver: ns.seasonOver, intermission: this.pendingIntermission };
  }

  /** Housemates who enjoyed time with the player earlier text about it once the block is over ("that was fun at the pool"). */
  private async sendFollowUps() {
    const s = this.requireState();
    const due = followUpsDue(s);
    if (!due.length) return;
    const P = s.playerId;
    const texts = await Promise.all(due.map((f) => this.gen.real
      ? this.gen.chat(s, f.id, P, new Budget(1), `Send ${firstName(s, P)} one short, natural text following up on "${f.title}" at ${placeName(f.place)} earlier today. You ${f.romance ? 'liked them and it showed' : 'enjoyed it'}; you may suggest doing it again. Only the message itself.`)
      : Promise.resolve(followUpTemplate(s, f))));
    due.forEach((f, i) => {
      this.state = sendFollowUp(this.requireState(), f.id, texts[i]);
      this.log('follow-up', { id: f.id, text: texts[i] });
    });
  }

  /**
   * Background talk from the block that just ended: the engine already decided who interacted and how it went, so the three
   * most telling everyday or tense exchanges get real dialogue. It becomes both housemates'
   * memory and, if you were in the room, shows in the chat log. Background, one at a time, skipped while you are busy.
   */
  private async overheard(episode: number, slot: string, snapshot?: GameState) {
    const game = this.state?.gameId;
    const epoch = this.readingEpoch;
    if (!this.gen.real) return;
    const s0 = snapshot ?? this.requireState();
    const picks = s0.log
      .filter((l) => l.kind === 'summary' && l.episode === episode && l.slot === slot && l.participants.length === 2 && !l.participants.includes(s0.playerId) && OVERHEARD_TYPES.includes(l.templateId ?? ''))
      .sort((x, y) => y.salience - x.salience)
      .slice(0, 3);
    for (const l of picks) {
      if (this.busy || this.state?.gameId !== game || this.readingEpoch !== epoch) return;
      const [a, b] = l.participants;
      const type = l.templateId!;
      const release = this.images.hold();
      const lines = await this.gen.overheard(s0, a, b, type, placeName(l.location ?? s0.characters[a].location), l.text).finally(release);
      if (!lines || this.busy || this.state?.gameId !== game || this.readingEpoch !== epoch) continue;
      const said = lines.map(({ speaker, text }) => ({ speaker, text }));
      this.state = recordConversation(this.state!, [a, b], said);
      this.log('conversation', { listeners: [a, b], lines: said });
      this.log('overheard', { episode, slot, a, b, type, location: l.location, seen: !!l.factId && knows(s0, s0.playerId, l.factId), lines: said });
      if (!this.busy && !this.order.some(id => this.runs.get(id)!.phase !== 'done')) this.autosave();
    }
  }

  /**
   * After an episode, each housemate writes a diary entry and their view of the others (LLM, in the background, one at
   * a time). Each lands in state as it arrives and is logged so replay reproduces it.
   */
  private async writeDiaries(episode: number) {
    const game = this.state?.gameId;
    for (const c of Object.values(this.requireState().characters)) {
      if (c.isPlayer || c.status !== 'inHouse') continue;
      const release = this.images.hold();
      const entry = await this.gen.diary(this.requireState(), c.id, episode).finally(release);
      if (!entry || this.state?.gameId !== game) continue;
      this.state = recordDiary(this.state!, c.id, episode, entry.diary, entry.pairs);
      this.log('diary', { id: c.id, episode, ...entry });
    }
  }

  private async enrichNewCharacters(previous: string[]) {
    const s = this.requireState();
    if (!this.gen.real) return;
    const wasBusy = this.busy;
    this.busy = true;
    const release = this.images.hold();
    try {
      for (const c of Object.values(s.characters)) {
        if (previous.includes(c.id) || c.isPlayer || !c.archetypeId || c.status !== 'inHouse') continue;
        const character = await enrichCharacter(this.gen.llm, c, Object.values(s.characters).filter(p => p.id !== c.id && p.status === 'inHouse'));
        if (character === c) continue;
        applyCharacterSnapshot(s, character);
        this.log('generated-character', { character });
      }
    } finally {
      this.busy = wasBusy;
      release();
      this.flushReadings();
    }
  }

  /** The last aired episode as the house saw it on TV: every rendered scene with its transcript (read-only). */
  broadcast() {
    const s = this.requireState();
    const ep = airedBroadcast(s);
    if (!ep) return { episode: null, days: null, highlights: [], scenes: [], panel: [] };
    const days = broadcastDays(ep);
    const recorded = this.store.events(s.gameId).filter(e => e.kind === 'scene' && e.payload.episode >= days.start && e.payload.episode <= days.end && e.payload.transcript?.length);
    const scenes = Array.from({ length: days.end - days.start + 1 }, (_, i) => days.start + i).flatMap(day => recorded.filter(e => e.payload.episode === day)
      .sort((a, b) => (b.payload.event?.salience ?? 0) - (a.payload.event?.salience ?? 0)).slice(0, 3).sort((a, b) => a.seq - b.seq)
      .map(e => ({ day, title: e.payload.title as string, location: placeName(e.payload.location), mine: (e.payload.participants as string[]).includes(s.playerId), lines: (e.payload.transcript as { speaker: string; text: string }[]).map(l => ({ name: speakerName(s, l.speaker), text: l.text })) })));
    const panel = broadcastPanel(s, ep).map(r => ({ day: r.episode, name: content().panel.find(p => p.id === r.speaker)?.name ?? 'Panel', text: r.text }));
    return { episode: ep, days, highlights: broadcastHighlights(s, ep).map(m => ({ day: m.day, text: m.text })), scenes, panel };
  }

  private loggedScenes(episode?: number) {
    const s = this.requireState();
    return this.store.events(s.gameId).filter((e) => e.kind === 'scene' && (episode === undefined || e.payload.episode === episode) && e.payload.transcript?.length);
  }

  /**
   * Every finished scene of a day (today by default) with its transcript (read-only), and whether the model has already
   * re-read it. Today's view also lists the player's text threads, which a re-read checks for agreed plans.
   */
  dayLog(day?: number) {
    const s = this.requireState();
    const episode = day && day >= 1 && day <= s.world.episode ? day : s.world.episode;
    const readings = new Map(this.store.events(s.gameId).filter((e) => e.kind === 'reading').map((e) => [e.payload.id, e.payload.status as 'applied' | 'fallback']));
    const scenes = this.loggedScenes(episode).map((e) => ({
      id: e.payload.eventId as string,
      title: e.payload.title as string,
      location: placeName(e.payload.location),
      reread: !!s.world.flags[`reread:${e.payload.eventId}`],
      overheard: false,
      reading: this.readings.has(e.payload.eventId) ? 'pending' as const : readings.get(e.payload.eventId),
      lines: (e.payload.transcript as Line[]).map((l) => ({ name: speakerName(s, l.speaker), text: l.text })),
    }));
    const label: Record<string, string> = { bicker: 'argued', flirt: 'flirted', confess: 'confession', deep: 'heart-to-heart', apology: 'apologised', help: 'checked in', household: 'talked while helping out', cold: 'kept their distance', jealousy: 'talked about jealousy', joke: 'joked', gossip: 'had a quiet word' };
    const overheard = this.store.events(s.gameId)
      .filter((e) => e.kind === 'overheard' && (e.payload.episode === episode || e.payload.episode === episode - 1 && e.payload.slot === 'lateNight') && e.payload.seen)
      .map((e) => ({
        id: `overheard:${e.seq}`,
        title: `${e.payload.episode < episode ? 'last night · ' : ''}${speakerName(s, e.payload.a)} & ${speakerName(s, e.payload.b)} ${label[e.payload.type] ?? 'talked'}`,
        location: placeName(e.payload.location),
        reread: true,
        overheard: true,
        reading: undefined,
        lines: (e.payload.lines as Line[]).map((l) => ({ name: speakerName(s, l.speaker), text: l.text })),
      }));
    // ponytail: chat messages carry no day, so threads show (last 12 messages) on today's page only
    const texts = episode !== s.world.episode ? [] : Object.entries(s.chats).filter(([key, msgs]) => key.split('|').includes(s.playerId) && msgs.length).map(([key, msgs]) => {
      const other = key.split('|').find((id) => id !== s.playerId)!;
      return {
        id: `phone:${other}`,
        title: `texts with ${speakerName(s, other)}`,
        location: 'phone',
        reread: false,
        overheard: false,
        phone: true,
        reading: undefined,
        lines: msgs.slice(-12).map((m) => ({ name: speakerName(s, m.from), text: m.text })),
      };
    });
    return { episode, today: s.world.episode, scenes: [...scenes, ...overheard, ...texts] };
  }

  /**
   * Ask the model to read one finished scene again. Its fresh read replaces what the scene applied (only the difference
   * is added) and writes richer memories. Repeated readings replace earlier ones; logged for saves and replays.
   */
  async reread(id: string) {
    if (this.busy) throw new Error('generation is running');
    if (this.readings.has(id)) throw new Error('this conversation is still being read');
    const s = this.requireState();
    if (id.startsWith('phone:')) return this.rereadTexts(id.slice('phone:'.length));
    const p = this.loggedScenes().find((e) => e.payload.eventId === id)?.payload;
    if (!p?.event) throw new Error("this scene isn't in the log");
    const day = p.episode as number;
    this.busy = true;
    const release = this.images.hold();
    try {
      const next = await this.gen.deltas(s, p.event as EventInstance, p.transcript as Line[], p.choices ?? {}, new Budget(2));
      if (!next) throw new Error('the dialogue model did not answer; nothing changed');
      const participants = (p.participants as string[]).filter((x) => s.characters[x]);
      const read = cleanReading(s, next, participants, p.transcript as Line[]);
      // an empty read would subtract everything the scene did; treat it as no answer so it can be retried
      if (!hasFeelingDeltas(read)) throw new Error('the model found no feelings to change in this scene; try re-reading again');
      const change = rereadChange(read, sanitizeProposal(p.proposal, participants), typeof p.feelingScale === 'number' ? p.feelingScale : 1);
      const boardChange = structuredClone(change);
      // Replace all prior corrections, including older saves whose re-reads only stored the net change.
      for (const e of this.store.events(s.gameId).filter(e => (e.kind === 'reading' || e.kind === 'reread') && e.payload.id === id && e.payload.change)) {
        for (const [correction, previous] of [[change, e.payload.change], [boardChange, e.payload.boardChange]] as const) {
          if (!previous) continue;
          for (const field of ['affinityDeltas', 'romanceDeltas', 'tensionDeltas', 'trustDeltas'] as const) {
            for (const d of previous[field] as DeltaProposal[typeof field]) {
              const net = correction[field].find(x => x.from === d.from && x.to === d.to);
              if (net) net.delta -= d.delta;
              else correction[field].push({ ...d, delta: -d.delta });
            }
          }
        }
      }
      applyReread(s, id, change, participants, true, boardChange, day);
      this.log('reread', { id, change, boardChange, participants, episode: day });
      this.autosave();
      return { view: this.view(), log: this.dayLog(day) };
    } finally { release(); this.busy = false; this.flushReadings(); }
  }

  /** Re-read a text thread for the plan it settled (or moved, or called off) and put the calendar right. */
  private async rereadTexts(other: string) {
    const s = this.requireState();
    const thread = todaysMessages(s, s.chats[[s.playerId, other].sort().join('|')] ?? []);
    if (!thread.length) return { view: this.view(), log: this.dayLog(), note: 'no texts today' };
    this.busy = true;
    try {
      const changed = await this.readPlans(s.playerId, other, thread.map((m) => ({ speaker: m.from, text: m.text })), true);
      if (changed) this.autosave();
      return { view: this.view(), log: this.dayLog(), note: changed ? 'plans updated from today\'s texts' : 'no new or changed plan in today\'s texts' };
    } finally { this.busy = false; }
  }

  /** What the panel rewatches: the scenes and overheard exchanges since it last spoke, juiciest first, with their actual lines. */
  private footage(upTo: number): Footage[] {
    const s = this.requireState();
    return this.store.events(s.gameId, upTo)
      .filter((e) => e.seq > this.footageSeq && (e.kind === 'scene' && e.payload.transcript?.length || e.kind === 'overheard' && e.payload.lines?.length))
      .map((e) => {
        const p = e.payload;
        const lines = ((p.transcript ?? p.lines) as Line[]).filter((l) => l.speaker !== 'narrator' && l.text).map((l) => ({ name: speakerName(s, l.speaker), text: l.text }));
        const title = e.kind === 'scene' ? p.title as string : `${speakerName(s, p.a)} and ${speakerName(s, p.b)}, off to the side`;
        return { title, place: e.kind === 'scene' ? placeName(p.location) : p.location ? placeName(p.location) : 'house', lines, salience: e.kind === 'scene' ? p.event?.salience ?? 0.5 : 0.5 };
      })
      .filter((f) => f.lines.length)
      .sort((a, b) => b.salience - a.salience)
      .slice(0, 4)
      .map(({ salience: _, ...f }) => f);
  }

  /** Studio intermission stays visible now and is recorded for the house's delayed TV watch. */
  async intermission() {
    if (this.intermissionResult) return this.intermissionResult;
    const s = this.requireState();
    const at = this.pendingIntermission;
    if (!at) throw new Error('no intermission pending');
    this.intermissionResult = (async () => {
      const release = this.images.hold();
      try {
        const upTo = this.logSeq;
        const r = await this.gen.intermission(s, at, this.intermissionSince, new Budget(2), this.footage(upTo));
        this.footageSeq = upTo;
        const remarks = { episode: at === 'end' && !s.seasonOver ? Math.max(1, s.world.episode - 1) : s.world.episode, participants: Object.values(s.characters).filter(c => c.status === 'inHouse').map(c => c.id), lines: r.commentary.lines };
        this.state = recordCommentary(this.requireState(), { calledBack: [], remarks });
        this.pendingIntermission = null;
        this.intermissionSince = s.world.tick;
        this.log('intermission', { at, ...r, remarks });
        this.autosave();
        return { at, lines: r.commentary.lines, source: r.source };
      } finally { release(); }
    })();
    try { return await this.intermissionResult; }
    catch (e) { this.intermissionResult = undefined; throw e; }
  }

  // ------------------------------------------------------------ scene streaming

  /** Restart a conversation from scratch with a new beat sheet; an arc beat also re-reads its premise from current content (a career beat is invented afresh on start). */
  changeBeat(id: string) {
    const run = this.runs.get(id);
    if (this.busy) throw new Error('wait for the current line to finish');
    if (!run?.rendered || run.ev.location === 'phone' || ['done', 'post', 'awaiting-response'].includes(run.phase)) throw new Error('this beat cannot be changed now');
    const tpl = run.ev.arcBeat && content().eventById.get(run.ev.templateId);
    const fresh = tpl && makeEvent(structuredClone(this.requireState()), tpl, run.ev.roles, run.ev.location);
    const ev = fresh ? { ...run.ev, title: fresh.title, premise: fresh.premise, tags: fresh.tags, intents: fresh.intents } : run.ev;
    this.runs.set(id, { id, planned: run.planned, ev, phase: 'new', response: run.response, playerStarts: run.playerStarts, choiceIndex: -1, transcript: [], ctx: { place: placeName(ev.location), catchphraseUses: {}, lineCounts: {} }, rendered: true, said: [] });
    return this.summaries().find((x) => x.id === id);
  }

  /** Illustrate a visible conversation on demand without changing its outcome or advancing time. */
  async sceneImage(id: string) {
    const s = this.requireState();
    const run = this.runs.get(id);
    if (!run || !run.rendered || run.phase === 'awaiting-response') throw new Error('scene is not available');
    if (!run.ev.participants.includes(s.playerId)) throw new Error('join this conversation before generating a scene');
    const participants = [s.playerId, ...run.ev.participants.filter((p) => p !== s.playerId)].slice(0, 6);
    if (participants.length < 2) throw new Error('a scene image needs another housemate');
    const phone = run.ev.location === 'phone';
    const ev = { ...run.ev, participants, location: phone ? s.characters[s.playerId].location : run.ev.location };
    const poses = phone ? Object.fromEntries(participants.map((p) => [p, `holding a phone, separately at ${placeName(s.characters[p].location)}`])) : await this.gen.shot(s, ev, run.transcript);
    const context = `${phone ? 'phone conversation, split-screen composition, not in the same room. ' : ''}No speech bubbles or captions.`;
    return this.images.request(freezeRequest(s, ev, (r) => this.images.localFile(r), context, run.transcript, poses, this.outfitOverrides), PRIORITY.currentScene);
  }

  /** Run the next segment of a scene, emitting SSE events. Resolves when the segment ends. */
  async stream(id: string, emit: Emit) {
    const run = this.runs.get(id);
    if (!run) throw new Error('unknown scene');
    if (this.busy) throw new Error('another scene segment is running');
    // Resume class scenes created before the classmate was bound in the template.
    if (run.ev.templateId === 'class-day' && !run.ev.roles.b) run.ev = { ...run.ev, roles: { ...run.ev.roles, b: 'classmate' } };
    this.busy = true;
    const release = this.images.hold(); // one GPU: dialogue first, images after the segment
    // every scene gets its own call budget: a block-wide one ran dry on the first scene and templated the rest
    if (run.phase === 'new') this.budget = new Budget(config.llmCallsPerScene);
    try {
      // a conversation already running at a bar (older save, or planned before drinking existed) catches up too
      if (run.ev.participants.includes(this.requireState().playerId)) {
        const vd = venueDrinks(this.requireState(), run.ev);
        if (Object.keys(vd.changes).length) { this.state = vd.state; this.log('drinks', { changes: vd.changes }); }
      }
      if (run.phase === 'awaiting-response') {
        emit('respond', { id, options: ['join', 'eavesdrop', 'ignore'], premise: run.ev.premise });
        return;
      }
      if (run.phase === 'awaiting-choice') {
        // reopened after the player stepped away or reloaded: restage the scene and what was said
        emit('scene', this.sceneHeader(run, run.ev.premise));
        run.transcript.forEach((l, i) => {
          emit('line-start', { index: i, speaker: l.speaker, name: speakerName(this.requireState(), l.speaker), caption: l.caption ?? null, emotion: l.emotion });
          emit('line-end', { index: i, speaker: l.speaker, text: l.text, caption: l.caption ?? null, source: l.source });
        });
        emit('choice', this.choiceEvent(run));
        return;
      }
      if (run.phase === 'done') {
        emit('done', { id, replay: true, transcript: run.transcript, commentary: run.commentary, result: run.result, freeze: run.freeze });
        return;
      }
      const s = this.requireState();
      if (run.ev.location === 'phone' && this.phoneCapacity(run) === 0) {
        run.phoneClosed = true;
        run.beats ??= [];
        run.phase = 'post';
      }
      if (run.phase === 'new') {
        if (beginBroadcast(s, run.ev)) this.log('broadcast-start', { event: run.ev });
        run.ev = { ...run.ev, ...(await this.gen.freshBeat(s, run.ev, this.budget)) };
        // a helper with news for the player (a favor they asked for): the helper, and the partner if they came along, tell it in person
        const reports = run.ev.participants.includes(s.playerId) ? readyReports(s, run.ev.participants) : [];
        for (const m of reports) if (m.partner && s.characters[m.partner]?.status === 'inHouse' && !run.ev.participants.includes(m.partner)) run.ev = { ...run.ev, participants: [...run.ev.participants, m.partner], factRefs: { ...run.ev.factRefs, [m.partner]: [] } };
        emit('scene', this.sceneHeader(run, await this.gen.flavor(run.ev.premise, this.budget)));
        const sheet = await this.gen.beatSheet(s, run.ev, this.budget);
        run.beats = sheet.beats;
        const playerIn = run.ev.participants.includes(s.playerId) && run.response !== 'eavesdrop';
        run.choiceIndex = playerIn ? (sheet.choiceIndex >= 0 ? sheet.choiceIndex : Math.min(2, sheet.beats.length - 1)) : -1;
        const watch = run.ev.templateId === 'broadcast-watch';
        if (watch) {
          await this.screenEpisode(run, emit);
          // the sheet's opening beats are replaced by the three screened days; only its player turn and wrap-up remain
          run.beats = playerIn ? run.beats.slice(run.choiceIndex) : run.beats.slice(-1);
          run.choiceIndex = playerIn ? 0 : -1;
        }
        let pre = watch || run.playerStarts ? [] : run.choiceIndex >= 0 ? run.beats.slice(0, run.choiceIndex) : run.beats;
        if (reports.length && !watch) {
          const topic = run.beats[0]?.topic ?? 'small talk';
          pre = reportBeats(s, reports, run.ev.participants).map((b) => ({ ...b, subtext: '', depth: run.ev.depthCeiling, topic }));
          this.state = tellMissions(this.requireState(), reports.map((m) => m.id));
          this.log('mission-told', { ids: reports.map((m) => m.id) });
        }
        if (s.world.flags.gradualMoveIn && s.world.episode === 1 && run.ev.type === 'arrival') this.introduce(run, run.ev.roles.a === s.playerId ? run.ev.roles.b : run.ev.roles.a, emit);
        await this.realize(run, pre, pre.map(() => undefined), emit);
        if (this.phoneCapacity(run) === 0) run.phoneClosed = true;
        if (run.phoneClosed) run.phase = 'post';
        else if (run.choiceIndex >= 0 && run.openingText) {
          // a message typed on the phone before the conversation opened
          run.pendingText = run.openingText;
          run.openingText = undefined;
          run.phase = 'reply';
        } else if (run.choiceIndex >= 0) {
          run.phase = 'awaiting-choice';
          await this.offerChoice(run, emit);
          return;
        } else run.phase = 'post';
      }
      if (run.phase === 'edit') {
        // rewind to the player's line and answer the new wording; the clock keeps what the old lines already cost
        const e = run.edit!;
        run.edit = undefined;
        run.transcript.splice(e.at);
        run.said.pop();
        run.ctx = e.ctx;
        emit('reset', { from: e.at });
        run.phase = 'reply';
      }
      if (run.phase === 'reply') return await this.reply(run, emit);
      if (run.phase === 'retry') {
        const retry = run.retry!;
        run.transcript.splice(retry.start);
        run.ctx = structuredClone(retry.ctx);
        emit('reset', { from: retry.start });
        this.budget.cap++;
        await this.realize(run, retry.beats, retry.intents, emit, retry.replyTo);
        run.timedLines = run.transcript.length;
        run.phase = 'awaiting-choice';
        emit('choice', this.choiceEvent(run));
        return;
      }
      if (run.phase === 'listen') return await this.listen(run, emit);
      if (run.phase === 'post') await this.finishScene(run, emit);
    } finally {
      this.busy = false;
      release();
      this.flushReadings();
    }
  }

  private sceneHeader(run: SceneRun, premise: string) {
    const s = this.requireState();
    return {
      id: run.id,
      title: run.ev.title,
      premise,
      location: run.ev.location,
      locationName: placeName(run.ev.location),
      occasion: occasionFor(run.ev),
      participants: run.ev.participants.map((p) => ({ id: p, name: speakerName(s, p), occasion: occasionForCharacter(s.characters[p] ?? {}, run.ev) })),
      outsiders: [...new Set(Object.values(run.ev.roles))].filter(id => !s.characters[id]).map(id => guestCharacter(s, id)).filter(c => c !== undefined).map(({ id, name, appearance, gender, portraitSeed }) => ({ id, name, appearance, gender, portraitSeed })),
      isPlayerScene: run.ev.isPlayerScene,
      eavesdrop: run.response === 'eavesdrop',
      background: this.images.request(locationRequest(run.ev.location, run.ev.slot, s.world.weather), PRIORITY.currentScene),
      chat: run.ev.location === 'phone',
      broadcast: run.ev.templateId === 'broadcast-watch' ? this.broadcast() : undefined,
      intro: run.ev.type === 'arrival' && s.characters[run.ev.roles.a] ? (({ id, name, age, occupation, hometown }) => ({ id, name, age, occupation, hometown }))(s.characters[run.ev.roles.a]) : null,
      moveIn: s.world.episode === 1 && !!s.world.flags.gradualMoveIn,
    };
  }

  private choiceEvent(run: SceneRun) {
    return { id: run.id, intents: run.ev.intents, canRetry: !!run.retry, canEdit: !!run.edit, canType: true, canEnd: run.said.length > 0 || !!run.listened, canListen: (run.listened ?? 0) < MAX_LISTENS && this.listeners(run).length >= 2, recipients: this.listeners(run).map(id => ({ id, name: speakerName(this.requireState(), id) })) };
  }

  private talkingHousemates(run: SceneRun) {
    if (run.ev.location === 'phone') return [];
    return run.ev.participants;
  }

  private async offerChoice(run: SceneRun, emit: Emit) {
    const s = this.requireState();
    const lines = run.transcript.slice(run.timedLines ?? 0).filter(l => l.speaker !== 'narrator').length;
    const protectedIds = this.talkingHousemates(run);
    if (run.ev.location !== 'phone' && (run.ev.participants.includes(s.playerId) || run.response === 'eavesdrop')) {
      await this.prepareActivities(s.world.minutes + lines * MINUTES_PER_LINE, protectedIds);
      this.state = passTime(s, lines, protectedIds);
      this.log('time', { lines, protectedIds, minutesPerLine: MINUTES_PER_LINE });
    }
    run.timedLines = run.transcript.length;
    if (s.world.episode !== 1 || !s.world.flags.gradualMoveIn) { emit('view', this.view()); emit('choice', this.choiceEvent(run)); return; }
    const arrival = planMoveInArrival(this.requireState());
    const planned = arrival.plan.scenes[0];
    if (!planned) { emit('view', this.view()); emit('choice', this.choiceEvent(run)); return; }
    this.state = arrival.state;
    this.log('move-in', {});
    const newcomer = this.state.characters[planned.event.roles.a];
    const home = Object.values(this.state.characters).filter(c => c.status === 'inHouse');
    if (home.length === 3 && run.ev.location !== 'phone') {
      run.ev = { ...run.ev, participants: [...new Set([...run.ev.participants, newcomer.id])], premise: `${run.ev.premise} ${planned.event.premise}`, factRefs: { ...run.ev.factRefs, [newcomer.id]: [] } };
      newcomer.location = run.ev.location;
      this.log('move-in-join', { event: run.ev, newcomer: newcomer.id });
      emit('arrival-joined', { intro: (({ id, name, age, occupation, hometown }) => ({ id, name, age, occupation, hometown }))(newcomer), participants: run.ev.participants.map(id => ({ id, name: speakerName(this.state!, id), occasion: 'daily' })), view: this.view() });
      this.introduce(run, newcomer.id, emit);
      emit('choice', this.choiceEvent(run));
      return;
    }
    const next: SceneRun = { id: planned.event.id, planned, ev: planned.event, phase: 'new', choiceIndex: -1, transcript: [], ctx: { place: placeName(planned.event.location), catchphraseUses: {}, lineCounts: {} }, rendered: true, said: [] };
    this.runs.set(next.id, next);
    this.order.splice(this.order.indexOf(run.id) + 1, 0, next.id);
    run.interrupted = true;
    this.interruptedTalk = { participants: [...run.ev.participants], transcript: [...run.transcript] };
    run.phase = 'post';
    emit('arrival-pending', { name: newcomer.name, view: this.view() });
    await this.finishScene(run, emit);
  }

  private introduce(run: SceneRun, id: string, emit: Emit) {
    const c = this.requireState().characters[id];
    const index = run.transcript.length;
    const text = `Hi, I'm ${c.name}. I'm ${c.age}, I work as ${c.occupation}, and I'm from ${c.hometown}. It's nice to meet you.`;
    emit('line-start', { index, speaker: id, name: speakerName(this.requireState(), id), caption: null, emotion: 'nervous' });
    emit('token', { index, token: text });
    run.transcript.push({ speaker: id, text, source: 'mock', emotion: 'nervous' });
    emit('line-end', { index, speaker: id, text, caption: null, source: 'mock' });
  }

  /** A scripted narration line (TV footage, panel talk): shown as narration and kept in the scene transcript. */
  private narrate(run: SceneRun, text: string, emit: Emit) {
    const index = run.transcript.length;
    emit('line-start', { index, speaker: 'narrator', name: 'Narration', caption: null, emotion: 'neutral' });
    emit('token', { index, token: text });
    run.transcript.push({ speaker: 'narrator', text, source: 'mock' });
    emit('line-end', { index, speaker: 'narrator', text, caption: null, source: 'mock' });
  }

  /**
   * The evening watch, one round per aired day: a moment the model picks from that day's scenes and panel talk, the
   * housemates reacting to it, then the panel's own remarks. Reads recorded footage only; changes no game state.
   */
  private async screenEpisode(run: SceneRun, emit: Emit) {
    const s = this.requireState();
    const ep = airedBroadcast(s);
    if (!ep) return;
    const { start } = broadcastDays(ep);
    const highlights = broadcastHighlights(s, ep);
    const remarks = broadcastPanel(s, ep);
    const panelName = (id?: string) => content().panel.find((p) => p.id === id)?.name ?? 'The panel';
    this.budget.cap += BROADCAST_DAYS * 2; // each day: one pick, one batch of reactions
    for (let day = start; day < start + BROADCAST_DAYS; day++) {
      const dayRemarks = remarks.filter((r) => r.episode === day);
      const scenes = this.loggedScenes(day)
        .filter((e) => e.payload.event?.templateId !== 'broadcast-watch')
        .sort((a, b) => (b.payload.event?.salience ?? 0) - (a.payload.event?.salience ?? 0))
        .slice(0, 4)
        .map((e) => ({ title: e.payload.title as string, place: placeName(e.payload.location), people: e.payload.participants as string[], lines: (e.payload.transcript as Line[]).filter((l) => l.speaker !== 'narrator' && l.text).slice(0, 12).map((l) => ({ name: speakerName(s, l.speaker), text: l.text })) }))
        .filter((sc) => sc.lines.length);
      const moment = highlights.find((m) => m.day === day);
      if (!scenes.length && !moment) continue;
      const pick = await this.gen.broadcastClip(day, scenes, dayRemarks.map((r) => `${panelName(r.speaker)}: ${r.text}`), this.budget);
      const scene = scenes[pick?.scene ?? 0];
      const people = scene?.people ?? moment!.participants;
      this.narrate(run, scene ? `On the TV, day ${day}: "${scene.title}".` : `On the TV, day ${day}: ${moment!.text}`, emit);
      if (scene) {
        const from = pick?.from ?? Math.max(0, scene.lines.length - 3);
        for (const l of scene.lines.slice(from, from + (pick?.count ?? 3))) this.narrate(run, `${l.name}: ${l.text}`, emit);
      }
      const watchers = this.listeners(run);
      const speakers = [...watchers.filter((id) => people.includes(id)), ...watchers.filter((id) => !people.includes(id))].slice(0, 3);
      const topic = (scene?.title ?? 'the broadcast').slice(0, 60);
      const reactions = speakers.map((speaker, i): Beat => ({
        speaker, emotion: 'neutral', beatType: (['smalltalk', 'tease', 'joke'] as const)[i], topic,
        intent: i ? 'react to the clip, or to what was just said about it, in your own voice' : 'react to watching this moment on TV',
        subtext: people.includes(speaker) ? 'seeing yourself on screen' : '', depth: people.includes(speaker) ? 'personal' : 'smalltalk',
      }));
      await this.realize(run, reactions, reactions.map(() => undefined), emit);
      const about = dayRemarks.filter((r) => r.participants.some((p) => people.includes(p)));
      for (const r of (about.length ? about : dayRemarks).slice(0, 3)) this.narrate(run, `The panel, ${panelName(r.speaker)}: "${r.text}"`, emit);
    }
    run.retry = undefined; // "try again" would only redo the last day's reactions
  }

  /** How many more phone lines fit. Phones stay on all week, Shabbat included: the cap is gone, the callers stay. */
  private phoneCapacity(_run: SceneRun) {
    return Infinity;
  }

  /** Housemates in the scene who can talk among themselves (not the player, not anyone busy asleep or on the phone). */
  private listeners(run: SceneRun) {
    const s = this.requireState();
    return run.ev.location === 'phone' ? [] : [...new Set([...run.ev.participants, ...Object.values(run.ev.roles)])].filter(id => id !== s.playerId && (s.characters[id] || guestCharacter(s, id)) && !['sleep', 'nap', 'text'].includes(s.characters[id]?.lastAction ?? ''));
  }

  /**
   * The player stays quiet: two housemates keep the conversation going (SillyTavern auto mode). Talkative and engaged
   * people speak first; nobody takes two turns in a row.
   */
  private async listen(run: SceneRun, emit: Emit) {
    const s = this.requireState();
    run.listened = (run.listened ?? 0) + 1;
    run.edit = undefined;
    const last = run.transcript.at(-1)?.speaker;
    const keen = (id: string) => (s.characters[id] ?? guestCharacter(s, id)!).persona.traits[2] + (s.characters[id]?.mood ?? 0) * 0.3 + (last && s.rel[id]?.[last] ? s.rel[id][last].affinity / 200 : 0);
    const order = this.listeners(run).filter((id) => id !== last).sort((a, b) => keen(b) - keen(a) || (a < b ? -1 : 1));
    const second = this.listeners(run).filter((id) => id !== order[0]).sort((a, b) => keen(b) - keen(a))[0];
    const speakers = [order[0], second].filter(Boolean);
    const topic = run.beats?.[0]?.topic ?? 'small talk';
    const beats: Beat[] = speakers.map((speaker, i) => ({ speaker, intent: i ? 'answer them' : 'carry the conversation on', emotion: 'neutral', beatType: i ? 'joke' : 'smalltalk', subtext: '', depth: run.ev.depthCeiling, topic }));
    this.budget.cap++;
    await this.realize(run, beats, beats.map(() => undefined), emit);
    run.phase = 'awaiting-choice';
    await this.offerChoice(run, emit);
  }

  /** The player's words or chosen intent, then housemates' answers; then it's the player's turn again. */
  private async reply(run: SceneRun, emit: Emit) {
    if (this.phoneCapacity(run) === 0) {
      run.phoneClosed = true;
      run.pendingText = undefined;
      run.pendingRecipient = undefined;
      run.phase = 'post';
      return this.finishScene(run, emit);
    }
    const s = this.requireState();
    let text = run.pendingText;
    const chosenIntent = run.pendingIntent;
    const recipient = run.pendingRecipient;
    let invite = run.pendingInvite;
    let favor = run.pendingFavor;
    run.pendingText = undefined;
    run.pendingIntent = undefined;
    run.pendingRecipient = undefined;
    run.pendingInvite = undefined;
    run.pendingFavor = undefined;
    if (chosenIntent) {
      const beat: Beat = { ...run.beats![run.choiceIndex], speaker: s.playerId };
      if (recipient) beat.intent += `; address ${recipient === 'everyone' ? 'everyone' : speakerName(s, recipient)} directly`;
      await this.realize(run, [beat], [chosenIntent], emit, undefined, recipient);
      text = run.transcript.at(-1)!.text;
    }
    if (!text) throw new Error('no reply pending for this scene');
    const ctxBefore = structuredClone(run.ctx);
    run.edit = undefined;
    const intent = chosenIntent ?? classifyIntent(text, run.ev.intents);
    const replyIntent = chosenIntent ?? classifyIntent(text, ['decline', ...run.ev.intents]);
    run.playerIntent = intent;
    run.said.push(text);
    const P = s.playerId;
    const idx = run.transcript.length;
    if (!chosenIntent) {
      emit('line-start', { index: idx, speaker: P, name: speakerName(s, P), caption: null, emotion: 'neutral', beatType: 'smalltalk', subtext: null });
      emit('token', { index: idx, token: text });
      run.transcript.push({ speaker: P, text, source: 'player', recipient, emotion: feltEmotion(text) ?? undefined });      emit('line-end', { index: idx, speaker: P, text, caption: null, source: 'player' });
    }
    // a meet-up proposed for later ("cafe tomorrow morning?") gets a real answer and, if agreed, a calendar entry
    const others = run.ev.participants.filter(id => id !== P && s.characters[id]);
    const planWith = recipient && recipient !== 'everyone' ? recipient : others.length === 1 ? others[0] : undefined;
    const later = !invite && !favor && !chosenIntent && planWith && s.characters[planWith] ? proposedPlan(s, text, [planWith]) : null;
    const laterVerdict = later ? planDecision(s, planWith!, later, run.transcript, `${s.world.tick}:${text}`) : undefined;
    // "Maybe head to Carmel market? I'm free right now": a typed invitation gets the same engine answer, and the same
    // go-out prompt, as the invite button, so what they say and what the game offers agree
    if (!invite && !chosenIntent && !later && planWith && s.characters[planWith] && run.ev.location !== 'phone') {
      const outing = proposedOuting(s, text, [planWith]);
      if (outing) invite = { node: outing.node, date: outing.date, target: planWith };
    }
    // "can you play matchmaker for me and Dana?" / "find out if Dana likes me": the helper decides from closeness and personality
    if (!favor && !invite && !later && !chosenIntent && planWith && s.characters[planWith]) {
      const asked = proposedFavor(s, text, planWith);
      if (asked) favor = { ...asked, helper: planWith };
    }
    const favorSeed = `${s.world.tick}:${text}`;
    const favorVerdict = favor ? favorDecision(s, favor.helper, favor, favorSeed) : undefined;
    const favorOut = favor && favorVerdict?.accept ? queueFavor(s, favor.helper, favor, favorVerdict, favorSeed) : undefined;
    if (favorOut) {
      this.state = favorOut.state;
      this.log('favor', { helper: favor!.helper, favor: { kind: favor!.kind, a: favor!.a, b: favor!.b }, seed: favorSeed, note: favorOut.note });
      emit('view', this.view());
    }
    const responders = invite ? [invite.target] : favor ? [favor.helper] : later ? [planWith!] : run.ev.location === 'phone' ? run.ev.participants.filter(id => id !== P) : recipient ? recipient === 'everyone' ? this.listeners(run) : [recipient] : chosenIntent ? this.listeners(run) : typedResponders(s, run.ev.participants, run.transcript, text);
    if (!responders.length && run.ev.location !== 'phone') responders.push(...this.listeners(run));
    // an invitation is answered from how they feel about the player and what was just said; the line is written to match
    // (a heatwave or typhoon can still turn down an open-air place, whatever they feel)
    const weatherNo = invite ? weatherRefusal(s, invite.target, invite.node, `${s.world.tick}`) : null;
    const verdict = invite ? ((v) => v.accept && weatherNo ? { accept: false, reason: weatherNo } : v)(inviteDecision(s, invite.target, run.transcript, { date: invite.date, seed: `${s.world.tick}:${text}` })) : undefined;
    // "let's do shots" / "I'll have a beer": the player drinks and the others may join, before they answer
    const order = !chosenIntent && !invite && !later && !favor ? orderDrinks(this.requireState(), text, run.ev.location === 'phone' ? [] : others) : null;
    if (order) {
      this.state = order.state;
      this.log('drinks', { changes: order.changes });
      emit('view', this.view());
    }
    const drinkNote = (speaker: string) => (order ? `; the player just asked for ${order.what}, ${order.changes[speaker] ? 'you join in and it shows a little' : 'you pass on drinking this round'}` : '');
    if (responders.length) {
      this.budget.cap++; // typed talk is the player's call: each answer gets its own LLM call
      const topic = run.beats?.[0]?.topic ?? 'small talk';
      const beat = (speaker: string, why: string): Beat => ({ speaker, intent: why, emotion: reactionTo(text) ?? REPLY_EMOTION[replyIntent] ?? 'neutral', beatType: replyBeatType(replyIntent, s.characters[speaker] ?? guestCharacter(s, speaker)!), subtext: '', depth: run.ev.depthCeiling, topic });
      const answer = (speaker: string): Beat => {
        if (later && laterVerdict) {
          const what = `the player's ${later.date ? 'invitation on a date' : 'plan to meet'} at ${placeName(later.node)} ${planWhen(s, later)}`;
          return { ...beat(speaker, laterVerdict.accept ? `agree to ${what}; confirm that time and place, without leaving now` : `turn down ${what} kindly because you ${laterVerdict.reason}; do not agree`), emotion: laterVerdict.accept ? 'happy' : 'awkward', beatType: laterVerdict.accept ? 'smalltalk' : 'deflect' };
        }
        if (favor && favorVerdict) return { ...beat(speaker, favorOut ? favorOut.brief : refusalBrief(s, favor.helper, favor, favorVerdict)), emotion: favorOut ? (favorVerdict.hurt ? 'sad' : 'happy') : 'awkward', beatType: favorOut ? 'smalltalk' : 'deflect' };
        if (!invite || !verdict) return beat(speaker, `${recipient && recipient !== 'everyone' ? `answer the player, who is addressing ${speakerName(s, speaker)} directly` : 'answer the player'}${drinkNote(speaker)}`);
        const where = placeName(invite.node);
        return { ...beat(speaker, verdict.accept ? `answer the player's invitation to ${where}: say yes warmly and agree to go together right now` : `answer the player's invitation to ${where}: turn it down kindly because you ${verdict.reason}; do not agree to go`), emotion: verdict.accept ? 'happy' : 'awkward', beatType: verdict.accept ? 'smalltalk' : 'deflect' };
      };
      await this.realize(run, responders.map(answer), responders.map(() => undefined), emit, { text, intent: replyIntent });
    }
    let planRead = false;
    if (later && laterVerdict?.accept) {
      this.state = addTalkPlan(this.requireState(), P, planWith!, later);
      this.log('talk-plan', { from: P, to: planWith, plan: later });
    } else if (!invite && !favor && planWith && await this.readPlans(P, planWith, run.transcript)) { planRead = true; emit('view', this.view()); }
    if (favor && favorVerdict) emit('favor', { from: favor.helper, name: speakerName(s, favor.helper), kind: favor.kind, accepted: favorVerdict.accept, note: favorOut ? favorOut.note : `${speakerName(s, favor.helper).split(' ')[0]} ${favorVerdict.reason}.` });
    if (invite && verdict) emit('invite', { from: invite.target, name: speakerName(s, invite.target), node: invite.node, date: invite.date, accepted: verdict.accept, reason: verdict.reason });
    if (run.phoneClosed || this.phoneCapacity(run) === 0) {
      run.phoneClosed = true;
      run.phase = 'post';
      return this.finishScene(run, emit);
    }
    // only a plain typed line that changed nothing outside the talk can be reworded
    if (!chosenIntent && !invite && !favor && !later && !order && !planRead) run.edit = { at: idx, recipient, ctx: ctxBefore };
    run.phase = 'awaiting-choice';
    await this.offerChoice(run, emit);
  }

  private async realize(run: SceneRun, beats: NonNullable<SceneRun['beats']>, intents: (Intent | undefined)[], emit: Emit, replyTo?: { text: string; intent: Intent }, recipient?: string) {
    // the player speaks only through an intent they picked: a model-written line for them any other way is dropped
    const P = this.requireState().playerId;
    const allowed = beats.map((b, i) => b.speaker !== P || intents[i] !== undefined);
    if (allowed.includes(false)) {
      logTrace('blocked-player-line', { scene: run.id, title: run.ev.title, beats: beats.filter((_, i) => !allowed[i]).map((b) => b.beatType) });
      intents = intents.filter((_, i) => allowed[i]);
      beats = beats.filter((_, i) => allowed[i]);
    }
    const capacity = this.phoneCapacity(run);
    if (capacity < beats.length) { beats = beats.slice(0, capacity); intents = intents.slice(0, capacity); run.phoneClosed = true; }
    if (!beats.length) return;
    const s = this.requireState();
    const others = run.ev.participants;
    const listenerFor = (speaker: string) => {
      if (speaker === s.playerId && recipient) return recipient === 'everyone' ? 'everyone' : speakerName(s, recipient);
      if (replyTo) return speakerName(s, s.playerId);
      const o = others.find((x) => x !== speaker);
      return o ? speakerName(s, o) : 'you';
    };
    const base = run.transcript.length;
    if (beats.every(b => b.speaker !== P)) run.retry = { start: base, beats, intents, replyTo, ctx: structuredClone(run.ctx) };
    const started = new Set<number>();
    await this.recallFor(run, beats.map((b) => b.speaker), replyTo?.text);
    const lines = await this.gen.lines(
      s,
      run.ev,
      beats,
      run.transcript,
      intents,
      { ...run.ctx, listener: listenerFor(beats[0].speaker), fact: this.factFor(run, beats[0].speaker), outcomeHint: run.result?.confession === 'rejected' ? 'rejected' : undefined, replyTo, recalled: run.recalled },
      this.budget,
       (i, speaker, beatIndex = i) => {
        if (started.has(i)) return;
        started.add(i);
        const beat = beats[beatIndex];
        emit('line-start', { index: base + i, speaker, name: speakerName(s, speaker), caption: speaker === 'narrator' ? null : captionFor(beat), emotion: lineEmotion(s.characters[speaker], beat.emotion), beatType: beat.beatType, subtext: null });
      },
      (i, token) => emit('token', { index: base + i, token }),
    );
    lines.forEach((l, i) => {
      const beatIndex = l.beatIndex ?? i;
      const caption = l.speaker === 'narrator' ? null : captionFor(beats[beatIndex]);
      logTrace('line', { scene: run.id, index: base + i, speaker: l.speaker, source: l.source, intent: intents[beatIndex], text: l.text.slice(0, 120) });
      run.transcript.push({ ...l, caption, emotion: lineEmotion(this.requireState().characters[l.speaker], beats[beatIndex].emotion) });
      emit('line-end', { index: base + i, speaker: l.speaker, text: l.text, caption, source: l.source });
    });
  }

  /** A fact the speaker actually knows (knowledge invariant) for reveal/gossip lines. */
  private factFor(run: SceneRun, speaker: string): string | undefined {
    const s = this.requireState();
    const fid = run.ev.factRefs[speaker]?.[0];
    return fid && s.knowledge[speaker]?.[fid] ? s.facts[fid]?.content : undefined;
  }

  private queueHouseMeal() {
    if (this.order.some(id => this.runs.get(id)!.phase !== 'done')) return;
    const meal = planHouseMeal(this.requireState());
    if (!meal.plan.scenes.length) return;
    this.state = meal.state;
    this.log('meal', {});
    for (const planned of meal.plan.scenes) {
      const ev = planned.event;
      const run: SceneRun = { id: ev.id, planned, ev, phase: planned.render ? 'new' : 'done', choiceIndex: -1, transcript: [], ctx: { place: placeName(ev.location), catchphraseUses: {}, lineCounts: {} }, rendered: planned.render, said: [] };
      this.runs.set(ev.id, run);
      this.order.push(ev.id);
      if (!planned.render) this.autoResolve(run);
      else this.images.request(locationRequest(ev.location, ev.slot, this.state.world.weather), PRIORITY.currentScene);
    }
  }

  private async finishScene(run: SceneRun, emit: Emit) {
    let s = this.requireState();
    const ev = run.ev;
    // engine choices (player intent + NPC intents), in the same order replay uses
    const ac = autoChoices(s, ev, run.playerIntent);
    s = ac.state;
    this.state = s;
    const conf = content().eventById.get(ev.templateId)!.effects.find((e) => e.confession);
    const preview = conf ? confessionPreview(s, ev.roles[conf.confession![0]], ev.roles[conf.confession![1]], ac.choices) : undefined;
    if (preview) run.result = { confession: preview };
    const rest = run.interrupted || run.endedByPlayer ? [] : run.beats!.slice(Math.max(0, run.choiceIndex));
    const intents = rest.map((b, i) => (i === 0 && run.choiceIndex >= 0 && b.speaker === s.playerId ? run.chosenIntent : undefined)); // typed words alone never make the model speak for you
    await this.realize(run, rest, intents, emit);
    s = this.requireState();
    const closingBudget = run.phoneClosed ? new Budget(0) : this.budget;
    const readingSnapshot = run.endedByPlayer && run.said.length ? structuredClone(s) : undefined;
    // a proposal that moves no feeling (a model shrug) falls back to the engine's
    const rawProposal = run.endedByPlayer ? null : await this.gen.deltas(s, ev, run.transcript, ac.choices, closingBudget);
    const llmProposal = rawProposal ? cleanReading(s, rawProposal, ev.participants, run.transcript) : null;
    const po = proposeOutcome(s, ev, ac.choices);
    s = po.state;
    const moves = llmProposal && hasFeelingDeltas(llmProposal);
    const rs = resolveScene(s, ev, moves ? llmProposal : po.proposal, ac.choices, run.response);
    s = rs.state;
    run.result = { confession: rs.result.effects.confession, leaving: rs.result.effects.leaving, secretRevealed: rs.result.effects.secretRevealed, noticed: rs.result.noticed };
    this.state = s;
    this.log('scene', { feelingScale: FEELING_SCALE, eventId: ev.id, event: ev, episode: ev.episode, title: ev.title, location: ev.location, participants: ev.participants, response: run.response, playerIntent: run.playerIntent, choices: ac.choices, proposal: rs.result.proposal, beats: run.beats, transcript: run.transcript });
    if (ev.location !== 'phone' && run.transcript.length) {
      const lines = run.transcript.map(({ speaker, text }) => ({ speaker, text }));
      this.state = recordConversation(this.state, ev.participants, lines);
      this.log('conversation', { listeners: ev.participants, lines });
    }
    // callbacks recalled in this scene rest for about three episodes (World Info cooldown)
    for (const [id, texts] of Object.entries(run.recalled ?? {})) for (const t of texts) this.recallCooldown.set(`${id}\n${t}`, this.state.world.tick + 15);
    // housemates remember what you actually said; phone conversations stay in the chat thread
    if (run.said.length) {
      this.state = recordPlayerWords(this.state, ev.participants, run.said);
      this.log('words', { listeners: ev.participants, words: run.said });
    }
    if (ev.location === 'phone' && ev.participants.length === 2) {
      const [a, b] = ev.participants;
      const lines = run.transcript.map((l) => ({ speaker: l.speaker, text: l.text }));
      // asked for a picture? the other person's reply comes with a selfie
      const asked = run.said.some((t) => /\b(pic|pics|picture|photo|selfie)\b/i.test(t));
      const photoFrom = asked ? ev.participants.find((id) => id !== this.state!.playerId) : undefined;
      this.state = recordChat(this.state, a, b, lines, photoFrom);
      this.log('chat', { a, b, lines, photoFrom });
    }
    // the clock runs for as long as the player was in (or listening to) the conversation
    if (ev.location !== 'phone' && (ev.participants.includes(this.state.playerId) || run.response === 'eavesdrop')) {
      const lines = run.transcript.slice(run.timedLines ?? 0).filter(l => l.speaker !== 'narrator').length;
      const protectedIds = this.talkingHousemates(run);
      await this.prepareActivities(this.state.world.minutes + lines * MINUTES_PER_LINE, protectedIds);
      this.state = passTime(this.state, lines, protectedIds);
      this.log('time', { lines, protectedIds, minutesPerLine: MINUTES_PER_LINE });
      if (run.phoneClosed && this.state.world.weekday === 5) {
        const left = (18 - SLOT_START[this.state.world.slot]) * 60 - this.state.world.minutes;
        if (left > 0 && left < MINUTES_PER_LINE) {
          this.state = passTime(this.state, left / MINUTES_PER_LINE);
          this.log('time', { lines: left / MINUTES_PER_LINE, minutesPerLine: MINUTES_PER_LINE });
        }
      }
    }
    emit('outcome', { id: ev.id, ...run.result, cues: this.cues(run) });
    if (run.endedByPlayer) {
      run.phase = 'done';
      for (const pending of this.runs.values()) {
        if (pending.phase !== 'done' && pending.ev.type !== 'arrival' && pending.ev.templateId !== 'broadcast-watch') this.autoResolve(pending, 'ignore');
      }
      if (welcomeDinnerDue(this.requireState())) this.queueHouseMeal();
      emit('done', { id: ev.id, scenes: this.summaries(), view: this.view() });
      this.autosave();
      if (readingSnapshot) void this.readPlayerTalk(readingSnapshot, run, ac.choices, rs.result.proposal);
      return;
    }
    // studio commentary (panel reacts; never hints, never mutates state except predictions bookkeeping)
    const pp = panelPrediction(this.requireState());
    this.state = pp.state;
    const cm = await this.gen.commentary(this.state, ev, run.transcript, rs.result.effects.confession, pp.condition, closingBudget);
    const callbacks = this.state.predictions.filter((p) => p.resolved !== null && !p.calledBack).slice(0, 1).map((p) => p.id);
    let prediction: { by: string; condition: PredictionCond; text: string } | undefined;
    if (pp.condition && cm.commentary.prediction) {
      const by = cm.commentary.lines[0]?.speaker ?? 'nagumo';
      prediction = { by, condition: pp.condition, text: cm.source === 'llm' ? cm.commentary.prediction.text : predictionText(this.state, by, pp.condition) };
    } else if (pp.condition && cm.source === 'mock' && run.ev.isPlayerScene && this.state.world.tick % 3 === 0) {
      const by = cm.commentary.lines[0]?.speaker ?? 'nagumo';
      prediction = { by, condition: pp.condition, text: predictionText(this.state, by, pp.condition) };
    }
    const remarks = { episode: ev.episode, participants: ev.participants, lines: cm.commentary.lines, moment: `${ev.templateId} ${ev.title} ${ev.tags.join(' ')}` };
    this.state = recordCommentary(this.state, { prediction, calledBack: callbacks, remarks });
    this.log('commentary', { eventId: ev.id, prediction, calledBack: callbacks, remarks, commentary: cm.commentary, source: cm.source });
    run.commentary = { ...cm.commentary, prediction: prediction ? { text: prediction.text } : undefined };
    if (ev.freeze && ev.participants.includes(this.state.playerId)) { // no CG for scenes the player isn't in
      // Keep dialogue-based actions inside each participant's description.
      const shot = await this.gen.shot(this.state, ev, run.transcript);
      const img = this.images.request(freezeRequest(this.state, ev, (r) => this.images.localFile(r), '', run.transcript, shot, this.outfitOverrides), PRIORITY.freeze);
      run.freeze = { caption: cm.commentary.freezeFrame?.caption ?? 'that moment', image: img.key };
      emit('freeze', { id: ev.id, caption: run.freeze.caption, image: img });
    }
    emit('commentary', { id: ev.id, ...run.commentary, predictionBy: prediction?.by, source: cm.source });
    run.phase = 'done';
    if (welcomeDinnerDue(this.requireState())) this.queueHouseMeal();
    emit('done', { id: ev.id, scenes: this.summaries(), view: this.view() });
  }

  /** Subtle narrative cues for the player (no numbers, no hints). */
  private cues(run: SceneRun): string[] {
    const s = this.requireState();
    const out: string[] = [];
    if (run.result?.confession === 'accepted') out.push(`${firstName(s, run.ev.roles.a)} and ${firstName(s, run.ev.roles.b)} are together now.`);
    if (run.result?.confession === 'rejected') out.push('The answer was no.');
    if (run.result?.secretRevealed) out.push(`Something about ${firstName(s, run.result.secretRevealed)} came out.`);
    for (const id of run.result?.leaving ?? []) out.push(`${firstName(s, id)} has decided to leave the house.`);
    if (run.result?.noticed) out.push('They noticed you listening.');
    return out;
  }

  debug() {
    const s = this.requireState();
    return {
      budget: { cap: this.budget.cap, used: this.budget.used, log: this.budget.log },
      log: s.log.slice(-150),
      voice: this.gen.voice,
      relationships: s.rel,
      characters: Object.values(s.characters).filter((c) => c.status === 'inHouse').map((c) => ({ id: c.id, name: c.name, isPlayer: c.isPlayer, location: c.location, mood: c.mood, energy: c.energy, doing: c.lastAction ?? null, swimming: c.swimming, drunk: c.drunk, hangover: c.hangover })),
      arcs: s.arcs,
      predictions: s.predictions,
      images: this.images.pending(),
      tick: s.world.tick,
    };
  }
}
