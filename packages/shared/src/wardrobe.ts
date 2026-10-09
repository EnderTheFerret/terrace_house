// Wardrobes: a rotating daily outfit plus fixed outfits for dates, outdoor trips, the beach and bed.
// Picked deterministically from the character id, so every client and the server agree without storing anything.
import { ROOMS } from './model';
import { hashSeed } from './rng';

export const OCCASIONS = ['daily', 'date', 'formal', 'outdoor', 'beach', 'sleep'] as const;
export type Occasion = typeof OCCASIONS[number];

type Pools = { woman: string[]; man: string[] };

const POOLS: Record<Occasion, Pools> = {
  daily: {
    woman: ['striped tee and high-waisted jeans', 'linen button-up shirt and wide trousers', 'cropped knit top and pleated midi skirt', 'oversized hoodie and bike shorts', 'denim overall dress over a white tee', 'ribbed tank top and linen pants'],
    man: ['plain white tee and chino shorts', 'short-sleeve linen shirt and khaki trousers', 'grey hoodie and joggers', 'striped polo shirt and jeans', 'black tee and cargo shorts', 'open flannel shirt over a tank top and jeans'],
  },
  date: {
    woman: ['ruby-red tailored crepe midi dress, bateau neckline, short sleeves, defined waist, smooth pencil skirt and elegant heels', 'navy silk midi dress, softly draped cowl neckline, fitted waist and elegant heels', 'ivory satin wrap midi dress, short sleeves, tailored waist and elegant heels', 'black satin midi dress, square neckline, wide shoulder straps, fitted waist and elegant heels', 'forest-green wrap midi dress, short sleeves, tied waist and low heels', 'burgundy A-line midi dress, three-quarter sleeves and elegant heels'],
    man: ['crisp white button-up shirt and tailored navy trousers', 'light blazer over a black tee and dark jeans', 'sage linen shirt and beige trousers', 'knit polo shirt and slim grey trousers', 'navy knit sweater over a collared shirt and dark chinos', 'olive bomber jacket, white tee and dark jeans'],
  },
  formal: {
    woman: ['navy tailored pantsuit, white silk blouse and elegant heels', 'black silk evening gown, elegant bateau neckline, structured waist, long flowing skirt and elegant heels', 'deep-blue satin evening gown, short sleeves, fitted waist, long skirt and elegant heels', 'charcoal tailored suit, ivory silk blouse and elegant heels'],
    man: ['tailored navy two-piece suit, white dress shirt, dark tie and dress shoes', 'black tuxedo, white dress shirt, black bow tie and dress shoes', 'charcoal three-piece suit, light-blue dress shirt, silver tie and dress shoes'],
  },
  outdoor: {
    woman: ['green hiking jacket, leggings and hiking boots', 'fleece pullover, cargo pants and trail shoes', 'windbreaker, shorts over leggings and hiking boots', 'orange rain jacket, hiking leggings and trail shoes'],
    man: ['green hiking jacket, cargo pants and hiking boots', 'fleece pullover, outdoor trousers and trail shoes', 'flannel shirt, cargo shorts and hiking boots', 'yellow rain jacket, hiking trousers and trail shoes'],
  },
  beach: {
    woman: ['coral two-piece bikini', 'navy one-piece swimsuit', 'yellow bikini with a sarong', 'white bikini', 'teal one-piece swimsuit', 'black two-piece swimsuit with a sheer cover-up'],
    man: ['blue swim trunks, shirtless', 'red swim trunks, shirtless', 'patterned board shorts, shirtless', 'black swim trunks, shirtless', 'teal swim trunks, shirtless'],
  },
  sleep: {
    woman: ['pastel pajama set', 'oversized sleep tee and shorts', 'striped cotton pajamas', 'soft long-sleeve pajama set with a star print'],
    man: ['grey sleep tee and pajama pants', 'plaid pajama set', 'loose tank top and sleep shorts', 'soft long-sleeve tee and checked pajama pants'],
  },
};

/** Days a daily outfit repeats after (signature outfit first). Each one costs an outfit portrait + a walk sheet once. */
export const DAILY_ROTATION = 4;

/**
 * Closets by personality. A character's closest style (their strongest of openness, conscientiousness, extraversion
 * or gentleness) replaces the generic daily pool and adds to the date pool; no traits (guests) keeps the generic ones.
 */
const STYLES = {
  artsy: { // open: thrifted, layered, colourful
    daily: {
      woman: ['mustard cardigan over a floral slip dress and boots', 'patchwork denim jacket, graphic tee and flared jeans', 'paint-splashed overalls and a striped long-sleeve tee', 'burgundy corduroy pinafore dress over a cream turtleneck', 'oversized vintage band tee and a tiered patterned skirt', 'teal knit vest over a white shirt and wide-leg trousers'],
      man: ['mustard knit sweater and corduroy trousers', 'vintage floral short-sleeve shirt and dark jeans', 'paint-splashed overalls over a plain tee', 'oversized patterned cardigan, white tee and baggy jeans', 'rust-orange overshirt, black tee and wide trousers', 'denim jacket with patches, graphic tee and cargo trousers'],
    },
    date: { woman: ['emerald velvet midi dress, long sleeves, defined waist and ankle boots', 'floral wrap midi dress, short sleeves, tied waist and strappy flats'], man: ['rust-orange corduroy shirt, dark jeans and suede boots', 'patterned camp-collar shirt and cream linen trousers'] },
  },
  neat: { // conscientious: tidy, tailored, muted
    daily: {
      woman: ['cream blouse tucked into a camel pleated midi skirt', 'navy knit polo and tailored beige trousers', 'white oxford shirt, grey cardigan and straight jeans', 'sage sweater vest over a collared shirt and slacks', 'black fine-knit sweater and a tailored charcoal midi skirt', 'light-blue button-up shirt and cream chinos'],
      man: ['white oxford shirt tucked into navy chinos', 'grey knit polo and tailored beige trousers', 'light-blue shirt, navy cardigan and slacks', 'fine-knit green sweater over a collared shirt and chinos', 'crisp striped shirt, rolled sleeves and grey trousers', 'cream henley and dark tailored trousers'],
    },
    date: { woman: ['dusty-blue tailored midi dress, short sleeves, belted waist and low heels', 'cream silk blouse, high-waisted black trousers and elegant heels'], man: ['navy blazer over a white shirt and grey trousers', 'fitted light-grey knit polo and tailored navy trousers'] },
  },
  bold: { // extraverted: sporty, bright, statement pieces
    daily: {
      woman: ['bright red track jacket, white tank top and black leggings', 'yellow oversized sweatshirt and denim shorts over leggings', 'cobalt-blue cropped jacket, white tee and high-waisted jeans', 'hot-pink hoodie and black bike shorts', 'orange windbreaker, graphic tee and joggers', 'colour-block football jersey and a denim skirt'],
      man: ['bright red track jacket, white tee and black joggers', 'yellow graphic hoodie and denim shorts', 'cobalt-blue bomber jacket, white tee and jeans', 'orange basketball jersey and black shorts', 'neon-green windbreaker, grey tee and joggers', 'colour-block football jersey and cargo shorts'],
    },
    date: { woman: ['fitted scarlet midi dress, short sleeves, defined waist and strappy heels', 'cobalt satin slip midi dress with a cropped denim jacket and heels'], man: ['fitted burgundy shirt, black jeans and white sneakers', 'bright teal bomber jacket over a white tee and black trousers'] },
  },
  cozy: { // gentle or anxious: soft, oversized, pastel
    daily: {
      woman: ['oversized lilac knit sweater and soft leggings', 'cream fleece pullover and loose corduroy trousers', 'pastel-pink cardigan over a white tee and a long denim skirt', 'baggy grey hoodie and soft wide-leg sweatpants', 'powder-blue sweater dress and knitted socks', 'oatmeal cardigan, ribbed tee and relaxed jeans'],
      man: ['oversized oatmeal knit sweater and soft joggers', 'sage fleece pullover and loose corduroy trousers', 'faded pastel hoodie and relaxed jeans', 'baggy grey crewneck sweatshirt and sweatpants', 'cream cardigan, white tee and loose chinos', 'light-blue flannel shirt over a tee and soft trousers'],
    },
    date: { woman: ['blush soft-knit midi dress, long sleeves, gentle waist and white sneakers', 'lavender wrap cardigan over a cream slip midi dress and flats'], man: ['soft sage knit sweater over a collared shirt and light trousers', 'cream cable-knit sweater and dark jeans'] },
  },
};
type Style = keyof typeof STYLES;

/** Traits are [openness, conscientiousness, extraversion, agreeableness, neuroticism]. */
function styleOf(traits?: number[]): Style | null {
  if (!traits || traits.length < 5) return null;
  const score: Record<Style, number> = { artsy: traits[0], neat: traits[1], bold: traits[2], cozy: (traits[3] + traits[4]) / 2 };
  return (Object.keys(score) as Style[]).reduce((a, b) => (score[b] > score[a] ? b : a));
}

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
export function outfitFor(c: { id: string; gender: string; appearance: { outfit: string }; persona?: { traits: number[] } }, occasion: Occasion, day = 0): string {
  const style = styleOf(c.persona?.traits);
  const extra = style && occasion === 'daily' ? STYLES[style].daily : null;
  const date = style && occasion === 'date' ? STYLES[style].date : null;
  const base = POOLS[occasion];
  const p: Pools = extra ?? (date ? { woman: [...base.woman, ...date.woman], man: [...base.man, ...date.man] } : base);
  const pool = c.gender === 'woman' ? p.woman : c.gender === 'man' ? p.man : [...p.woman, ...p.man];
  if (occasion !== 'daily') return pick(pool, c.id, occasion);
  const turn = ((day % DAILY_ROTATION) + DAILY_ROTATION) % DAILY_ROTATION;
  if (turn === 0) return c.appearance.outfit;
  // distinct picks for the other days of the rotation
  const start = hashSeed(`${c.id}:daily`) % pool.length;
  return pool[(start + turn - 1) % pool.length];
}
