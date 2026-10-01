// Generation service: wires prompts + LLM client + mock fallback + budget + voice checks.
import {
  BeatSheet, Commentary, DeltaProposal, content, firstName, hashSeed, mockBeatSheet, mulberry32, voiceCheck, placeName,
  type Beat, type EventInstance, type GameState, type Intent, type LineContext, type LlmClient, type PredictionCond, type SceneChoices,
} from '@shared-roof/shared';
import { config } from '../config';
import { MockLlm } from '../llm/mock';
import { structured, logFailure, type Budget } from '../llm/structured';
import { beatSheetPrompt, deltaPrompt, linesPrompt, parseLines } from '../prompts/scene';
import { chatPrompt, commentaryPrompt, flavorPrompt } from '../prompts/studio';

export interface Line {
  speaker: string;
  text: string;
  caption?: string | null;
  source: 'llm' | 'mock';
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
  constructor(public llm: LlmClient) {}

  get real() {
    return this.llm.name !== 'mock';
  }

  /** Stage 1: beat sheet. LLM output is validated, speakers sanitized; the player's choice point is engine-defined. */
  async beatSheet(s: GameState, ev: EventInstance, budget: Budget): Promise<{ beats: Beat[]; choiceIndex: number; source: 'llm' | 'mock' }> {
    const local = mockBeatSheet(s, mulberry32(hashSeed(ev.id)), ev);
    if (!this.real) return { beats: local.sheet.beats, choiceIndex: local.choiceIndex, source: 'mock' };
    const r = await structured(this.llm, this.mock, { kind: 'beats', prompt: beatSheetPrompt(s, ev), temperature: config.temps.beats, maxTokens: 700, context: { kind: 'beats', state: s, event: ev } }, BeatSheet, budget);
    const valid = new Set([...ev.participants, ...Object.values(ev.roles)]);
    let beats = r.value.beats.map((b) => (valid.has(b.speaker) ? b : { ...b, speaker: ev.participants[0] }));
    let choiceIndex = local.choiceIndex;
    if (choiceIndex >= 0) {
      choiceIndex = Math.min(choiceIndex, beats.length);
      const player = s.playerId;
      // ensure the choice beat belongs to the player
      beats = [...beats.slice(0, choiceIndex), { ...local.sheet.beats[local.choiceIndex], speaker: player }, ...beats.slice(choiceIndex).filter((b) => b.speaker !== player || b.beatType === 'close')].slice(0, 8);
    }
    return { beats, choiceIndex, source: r.source };
  }

  /**
   * Stage 2: realize beats as lines, streaming tokens via onToken. One LLM call for the batch; each line gets a
   * rule-based voice check with one regeneration, then template fallback.
   */
  async lines(
    s: GameState,
    ev: EventInstance,
    beats: Beat[],
    transcript: Line[],
    intents: (Intent | undefined)[],
    ctx: LineContext,
    budget: Budget,
    onLineStart: (i: number, speaker: string) => void,
    onToken: (i: number, token: string) => void,
  ): Promise<Line[]> {
    const mockReq = (bs: Beat[], ins: (Intent | undefined)[]) => ({
      kind: 'lines' as const,
      prompt: `${ev.id}|${transcript.length}|${bs.map((b) => b.beatType).join(',')}`,
      temperature: 0,
      context: { kind: 'lines', state: s, beats: bs, ctx, intents: ins },
    });
    const out: Line[] = [];
    const finish = (i: number, text: string, source: 'llm' | 'mock') => {
      const b = beats[i];
      out[i] = { speaker: b.speaker, text, source };
      this.voice.add(b.speaker, text);
    };
    let texts: (string | null)[] = beats.map(() => null);
    if (this.real && budget.take()) {
      try {
        const prompt = linesPrompt(s, ev, beats, transcript, intents);
        let buf = '';
        let lineIdx = 0;
        let partial = '';
        let emitted = 0;
        let started = false;
        for await (const tok of this.llm.stream({ kind: 'lines', prompt, temperature: config.temps.lines, maxTokens: 160 * beats.length })) {
          buf += tok;
          // stream only the text after "speaker:" of the line being written
          for (const ch of tok) {
            if (ch === '\n') {
              if (started) lineIdx++;
              partial = '';
              emitted = 0;
              started = false;
              continue;
            }
            partial += ch;
            if (lineIdx >= beats.length) continue;
            const m = partial.match(/^[^:：]{1,40}[:：]\s*/);
            if (!m) continue;
            if (!started) {
              onLineStart(lineIdx, beats[lineIdx].speaker);
              started = true;
              emitted = m[0].length;
            }
            if (partial.length > emitted) {
              onToken(lineIdx, partial.slice(emitted));
              emitted = partial.length;
            }
          }
        }
        texts = parseLines(buf, beats);
      } catch (e) {
        logFailure(`lines:${ev.id}`, (e as Error).message, 'lines');
      }
    }
    for (let i = 0; i < beats.length; i++) {
      const b = beats[i];
      const c = s.characters[b.speaker];
      let text = texts[i];
      let source: 'llm' | 'mock' = 'llm';
      if (text && c) {
        const vc = voiceCheck(text, c.persona.speech, { catchphraseCount: ctx.catchphraseUses[b.speaker] ?? 0, lineCount: ctx.lineCounts[b.speaker] ?? 1 });
        if (!vc.ok) {
          this.voice.fails[b.speaker] = (this.voice.fails[b.speaker] ?? 0) + 1;
          text = null;
          if (budget.take()) {
            try {
              const raw = await this.llm.complete({ kind: 'lines', prompt: linesPrompt(s, ev, [b], transcript, [intents[i]]) + `\n(Previous attempt failed: ${vc.reasons.join('; ')})`, temperature: config.temps.lines, maxTokens: 120 });
              const retry = parseLines(raw, [b])[0];
              if (retry && voiceCheck(retry, c.persona.speech).ok) text = retry;
            } catch {
              /* fall through to template */
            }
          }
        }
      }
      if (!text) {
        source = 'mock';
        text = (await this.mock.complete(mockReq([b], [intents[i]]))).replace(/^[\w-]+:\s*/, '');
        onLineStart(i, b.speaker);
        for (const part of text.split(/(?<=\s)/)) onToken(i, part);
      }
      finish(i, text, source);
    }
    return out;
  }

  async deltas(s: GameState, ev: EventInstance, transcript: Line[], choices: SceneChoices, budget: Budget): Promise<DeltaProposal | null> {
    if (!this.real) return null; // engine proposal is the mock proposal
    const r = await structured(this.llm, this.mock, { kind: 'deltas', prompt: deltaPrompt(s, ev, transcript, choices), temperature: config.temps.deltas, maxTokens: 600, context: { kind: 'deltas', state: s, event: ev, choices } }, DeltaProposal, budget);
    return r.source === 'llm' ? r.value : null;
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

  async chat(s: GameState, from: string, to: string, budget: Budget): Promise<string> {
    const thread = (s.chats[[from, to].sort().join('|')] ?? []).map((m) => ({ from: m.from, text: m.text }));
    const req = { kind: 'chat' as const, prompt: chatPrompt(s, from, to, thread), temperature: config.temps.chat, maxTokens: 60, context: { kind: 'chat', state: s, from, to } };
    if (this.real && budget.take()) {
      try {
        const t = (await this.llm.complete(req)).trim().split('\n')[0].replace(/^["“]|["”]$/g, '');
        if (t && t.length < 200) return t;
      } catch (e) {
        logFailure(req.prompt, (e as Error).message, 'chat');
      }
    }
    return this.mock.complete(req);
  }

  /** Optional premise flavor pass: rewrites text only, never changes the selection. */
  async flavor(premise: string, budget: Budget): Promise<string> {
    if (!this.real || budget.remaining < 3 || !budget.take()) return premise;
    try {
      const t = (await this.llm.complete({ kind: 'flavor', prompt: flavorPrompt(premise), temperature: config.temps.flavor, maxTokens: 120 })).trim();
      return t && t.length < 400 ? t : premise;
    } catch {
      return premise;
    }
  }
}

export const speakerName = (s: GameState, id: string) => (s.characters[id] ? firstName(s, id) : (content().npcs.find((n) => n.id === id)?.name ?? id));
export const where = (loc: string) => placeName(loc);
