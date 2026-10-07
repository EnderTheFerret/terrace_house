// Cooking minigame (Section 8): pure state machine over a recipe DAG + step scoring + reception formula.
// The React renderer only feeds inputs/timings in and reads scores out.
import type { Recipe, RecipeStep } from '../contentSchema';
import type { Character, GameState } from '../model';
import type { Rng } from '../rng';
import { mulberry32 } from '../rng';
import { clamp, cosine } from '../util';
import { content } from '../content';
import { addLog, addMemory, addRel, cloneState, firstName, traitsOf } from './core';
import { consume } from './house';
import { publicAct } from './social';
import { isShabbat } from './agents';

export const recipeById = (id: string): Recipe => {
  const r = content().recipes.find((x) => x.id === id);
  if (!r) throw new Error(`unknown recipe ${id}`);
  return r;
};

// ---------------------------------------------------------------- step scoring (all return [0,1])

/** chop: rhythm hits vs beat times. Each beat takes its nearest unused hit within the window. Extra hits cost a little. */
export function scoreChop(beatTimes: number[], hitTimes: number[], windowMs: number): number {
  if (!beatTimes.length) return 0;
  const used = new Set<number>();
  let total = 0;
  for (const b of beatTimes) {
    let best = -1;
    let bestD = Infinity;
    hitTimes.forEach((h, i) => {
      const d = Math.abs(h - b);
      if (!used.has(i) && d <= windowMs && d < bestD) {
        bestD = d;
        best = i;
      }
    });
    if (best >= 0) {
      used.add(best);
      total += 1 - bestD / windowMs / 2; // a hit anywhere in the window is worth ≥ 0.5
    }
  }
  const extra = Math.max(0, hitTimes.length - used.size);
  return clamp(total / beatTimes.length - extra * 0.03, 0, 1);
}

export const chopBeats = (params: { beats: number; bpm: number }) => {
  const interval = 60000 / params.bpm;
  return Array.from({ length: params.beats }, (_, i) => Math.round(1000 + i * interval));
};

/** boil: stop the timer inside [lo, hi]; linear falloff outside over a margin of half the window (min 1.5s). */
export function scoreBoil(stopAt: number, target: [number, number]): number {
  const [lo, hi] = target;
  if (stopAt >= lo && stopAt <= hi) return 1;
  const margin = Math.max(1.5, (hi - lo) / 2 + 1);
  const d = stopAt < lo ? lo - stopAt : stopAt - hi;
  return clamp(1 - d / margin, 0, 1);
}

export interface SauteParams {
  duration: number;
  bandWidth: number;
  bandSpeed: number;
  heatRate: number;
  coolRate: number;
}

export const sauteBand = (p: SauteParams, t: number) => 0.5 + 0.28 * Math.sin(2 * Math.PI * p.bandSpeed * t * 0.5 + 0.6);

/** One saute tick: holding raises temperature, releasing lets it cool. */
export function sauteStep(temp: number, holding: boolean, p: SauteParams, dt: number): number {
  return clamp(temp + (holding ? p.heatRate : -p.coolRate) * dt, 0, 1);
}

/** saute: simulate inputs sampled at dt; score = fraction of time the gauge is inside the moving band. */
export function scoreSaute(holds: boolean[], p: SauteParams, dt = 0.05): number {
  if (!holds.length) return 0;
  let temp = 0.2;
  let inBand = 0;
  holds.forEach((h, i) => {
    temp = sauteStep(temp, h, p, dt);
    if (Math.abs(temp - sauteBand(p, i * dt)) <= p.bandWidth / 2) inBand++;
  });
  return inBand / holds.length;
}

/** In-band fraction from a recorded temperature trace (renderer-side simulation). */
export function scoreSauteTrace(trace: { t: number; temp: number }[], p: SauteParams): number {
  if (!trace.length) return 0;
  return trace.filter((x) => Math.abs(x.temp - sauteBand(p, x.t)) <= p.bandWidth / 2).length / trace.length;
}

/** season: dial value vs hidden optimum. */
export function scoreSeason(value: number, optimum: number, tolerance: number): number {
  return clamp(1 - Math.abs(value - optimum) / Math.max(1e-6, tolerance), 0, 1);
}

/** plate: placed items vs reference layout (coordinates in [0,1]); missing items count as max distance. */
export function scorePlate(placed: { id: string; x: number; y: number }[], layout: { id: string; x: number; y: number }[]): number {
  if (!layout.length) return 1;
  const maxD = 0.5;
  let sum = 0;
  for (const ref of layout) {
    const p = placed.find((q) => q.id === ref.id);
    sum += p ? Math.min(maxD, Math.hypot(p.x - ref.x, p.y - ref.y)) : maxD;
  }
  return clamp(1 - sum / layout.length / maxD, 0, 1);
}

export function timeFactor(elapsed: number, budget: number): number {
  return elapsed <= budget ? 1 : clamp(1 - (elapsed - budget) / budget, 0.5, 1);
}

/** Final quality q ∈ [0,1] = weighted mean of step scores × time factor. */
export function quality(recipe: Recipe, scores: Record<string, number>, elapsed: number): number {
  let w = 0;
  let sum = 0;
  for (const st of recipe.steps) {
    w += st.weight;
    sum += st.weight * clamp(scores[st.id] ?? 0, 0, 1);
  }
  return clamp((w ? sum / w : 0) * timeFactor(elapsed, recipe.timeBudget), 0, 1);
}

/** r = q · clamp(0.5 + cos(t, p)/2, 0, 1) */
export function reception(q: number, taste: number[], pref: number[]): number {
  return clamp(q, 0, 1) * clamp(0.5 + cosine(taste, pref) / 2, 0, 1);
}

const REC_POINTS: [number, number, number][] = [
  [0, -6, -0.15],
  [0.3, -1, -0.03],
  [0.5, 2, 0.05],
  [0.75, 6, 0.12],
  [1, 10, 0.2],
];
/** Monotone piecewise-linear map from reception to affinity/mood deltas. */
export function receptionDeltas(r: number): { affinity: number; mood: number } {
  const x = clamp(r, 0, 1);
  for (let i = 1; i < REC_POINTS.length; i++) {
    const [x1, a1, m1] = REC_POINTS[i];
    const [x0, a0, m0] = REC_POINTS[i - 1];
    if (x <= x1) {
      const t = (x - x0) / (x1 - x0);
      return { affinity: a0 + (a1 - a0) * t, mood: m0 + (m1 - m0) * t };
    }
  }
  return { affinity: 10, mood: 0.2 };
}

// ---------------------------------------------------------------- state machine

export type StepStatus = 'locked' | 'ready' | 'active' | 'done';
export interface CookingState {
  recipeId: string;
  elapsed: number;
  steps: Record<string, { status: StepStatus; score: number | null; by: 'player' | 'partner' }>;
  partner: string | null;
  active: string | null;
  done: boolean;
  quality: number | null;
}

export function coopSkill(c: Character): number {
  const t = traitsOf(c);
  return clamp(0.35 + t.C * 0.35 + (/cook|chef|baker|pastry/.test(c.occupation) ? 0.25 : 0), 0, 1);
}

function refresh(cs: CookingState, recipe: Recipe) {
  for (const st of recipe.steps) {
    const s = cs.steps[st.id];
    if (s.status === 'locked' && st.deps.every((d) => cs.steps[d].status === 'done')) s.status = 'ready';
  }
  cs.done = recipe.steps.every((st) => cs.steps[st.id].status === 'done');
  if (cs.done) {
    const scores = Object.fromEntries(Object.entries(cs.steps).map(([k, v]) => [k, v.score ?? 0]));
    cs.quality = quality(recipe, scores, cs.elapsed);
  }
}

/**
 * Start a session. With a partner, they co-op a subset of steps (auto-played with trait-derived skill):
 * every second dependency-free-or-ready step, never the plating.
 */
export function startCooking(recipe: Recipe, partner?: { id: string; skill: number }, rng: Rng = mulberry32(1)): CookingState {
  const cs: CookingState = {
    recipeId: recipe.id,
    elapsed: 0,
    steps: Object.fromEntries(recipe.steps.map((st) => [st.id, { status: 'locked' as StepStatus, score: null, by: 'player' as const }])),
    partner: partner?.id ?? null,
    active: null,
    done: false,
    quality: null,
  };
  if (partner) {
    const candidates = recipe.steps.filter((st) => st.type !== 'plate');
    candidates.forEach((st, i) => {
      if (i % 2 === 1) {
        cs.steps[st.id].by = 'partner';
        cs.steps[st.id].score = clamp(partner.skill + rng.normal(0, 0.08), 0, 1);
      }
    });
  }
  refresh(cs, recipe);
  autoplayPartner(cs, recipe);
  return cs;
}

/** Partner steps complete as soon as they become available (in parallel with the player). */
function autoplayPartner(cs: CookingState, recipe: Recipe) {
  let changed = true;
  while (changed) {
    changed = false;
    for (const st of recipe.steps) {
      const s = cs.steps[st.id];
      if (s.by === 'partner' && s.status === 'ready') {
        s.status = 'done';
        changed = true;
      }
    }
    refresh(cs, recipe);
  }
}

export const availableSteps = (cs: CookingState, recipe: Recipe): RecipeStep[] => recipe.steps.filter((st) => cs.steps[st.id].status === 'ready' && cs.steps[st.id].by === 'player');

export function beginStep(cs0: CookingState, recipe: Recipe, stepId: string): CookingState {
  const cs = structuredClone(cs0);
  if (cs.active) throw new Error('another step is active');
  const s = cs.steps[stepId];
  if (!s || s.status !== 'ready' || s.by !== 'player') throw new Error(`step ${stepId} not available`);
  s.status = 'active';
  cs.active = stepId;
  return cs;
}

/** Complete the active step with a score and the seconds it took (shared time budget). */
export function completeStep(cs0: CookingState, recipe: Recipe, stepId: string, score: number, seconds: number): CookingState {
  const cs = structuredClone(cs0);
  const s = cs.steps[stepId];
  if (!s || s.status !== 'active') throw new Error(`step ${stepId} not active`);
  s.status = 'done';
  s.score = clamp(score, 0, 1);
  cs.active = null;
  cs.elapsed += Math.max(0, seconds);
  refresh(cs, recipe);
  autoplayPartner(cs, recipe);
  return cs;
}

// ---------------------------------------------------------------- applying a cooked dish to the game

export interface Reception {
  charId: string;
  r: number;
  affinity: number;
  mood: number;
  verdict: 'loved it' | 'liked it' | 'polite' | 'struggled' | 'politely declined';
}

export function canEat(c: Character, recipe: Recipe, utensil: Recipe['category'] = recipe.category): boolean {
  const ingredients = Object.keys(recipe.ingredients);
  const meat = recipe.category === 'meat' || ingredients.some((x) => /chicken|beef|pork|lamb|salmon|fish|shrimp|shellfish/.test(x));
  const dairy = recipe.category === 'dairy' || ingredients.some((x) => /milk|butter|cheese|cream|yogurt/.test(x));
  if (c.persona.diet === 'vegan' && (meat || dairy || ingredients.includes('egg') || recipe.diet !== 'vegan')) return false;
  if (c.persona.diet === 'vegetarian' && (meat || recipe.diet === 'omnivore')) return false;
  if (c.persona.kashrut === 'none') return true;
  if (ingredients.some((x) => /pork|bacon|shrimp|shellfish/.test(x)) || (meat && dairy)) return false;
  return c.persona.kashrut !== 'strict' || (recipe.kosher && !(recipe.category === 'dairy' && utensil === 'meat') && !(recipe.category === 'meat' && utensil === 'dairy'));
}

export function npcRecipe(c: Character, s: GameState, rng: Rng, company: Character[] = []): Recipe | undefined {
  const recipes = content().recipes.filter((r) => [c, ...company].every(person => canEat(person,r)) &&
    Object.entries(r.ingredients).every(([id,count]) => (s.house.fridge[id] ?? 0) >= count) &&
    (![c, ...company].some(person => person.persona.kashrut === 'strict') || (
      Object.keys(r.ingredients).every((id) => s.house.kitchen.kosherShelf.includes(id)) &&
      (r.category !== 'meat' || s.house.kitchen.meatPanClean) && (r.category !== 'dairy' || s.house.kitchen.dairyPanClean))));
  if (!recipes.length) return;
  const crowd = Object.values(s.characters).filter(person => person.status === 'inHouse' && person.location !== 'out');
  const coverage = (r: Recipe) => crowd.filter(person => canEat(person, r)).length;
  const most = Math.max(...recipes.map(coverage));
  return rng.pick(recipes.filter(r => coverage(r) === most));
}

export function verdictOf(r: number): Reception['verdict'] {
  return r >= 0.7 ? 'loved it' : r >= 0.5 ? 'liked it' : r >= 0.3 ? 'polite' : 'struggled';
}

/** Pure: apply a dish (quality from the minigame) to housemates who ate it. */
export function applyCooking(
  s0: GameState,
  o: { recipeId: string; quality: number; cook: string; partner?: string; servedTo: string[]; utensil?: Recipe['category']; ingredientsReserved?: boolean },
): { state: GameState; receptions: Reception[]; improvised: boolean } {
  const s = cloneState(s0);
  const recipe = recipeById(o.recipeId);
  if (isShabbat(s,s.characters[o.cook])) throw new Error('This housemate does not cook on Shabbat. Share food prepared before sundown.');
  const utensil = o.utensil ?? recipe.category;
  const clean = utensil === 'meat' ? s.house.kitchen.meatPanClean : utensil === 'dairy' ? s.house.kitchen.dairyPanClean : true;
  const markedIngredients = Object.keys(recipe.ingredients).every((id) => s.house.kitchen.kosherShelf.includes(id));
  if ((utensil === 'meat' && recipe.category === 'dairy') || (utensil === 'dairy' && recipe.category === 'meat')) {
    s.world.flags.kosherPanViolation = true;
    if (utensil === 'meat') s.house.kitchen.meatPanClean = false;
    else s.house.kitchen.dairyPanClean = false;
  }
  const improvised = !o.ingredientsReserved && !consume(s, recipe.ingredients);
  const q = clamp(o.quality * (improvised ? 0.6 : 1), 0, 1);
  const receptions: Reception[] = [];
  for (const id of o.servedTo.slice(0, recipe.serves)) {
    const c = s.characters[id];
    if (!c || c.status !== 'inHouse' || id === o.cook) continue;
    if (!canEat(c,recipe,utensil) || (c.persona.kashrut === 'strict' && (!clean || !markedIngredients || improvised))) {
      addRel(s,id,o.cook,'trust',-2);
      addMemory(s,id,`${firstName(s,o.cook)} served ${recipe.name} without checking my kitchen or diet needs. I politely declined.`,[id,o.cook],.35);
      receptions.push({charId:id,r:0,affinity:0,mood:0,verdict:'politely declined'});
      continue;
    }
    if (c.persona.kashrut !== 'none' || c.persona.diet !== 'omnivore') addRel(s,id,o.cook,'trust',2);
    const r = reception(q, recipe.taste, c.tastes);
    const d = receptionDeltas(r);
    addRel(s, id, o.cook, 'affinity', d.affinity);
    addRel(s, id, o.cook, 'closeness', 2);
    if (o.partner && id !== o.partner) addRel(s, id, o.partner, 'affinity', d.affinity * 0.4);
    c.mood = clamp(c.mood + d.mood, -1, 1);
    c.needs.hunger = clamp(c.needs.hunger - 30, 0, 100);
    addMemory(s, id, `${firstName(s, o.cook)} cooked ${recipe.name}; ${firstName(s, id)} ${verdictOf(r)}.`, [id, o.cook], 0.25 + Math.abs(r - 0.5) * 0.6);
    receptions.push({ charId: id, r, ...d, verdict: verdictOf(r) });
  }
  if (o.partner && s.characters[o.partner]) {
    addRel(s, o.partner, o.cook, 'closeness', 5);
    addRel(s, o.cook, o.partner, 'closeness', 5);
    addRel(s, o.partner, o.cook, 'affinity', 3);
  }
  if (receptions.length >= 2) publicAct(s, o.cook, 3 * q);
  s.house.dishes = clamp(s.house.dishes + 6 + receptions.length * 3, 0, 100);
  s.house.groceryBudget -= improvised ? 0 : 14;
  addLog(s, { kind: 'domestic', text: `${firstName(s, o.cook)} cooked ${recipe.name}${improvised ? ' (improvised with what was left)' : ''}.`, participants: [o.cook, ...receptions.map((r) => r.charId)], salience: 0.3 });
  return { state: s, receptions, improvised };
}
