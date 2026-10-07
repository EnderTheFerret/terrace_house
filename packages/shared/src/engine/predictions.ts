// Panel predictions lifecycle: proposed by the engine (resolvable conditions), phrased by panel/LLM, resolved by engine.
import type { GameState, Prediction, PredictionCond } from '../model';
import { recordRemarks } from './broadcast';
import { mulberry32, type Rng } from '../rng';
import { content } from '../content';
import { fill } from '../util';
import { attracted, firstName, housemates, isCouple, nextId, rel } from './core';

export const MAX_ACTIVE_PREDICTIONS = 4;

/** Engine-chosen resolvable condition (the LLM only writes the text). */
export function proposeCondition(s: GameState, rng: Rng): PredictionCond | null {
  const hm = housemates(s);
  const ep = s.world.episode;
  const opts: { c: PredictionCond; w: number }[] = [];
  for (const a of hm)
    for (const b of hm) {
      if (a.id === b.id) continue;
      const r = rel(s, a.id, b.id);
      if (attracted(a, b) && r.romance >= 35 && !isCouple(s, a.id, b.id)) {
        opts.push({ c: { kind: 'confess', a: a.id, b: b.id, byEpisode: ep + 3 }, w: r.romance / 30 });
        if (a.id < b.id) opts.push({ c: { kind: 'couple', a: a.id, b: b.id, byEpisode: ep + 5 }, w: (r.romance + rel(s, b.id, a.id).romance) / 80 });
      }
      if (a.id < b.id && r.tension >= 35) opts.push({ c: { kind: 'fight', a: a.id, b: b.id, byEpisode: ep + 3 }, w: r.tension / 35 });
    }
  for (const a of hm) if (a.mood < -0.2 && !a.isPlayer) opts.push({ c: { kind: 'leave', a: a.id, byEpisode: ep + 4 }, w: 0.8 });
  const fresh = opts.filter((o) => !s.predictions.some((p) => p.resolved === null && p.condition.kind === o.c.kind && p.condition.a === o.c.a && p.condition.b === o.c.b));
  if (!fresh.length) return null;
  return rng.weighted(
    fresh.map((o) => o.c),
    fresh.map((o) => o.w),
  );
}

export function predictionText(s: GameState, panelistId: string, c: PredictionCond): string {
  const p = content().panel.find((x) => x.id === panelistId)!;
  const tpl = p.lines.prediction?.[0] ?? '{a} and {b} by episode {ep}.';
  const kindText: Record<PredictionCond['kind'], string> = {
    confess: `I think {a} confesses to {b} by episode {ep}.`,
    couple: tpl,
    fight: `{a} and {b} are going to blow up by episode {ep}.`,
    leave: `{a} won't last past episode {ep}.`,
  };
  return fill(kindText[c.kind], { a: firstName(s, c.a), b: c.b ? firstName(s, c.b) : '', ep: c.byEpisode });
}

export function addPrediction(s: GameState, panelistId: string, c: PredictionCond, text: string): Prediction | null {
  if (s.predictions.filter((p) => p.resolved === null).length >= MAX_ACTIVE_PREDICTIONS) return null;
  const pr: Prediction = { id: nextId(s, 'pred'), by: panelistId, text: text.slice(0, 160), madeEp: s.world.episode, condition: c, resolved: null, calledBack: false };
  s.predictions.push(pr);
  return pr;
}

/** Resolve open predictions matching an observed world event. */
export function resolveOn(s: GameState, kind: PredictionCond['kind'], a: string, b?: string) {
  for (const p of s.predictions) {
    if (p.resolved !== null || p.condition.kind !== kind) continue;
    const c = p.condition;
    const match =
      kind === 'leave' ? c.a === a : kind === 'confess' ? c.a === a && (!c.b || c.b === b) : (c.a === a && c.b === b) || (c.a === b && c.b === a);
    if (match) {
      p.resolved = true;
      p.resolvedEp = s.world.episode;
    }
  }
}

/** Expire predictions past their deadline (resolved false). */
export function expirePredictions(s: GameState) {
  for (const p of s.predictions) {
    if (p.resolved === null && s.world.episode > p.condition.byEpisode) {
      p.resolved = false;
      p.resolvedEp = s.world.episode;
    }
  }
}

/** Pure engine step before commentary: pick a resolvable prediction condition (advances state rng). */
export function panelPrediction(s0: GameState): { state: GameState; condition: PredictionCond | null } {
  const s = structuredClone(s0);
  const rng = mulberry32(s.rngState);
  const condition = proposeCondition(s, rng);
  s.rngState = rng.state() | 0;
  return { state: s, condition };
}

/** Bookkeeping after commentary: store a new prediction, mark callbacks. Pure wrapper (clones). */
export function recordCommentary(s0: GameState, r: { prediction?: { by: string; condition: PredictionCond; text?: string }; calledBack: string[]; remarks?: { episode: number; participants: string[]; lines: { speaker?: string; text: string }[]; moment?: string } }): GameState {
  const s = structuredClone(s0);
  if (r.remarks) recordRemarks(s, r.remarks.episode, r.remarks.participants, r.remarks.lines, r.remarks.moment);
  for (const id of r.calledBack) {
    const p = s.predictions.find((x) => x.id === id);
    if (p) p.calledBack = true;
  }
  if (r.prediction) addPrediction(s, r.prediction.by, r.prediction.condition, r.prediction.text ?? predictionText(s, r.prediction.by, r.prediction.condition));
  return s;
}

/** Resolved predictions the panel hasn't called back yet. */
export const pendingCallbacks = (s: GameState) => s.predictions.filter((p) => p.resolved !== null && !p.calledBack);
