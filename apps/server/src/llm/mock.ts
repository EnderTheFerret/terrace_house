// MockLlm: rule-based, deterministic. Produces valid output for every schema from the structured `context`.
import {
  engineProposal, hashSeed, mockBeatSheet, mockCommentary, mockIntermission, mockLine, chatLine, mulberry32,
  type EventInstance, type GameState, type LlmClient, type LlmRequest, type Beat, type LineContext, type SceneChoices,
  type PredictionCond, type Intent, type Footage,
} from '@shared-roof/shared';

export type MockContext =
  | { kind: 'beats'; state: GameState; event: EventInstance }
  | { kind: 'lines'; state: GameState; beats: Beat[]; ctx: LineContext; intents?: (Intent | undefined)[] }
  | { kind: 'deltas'; state: GameState; event: EventInstance; choices: SceneChoices }
  | { kind: 'commentary'; state: GameState; event: EventInstance; outcome?: 'accepted' | 'rejected' | 'none'; predictionCond: PredictionCond | null }
  | { kind: 'chat'; state: GameState; from: string; to: string }
  | { kind: 'intermission'; state: GameState; at: 'mid' | 'end'; since: number; footage?: Footage[] }
  | { kind: 'text'; text: string };

export class MockLlm implements LlmClient {
  readonly name = 'mock';
  calls = 0;
  async health() {
    return true;
  }

  /** Deterministic per prompt: rng seeded by prompt hash, never by game state. */
  private rng(req: LlmRequest) {
    return mulberry32(hashSeed(req.prompt));
  }

  async complete(req: LlmRequest): Promise<string> {
    this.calls++;
    const c = req.context as MockContext | undefined;
    const rng = this.rng(req);
    if (!c) return req.kind === 'lines' || req.kind === 'chat' || req.kind === 'summary' || req.kind === 'flavor' ? '...' : '{}';
    switch (c.kind) {
      case 'beats':
        return JSON.stringify(mockBeatSheet(c.state, rng, c.event).sheet);
      case 'lines':
        return c.beats.map((b, i) => `${b.speaker}: ${mockLine(c.state, rng, b, c.ctx, c.intents?.[i])}`).join('\n');
      case 'deltas':
        return JSON.stringify(engineProposal(c.state, rng, c.event, c.choices));
      case 'commentary':
        return JSON.stringify(mockCommentary(c.state, rng, c.event, c.outcome, c.predictionCond).commentary);
      case 'chat':
        return chatLine(c.state, rng, c.from, c.to);
      case 'intermission':
        return JSON.stringify(mockIntermission(c.state, rng, c.at, c.since, c.footage));
      case 'text':
        return c.text;
    }
  }

  async *stream(req: LlmRequest): AsyncIterable<string> {
    const text = await this.complete(req);
    // emulate token streaming: word chunks
    for (const part of text.split(/(?<=\s)/)) yield part;
  }
}
