// Drinking: nights out at bars, karaoke and venues can get people drunk; the morning after, they pay for it.
// Rolls are deterministic from the world tick (no rng draws), so replays and old saves stay in step.
import type { Character, Emotion, EventInstance, GameState } from '../model';
import { hashSeed } from '../rng';
import { clamp } from '../util';
import { content } from '../content';
import { addLog, firstName, housemates, placeName, traitsOf } from './core';

const DRINK_TYPES = ['bar', 'karaoke', 'venue'];
const NIGHT = ['slot3', 'evening', 'lateNight'];
export const DRUNK_LABEL = ['sober', 'tipsy', 'drunk', 'very drunk'] as const;
export const HANGOVER_LABEL = ['', 'hungover', 'badly hungover'] as const;

export const servesDrinks = (node: string) => DRINK_TYPES.includes(content().city.nodes.find((n) => n.id === node)?.type ?? '');
const blockKey = (s: GameState) => `${s.world.episode}:${s.world.slot}`;
const roll = (s: GameState, id: string, salt: string) => (hashSeed(`${s.world.tick}:${id}:${salt}`) % 1000) / 1000;

/** What a viewer would call someone's state, or undefined when they are fine. */
export const conditionOf = (c: Pick<Character, 'drunk' | 'hangover'>): string | undefined =>
  c.drunk ? DRUNK_LABEL[c.drunk] : c.hangover ? HANGOVER_LABEL[c.hangover] : undefined;

/** Behaviour notes for dialogue prompts; null when sober. */
export function bodyState(c: Pick<Character, 'drunk' | 'hangover'>): string | null {
  if (c.drunk === 1) return 'tipsy: warmer, chattier and a little less filtered than usual; speech still clear.';
  if (c.drunk === 2) return 'drunk: slurs a little, repeats themselves, loses the thread, blunt and affectionate or emotional; short, loose lines.';
  if (c.drunk === 3) return 'very drunk: slurring badly, rambling and oversharing, giggly or weepy, may forget what was just said; short fragments.';
  if (c.hangover === 1) return 'hungover: headache, squinting at light, low energy, short-tempered, wants water, coffee or toast; quiet and a bit grumpy.';
  if (c.hangover === 2) return 'badly hungover: miserable and queasy, speaking softly, barely functioning, regrets last night.';
  return null;
}

/** Light slur for mock dialogue so drunk speakers read differently even without a model. */
export function drunkSpeech(text: string, level: number): string {
  if (level < 2) return text;
  const h = hashSeed(text);
  let out = text.replace(/\bso\b/i, 'sooo');
  if (h % 3 === 0) out = out.replace(/[.!?]?$/, '… *hic*');
  if (level >= 3) out = out.replace(/^(\w)(\w*)/, (_m, a: string, rest: string) => `${a}-${a}${rest}`);
  return out;
}

/** A drunk speaker's face shows it whatever the line's feeling. */
export const lineEmotion = (c: Pick<Character, 'drunk'> | undefined, e: Emotion): Emotion => ((c?.drunk ?? 0) >= 2 ? 'drunk' : e);

const SHOTS = /\b(shots?|vodka|tequila|whisk(?:e)?y|arak|sambuca|j[aä]germeister|bottoms up)\b/i;
const MILD = /\b(beers?|pints?|ale|lager|wine|cocktails?|mojito|spritz|cider|prosecco|champagne|gin|rum|a drink|drinks)\b/i;
const WANTS = /\b(have|having|get|grab|order|pour|down|do|take|buy|bring|need|want|wanna|let'?s|lets|i'?ll|ill|another|cheers|bottoms up)\b/i;
const REFUSES = /\b(no|don'?t|dont|not|never|won'?t|sober|stop|enough)\b/i;

/**
 * The player asks for drinks in their own words ("let's do shots", "I'll have a beer"): they drink, and the others in the
 * conversation may join in. A drink is a level, shots two. Null when the line is not an order.
 */
export function orderDrinks(s0: GameState, text: string, others: string[]): { state: GameState; changes: Record<string, number>; what: string } | null {
  if (REFUSES.test(text) || !WANTS.test(text)) return null;
  const strong = SHOTS.test(text);
  if (!strong && !MILD.test(text)) return null;
  const inc = strong ? 2 : 1;
  const s = structuredClone(s0);
  const changes: Record<string, number> = {};
  const key = blockKey(s);
  const bump = (c: Character) => {
    const to = clamp((c.drunk ?? 0) + inc, 0, 3);
    s.world.flags[`drank_${c.id}`] = key;
    if (to > (c.drunk ?? 0)) { getDrunk(s, c, to); changes[c.id] = to; }
  };
  bump(s.characters[s.playerId]);
  for (const id of others) {
    const c = s.characters[id];
    if (!c || c.isPlayer || c.status !== 'inHouse') continue;
    const t = traitsOf(c);
    if (roll(s, id, text) < clamp(0.4 + 0.5 * (t.E - 0.5) - 0.4 * (t.C - 0.5) + (strong ? 0.15 : 0), 0.1, 0.9)) bump(c);
  }
  return { state: s, changes, what: strong ? 'shots' : 'a drink' };
}

/** Make someone at least this drunk; no-op if they already are. */
export function getDrunk(s: GameState, c: Character, level: number, place?: string) {
  const to = clamp(Math.round(level), 0, 3);
  if (to <= (c.drunk ?? 0)) return;
  c.drunk = to;
  c.drunkPeak = Math.max(c.drunkPeak ?? 0, to);
  c.mood = clamp(c.mood + 0.06 * to, -1, 1);
  c.needs.energy = clamp(c.needs.energy - 6 * to, 0, 100);
  if (to >= 2) addLog(s, { kind: 'system', text: c.isPlayer ? `You had a few too many${place ? ` at ${placeName(place)}` : ''}.` : `${firstName(s, c.id)} is ${DRUNK_LABEL[to]}${place ? ` at ${placeName(place)}` : ''}.`, participants: [c.id], salience: 0.35 });
}

/**
 * An NPC at a place that serves drinks may drink, once per block. `boost` is the nudge from a friend who is drinking;
 * outside the evening it only happens with a boost. The player drinks only by choice.
 */
export function maybeDrink(s: GameState, c: Character, node: string, boost = 0): number {
  if (c.isPlayer || !servesDrinks(node)) return 0;
  const key = blockKey(s);
  if (s.world.flags[`drank_${c.id}`] === key) return 0;
  s.world.flags[`drank_${c.id}`] = key;
  if (!NIGHT.includes(s.world.slot) && boost < 0.3) return 0;
  const t = traitsOf(c);
  const p = clamp(0.2 + 0.5 * (t.E - 0.5) - 0.4 * (t.C - 0.5) + boost, 0.03, 0.9);
  if (roll(s, c.id, 'drink') >= p) return 0;
  const r = roll(s, c.id, 'level');
  const level = r < 0.15 ? 3 : r < 0.5 ? 2 : 1;
  getDrunk(s, c, level, node);
  return level;
}

/** Catch up a scene that is already running at a bar (an older save, or one planned before drinking existed). */
export function venueDrinks(s0: GameState, ev: Pick<EventInstance, 'participants' | 'location'>): { state: GameState; changes: Record<string, number> } {
  const s = structuredClone(s0);
  const changes: Record<string, number> = {};
  if (servesDrinks(ev.location)) for (const id of ev.participants) {
    const c = s.characters[id];
    if (c && !c.isPlayer) { const level = maybeDrink(s, c, ev.location, 0.3); if (level) changes[id] = level; }
  }
  return { state: s, changes };
}

/** Replay of `venueDrinks`: the logged outcome, not a fresh roll. */
export function applyDrinks(s0: GameState, changes: Record<string, number>): GameState {
  const s = structuredClone(s0);
  for (const [id, level] of Object.entries(changes)) {
    const c = s.characters[id];
    if (!c) continue;
    s.world.flags[`drank_${id}`] = blockKey(s);
    getDrunk(s, c, level);
  }
  return s;
}

/**
 * End of a block: everyone sobers up a level, and the afternoon clears a hangover. At the end of the day, the night's worst
 * level becomes tomorrow morning's hangover (tipsy costs nothing).
 */
export function soberUp(s: GameState, endOfDay: boolean) {
  for (const c of housemates(s)) {
    if (endOfDay) {
      const h = (c.drunkPeak ?? 0) >= 2 ? c.drunkPeak - 1 : 0;
      c.hangover = h;
      c.drunk = 0;
      c.drunkPeak = 0;
      if (h) {
        c.mood = clamp(c.mood - 0.08 * h, -1, 1);
        c.needs.energy = clamp(c.needs.energy - 12 * h, 0, 100);
        addLog(s, { kind: 'system', text: c.isPlayer ? 'You wake up with a pounding head: last night is catching up with you.' : `${firstName(s, c.id)} is ${HANGOVER_LABEL[h]} this morning.`, participants: [c.id], salience: c.isPlayer ? 0.4 : 0.25 });
      }
    } else {
      c.drunk = Math.max(0, (c.drunk ?? 0) - 1);
      if (s.world.slot === 'slot2') c.hangover = 0; // the slot that just ended was the late morning; the afternoon is clear
    }
  }
}
