// GameSession: owns the live GameState, runs slots and scenes, logs replayable events, autosaves.
// Only engine functions touch state.rngState, in a fixed order that scripts/replay.ts reproduces.
import {
  PlayerAction, SceneResponse, Intent as IntentSchema, autoChoices, captionFor, confessionPreview, createGame, finishSlot, firstName,
  panelPrediction, planSlot, predictionText, projectForPlayer, proposeOutcome, recordCommentary, resolveScene, content, placeName,
  type Commentary, type EventInstance, type GameState, type Intent, type LineContext, type NewGameOptions, type PlannedScene,
  type PlayerSetup, type PredictionCond,
} from '@shared-roof/shared';
import type { Store } from '../db';
import { Budget } from '../llm/structured';
import { Generator, speakerName, type Line } from './generate';
import type { ImageQueue } from '../image/queue';
import { PRIORITY } from '../image/queue';
import { freezeRequest, locationRequest, portraitRequest } from '../image/requests';
import { config } from '../config';

export type Emit = (event: string, data: unknown) => void;

type Phase = 'new' | 'awaiting-response' | 'awaiting-choice' | 'post' | 'done';

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
  ctx: LineContext;
  result?: { confession?: string; leaving?: string[]; secretRevealed?: string; noticed?: boolean };
  commentary?: Commentary;
  freeze?: { caption: string; image?: string };
  rendered: boolean;
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

  constructor(
    public store: Store,
    public gen: Generator,
    public images: ImageQueue,
  ) {}

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

  newGame(o: { seed?: number; player?: PlayerSetup; randomizeCast?: boolean }) {
    const seed = o.seed ?? (config.seed ? Number(config.seed) : Math.floor(Math.random() * 2 ** 31));
    const gameId = `g${Date.now().toString(36)}${seed.toString(36)}`;
    const opts: NewGameOptions = { seed, player: o.player, randomizeCast: o.randomizeCast, seasonLength: config.seasonLength, gameId };
    this.state = createGame(opts);
    this.runs.clear();
    this.order = [];
    this.store.truncateEvents(gameId, 0);
    this.logSeq = 0;
    this.log('new', opts);
    this.digestSince = 0;
    this.lastEpisodeShown = 0;
    this.prefetchPortraits();
    this.autosave();
    return this.view();
  }

  load(saveId: number) {
    const r = this.store.load(saveId);
    if (!r) throw new Error('save not found');
    this.state = r.state;
    this.logSeq = r.row.log_seq;
    this.store.truncateEvents(r.state.gameId, r.row.log_seq); // continuing from a save branches the log
    this.runs.clear();
    this.order = [];
    this.digestSince = r.state.world.tick;
    this.prefetchPortraits();
    return this.view();
  }

  resumeLatest(): boolean {
    const r = this.store.latestAutosave();
    if (!r) return false;
    this.state = r.state;
    this.logSeq = r.row.log_seq;
    this.digestSince = r.state.world.tick;
    return true;
  }

  save(slot: number, name?: string) {
    const s = this.requireState();
    if (this.order.some((id) => this.runs.get(id)!.phase !== 'done')) throw new Error('finish the current scenes before saving');
    return this.store.save(slot, s, name ?? `Episode ${s.world.episode} · ${s.world.slot}`, this.logSeq);
  }

  autosave() {
    const s = this.requireState();
    this.store.save(0, s, `autosave · ep ${s.world.episode} ${s.world.slot}`, this.logSeq);
  }

  prefetchPortraits() {
    const s = this.requireState();
    for (const c of Object.values(s.characters)) if (c.status === 'inHouse') this.images.request(portraitRequest(c), c.isPlayer ? PRIORITY.playerPortrait : PRIORITY.portrait);
  }

  // ------------------------------------------------------------ slots

  act(raw: unknown) {
    const s = this.requireState();
    if (s.seasonOver) throw new Error('season is over');
    if (this.order.some((id) => this.runs.get(id)!.phase !== 'done')) throw new Error('scenes still pending');
    const action = PlayerAction.parse(raw);
    this.budget.reset();
    this.digestSince = s.world.tick;
    const { state, plan } = planSlot(s, action);
    this.state = state;
    this.log('action', { action });
    this.runs.clear();
    this.order = [];
    const sorted = [...plan.scenes].sort((a, b) => b.priority - a.priority);
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

  choose(id: string, raw: unknown) {
    const run = this.runs.get(id);
    if (!run || run.phase !== 'awaiting-choice') throw new Error('no choice pending for this scene');
    const intent = IntentSchema.parse(raw);
    if (!run.ev.intents.includes(intent)) throw new Error('intent not offered in this scene');
    run.playerIntent = intent;
    run.phase = 'post';
  }

  endSlot() {
    const s = this.requireState();
    if (this.order.some((id) => this.runs.get(id)!.phase !== 'done')) throw new Error('scenes still pending');
    const prevEp = s.world.episode;
    this.state = finishSlot(s);
    this.log('end-slot', {});
    this.runs.clear();
    this.order = [];
    this.autosave();
    const ns = this.state;
    if (ns.world.episode !== prevEp) this.prefetchPortraits();
    return { view: this.view(), newEpisode: ns.world.episode !== prevEp || ns.seasonOver, seasonOver: ns.seasonOver };
  }

  // ------------------------------------------------------------ scene streaming

  /** Run the next segment of a scene, emitting SSE events. Resolves when the segment ends. */
  async stream(id: string, emit: Emit) {
    const run = this.runs.get(id);
    if (!run) throw new Error('unknown scene');
    if (this.busy) throw new Error('another scene segment is running');
    this.busy = true;
    try {
      if (run.phase === 'awaiting-response') {
        emit('respond', { id, options: ['join', 'eavesdrop', 'ignore'], premise: run.ev.premise });
        return;
      }
      if (run.phase === 'awaiting-choice') {
        emit('choice', { id, intents: run.ev.intents });
        return;
      }
      if (run.phase === 'done') {
        emit('done', { id, replay: true, transcript: run.transcript, commentary: run.commentary, result: run.result, freeze: run.freeze });
        return;
      }
      const s = this.requireState();
      if (run.phase === 'new') {
        const loc = this.images.request(locationRequest(run.ev.location, run.ev.slot, s.world.weather), PRIORITY.currentScene);
        emit('scene', {
          id,
          title: run.ev.title,
          premise: await this.gen.flavor(run.ev.premise, this.budget),
          location: run.ev.location,
          locationName: placeName(run.ev.location),
          participants: run.ev.participants.map((p) => ({ id: p, name: speakerName(s, p) })),
          outsiders: Object.entries(run.ev.roles).filter(([, v]) => !s.characters[v]).map(([, v]) => ({ id: v, name: speakerName(s, v) })),
          isPlayerScene: run.ev.isPlayerScene,
          eavesdrop: run.response === 'eavesdrop',
          background: loc,
          chat: run.ev.location === 'phone',
        });
        const sheet = await this.gen.beatSheet(s, run.ev, this.budget);
        run.beats = sheet.beats;
        const playerIn = run.ev.participants.includes(s.playerId) && run.response !== 'eavesdrop';
        run.choiceIndex = playerIn ? (sheet.choiceIndex >= 0 ? sheet.choiceIndex : Math.min(2, sheet.beats.length - 1)) : -1;
        const pre = run.choiceIndex >= 0 ? run.beats.slice(0, run.choiceIndex) : run.beats;
        await this.realize(run, pre, pre.map(() => undefined), emit);
        if (run.choiceIndex >= 0) {
          run.phase = 'awaiting-choice';
          emit('choice', { id, intents: run.ev.intents });
          return;
        }
        run.phase = 'post';
      }
      if (run.phase === 'post') await this.finishScene(run, emit);
    } finally {
      this.busy = false;
    }
  }

  private async realize(run: SceneRun, beats: NonNullable<SceneRun['beats']>, intents: (Intent | undefined)[], emit: Emit) {
    if (!beats.length) return;
    const s = this.requireState();
    const others = run.ev.participants;
    const listenerFor = (speaker: string) => {
      const o = others.find((x) => x !== speaker);
      return o ? speakerName(s, o) : 'you';
    };
    const base = run.transcript.length;
    const started = new Set<number>();
    const lines = await this.gen.lines(
      s,
      run.ev,
      beats,
      run.transcript,
      intents,
      { ...run.ctx, listener: listenerFor(beats[0].speaker), fact: this.factFor(run, beats[0].speaker), outcomeHint: run.result?.confession === 'rejected' ? 'rejected' : undefined },
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
      run.transcript.push({ ...l, caption });
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
    const rest = run.beats!.slice(Math.max(0, run.choiceIndex));
    const intents = rest.map((b, i) => (i === 0 && run.choiceIndex >= 0 && b.speaker === s.playerId ? run.playerIntent : undefined));
    await this.realize(run, rest, intents, emit);
    s = this.requireState();
    const llmProposal = await this.gen.deltas(s, ev, run.transcript, ac.choices, this.budget);
    const po = proposeOutcome(s, ev, ac.choices);
    s = po.state;
    const rs = resolveScene(s, ev, llmProposal ?? po.proposal, ac.choices, run.response);
    s = rs.state;
    run.result = { confession: rs.result.effects.confession, leaving: rs.result.effects.leaving, secretRevealed: rs.result.effects.secretRevealed, noticed: rs.result.noticed };
    this.state = s;
    this.log('scene', { eventId: ev.id, response: run.response, playerIntent: run.playerIntent, choices: ac.choices, proposal: rs.result.proposal });
    emit('outcome', { id: ev.id, ...run.result, cues: this.cues(run) });
    // studio commentary (panel reacts; never hints, never mutates state except predictions bookkeeping)
    const pp = panelPrediction(this.requireState());
    this.state = pp.state;
    const cm = await this.gen.commentary(this.state, ev, run.transcript, rs.result.effects.confession, pp.condition, this.budget);
    const callbacks = this.state.predictions.filter((p) => p.resolved !== null && !p.calledBack).slice(0, 1).map((p) => p.id);
    let prediction: { by: string; condition: PredictionCond; text: string } | undefined;
    if (pp.condition && cm.commentary.prediction) {
      const by = cm.commentary.lines[0]?.speaker ?? 'nagumo';
      prediction = { by, condition: pp.condition, text: cm.source === 'llm' ? cm.commentary.prediction.text : predictionText(this.state, by, pp.condition) };
    } else if (pp.condition && cm.source === 'mock' && run.ev.isPlayerScene && this.state.world.tick % 3 === 0) {
      const by = cm.commentary.lines[0]?.speaker ?? 'nagumo';
      prediction = { by, condition: pp.condition, text: predictionText(this.state, by, pp.condition) };
    }
    this.state = recordCommentary(this.state, { prediction, calledBack: callbacks });
    this.log('commentary', { eventId: ev.id, prediction, calledBack: callbacks });
    run.commentary = { ...cm.commentary, prediction: prediction ? { text: prediction.text } : undefined };
    if (ev.freeze || cm.commentary.freezeFrame) {
      const img = this.images.request(freezeRequest(this.state, ev), PRIORITY.freeze);
      run.freeze = { caption: cm.commentary.freezeFrame?.caption ?? 'that moment', image: img.key };
      emit('freeze', { id: ev.id, caption: run.freeze.caption, image: img });
    }
    emit('commentary', { id: ev.id, ...run.commentary, predictionBy: prediction?.by, source: cm.source });
    run.phase = 'done';
    emit('done', { id: ev.id });
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
      arcs: s.arcs,
      predictions: s.predictions,
      images: this.images.pending(),
      tick: s.world.tick,
    };
  }
}
