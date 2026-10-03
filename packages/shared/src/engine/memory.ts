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

export const ARCHIVE_BUDGET = 300;

/** Keep the prompt-sized top memories active; everything else goes to the archive, where recall can still find it. */
export function compactAll(s: GameState) {
  for (const id of Object.keys(s.memory)) {
    const kept = compactMemory(s.memory[id], s.world.tick);
    const dropped = s.memory[id].filter((m) => !kept.includes(m));
    if (dropped.length) {
      const archive = (s.memoryArchive[id] ??= []);
      archive.push(...dropped);
      if (archive.length > ARCHIVE_BUDGET) archive.splice(0, archive.length - ARCHIVE_BUDGET);
    }
    s.memory[id] = kept;
  }
}

const RECALL_STOP = new Set('about after again also been before both from have here into just like myself really remember said some something that them then there these they this told want were what when where which will with would your'.split(' '));
// ponytail: exact keywords; add embeddings only if paraphrased callbacks routinely miss.
const recallWords = (text: string) => new Set((text.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? []).filter(w => !RECALL_STOP.has(w)));

export function topMemories(s: GameState, charId: string, k: number, involving?: string[], query = ''): MemoryItem[] {
  const words = recallWords(query);
  const relevance = (m: MemoryItem) => words.size ? [...recallWords(m.text)].filter(w => words.has(w)).length : 0;
  const others = involving?.filter(id => id !== charId);
  // archived memories come back only when the conversation names them (World Info style keyword trigger)
  const archived = words.size ? (s.memoryArchive?.[charId] ?? []).filter((m) => relevance(m) > 0) : [];
  return [...(s.memory[charId] ?? []), ...archived]
    .filter((m) => !others?.length || others.some(p => m.participants.includes(p)) || relevance(m) > 0)
    .slice()
    .sort((a, b) => relevance(b) - relevance(a) || memoryScore(b, s.world.tick) - memoryScore(a, s.world.tick))
    .slice(0, k);
}

const word = (v: number, scale: [number, string][]) => scale.find(([t]) => v >= t)?.[1] ?? scale[scale.length - 1][1];

/** Record a housemate's end-of-episode diary and their own view of each housemate (LLM-written in real mode). */
export function recordDiary(s0: GameState, id: string, episode: number, diary: string, pairs: Record<string, string>): GameState {
  const s = structuredClone(s0);
  if (!s.characters[id]) return s;
  const book = (s.diaries[id] ??= []);
  if (diary.trim()) book.push({ episode, text: truncate(diary.trim(), 600) });
  if (book.length > 6) book.splice(0, book.length - 6);
  for (const [j, text] of Object.entries(pairs)) if (s.characters[j] && j !== id && text.trim()) s.pairNotes[`${id}>${j}`] = { episode, text: truncate(text.trim(), 300) };
  return s;
}

/** Rolling ≤300-char summary of how i sees j: their own LLM-written note when fresh, else the engine template. */
export function pairSummaryText(s: GameState, i: string, j: string): string {
  const note = s.pairNotes?.[`${i}>${j}`];
  if (note && note.episode >= s.world.episode - 2) return note.text;
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
