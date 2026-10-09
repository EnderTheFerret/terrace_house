// Generation service: wires prompts + LLM client + mock fallback + budget + voice checks.
import {
  BeatSheet, Commentary, DeltaProposal, BANNED_META, content, firstName, guestCharacter, hashSeed, mockBeatSheet, mulberry32, voiceCheck, placeName, isShabbat, sanitizeProposal, hasFeelingDeltas, typedAffinityFallback, planFromWords,
  type Beat, type PlanRead, type Emotion, type EventInstance, type Footage, type GameState, type Intent, type LineContext, type LlmClient, type PredictionCond, type SceneChoices,
} from '@shared-roof/shared';
import { config } from '../config';
import { MockLlm } from '../llm/mock';
import { structured, logFailure, extractJson, type Budget } from '../llm/structured';
import { beatSheetPrompt, deltaPrompt, linesPrompt, parseLines } from '../prompts/scene';
import { broadcastClipPrompt, chatPrompt, commentaryPrompt, flavorPrompt, freshBeatPrompt, intermissionPrompt, overheardPrompt, shotIds, shotPrompt } from '../prompts/studio';
import { contentCheck } from './personas';
import { diaryPrompt, planReadPrompt } from '../prompts/common';
import { dialogueCheck, splitReply } from '../prompts/dialogue';

const PLAN_READ_SCHEMA = { type: 'object', properties: { agreed: { type: 'boolean' }, place: { type: 'string' }, when: { type: 'string' }, date: { type: 'boolean' }, cancel: { type: 'boolean' }, meeting: { type: 'boolean' }, topic: { type: 'string' } }, required: ['agreed', 'place', 'when', 'date', 'cancel', 'meeting', 'topic'] };
const DIARY_SCHEMA ={ type: 'object', properties: { diary: { type: 'string' }, pairs: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, summary: { type: 'string' } }, required: ['name', 'summary'] } } }, required: ['diary', 'pairs'] };

export interface Line {
  speaker: string;
  text: string;
  caption?: string | null;
  source: 'llm' | 'mock' | 'player';
  /** how the speaker felt saying it: stages their pose in scene images */
  emotion?: Emotion;
  /** Explicit addressee for a player's typed line; retained for relationship readings. */
  recipient?: string;
  beatIndex?: number;
}

export class VoiceStats {
  samples: Record<string, string[]> = {};
  fails: Record<string, number> = {};
  add(id: string, text: string) {
    const arr = (this.samples[id] ??= []);
    arr.push(text);
    if (arr.length > 200) arr.shift();
  }
}

export class Generator {
  readonly mock = new MockLlm();
  voice = new VoiceStats();
  constructor(public llm: LlmClient, public linesLlm: LlmClient = llm) {}

  get real() {
    return this.llm.name !== 'mock';
  }

  /** Stage 1: beat sheet. LLM output is validated, speakers sanitized; the player's choice point is engine-defined. */
  async beatSheet(s: GameState, ev: EventInstance, budget: Budget): Promise<{ beats: Beat[]; choiceIndex: number; source: 'llm' | 'mock' }> {
    const local = mockBeatSheet(s, mulberry32(hashSeed(ev.id)), ev);
    if (!this.real) return { beats: local.sheet.beats, choiceIndex: local.choiceIndex, source: 'mock' };
    const r = await structured(this.llm, this.mock, { kind: 'beats', prompt: beatSheetPrompt(s, ev), temperature: config.temps.beats, maxTokens: 700, context: { kind: 'beats', state: s, event: ev } }, BeatSheet, budget);
    const valid = new Set([...ev.participants, ...Object.values(ev.roles)]);
    const player = s.playerId;
    const npcVoice = [...ev.participants, ...Object.values(ev.roles)].find((p) => p !== player) ?? ev.participants[0];
    // the player only speaks at the engine-defined choice beat; any other player beat goes to an NPC
    let beats = r.value.beats.map((b) => (!valid.has(b.speaker) || b.speaker === player ? { ...b, speaker: npcVoice } : b));
    let choiceIndex = local.choiceIndex;
    if (choiceIndex >= 0) {
      choiceIndex = Math.min(choiceIndex, beats.length);
      beats = [...beats.slice(0, choiceIndex), { ...local.sheet.beats[local.choiceIndex], speaker: player }, ...beats.slice(choiceIndex)].slice(0, 8);
    }
    return { beats, choiceIndex, source: r.source };
  }

  /**
   * Stage 2: realize beats as lines, streaming tokens via onToken. One LLM call for the batch; each line gets a
    * meta check with one regeneration, then template fallback. Scene actions remain part of the reply.
   */
  async lines(
    s: GameState,
    ev: EventInstance,
    beats: Beat[],
    transcript: Line[],
    intents: (Intent | undefined)[],
    ctx: LineContext,
    budget: Budget,
    onLineStart: (i: number, speaker: string, beatIndex?: number) => void,
    onToken: (i: number, token: string) => void,
  ): Promise<Line[]> {
    const mockReq = (bs: Beat[], ins: (Intent | undefined)[]) => ({
      kind: 'lines' as const,
      prompt: `${ev.id}|${transcript.length + out.length}|${bs.map((b) => b.beatType).join(',')}|${ctx.replyTo?.text ?? ''}`,
      temperature: 0,
      context: { kind: 'lines', state: s, beats: bs, ctx: { ...ctx, event: ev }, intents: ins },
    });
    const out: Line[] = [];
    const norm = (t: string) => t.toLowerCase().replace(/[^a-z' ]/g, '').trim();
    const finish = (i: number, text: string, source: 'llm' | 'mock') => {
      const b = beats[i];
      const parts = ev.location === 'phone' ? [{ text, narration: false }] : splitReply(text, ev.participants.map(id => speakerName(s, id)));
      for (const part of parts) {
        // a model (or a stand-in for a failed model line) looping: drop a longer line or stage direction this scene already has
        if ((source === 'llm' || this.linesLlm.name !== 'mock') && norm(part.text).length >= 12 && [...transcript, ...out].some((l) => norm(l.text) === norm(part.text))) continue;
        const index = out.length;
        const speaker = part.narration ? 'narrator' : b.speaker;
        onLineStart(index, speaker, i);
        for (const token of part.text.split(/(?<=\s)/)) onToken(index, token);
        out.push({ speaker, text: part.text, source, beatIndex: i });
        if (!part.narration) this.voice.add(b.speaker, part.text);
      }
    };
    let texts: (string | null)[] = beats.map(() => null);
    // Keep explicit refusals unambiguous even when a small model ignores the boundary.
    if (ctx.replyTo?.intent !== 'decline' && this.linesLlm.name !== 'mock' && budget.take()) {
      try {
        const prompt = linesPrompt(s, ev, beats, transcript, intents, ctx.replyTo?.text, ctx.recalled);
        let buf = '';
        for await (const tok of this.linesLlm.stream({ kind: 'lines', prompt, temperature: config.temps.lines, maxTokens: 512 * beats.length })) buf += tok;
        // Validate before displaying: a rejected line must never flash on screen.
        texts = parseLines(buf, beats, true);
      } catch (e) {
        logFailure(`lines:${ev.id}`, (e as Error).message, 'lines');
      }
    }
    for (let i = 0; i < beats.length; i++) {
      const b = beats[i];
      const c = s.characters[b.speaker];
      let text = texts[i];
      let source: 'llm' | 'mock' = 'llm';
      if (text && !contentCheck(text)) text = null;
      if (text && [...transcript, ...out].some((l) => norm(l.text) === norm(text!)) && norm(text).length >= 12) text = null; // looped on an earlier line: use the stand-in
      if (text && ev.location === 'phone' && !dialogueCheck(text, ev.participants.map(id => speakerName(s, id))).ok) text = null;
      if (text) {
        // ponytail: cadence counts actions as speech; keep the meta guard for scenes and cadence checks for phone messages.
        const vc = { ok: !BANNED_META.some(re => re.test(text!)), reasons: ['out-of-character meta commentary'] };
        if (!vc.ok) {
          this.voice.fails[b.speaker] = (this.voice.fails[b.speaker] ?? 0) + 1;
          text = null;
          if (budget.take()) {
            try {
              const raw = await this.linesLlm.complete({ kind: 'lines', prompt: linesPrompt(s, ev, [b], transcript, [intents[i]], ctx.replyTo?.text, ctx.recalled) +`\n(Previous attempt failed: ${vc.reasons.join('; ')})`, temperature: config.temps.lines, maxTokens: 512 });
              const retry = parseLines(raw, [b], true)[0];
              if (retry && contentCheck(retry) && !BANNED_META.some(re => re.test(retry))) text = retry;
            } catch {
              /* fall through to template */
            }
          }
        }
      }
      if (!text) {
        source = 'mock';
        text = (await this.mock.complete(mockReq([b], [intents[i]]))).replace(/^[\w-]+:\s*/, '');
      }
      finish(i, text, source);
      ctx.lineCounts[b.speaker] = (ctx.lineCounts[b.speaker] ?? 0) + 1;
      if (c?.persona.speech.catchphrase && text.includes(c.persona.speech.catchphrase.text)) ctx.catchphraseUses[b.speaker] = (ctx.catchphraseUses[b.speaker] ?? 0) + 1;
    }
    return out;
  }

  async deltas(s: GameState, ev: EventInstance, transcript: Line[], choices: SceneChoices, budget: Budget): Promise<DeltaProposal | null> {
    if (this.linesLlm.name === 'mock') return typedAffinityFallback(s, ev.participants, transcript);
    const r = await structured(this.linesLlm, this.mock, { kind: 'deltas', prompt: deltaPrompt(s, ev, transcript, choices), temperature: config.temps.deltas, maxTokens: 600, context: { kind: 'deltas', state: s, event: ev, choices } }, DeltaProposal, budget);
    const read = sanitizeProposal(r.value, ev.participants);
    return r.source === 'llm' && hasFeelingDeltas(read) ? read : typedAffinityFallback(s, ev.participants, transcript);
  }

  async commentary(s: GameState, ev: EventInstance, transcript: Line[], outcome: 'accepted' | 'rejected' | 'none' | undefined, cond: PredictionCond | null, budget: Budget): Promise<{ commentary: Commentary; source: 'llm' | 'mock' }> {
    const r = await structured(
      this.llm,
      this.mock,
      { kind: 'commentary', prompt: commentaryPrompt(s, ev, transcript, outcome, cond), temperature: config.temps.commentary, maxTokens: 600, context: { kind: 'commentary', state: s, event: ev, outcome, predictionCond: cond } },
      Commentary,
      budget,
    );
    // panel never mutates state or hints; keep only known panelist ids
    const ids = new Set(content().panel.map((p) => p.id));
    const lines = r.value.lines.filter((l) => ids.has(l.speaker));
    const commentary: Commentary = { ...r.value, lines: lines.length ? lines : r.value.lines.slice(0, 1).map((l) => ({ ...l, speaker: 'nagumo' })) };
    return { commentary, source: r.source };
  }

  async intermission(s: GameState, at: 'mid' | 'end', since: number, budget: Budget, footage: Footage[] = []): Promise<{ commentary: Commentary; source: 'llm' | 'mock' }> {
    const r = await structured(this.llm, this.mock, { kind: 'commentary', prompt: intermissionPrompt(s, at, since, footage), temperature: config.temps.commentary, maxTokens: 900, context: { kind: 'intermission', state: s, at, since, footage } }, Commentary, budget);
    const ids = new Set(content().panel.map((p) => p.id));
    const lines = r.value.lines.filter((l) => ids.has(l.speaker));
    return { commentary: { lines: lines.length ? lines : r.value.lines.slice(0, 1).map((l) => ({ ...l, speaker: 'nagumo' })) }, source: r.source };
  }

  /** `note`: what the engine already decided the reply must do (e.g. agree to a proposed plan). */
  async chat(s: GameState, from: string, to: string, budget: Budget, note?: string): Promise<string> {
    const thread = (s.chats[[from, to].sort().join('|')] ?? []).map((m) => ({ from: m.from, text: m.text, tick: m.tick }));
    const req = { kind: 'chat' as const, prompt: chatPrompt(s, from, to, thread, note), temperature: config.temps.chat, maxTokens: 160, context: { kind: 'chat', state: s, from, to } };
    if (this.linesLlm.name !== 'mock' && budget.take()) {
      try {
        const t = (await this.linesLlm.complete(req)).trim().split('\n')[0].replace(/^["“]|["”]$/g, '');
        const c = s.characters[from];
        // a text is what they type, not a stage direction ("Shira's phone buzzes… she types back quickly")
        const narration = new RegExp(`^\\s*${firstName(s, from)}\\b|\\*|\\b(?:types|texts|writes) back\\b|\\bphone (?:buzzes|vibrates|lights up)\\b`, 'i');
        const said = thread.slice(-12).some((m) => m.text.toLowerCase() === t.toLowerCase());
        if (t && !said && t.length < 200 && !narration.test(t) && contentCheck(t) && dialogueCheck(t, [firstName(s, from), firstName(s, to)]).ok && (!c || voiceCheck(t, c.persona.speech).ok)) return t;
      } catch (e) {
        logFailure(req.prompt, (e as Error).message, 'chat');
      }
    }
    return this.mock.complete(req);
  }

  /** Optional premise flavor pass: rewrites text only, never changes the selection. */
  /**
   * End-of-episode diary for one housemate plus their view of each housemate, written only from what they know.
   * Null when the LLM is off or answers badly: the engine's template summaries stay.
   */
  async diary(s: GameState, id: string, episode: number): Promise<{ diary: string; pairs: Record<string, string> } | null> {
    if (!this.real) return null;
    try {
      const raw = await this.llm.complete({ kind: 'summary', prompt: diaryPrompt(s, id, episode), temperature: 0.6, maxTokens: 700, schema: DIARY_SCHEMA });
      const j = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)) as { diary?: unknown; pairs?: { name?: unknown; summary?: unknown }[] };
      if (typeof j.diary !== 'string') return null;
      const byName = Object.fromEntries(Object.values(s.characters).map((c) => [c.name.split(' ')[0].toLowerCase(), c.id]));
      const pairs: Record<string, string> = {};
      for (const p of j.pairs ?? []) {
        const other = typeof p.name === 'string' ? byName[p.name.split(' ')[0].toLowerCase()] : undefined;
        if (other && other !== id && typeof p.summary === 'string') pairs[other] = p.summary;
      }
      return contentCheck(j.diary) ? { diary: j.diary, pairs } : null;
    } catch {
      return null;
    }
  }

  /**
   * Did these two settle, move or call off a meet-up? Read by the model from the actual words, so "9:30 works, see you
   * then" after three messages lands on the calendar. Null when the model is off, unsure or answers badly.
   */
  async planRead(s: GameState, a: string, b: string, lines: { speaker: string; text: string }[]): Promise<PlanRead | null> {
    if (!this.real || !lines.length) return null;
    try {
      const raw = await this.llm.complete({ kind: 'summary', prompt: planReadPrompt(s, a, b, lines.slice(-12)), temperature: 0.1, maxTokens: 160, schema: PLAN_READ_SCHEMA });
      const j = extractJson(raw) as { agreed?: unknown; place?: unknown; when?: unknown; date?: unknown; cancel?: unknown; meeting?: unknown; topic?: unknown } | null;
      if (!j || typeof j !== 'object') return null;
      if (j.cancel === true) return { cancel: true };
      if (j.agreed !== true || typeof j.place !== 'string' || typeof j.when !== 'string') return null;
      // a house meeting for everyone has no place of its own: it is held at home, and `topic` is what it is about
      const plan = planFromWords(s, j.place, j.when, j.date === true, j.meeting === true ? (typeof j.topic === 'string' ? j.topic.trim() : '') : undefined);
      return plan ? { plan } : null;
    } catch (e) {
      logFailure(planReadPrompt(s, a, b, lines.slice(-12)), (e as Error).message, 'plan-read');
      return null;
    }
  }

  /** Which lines of which recorded scene the house sees for one aired day. Null when the model is off or its pick is unusable: the caller falls back. */
  async broadcastClip(day: number, scenes: Parameters<typeof broadcastClipPrompt>[1], panel: string[], budget: Budget): Promise<{ scene: number; from: number; count: number } | null> {
    if (!this.real || !scenes.length || !budget.take()) return null;
    try {
      const schema = { type: 'object', properties: { scene: { type: 'integer' }, from: { type: 'integer' }, count: { type: 'integer' } }, required: ['scene', 'from', 'count'] };
      const j = extractJson(await this.llm.complete({ kind: 'flavor', prompt: broadcastClipPrompt(day, scenes, panel), temperature: 0.4, maxTokens: 60, schema })) as { scene?: unknown; from?: unknown; count?: unknown } | null;
      const [scene, from, count] = [Number(j?.scene), Number(j?.from), Number(j?.count)];
      return Number.isInteger(scene) && Number.isInteger(from) && Number.isInteger(count) && scenes[scene] && from >= 0 && from < scenes[scene].lines.length && count >= 1 ? { scene, from, count: Math.min(count, 4) } : null;
    } catch {
      return null;
    }
  }

  /** The current speaker's action stays inside that person's image description. */
  async shot(s: GameState, ev: EventInstance, transcript: Line[]): Promise<Record<string, string>> {
    if (!this.real) return {};
    try {
      const ids = shotIds(s, ev, transcript);
      const schema = { type: 'object', properties: Object.fromEntries(ids.map((id) => [id, { type: 'string', maxLength: 100 }])), required: ids, additionalProperties: false };
      const j = extractJson(await this.llm.complete({ kind: 'flavor', prompt: shotPrompt(s, ev, transcript), temperature: 0.5, maxTokens: 120, schema }));
      if (!j || typeof j !== 'object' || Array.isArray(j)) return {};
      return Object.fromEntries(Object.entries(j).filter(([id, pose]) => ids.includes(id) && typeof pose === 'string' && pose.trim().length > 0 && pose.length <= 100 && contentCheck(pose)).map(([id, pose]) => [id, (pose as string).trim()]));
    } catch {
      return {};
    }
  }

  /** Voice a background exchange the engine already decided. Null when the model is off or its answer is unusable: no template stand-in. */
  async overheard(s: GameState, a: string, b: string, type: string, place: string, summary?: string): Promise<Line[] | null> {
    if (!this.real) return null;
    try {
      const raw = await this.linesLlm.complete({ kind: 'lines', prompt: overheardPrompt(s, a, b, type, place, summary), temperature: config.temps.lines, maxTokens: 320 });
      const speakers = [a, b, a, b];
      // models slip third-person narration into spoken lines ("Ron glances at the clock."); two people alone never refer to themselves like that
      const names = [a, b].map((id) => firstName(s, id));
      const narration = new RegExp(`^\\s*(?:${names.join('|')}|He|She|They|His|Her|Door|Voice)\\b(?!\\s*[,!?])`);
      const texts = parseLines(raw.replace(/\*[^*\n]*\*/g, ' '), speakers.map((speaker) => ({ speaker }) as Beat)).map((t) => t && (t.match(/[^.!?]+(?:[.!?]+|$)/g) ?? [t]).filter((x) => !narration.test(x) && dialogueCheck(x, names).ok).join('').trim());
      const lines: Line[] = [];
      for (const [i, text] of texts.entries()) {
        if (!text || !contentCheck(text)) break;
        lines.push({ speaker: speakers[i], text, source: 'llm' });
      }
      return lines.length >= 2 ? lines : null;
    } catch {
      return null;
    }
  }

  /** Career news/gossip/secret beats get a newly invented premise; the hand-written one is the style example and fallback. */
  async freshBeat(s: GameState, ev: EventInstance, budget: Budget): Promise<Pick<EventInstance, 'title' | 'premise'>> {
    const same = { title: ev.title, premise: ev.premise };
    const kind = ev.tags.includes('career') ? (['news', 'gossip', 'secret'] as const).find((k) => ev.tags.includes(k)) : undefined;
    if (!kind || !this.real || !ev.roles.self || !ev.roles.b || budget.remaining < 6 || !budget.take()) return same;
    try {
      const t = (await this.llm.complete({ kind: 'flavor', prompt: freshBeatPrompt(s, ev, kind), temperature: 0.9, maxTokens: 120 })).trim();
      const title = { news: 'some news', gossip: 'a bit of gossip', secret: 'a secret' }[kind];
      return t && t.length < 400 && t.includes(firstName(s, ev.roles.self)) && contentCheck(t) ? { title, premise: t } : same;
    } catch {
      return same;
    }
  }

  async flavor(premise: string, budget: Budget): Promise<string> {
    if (!config.flavorPass || !this.real || budget.remaining < 6 || !budget.take()) return premise;
    try {
      const t = (await this.llm.complete({ kind: 'flavor', prompt: flavorPrompt(premise), temperature: config.temps.flavor, maxTokens: 120 })).trim();
      return t && t.length < 400 ? t : premise;
    } catch {
      return premise;
    }
  }
}

export const speakerName = (s: GameState, id: string) => id === 'narrator' ? 'Narration' : (s.characters[id] ? firstName(s, id) : (guestCharacter(s, id)?.name ?? id));
export const where = (loc: string) => placeName(loc);
