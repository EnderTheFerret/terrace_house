// Memory: compaction by salience × recency, pair summaries, "previously" recap.
import type { GameState, MemoryItem } from '../model';
import { truncate } from '../util';
import { firstName, housemates, rel } from './core';

export const MEMORY_BUDGET = 40;
export const RECENCY_TAU = 60; // ticks (5 per episode)

export const memoryScore = (m: MemoryItem, nowTick: number, tau = RECENCY_TAU) => m.salience * Math.exp(-(nowTick - m.tick) / tau);

/** Keep the top-k memories by salience × recency; returns them in chronological order. */
export function compactMemory(items: MemoryItem[], nowTick: number, budget = MEMORY_BUDGET): MemoryItem[] {
  if (items.length <= budget) return items;
  return items
    .map((m, i) => ({ m, i, sc: memoryScore(m, nowTick) }))
    .sort((a, b) => b.sc - a.sc || a.i - b.i)
    .slice(0, budget)
    .sort((a, b) => a.m.tick - b.m.tick || a.i - b.i)
    .map((x) => x.m);
}

export function compactAll(s: GameState) {
  for (const id of Object.keys(s.memory)) s.memory[id] = compactMemory(s.memory[id], s.world.tick);
}

export function topMemories(s: GameState, charId: string, k: number, involving?: string[]): MemoryItem[] {
  return (s.memory[charId] ?? [])
    .filter((m) => !involving || involving.every((p) => p === charId || m.participants.includes(p)))
    .slice()
    .sort((a, b) => memoryScore(b, s.world.tick) - memoryScore(a, s.world.tick))
    .slice(0, k);
}

const word = (v: number, scale: [number, string][]) => scale.find(([t]) => v >= t)?.[1] ?? scale[scale.length - 1][1];

/** Rolling ≤300-char summary of how i sees j (engine-written; real mode may overwrite with an LLM summary). */
export function pairSummaryText(s: GameState, i: string, j: string): string {
  const r = rel(s, i, j);
  const aff = word(r.affinity, [[50, 'really likes'], [20, 'likes'], [-10, 'is neutral about'], [-40, 'is wary of'], [-101, 'dislikes']]);
  const rom = r.romance >= 60 ? ', has strong feelings for them' : r.romance >= 30 ? ', is a little drawn to them' : '';
  const ten = r.tension >= 50 ? ', and there is real friction' : r.tension >= 25 ? ', with some tension' : '';
  const tr = r.trust >= 65 ? ' Trusts them.' : r.trust <= 25 ? " Doesn't trust them." : '';
  const last = topMemories(s, i, 1, [j])[0];
  const base = `${firstName(s, i)} ${aff} ${firstName(s, j)}${rom}${ten}.${tr}`;
  return truncate(last ? `${base} Recently: ${last.text}` : base, 300);
}

export function updatePairSummaries(s: GameState) {
  const ids = housemates(s).map((c) => c.id);
  for (const i of ids) for (const j of ids) if (i !== j) s.pairSummary[`${i}>${j}`] = pairSummaryText(s, i, j);
}

/** "Previously on…": top salience player-visible log lines from the last episode. */
export function previouslyRecap(s: GameState, episode: number): string {
  const lines = s.log
    .filter((l) => l.episode === episode && l.salience >= 0.35)
    .sort((a, b) => b.salience - a.salience)
    .slice(0, 3)
    .map((l) => l.text);
  return lines.join(' ');
}
