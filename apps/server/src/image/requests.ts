// Image request builders (prompts compiled by shared pure functions; style prefix from config).
import {
  compileAppearancePrompt, compileAppearanceTags, compileLocationPrompt, content, hashSeed, sanitizePromptText, GLOBAL_NEGATIVE,
  type Character, type Emotion, type EventInstance, type GameState, type ImageRequest, type Slot,
} from '@shared-roof/shared';
import { config, ROOT } from '../config';
import { resolve } from 'node:path';

const size = (k: string) => config.sizes[k] ?? [1024, 1024];

// Explicit viewpoints keep room names from turning into captioned house exteriors.
const scenery: Record<string, string> = {
  arcade: 'open-air Jaffa flea-market lane, vintage clothing and brass objects on stalls, warm stone paving and low historic storefronts',
  lighthouse: 'wooden Mediterranean harbor boardwalk in Tel Aviv, simple railing and street lamps, blue sea, distant pale skyline, benches',
  bedroomW: 'interior of an upstairs shared bedroom, three single beds with coral and lavender bedding, personal shelves, folded clothes, warm wooden floor, a glass door to a private balcony',
  bedroomM: 'interior of an upstairs shared bedroom, three single beds with navy and olive bedding, personal shelves, guitar and folded clothes, warm wooden floor, a glass door to a private balcony',
  bathroom: 'interior of the upstairs shared bathroom, blue ceramic wall tiles, shower enclosure, bathtub, two washbasins, towels and toiletries',
  smallBathroom: 'interior of a compact downstairs bathroom, pale ceramic tiles, toilet, small washbasin, mirror, hand towel',
  living: 'interior of a shared living room, large comfortable sofa, low wooden coffee table, books and houseplants, television, broad windows with Mediterranean light',
  kitchen: 'interior of a shared kitchen and dining area, six chairs at a wooden table, refrigerator, stove, sink, pale tiled floor, clearly separate red and blue cookware storage, herbs by the window',
  entrance: 'interior entry hallway viewed from inside, front door, shoe rack with six pairs of shoes, hooks and bags, patterned tile floor, passage to the living room',
  stairs: 'interior ground-floor staircase, one flight of wooden steps climbing to the second floor, simple handrail, tile floor, houseplants, walls filling the frame',
  stairsUp: 'second-floor hallway landing, horizontal wooden corridor with bedroom doors, low wooden balustrade around a rectangular opening in the floor, a descending stairwell visible below the floor opening, warm wooden floor, small window, uninterrupted flat ceiling',
  balconyM: 'view from inside a small private second-floor bedroom balcony, two chairs and small table, potted herbs, simple railing overlooking a Tel Aviv street, bedroom door behind, no roof deck',
  balconyW: 'view from inside a small private second-floor bedroom balcony, two chairs and small table, bougainvillea in pots, simple railing overlooking a Tel Aviv street, bedroom door behind, no roof deck',
  backyard: 'ground-level enclosed backyard garden, the entire ground covered by lawn and warm stone paving, shared wooden table with six chairs, overhead string lights, potted herbs and bougainvillea, compact charcoal barbecue, rear wall of a white two-story Tel Aviv house with bedroom balconies',
  riverside: 'Mediterranean seafront promenade in Tel Aviv, palms and pale paving, blue sea, distant Bauhaus buildings, benches and a bicycle lane',
  beach: 'Mediterranean sandy beach in Tel Aviv, volleyball net, calm blue sea, palms, distant pale city buildings, quiet open sand',
  hospital: 'interior of a modern Tel Aviv hospital ward, clean beds, white sheets, blue curtains, medical equipment, softly lit corridor',
};

export function portraitRequest(c: Pick<Character, 'id' | 'age' | 'gender' | 'appearance' | 'portraitSeed'> & { appearanceText?: string }, lowRes = false): ImageRequest {
  const p = compileAppearancePrompt(c, 'portrait', { stylePrefix: config.stylePrefix });
  const { palette: _palette, ...appearance } = c.appearance;
  const [w, h] = size('portrait');
  const scale = lowRes ? 0.5 : 1;
  return {
    kind: 'portrait',
    prompt: p.positive,
    negative: p.negative,
    seed: c.portraitSeed,
    width: Math.round((w * scale) / 16) * 16,
    height: Math.round((h * scale) / 16) * 16,
    subjectKey: `portrait:${c.id}:${c.portraitSeed}:${hashSeed(JSON.stringify([appearance, c.appearanceText ?? ''])) % 100000}`,
    meta: { appearance: c.appearance, gender: c.gender },
  };
}

/** Shared style and identity prompts apply equally to defaults, arrivals and custom players. */
export function spriteRequest(c: Parameters<typeof portraitRequest>[0]): ImageRequest {
  const base = portraitRequest(c);
  const who = [...compileAppearanceTags(c), sanitizePromptText(c.appearanceText ?? '')].filter(Boolean).join(', ');
  return {
    ...base, kind: 'sprite', width: 1024, height: 384,
    subjectKey: `sprite:chibi-v2:${base.subjectKey}`,
    reference: resolve(ROOT, 'workflows/sprite-style.jpg'),
    reference2: resolve(ROOT, 'workflows/sprite-layout.png'),
    prompt: `Image 1 is ONLY a pixel art STYLE guide, not its characters or costumes. Image 2 is ONLY the exact four-view pose/layout guide, not its hair or outfit. Preserve Image 2 direction order and compact large-head proportions while applying Image 1 detailed pixel rendering. Create a new adult character: ${who}. Draw exactly FOUR full-body idle views of this SAME person in one horizontal row: front, back, LEFT profile nose pointing left, RIGHT profile nose pointing right. Equal-width quarters, centered, equal height, same foot baseline. Match the reference's detailed handheld-era RPG pixel sprites: compact chibi proportions, only TWO heads tall, big textured hair silhouette occupying half the height, small face, short body and short legs, crisp one-pixel dark contour, angular highlights and shadows, 4-tone hair clusters, layered clothing, collar seams, buttons, folds, cuffs, hands and shoe soles, readable individual accessories. Contemporary everyday clothing from the character description. Entire heads and feet visible with generous white margins. Pure white studio background; no text, no captions, no scenery, no shadow, no grid lines, no gradients. Design for a true 32 by 40 pixel frame.`,
    negative: base.negative + ', realistic, photograph, 3d, oversized portrait, blur, text, watermark, cropped head, cropped feet, extra people, scenery, drop shadow',
  };
}

const expressionTags: Record<Emotion, string> = {
  neutral: 'calm natural expression', happy: 'happy expression, warm smile, bright eyes',
  sad: 'sad expression, downturned mouth, sorrowful eyes', angry: 'angry expression, furrowed brows, tight lips',
  tender: 'in love expression, affectionate gaze, soft smile, lightly blushing cheeks',
  shy: 'shy expression, blushing, bashful smile', awkward: 'awkward expression, hesitant uneven smile',
  annoyed: 'annoyed expression, narrowed eyes, pursed lips', excited: 'excited expression, wide joyful eyes, big smile',
  nervous: 'nervous expression, worried brows, tense small smile',
};

export function expressionRequest(c: Character, emotion: Emotion, reference?: string | null): ImageRequest {
  const base = portraitRequest(c);
  if (emotion === 'neutral') return base;
  const p = compileAppearancePrompt(c, 'portrait', { stylePrefix: config.stylePrefix, expression: expressionTags[emotion] });
  return { ...base, prompt: `${p.positive}${reference ? ', preserve the reference character identity, hair, clothing, background and framing; change only the facial expression' : ''}`, subjectKey: `${base.subjectKey}:expression:${emotion}`, ...(reference ? { reference } : {}) };
}

export const timeOfDay = (slot: Slot): 'morning' | 'day' | 'evening' | 'night' => (slot === 'morning' ? 'morning' : slot === 'slot3' ? 'evening' : slot === 'evening' || slot === 'lateNight' ? 'night' : 'day');

export function locationRequest(locId: string, slot: Slot, weather: string): ImageRequest {
  const node = content().city.nodes.find((n) => n.id === locId);
  const room = content().house.rooms.find((r) => r.id === locId);
  const name = node?.name ?? (room ? `share house ${room.name}` : locId);
  const desc = scenery[locId] ?? node?.description ?? (room ? `interior of a Tel Aviv share house ${room.name}` : '');
  const tod = timeOfDay(slot);
  // weather variants are rendered as overlays client-side; only rain/snow get their own background
  const w = weather === 'rain' || weather === 'typhoon' || weather === 'snow' ? weather : 'clear';
  const style = config.stylePrefix.replace(/,?\s*reality show still/gi, '');
  const p = compileLocationPrompt(name, desc, tod, w, style);
  if (scenery[locId]) p.positive = `${style}, wide game background, ${desc}, ${tod} lighting${w === 'clear' ? '' : `, ${w} weather`}, unoccupied space, all walls and surfaces unlettered, no captions, no typography, no people`;
  if (locId === 'backyard') p.negative += ', swimming pool, pool, rooftop terrace';
  const [W, H] = size('location');
  return { kind: 'location', prompt: p.positive, negative: p.negative, seed: hashSeed(`${locId}:${tod}:${w}`) % 100000, width: W, height: H, subjectKey: `location:${locId}:${tod}${w === 'clear' ? '' : ':' + w}`, meta: { timeOfDay: tod, weather: w } };
}

export function avatarRequest(panelistId: string): ImageRequest {
  const p = content().panel.find((x) => x.id === panelistId)!;
  const [W, H] = size('avatar');
  return {
    kind: 'avatar',
    prompt: `${config.stylePrefix}, adult, age 20+, ${sanitizePromptText(p.appearance)}, tv studio panel guest, sitting at a desk, square avatar, head and shoulders, studio backdrop`,
    negative: GLOBAL_NEGATIVE,
    seed: p.avatarSeed,
    width: W,
    height: H,
    subjectKey: `avatar:${p.id}`,
  };
}

/**
 * Freeze-frame still. `reference` = the first participant's approved portrait, so a reference workflow keeps their face.
 * ponytail: one reference face; the second person relies on the fixed tag order. Add image2 to the workflow if needed.
 */
export function freezeRequest(s: GameState, ev: EventInstance, reference?: string | null, context = ''): ImageRequest {
  const people = ev.participants.map((id) => s.characters[id]).filter(Boolean).slice(0, 2);
  const who = people.map((c) => compileAppearancePrompt(c, 'scene', { stylePrefix: '' }).positive.replace(/^,\s*/, '')).join('; and ');
  const loc = scenery[ev.location] ?? content().city.nodes.find((n) => n.id === ev.location)?.description ?? `share house ${ev.location}`;
  const [W, H] = size('freeze');
  return {
    kind: 'freeze',
    prompt: `${config.stylePrefix}, adult, age 20+, freeze frame still, ${sanitizePromptText(ev.title)} at ${loc}, ${who}, emotional moment, cinematic composition${context ? `, ${timeOfDay(ev.slot)} lighting, ${s.world.weather} weather, ${sanitizePromptText(context)}` : ''}`,
    negative: GLOBAL_NEGATIVE,
    seed: hashSeed(ev.id) % 100000,
    width: W,
    height: H,
    subjectKey: `freeze:${ev.templateId}:${ev.location}:${ev.participants.join('-')}`,
    ...(reference ? { reference } : {}),
    meta: { timeOfDay: timeOfDay(ev.slot), people: people.map((c) => ({ appearance: c.appearance, gender: c.gender, seed: c.portraitSeed })) },
  };
}
