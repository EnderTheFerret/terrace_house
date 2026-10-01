// Seeded PRNG (mulberry32). All engine randomness flows through an Rng whose
// 32-bit state is stored in GameState.rngState, so runs are replayable.

export interface Rng {
  /** float in [0,1) */
  next(): number;
  int(minInclusive: number, maxExclusive: number): number;
  pick<T>(arr: readonly T[]): T;
  chance(p: number): boolean;
  normal(mean?: number, sd?: number): number;
  shuffle<T>(arr: readonly T[]): T[];
  /** Gumbel(0,1) sample, used for softmax sampling via the Gumbel-max trick */
  gumbel(): number;
  weighted<T>(items: readonly T[], weights: readonly number[]): T;
  state(): number;
}

export function mulberry32(seed: number): Rng {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rng: Rng = {
    next,
    int: (a, b) => a + Math.floor(next() * (b - a)),
    pick: (arr) => {
      if (arr.length === 0) throw new Error('pick from empty array');
      return arr[Math.floor(next() * arr.length)];
    },
    chance: (p) => next() < p,
    normal: (mean = 0, sd = 1) => {
      const u = Math.max(next(), 1e-12);
      const v = next();
      return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
    shuffle: (arr) => {
      const out = arr.slice();
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    },
    gumbel: () => -Math.log(-Math.log(Math.max(next(), 1e-12))),
    weighted: (items, weights) => {
      const total = weights.reduce((a, w) => a + Math.max(0, w), 0);
      if (total <= 0) return rng.pick(items);
      let r = next() * total;
      for (let i = 0; i < items.length; i++) {
        r -= Math.max(0, weights[i]);
        if (r <= 0) return items[i];
      }
      return items[items.length - 1];
    },
    state: () => s,
  };
  return rng;
}

/** Hash a string to a 32-bit seed (FNV-1a). Deterministic, used for derived seeds. */
export function hashSeed(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Softmax sampling with temperature using the Gumbel-max trick. Returns index. */
export function softmaxSample(rng: Rng, scores: readonly number[], temperature = 1): number {
  let best = -Infinity;
  let bestI = 0;
  const t = Math.max(temperature, 1e-6);
  for (let i = 0; i < scores.length; i++) {
    const v = scores[i] / t + rng.gumbel();
    if (v > best) {
      best = v;
      bestI = i;
    }
  }
  return bestI;
}
