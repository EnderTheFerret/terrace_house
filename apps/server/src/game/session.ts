// GameSession: owns the live GameState, runs slots and scenes, logs replayable events, autosaves.
// Only engine functions touch state.rngState, in a fixed order that scripts/replay.ts reproduces.
import type { Recall } from '../llm/recall';
import {
  PlayerAction, SceneResponse, Intent as IntentSchema, autoChoices, captionFor, confessionPreview, createGame, finishSlot, firstName,
  FEELING_SCALE, applyReread, rereadChange, sanitizeProposal, panelPrediction, planSlot, planMoveInArrival, predictionText, projectForPlayer, proposeOutcome, recordCommentary, resolveScene, content, placeName,
  type Commentary, type EventInstance, type GameState, type Intent, type LineContext, type NewGameOptions, type PlannedScene,
   type PlayerEdit, type PlayerSetup, type PredictionCond, type Emotion, type Beat, type ArtworkEdit, classifyIntent, editPlayer, inviteDecision, joinNewPlayer, recordChat, recordPlayerWords, replyBeatType,
   MAX_TYPED_EXCHANGES, passTime, recordDiary, reactionTo, feltEmotion, blockOver, isShabbat, SLOT_START, MINUTES_PER_LINE, occasionFor, occasionForCharacter, outfitFor, typedResponders, queueNpcPlans, SLOT_MINUTES, recordConversation,
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
import { decideActivities } from './autonomy';

export type Emit = (event: string, data: unknown) => void;

/** SEASON_LENGTH=0: the house never closes; housemates keep rotating. */
const REPLY_EMOTION: Partial<Record<Intent, Emotion>> = { flirt: 'shy', confront: 'annoyed', apologize: 'tender', support: 'tender', joke: 'happy', tease: 'happy', confess: 'nervous', decline: 'sad', listen: 'tender' };
const ChoiceSchema = z.object({ intent: IntentSchema.optional(), text: z.string().trim().min(1).max(200).optional(), recipient: z.string().min(1).max(80).optional(), done: z.boolean().optional(), listen: z.boolean().optional(), hangout: z.boolean().optional(), via: z.enum(['button', 'key', 'typed', 'invite']).optional(), invite: z.object({ node: z.string(), date: z.boolean().optional(), with: z.string().optional() }).optional() });
/** How many times the player can stay quiet and let a group keep talking in one scene. */
const MAX_LISTENS = 3;

type Phase = 'new' | 'awaiting-response' | 'awaiting-choice' | 'reply' | 'listen' | 'post' | 'done';

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
  /** rounds the player stayed quiet and let the housemates talk among themselves */
  listened?: number;
  endedByPlayer?: boolean;
  /** a phone message typed before the scene started */
  openingText?: string;
  phoneClosed?: boolean;
  /** memories recalled by meaning per speaker: they stay in that speaker's prompt for the rest of the scene */
  recalled?: Record<string, string[]>;
  timedLines?: number;
  interrupted?: boolean;
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
  order: string[] = [];
  budget = new Budget(config.llmCallsPerSlot);
  digestSince = 0;
  lastEpisodeShown = 0;
  logSeq = 0;
  busy = false;
  intermissionSince = 0;
  pendingIntermission: 'mid' | 'end' | null = null;
  budgetBlock = '';
  private interruptedTalk?: { participants: string[]; transcript: Line[] };
  private lastWorldPulse = 0;

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
      this.autosave();
      return { view: this.view(), scenes: this.summaries() };
    } finally { release(); this.busy = false; }
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
    const seed = o.seed ?? (config.seed ? Number(config.seed) : Math.floor(Math.random() * 2 ** 31));
    const gameId = `g${Date.now().toString(36)}${seed.toString(36)}`;
    const opts: NewGameOptions = { seed, player: o.player, randomizeCast: o.randomizeCast, seasonLength: o.seasonLength ?? config.seasonLength, gameId, moveInDay: o.moveInDay ?? true, moveInVersion: 2 };
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
    this.state = r.state;
    this.interruptedTalk = r.resume;
    this.logSeq = r.row.log_seq;
    this.store.truncateEvents(r.state.gameId, r.row.log_seq); // continuing from a save branches the log
    this.runs.clear();
    this.order = [];
    this.digestSince = r.state.world.tick;
    this.intermissionSince = r.state.world.tick;
    this.budgetBlock = '';
    this.prefetchPortraits();
    return this.view();
  }

  resumeLatest(): boolean {
    const r = this.store.latestAutosave();
    if (!r) return false;
    this.state = r.state;
    this.interruptedTalk = undefined;
    this.logSeq = r.row.log_seq;
    this.digestSince = r.state.world.tick;
    this.intermissionSince = r.state.world.tick;
    return true;
  }

  /** Saving mid-conversation keeps the talk: loading it lets the player pick that conversation up again from the house. */
  save(slot: number, name?: string) {
    if (this.busy) throw new Error('wait for the current line to finish, then save');
    const s = this.requireState();
    const open = this.order.map((id) => this.runs.get(id)!).find((r) => r.rendered && r.phase !== 'done' && r.transcript.length && r.ev.location !== 'phone' && r.ev.participants.includes(s.playerId));
    const resume = open ? { participants: [...open.ev.participants], transcript: open.transcript.slice(-12) } : undefined;
    return this.store.save(slot, s, name ?? `Episode ${s.world.episode} · ${s.world.slot}${resume ? ' · mid-conversation' : ''}`, this.logSeq, resume);
  }

  autosave() {
    const s = this.requireState();
    this.store.save(0, s, `autosave · ep ${s.world.episode} ${s.world.slot}`, this.logSeq);
  }

  prefetchPortraits() {
    const s = this.requireState();
    for (const c of Object.values(s.characters)) if (c.status === 'inHouse') this.images.request(portraitRequest(c), c.isPlayer ? PRIORITY.playerPortrait : PRIORITY.portrait);
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
    finally { this.busy = false; }
  }

  private async actUnlocked(raw: unknown) {
    const s = this.requireState();
    if (s.seasonOver) throw new Error('season is over');
    if (s.awaitingPlayer) throw new Error('your next housemate has to move in first');
    if (this.order.some((id) => this.runs.get(id)!.phase !== 'done')) throw new Error('scenes still pending');
    const action = PlayerAction.parse(raw);
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
        transcript: [],
        ctx: { place: placeName(p.event.location), catchphraseUses: {}, lineCounts: {} },
        rendered: p.render,
        said: [],
        openingText: action.type === 'text' && p.event.isPlayerScene && action.text?.trim() ? action.text.trim() : undefined,
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
   * again, up to MAX_TYPED_EXCHANGES), or end a typed conversation.
   */
  choose(id: string, raw: unknown) {
    const run = this.runs.get(id);
    if (!run || run.phase !== 'awaiting-choice') throw new Error('no choice pending for this scene');
    const c = ChoiceSchema.parse(typeof raw === 'string' ? { intent: raw } : raw);
    logTrace('choose', { scene: id, title: run.ev.title, via: c.via ?? (c.text ? 'typed' : c.invite ? 'invite' : c.intent ? 'unknown' : 'control'), intent: c.intent, text: c.text, recipient: c.recipient, done: c.done, listen: c.listen, hangout: c.hangout, invite: c.invite });
    const recipients = this.listeners(run);
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
    if (c.recipient && !(c.recipient === 'everyone' ? recipients.length >= 2 : recipients.includes(c.recipient))) throw new Error('that housemate cannot respond in this conversation');
    if (c.text) {
      if (run.said.length >= MAX_TYPED_EXCHANGES) throw new Error('that conversation has run its course');
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
    await this.enrichNewCharacters(Object.keys(s.characters));
    this.autosave();
    const ns = this.state;
    if (ns.world.episode !== prevEp) {
      this.prefetchPortraits();
      void this.writeDiaries(prevEp);
    }
    const newEpisode = ns.world.episode !== prevEp || ns.seasonOver;
    // the show cuts to the studio halfway through the day and after the last scene
    this.pendingIntermission = newEpisode ? 'end' : prevSlot === 'slot2' ? 'mid' : null;
    return { view: this.view(), newEpisode, seasonOver: ns.seasonOver, intermission: this.pendingIntermission };
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
    }
  }

  /** The last aired episode as the house saw it on TV: every rendered scene with its transcript (read-only). */
  broadcast() {
    const s = this.requireState();
    const ep = typeof s.world.flags.aired === 'number' ? s.world.flags.aired : null;
    if (ep === null) return { episode: null, scenes: [] };
    const scenes = this.store.events(s.gameId)
      .filter((e) => e.kind === 'scene' && e.payload.episode === ep && e.payload.transcript?.length)
      .map((e) => ({ title: e.payload.title as string, location: placeName(e.payload.location), mine: (e.payload.participants as string[]).includes(s.playerId), lines: (e.payload.transcript as { speaker: string; text: string }[]).map((l) => ({ name: speakerName(s, l.speaker), text: l.text })) }));
    return { episode: ep, scenes };
  }

  private todaysScenes() {
    const s = this.requireState();
    return this.store.events(s.gameId).filter((e) => e.kind === 'scene' && e.payload.episode === s.world.episode && e.payload.transcript?.length);
  }

  /** Every finished scene of the current day with its transcript (read-only), and whether the model has already re-read it. */
  dayLog() {
    const s = this.requireState();
    const scenes = this.todaysScenes().map((e) => ({
      id: e.payload.eventId as string,
      title: e.payload.title as string,
      location: placeName(e.payload.location),
      reread: !!s.world.flags[`reread:${e.payload.eventId}`],
      lines: (e.payload.transcript as Line[]).map((l) => ({ name: speakerName(s, l.speaker), text: l.text })),
    }));
    return { episode: s.world.episode, scenes };
  }

  /**
   * Ask the model to read one finished scene again. Its fresh read replaces what the scene applied (only the difference
   * is added) and writes richer memories. Once per scene; logged so replays and saves reproduce it.
   */
  async reread(id: string) {
    if (this.busy) throw new Error('generation is running');
    const s = this.requireState();
    if (s.world.flags[`reread:${id}`]) throw new Error('the model already re-read this scene');
    const p = this.todaysScenes().find((e) => e.payload.eventId === id)?.payload;
    if (!p?.event) throw new Error("this scene isn't in today's log");
    this.busy = true;
    const release = this.images.hold();
    try {
      const next = await this.gen.deltas(s, p.event as EventInstance, p.transcript as Line[], p.choices ?? {}, new Budget(2));
      if (!next) throw new Error('the dialogue model did not answer; nothing changed');
      const participants = (p.participants as string[]).filter((x) => s.characters[x]);
      const change = rereadChange(sanitizeProposal(next, participants), sanitizeProposal(p.proposal, participants), typeof p.feelingScale === 'number' ? p.feelingScale : 1);
      applyReread(s, id, change, participants);
      this.log('reread', { id, change, participants });
      this.autosave();
      return { view: this.view(), log: this.dayLog() };
    } finally { release(); this.busy = false; }
  }

  /** Studio intermission over the footage since the last one. Text only: never touches game state. */
  async intermission() {
    const s = this.requireState();
    const at = this.pendingIntermission;
    if (!at) throw new Error('no intermission pending');
    this.pendingIntermission = null;
    const r = await this.gen.intermission(s, at, this.intermissionSince, new Budget(2));
    this.intermissionSince = s.world.tick;
    this.log('intermission', { at, ...r });
    return { at, ...r.commentary, source: r.source };
  }

  // ------------------------------------------------------------ scene streaming

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
    return this.images.request(freezeRequest(s, ev, (r) => this.images.localFile(r), context, run.transcript, poses), PRIORITY.currentScene);
  }

  /** Run the next segment of a scene, emitting SSE events. Resolves when the segment ends. */
  async stream(id: string, emit: Emit) {
    const run = this.runs.get(id);
    if (!run) throw new Error('unknown scene');
    if (this.busy) throw new Error('another scene segment is running');
    this.busy = true;
    const release = this.images.hold(); // one GPU: dialogue first, images after the segment
    // every scene gets its own call budget: a block-wide one ran dry on the first scene and templated the rest
    if (run.phase === 'new') this.budget = new Budget(config.llmCallsPerScene);
    try {
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
        emit('scene', this.sceneHeader(run, await this.gen.flavor(run.ev.premise, this.budget)));
        const sheet = await this.gen.beatSheet(s, run.ev, this.budget);
        run.beats = sheet.beats;
        const playerIn = run.ev.participants.includes(s.playerId) && run.response !== 'eavesdrop';
        run.choiceIndex = playerIn ? (sheet.choiceIndex >= 0 ? sheet.choiceIndex : Math.min(2, sheet.beats.length - 1)) : -1;
        const pre = run.choiceIndex >= 0 ? run.beats.slice(0, run.choiceIndex) : run.beats;
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
      if (run.phase === 'reply') return await this.reply(run, emit);
      if (run.phase === 'listen') return await this.listen(run, emit);
      if (run.phase === 'post') await this.finishScene(run, emit);
    } finally {
      this.busy = false;
      release();
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
      outsiders: Object.entries(run.ev.roles).filter(([, v]) => !s.characters[v]).map(([, v]) => ({ id: v, name: speakerName(s, v) })),
      isPlayerScene: run.ev.isPlayerScene,
      eavesdrop: run.response === 'eavesdrop',
      background: this.images.request(locationRequest(run.ev.location, run.ev.slot, s.world.weather), PRIORITY.currentScene),
      chat: run.ev.location === 'phone',
      intro: run.ev.type === 'arrival' && s.characters[run.ev.roles.a] ? (({ id, name, age, occupation, hometown }) => ({ id, name, age, occupation, hometown }))(s.characters[run.ev.roles.a]) : null,
      moveIn: s.world.episode === 1 && !!s.world.flags.gradualMoveIn,
    };
  }

  private choiceEvent(run: SceneRun) {
    return { id: run.id, intents: run.ev.intents, canType: run.said.length < MAX_TYPED_EXCHANGES, canEnd: run.said.length > 0 || !!run.listened, canListen: (run.listened ?? 0) < MAX_LISTENS && this.listeners(run).length >= 2, recipients: this.listeners(run).map(id => ({ id, name: speakerName(this.requireState(), id) })) };
  }

  private talkingHousemates(run: SceneRun) {
    if (run.ev.location === 'phone') return [];
    return run.ev.participants;
  }

  private async offerChoice(run: SceneRun, emit: Emit) {
    const s = this.requireState();
    const lines = run.transcript.length - (run.timedLines ?? 0);
    const protectedIds = this.talkingHousemates(run);
    if (run.ev.participants.includes(s.playerId) || run.response === 'eavesdrop') {
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

  private phoneCapacity(run: SceneRun) {
    if (run.ev.location !== 'phone') return Infinity;
    const s = this.requireState();
    const observers = run.ev.participants.map(id => s.characters[id]).filter(c => c?.persona.keepsShabbat);
    if (!observers.length) return Infinity;
    const virtual = { ...s, world: { ...s.world, minutes: s.world.minutes + (run.transcript.length - (run.timedLines ?? 0)) * MINUTES_PER_LINE } };
    if (observers.some(c => isShabbat(virtual, c))) return 0;
    if (s.world.weekday !== 5) return Infinity;
    const left = (18 - SLOT_START[s.world.slot]) * 60 - virtual.world.minutes;
    return Math.max(0, Math.floor(left / MINUTES_PER_LINE));
  }

  /** Housemates in the scene who can talk among themselves (not the player, not anyone busy asleep or on the phone). */
  private listeners(run: SceneRun) {
    const s = this.requireState();
    return run.ev.location === 'phone' ? [] : run.ev.participants.filter((id) => id !== s.playerId && !['sleep', 'nap', 'text'].includes(s.characters[id]?.lastAction ?? ''));
  }

  /**
   * The player stays quiet: two housemates keep the conversation going (SillyTavern auto mode). Talkative and engaged
   * people speak first; nobody takes two turns in a row.
   */
  private async listen(run: SceneRun, emit: Emit) {
    const s = this.requireState();
    run.listened = (run.listened ?? 0) + 1;
    const last = run.transcript.at(-1)?.speaker;
    const keen = (id: string) => s.characters[id].persona.traits[2] + s.characters[id].mood * 0.3 + (last && s.rel[id]?.[last] ? s.rel[id][last].affinity / 200 : 0);
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
    const invite = run.pendingInvite;
    run.pendingText = undefined;
    run.pendingIntent = undefined;
    run.pendingRecipient = undefined;
    run.pendingInvite = undefined;
    if (chosenIntent) {
      const beat: Beat = { ...run.beats![run.choiceIndex], speaker: s.playerId };
      if (recipient) beat.intent += `; address ${recipient === 'everyone' ? 'everyone' : speakerName(s, recipient)} directly`;
      await this.realize(run, [beat], [chosenIntent], emit, undefined, recipient);
      text = run.transcript.at(-1)!.text;
    }
    if (!text) throw new Error('no reply pending for this scene');
    const intent = chosenIntent ?? classifyIntent(text, run.ev.intents);
    const replyIntent = chosenIntent ?? classifyIntent(text, ['decline', ...run.ev.intents]);
    run.playerIntent = intent;
    run.said.push(text);
    const P = s.playerId;
    const idx = run.transcript.length;
    if (!chosenIntent) {
      emit('line-start', { index: idx, speaker: P, name: speakerName(s, P), caption: null, emotion: 'neutral', beatType: 'smalltalk', subtext: null });
      emit('token', { index: idx, token: text });
      run.transcript.push({ speaker: P, text, source: 'player', emotion: feltEmotion(text) ?? undefined });
      emit('line-end', { index: idx, speaker: P, text, caption: null, source: 'player' });
    }
    const responders = invite ? [invite.target] : run.ev.location === 'phone' ? run.ev.participants.filter(id => id !== P) : recipient ? recipient === 'everyone' ? this.listeners(run) : [recipient] : chosenIntent ? this.listeners(run) : typedResponders(s, run.ev.participants, run.transcript, text);
    // an invitation is answered from how they feel about the player and what was just said; the line is written to match
    const verdict = invite ? inviteDecision(s, invite.target, run.transcript, { date: invite.date, seed: `${s.world.tick}:${text}` }) : undefined;
    if (responders.length) {
      this.budget.cap++; // typed talk is the player's call: each answer gets its own LLM call
      const topic = run.beats?.[0]?.topic ?? 'small talk';
      const beat = (speaker: string, why: string): Beat => ({ speaker, intent: why, emotion: reactionTo(text) ?? REPLY_EMOTION[replyIntent] ?? 'neutral', beatType: replyBeatType(replyIntent, s.characters[speaker]), subtext: '', depth: run.ev.depthCeiling, topic });
      const answer = (speaker: string): Beat => {
        if (!invite || !verdict) return beat(speaker, recipient && recipient !== 'everyone' ? `answer the player, who is addressing ${speakerName(s, speaker)} directly` : 'answer the player');
        const where = placeName(invite.node);
        return { ...beat(speaker, verdict.accept ? `answer the player's invitation to ${where}: say yes warmly and agree to go together right now` : `answer the player's invitation to ${where}: turn it down kindly because you ${verdict.reason}; do not agree to go`), emotion: verdict.accept ? 'happy' : 'awkward', beatType: verdict.accept ? 'smalltalk' : 'deflect' };
      };
      await this.realize(run, responders.map(answer), responders.map(() => undefined), emit, { text, intent: replyIntent });
    }
    if (invite && verdict) emit('invite', { from: invite.target, name: speakerName(s, invite.target), node: invite.node, date: invite.date, accepted: verdict.accept, reason: verdict.reason });
    if (run.phoneClosed || this.phoneCapacity(run) === 0) {
      run.phoneClosed = true;
      run.phase = 'post';
      return this.finishScene(run, emit);
    }
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
      (i, speaker) => {
        if (started.has(i)) return;
        started.add(i);
        emit('line-start', { index: base + i, speaker, name: speakerName(s, speaker), caption: captionFor(beats[i]), emotion: beats[i].emotion, beatType: beats[i].beatType, subtext: null });
      },
      (i, token) => emit('token', { index: base + i, token }),
    );
    lines.forEach((l, i) => {
      const caption = captionFor(beats[i]);
      logTrace('line', { scene: run.id, index: base + i, speaker: l.speaker, source: l.source, intent: intents[i], text: l.text.slice(0, 120) });
      run.transcript.push({ ...l, caption, emotion: beats[i].emotion });
      emit('line-end', { index: base + i, speaker: l.speaker, text: l.text, caption, source: l.source });
    });
  }

  /** A fact the speaker actually knows (knowledge invariant) for reveal/gossip lines. */
  private factFor(run: SceneRun, speaker: string): string | undefined {
    const s = this.requireState();
    const fid = run.ev.factRefs[speaker]?.[0];
    return fid && s.knowledge[speaker]?.[fid] ? s.facts[fid]?.content : undefined;
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
    // a proposal that moves no feeling (a model shrug) falls back to the engine's
    const llmProposal = run.endedByPlayer ? null : await this.gen.deltas(s, ev, run.transcript, ac.choices, closingBudget);
    const po = proposeOutcome(s, ev, ac.choices);
    s = po.state;
    const moves = llmProposal && [llmProposal.affinityDeltas, llmProposal.romanceDeltas, llmProposal.tensionDeltas, llmProposal.trustDeltas].some((d) => d.length);
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
    if (ev.participants.includes(this.state.playerId) || run.response === 'eavesdrop') {
      const lines = run.transcript.length - (run.timedLines ?? 0);
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
        if (pending.phase !== 'done' && pending.ev.type !== 'arrival') this.autoResolve(pending, 'ignore');
      }
      emit('done', { id: ev.id, scenes: this.summaries(), view: this.view() });
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
    const remarks = { episode: ev.episode, participants: ev.participants, lines: cm.commentary.lines.map((l) => ({ text: l.text })), moment: `${ev.templateId} ${ev.title} ${ev.tags.join(' ')}` };
    this.state = recordCommentary(this.state, { prediction, calledBack: callbacks, remarks });
    this.log('commentary', { eventId: ev.id, prediction, calledBack: callbacks, remarks, commentary: cm.commentary, source: cm.source });
    run.commentary = { ...cm.commentary, prediction: prediction ? { text: prediction.text } : undefined };
    if (ev.freeze) {
      // Keep dialogue-based actions inside each participant's description.
      const shot = await this.gen.shot(this.state, ev, run.transcript);
      const img = this.images.request(freezeRequest(this.state, ev, (r) => this.images.localFile(r), '', run.transcript, shot), PRIORITY.freeze);
      run.freeze = { caption: cm.commentary.freezeFrame?.caption ?? 'that moment', image: img.key };
      emit('freeze', { id: ev.id, caption: run.freeze.caption, image: img });
    }
    emit('commentary', { id: ev.id, ...run.commentary, predictionBy: prediction?.by, source: cm.source });
    run.phase = 'done';
    emit('done', { id: ev.id, scenes: this.summaries(), view: this.view() });
  }

  /** Subtle narrative cues for the player (no numbers, no hints). */
  private cues(run: SceneRun): string[] {
    const s = this.requireState();
    const out: string[] = [];
    if (run.phoneClosed) out.push('The phone is put away for Shabbat. You can talk in person, or message after Saturday evening.');
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
      arcs: s.arcs,
      predictions: s.predictions,
      images: this.images.pending(),
      tick: s.world.tick,
    };
  }
}
