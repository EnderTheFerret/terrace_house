// Budget levels instead of money: what people can afford is a comparison between their level (from their job) and a
// place's or thing's price level — never a running balance.
import type { CityNode } from '../contentSchema';
import type { Character, GameState } from '../model';

export const BUDGETS = ['tight', 'modest', 'comfortable', 'generous'] as const;
export type Budget = 0 | 1 | 2 | 3;
/** ₪ / ₪₪ / ₪₪₪ */
export type Price = 1 | 2 | 3;

const GENEROUS = /founder|stock analyst/i;
const COMFORTABLE = /architect|pharmacist|consultant|data scientist|programmer|medical resident|\bvet\b|restaurant manager|interior designer|sommelier|flight attendant|sales rep|office manager|\bmodel\b|midwife/i;
const TIGHT = /student|barista|clerk|courier|trainee|apprentice|staff|attendant|deckhand|indie musician|streamer|assistant|comedian|game tester|fisherman|freelance/i;

/** Budget level from occupation; a part-time job (the player's contract) lifts it one step while kept. */
export function budgetOf(c: Pick<Character, 'occupation'>, partTime = false): Budget {
  const o = c.occupation;
  const base = GENEROUS.test(o) ? 3 : COMFORTABLE.test(o) ? 2 : TIGHT.test(o) ? 0 : 1;
  return Math.min(3, base + (partTime ? 1 : 0)) as Budget;
}

export const playerBudget = (s: GameState) => budgetOf(s.characters[s.playerId], !!s.world.playerJob);
/** A housemate picking up extra shifts (to afford a trip) is a level up until the flag's episode passes. */
export const extraShifts = (s: GameState, id: string) => Number(s.world.flags[`extraShifts_${id}`] ?? 0) >= s.world.episode;
export const budgetFor = (s: GameState, id: string) => (id === s.playerId ? playerBudget(s) : budgetOf(s.characters[id], extraShifts(s, id)));

/** A place's price level from its entry cost (the beach is ₪, a rooftop bar ₪₪₪). */
export const nodePrice = (n: Pick<CityNode, 'cost'>): Price => (n.cost <= 15 ? 1 : n.cost <= 40 ? 2 : 3);

export const GIFT_PRICE: Record<string, Price> = { coffee: 1, snacks: 1, flowers: 2, plant: 2, book: 2, vinyl: 3 };

export const priceLabel = (p: Price) => '₪'.repeat(p);

/** 'ok' at or below your level, 'stretch' one above (now and then, it strains you), 'out' two or more above. */
export function afford(budget: Budget, price: Price): 'ok' | 'stretch' | 'out' {
  const gap = price - 1 - budget; // ₪ is for everyone, ₪₪ needs modest, ₪₪₪ needs comfortable
  return gap <= 0 ? 'ok' : gap === 1 ? 'stretch' : 'out';
}

/** Stretches are for now and then: at most one every two episodes. */
export const canStretch = (s: GameState) => s.world.episode - Number(s.world.flags.stretchEp ?? -9) >= 2;
