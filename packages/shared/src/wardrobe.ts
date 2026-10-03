// Wardrobes: a rotating daily outfit plus fixed outfits for dates, outdoor trips, the beach and bed.
// Picked deterministically from the character id, so every client and the server agree without storing anything.
import { ROOMS } from './model';
import { hashSeed } from './rng';

export type Occasion = 'daily' | 'date' | 'outdoor' | 'beach' | 'sleep';

type Pools = { woman: string[]; man: string[] };

const POOLS: Record<Occasion, Pools> = {
  daily: {
    woman: ['striped tee and high-waisted jeans', 'linen button-up shirt and wide trousers', 'cropped knit top and pleated midi skirt', 'oversized hoodie and bike shorts', 'denim overall dress over a white tee', 'ribbed tank top and linen pants'],
    man: ['plain white tee and chino shorts', 'short-sleeve linen shirt and khaki trousers', 'grey hoodie and joggers', 'striped polo shirt and jeans', 'black tee and cargo shorts', 'open flannel shirt over a tank top and jeans'],
  },
  date: {
    woman: ['red knee-length summer dress and sandals', 'navy slip dress and a light cardigan', 'floral wrap dress and white sneakers', 'black satin midi dress and heeled sandals'],
    man: ['crisp white button-up shirt and tailored navy trousers', 'light blazer over a black tee and dark jeans', 'sage linen shirt and beige trousers', 'knit polo shirt and slim grey trousers'],
  },
  outdoor: {
    woman: ['green hiking jacket, leggings and hiking boots', 'fleece pullover, cargo pants and trail shoes', 'windbreaker, shorts over leggings and hiking boots'],
    man: ['green hiking jacket, cargo pants and hiking boots', 'fleece pullover, outdoor trousers and trail shoes', 'flannel shirt, cargo shorts and hiking boots'],
  },
  beach: {
    woman: ['coral two-piece bikini', 'navy one-piece swimsuit', 'yellow bikini with a sarong', 'white bikini'],
    man: ['blue swim trunks, shirtless', 'red swim trunks, shirtless', 'patterned board shorts, shirtless', 'black swim trunks, shirtless'],
  },
  sleep: {
    woman: ['pastel pajama set', 'oversized sleep tee and shorts', 'striped cotton pajamas'],
    man: ['grey sleep tee and pajama pants', 'plaid pajama set', 'loose tank top and sleep shorts'],
  },
};

/** Days a daily outfit repeats after (signature outfit first). Each one costs an outfit portrait + a walk sheet once. */
export const DAILY_ROTATION = 4;

const pick = (pool: string[], id: string, salt: string) => pool[hashSeed(`${id}:${salt}`) % pool.length];

/** What a scene calls for: swimwear at the beach, gear on trips, date clothes on dates, otherwise today's outfit. */
export function occasionFor(ev: { location: string; type: string; tags: string[]; templateId: string; slot?: string; swimming?: boolean }): Occasion {
  if (ev.location === 'beach' || ev.swimming || ev.tags.includes('swim')) return 'beach';
  // after 23:00 at home everyone is in their sleepwear
  if (ev.slot === 'lateNight' && (ROOMS as readonly string[]).includes(ev.location)) return 'sleep';
  if (ev.tags.some((t) => ['camping', 'hike', 'trip', 'overnight'].includes(t))) return 'outdoor';
  if (ev.type === 'date' || ev.tags.includes('date') || ev.templateId.includes('date')) return 'date';
  return 'daily';
}

export function occasionForCharacter(c: { swimming?: boolean }, ev: Parameters<typeof occasionFor>[0]): Occasion {
  if (ev.location !== 'backyard') return occasionFor(ev);
  if (c.swimming) return 'beach';
  return occasionFor({ ...ev, swimming: false, tags: ev.tags.filter((tag) => tag !== 'swim') });
}

/** `day` is the 0-based world day; day 0 (and every DAILY_ROTATION days after) is the character's signature outfit. */
export function outfitFor(c: { id: string; gender: string; appearance: { outfit: string } }, occasion: Occasion, day = 0): string {
  const p = POOLS[occasion];
  const pool = c.gender === 'woman' ? p.woman : c.gender === 'man' ? p.man : [...p.woman, ...p.man];
  if (occasion !== 'daily') return pick(pool, c.id, occasion);
  const turn = ((day % DAILY_ROTATION) + DAILY_ROTATION) % DAILY_ROTATION;
  if (turn === 0) return c.appearance.outfit;
  // distinct picks for the other days of the rotation
  const start = hashSeed(`${c.id}:daily`) % pool.length;
  return pool[(start + turn - 1) % pool.length];
}
