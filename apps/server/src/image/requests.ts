// Image request builders (prompts compiled by shared pure functions; style prefix from config).
import {
  DEFAULT_PLAYER, compileAppearancePrompt, compileAppearanceTags, compileLocationPrompt, content, hashSeed, isOutdoors, sanitizePromptText, GLOBAL_NEGATIVE, outfitFor, occasionForCharacter,
  type Character, type Emotion, type EventInstance, type GameState, type ImageRequest, type Slot,
} from '@shared-roof/shared';
import { config } from '../config';

const size = (k: string) => config.sizes[k] ?? [1024, 1024];

// Explicit viewpoints keep room names from turning into captioned house exteriors.
const scenery: Record<string, string> = {
  arcade: 'open-air Jaffa flea-market lane, vintage clothing and brass objects on stalls, warm stone paving and low historic storefronts',
  lighthouse: 'wooden Mediterranean harbor boardwalk in Tel Aviv, simple railing and street lamps, blue sea, distant pale skyline, benches',
  bedroomW: 'interior of a bright upstairs shared bedroom in a sleek Tokyo-style share house, three single beds with rumpled white linen and blush throws, large floor cushions, a clothing rail with dresses, plants, pale oak floor, soft daylight, a glass door to a private balcony',
  bedroomM: 'interior of a cabin-like upstairs shared bedroom, dark wood panelled walls, three single beds with plaid blankets, a guitar, a clothing rail, dumbbells and a rolled yoga mat on the floor, warm lamplight, a glass door to a private balcony',
  bathroom: 'interior of the upstairs shared bathroom, blue ceramic wall tiles, shower enclosure, bathtub, two washbasins, towels and toiletries',
  smallBathroom: 'interior of a compact downstairs bathroom, pale ceramic tiles, toilet, small washbasin, mirror, hand towel',
  living: 'interior of a sleek Terrace House style living room, long light grey fabric sofa with mustard cushions and a knitted throw, shaggy cream sheepskin rug, low oak coffee table with magazines and an air plant, mid-century furniture, fiddle leaf fig, brass arc floor lamp, floor-to-ceiling glass wall looking onto an indoor pool, natural oak floor, lived-in details',
  kitchen: 'interior of a modern open kitchen and dining area in a Tokyo-style share house, white cabinets with oak worktops, a marble kitchen island with oak bar stools, a long natural oak dining table with mismatched mugs, a fruit bowl and flowers, a fridge covered in photos and notes, pendant lights, lived-in clutter',
  entrance: 'interior entry hallway of a modern share house viewed from inside, front door, a genkan step with sneakers kicked off, an oak shoe rack crowded with shoes, a coat stand with jackets, a tall plant, pale stone floor, passage to the living room',
  stairs: 'interior ground-floor staircase, one flight of wooden steps climbing to the second floor, simple handrail, tile floor, houseplants, walls filling the frame',
  stairsUp: 'second-floor landing of a sleek modern share house, pale oak floor, a glass balustrade around a large opening looking down into the double-height living room below, a reading corner with a grey sofa and sheepskin rug, bookshelf with records, bedroom doors, warm light',
  balconyM: 'view from inside a small private second-floor bedroom balcony, two chairs and small table, potted herbs, simple railing overlooking a Tel Aviv street, bedroom door behind, no roof deck',
  balconyW: 'view from inside a small private second-floor bedroom balcony, two chairs and small table, bougainvillea in pots, simple railing overlooking a Tel Aviv street, bedroom door behind, no roof deck',
  backyard: 'indoor pool deck of a sleek modern share house, a rectangular swimming pool with turquoise water, pale stone pavers, white sun loungers with striped towels, tall plants, black metal lanterns, a floor-to-ceiling glass wall separating it from the living room, high white walls, open sky above',
  riverside: 'Mediterranean seafront promenade in Tel Aviv, palms and pale paving, blue sea, distant Bauhaus buildings, benches and a bicycle lane',
  beach: 'Mediterranean sandy beach in Tel Aviv, volleyball net, calm blue sea, palms, distant pale city buildings, quiet open sand',
  galilee: 'campsite in the Galilee at dusk, tents by a river under eucalyptus trees, a small campfire, folding chairs, green hills, first stars',
  deadsea: 'Dead Sea shore at Ein Bokek, pale salt crystals at the waterline, calm turquoise water, desert mountains, a simple guesthouse terrace',
  eilat: 'Eilat seafront, Red Sea coral beach with turquoise water, red desert mountains behind, palm trees and a hotel balcony',
  hospital: 'interior of a modern Tel Aviv hospital ward, clean beds, white sheets, blue curtains, medical equipment, softly lit corridor',
};

export function portraitRequest(c: Pick<Character, 'id' | 'age' | 'gender' | 'appearance' | 'portraitSeed'> & { appearanceText?: string }, lowRes = false, reference?: string | null): ImageRequest {
  const p = compileAppearancePrompt(c, 'portrait', { stylePrefix: config.stylePrefix });
  const { palette: _palette, ...appearance } = c.appearance;
  const [w, h] = size('portrait');
  const scale = lowRes ? 0.5 : 1;
  return {
    kind: 'portrait', framing: 'knees',
    prompt: reference ? `Redraw the single adult character in the reference, preserving the exact original 16-bit pixel art style, pixel cluster size, outlines, palette, facial features, hair and clothing. Correct only the body proportions: reduce the head including hair relative to the shoulders, lengthen the torso and thighs. Keep the same stylized face and eyes. Draw one full-length standing figure, upright with straight legs and relaxed arms, entire head and feet visible with small margins, plain solid pastel background. Do not change the art style or add other people. ${p.positive}` : p.positive,
    negative: p.negative,
    seed: c.portraitSeed,
    width: Math.round((w * scale) / 16) * 16,
    height: Math.round((h * scale) / 16) * 16,
    subjectKey: `portrait:${c.id}:${c.portraitSeed}:${hashSeed(JSON.stringify([appearance, c.appearanceText ?? ''])) % 100000}${c.id === 'player' && (c.age !== DEFAULT_PLAYER.age || c.gender !== DEFAULT_PLAYER.gender) ? `:identity:${c.age}:${c.gender}` : ''}:knees-up-v3`,
    ...(reference ? { reference } : {}),
    meta: { appearance: c.appearance, gender: c.gender },
  };
}

/**
 * One 4x4 walk sheet per character (FLUX.2 Klein base 4B + svntax pixel_4walk LoRA), drawn from the character's own
 * portrait so defaults, arrivals and custom players share one path. The LoRA's training prompt fixes the layout:
 * rows down/left/right/up, columns 0-2 walk frames, column 3 an unused extra pose. The text pins the outfit.
 */
export function spriteRequest(c: Parameters<typeof portraitRequest>[0] & Pick<Character, 'spriteSeed' | 'spriteInstructions'>, portrait?: string, outfit = c.appearance.outfit): ImageRequest {
  const dressed = { ...c, appearance: { ...c.appearance, outfit, accessory: outfit === c.appearance.outfit ? c.appearance.accessory : 'none' } };
  const base = portraitRequest(c);
  const who = [...compileAppearanceTags(dressed), sanitizePromptText(outfit === c.appearance.outfit ? c.appearanceText ?? '' : '')].filter(Boolean).join(', ');
  const corrections = sanitizePromptText(c.spriteInstructions ?? '');
  const variation = c.spriteSeed !== undefined || corrections ? `:variation:${c.spriteSeed ?? base.seed}:${hashSeed(corrections) % 100000}` : '';
  return {
    ...base, kind: 'sprite', framing: undefined, width: 512, height: 512,
    seed: c.spriteSeed ?? base.seed,
    subjectKey: `sprite:klein-4walk-v1:${base.subjectKey.replace(':knees-up-v3', '')}${outfit === c.appearance.outfit ? '' : `:outfit:v2:${hashSeed(outfit) % 100000}`}${variation}`,
    meta: { ...base.meta, appearance: dressed.appearance },
    ...(portrait ? { reference: portrait } : {}),
    prompt: `Create a pixel art spritesheet of the character in the image. The spritesheet is a 4 by 4 grid of four rows of frames - first row is 3 walking frames facing down and 1 frame both arms raised, second row is 3 walking frames facing left and 1 frame jumping left, third row is 3 walking frames facing right and 1 frame jumping right, fourth row is 3 walking frames back view facing up and 1 frame lying on floor. The character is ${who}.${corrections ? ` Sprite corrections: ${corrections}. Keep the reference character's identity and the four-row walking layout consistent in every frame.` : ''}`,
    negative: '',
  };
}

/**
 * The character's approved portrait re-dressed in `outfit` (same face, hair and framing), drawn from `reference`.
 * The signature outfit is the base portrait itself.
 */
export function outfitPortraitRequest(c: Parameters<typeof portraitRequest>[0], outfit: string, reference?: string | null): ImageRequest {
  const base = portraitRequest(c);
  if (outfit === c.appearance.outfit) return base;
  const appearance = { ...c.appearance, outfit, accessory: 'none' };
  const p = compileAppearancePrompt({ ...c, appearance, appearanceText: '' }, 'portrait', { stylePrefix: config.stylePrefix });
  const bareTorso = /shirtless/i.test(outfit) ? ` The adult ${c.gender === 'man' ? 'man' : c.gender === 'woman' ? 'woman' : 'person'} has a completely bare chest, shoulders and abdomen, wearing only swim trunks below the waist. Remove the T-shirt and sleeves completely. No shirt, top, vest, towel or necklace.` : '';
  const wrapDress = /wrap dress/i.test(outfit) ? ' The dress has an overlapping V neckline, short sleeves, a diagonal wrapped front and a tie at the waist. It is not strapless.' : '';
  return {
    ...base,
    framing: reference ? undefined : base.framing,
    prompt: reference ? `Edit the adult character's clothing in the reference image (adult, age 20+). Replace the entire outfit with ${sanitizePromptText(outfit)}.${bareTorso}${wrapDress} Remove all previous garments and clothing accessories, including towels, aprons, bags and necklaces, unless explicitly requested in the new outfit. Preserve the character identity, face, hair, natural adult body proportions, small proportional head, body pose, pixel art style and background. Keep the knees-up composition: entire head through both knees, crop at the knees, calves and feet outside the image. Keep clean solid pixel colors without extra speckles.` : p.positive,
    subjectKey: `${base.subjectKey}:outfit:v2:${hashSeed(outfit) % 100000}`,
    ...(reference ? { reference } : {}),
    meta: { ...base.meta, appearance },
  };
}

/** Visual-novel standing figure: the finished `source` image (`of`) with its background removed. */
export function cutoutRequest(source: string, of: ImageRequest): ImageRequest {
  return { kind: 'cutout', prompt: '', negative: '', seed: 0, width: of.width, height: of.height, subjectKey: `cutout:solid-v2:${of.subjectKey}`, reference: source, meta: of.meta };
}

export const sceneMeal = (ev: EventInstance) => ev.tags.some(tag => ['communal-meal', 'household-meal'].includes(tag)) || !/\b(cooking|preparing|making|baking)\b/i.test(ev.premise ?? '') && /\b(eating|dinner|breakfast|sharing a meal)\b/i.test(ev.premise ?? '');

const expressionTags: Record<Emotion, string> = {
  neutral: 'calm natural expression', happy: 'happy expression, warm smile, bright eyes',
  sad: 'sad expression, downturned mouth, sorrowful eyes', angry: 'angry expression, furrowed brows, tight lips',
  tender: 'in love expression, affectionate gaze, soft smile, lightly blushing cheeks',
  shy: 'shy expression, blushing, bashful smile', awkward: 'awkward expression, hesitant uneven smile',
  annoyed: 'annoyed expression, narrowed eyes, pursed lips', excited: 'excited expression, wide joyful eyes, big smile',
  nervous: 'nervous expression, worried brows, tense small smile',
  drunk: 'drunk expression, flushed cheeks, heavy-lidded unfocused eyes, loose lopsided grin',
};

export function expressionRequest(c: Character, emotion: Emotion, reference?: string | null, faceGuide?: string | null, customExpression?: string): ImageRequest {
  const base = portraitRequest(c);
  const description = sanitizePromptText(customExpression?.trim() ?? '');
  if (emotion === 'neutral' && !description) return base;
  if (reference) { base.editRegion = 'face'; base.framing = undefined; }
  if (reference && faceGuide && faceGuide !== reference) base.reference2 = faceGuide;
  const edit = c.expressionEdits?.[emotion];
  const corrections = description ? '' : sanitizePromptText(edit?.instructions ?? '');
  const expression = description || expressionTags[emotion];
  const p = compileAppearancePrompt(c, 'portrait', { stylePrefix: config.stylePrefix, expression });
  return { ...base, seed: edit?.seed ?? base.seed, prompt: `${reference ? `Edit only the adult character's face (adult, age 20+) to show this exact expression: ${expression}. Preserve the reference character identity, hair, clothing, body, background and framing. Keep the original pixel art style and clean solid colors. Do not add accessories, colored speckles or change pixels outside the face.` : p.positive}${corrections ? ` Expression corrections: ${corrections}; keep the ${expressionTags[emotion]}.` : ''}`, subjectKey: `${base.subjectKey}:expression:v3:${emotion}${edit ? `:variation:${edit.seed}:${hashSeed(corrections) % 100000}` : ''}${description ? `:custom:${hashSeed(description) % 100000}` : ''}`, ...(reference ? { reference } : {}) };
}

export const timeOfDay = (slot: Slot): 'morning' | 'day' | 'evening' | 'night' => (slot === 'morning' ? 'morning' : slot === 'slot3' ? 'evening' : slot === 'evening' || slot === 'lateNight' ? 'night' : 'day');

export function locationRequest(locId: string, slot: Slot, weather: string): ImageRequest {
  const node = content().city.nodes.find((n) => n.id === locId);
  const room = content().house.rooms.find((r) => r.id === locId);
  const name = node?.name ?? (room ? `share house ${room.name}` : locId);
  const desc = scenery[locId] ?? node?.description ?? (room ? `interior of a Tel Aviv share house ${room.name}` : '');
  const tod = timeOfDay(slot);
  // weather variants are rendered as overlays client-side; only rain/snow get their own background, and only outdoors
  // (a "rainy" kitchen was drawn with rain falling inside)
  const w = (weather === 'rain' || weather === 'typhoon' || weather === 'snow') && isOutdoors(locId) ? weather : 'clear';
  const style = config.stylePrefix.replace(/,?\s*reality show still/gi, '');
  const p = compileLocationPrompt(name, desc, tod, w, style);
  if (scenery[locId]) p.positive = `${style}, wide game background, ${desc}, ${tod} lighting${w === 'clear' ? '' : `, ${w} weather`}, unoccupied space, all walls and surfaces unlettered, no captions, no typography, no people`;
  const [W, H] = size('location');
  return { kind: 'location', prompt: p.positive, negative: p.negative, seed: hashSeed(`${locId}:${tod}:${w}`) % 100000, width: W, height: H, subjectKey: `location:${locId}:${tod}${w === 'clear' ? '' : ':' + w}`, meta: { timeOfDay: tod, weather: w } };
}

/**
 * A phone photo: a feed post or a selfie in a chat thread. Same group workflow as freeze frames (every face from its
 * portrait); the subject key is the post/message, so each photo is drawn once and reused.
 */
export function photoRequest(s: GameState, people: Character[], location: string, slot: Slot, caption: string, subjectKey: string, fileOf: (r: ImageRequest) => string | null, selfie = false): ImageRequest {
  const ev = { id: subjectKey, templateId: 'photo', type: 'photo', tags: [], title: selfie ? 'a selfie' : 'a photo for the house feed', location, slot, participants: people.map((c) => c.id) } as unknown as EventInstance;
  const r = freezeRequest(s, ev, fileOf, `${selfie ? 'casual phone selfie at arm length, looking into the camera' : 'casual phone snapshot posted to social media'}: ${caption}`);
  return { ...r, subjectKey, seed: hashSeed(subjectKey) % 100000 };
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

/** Body language for a person's last felt emotion, so scene images show reactions instead of a lineup. */
const POSE: Record<Emotion, string> = {
  neutral: 'relaxed, listening',
  happy: 'laughing with a big smile',
  shy: 'smiling bashfully and glancing away, a hand touching their hair',
  awkward: 'awkward half-smile, rubbing the back of their neck',
  annoyed: 'arms crossed, unimpressed frown',
  sad: 'eyes downcast, shoulders slumped',
  excited: 'beaming and leaning in, hands raised mid-gesture',
  nervous: 'fidgeting and biting their lip',
  tender: 'soft smile, leaning toward the person they are talking to',
  angry: 'scowling, tense, pointing',
  drunk: 'swaying slightly with a goofy flushed grin, leaning on someone or something, a drink in hand',
};

/**
 * Freeze-frame / scene still with everyone in it (up to 6). `fileOf` returns a finished image file for a request:
 * The room is the only image reference; identities and actions stay together in each character description.
 */
export function freezeRequest(s: GameState, ev: EventInstance, fileOf: (r: ImageRequest) => string | null = () => null, context = '', lines: { speaker: string; emotion?: Emotion }[] = [], poses: Record<string, string> = {}): ImageRequest {
  const people = [...new Set(ev.participants)].map((id) => s.characters[id]).filter(Boolean).slice(0, 6);
  const dressed = people.map((c) => {
    const outfit = outfitFor(c, occasionForCharacter(c, ev), s.world.day);
    return { original: c, outfit, character: { ...c, appearanceText: outfit === c.appearance.outfit ? c.appearanceText : '', appearance: { ...c.appearance, outfit, accessory: outfit === c.appearance.outfit ? c.appearance.accessory : 'none' } } };
  });
  // each person is staged on their own: where they are (in the water or not) and the body language of their last line
  const anySwimming = people.some((c) => c.swimming);
  const meal = sceneMeal(ev);
  const activity = `${ev.title} ${ev.premise ?? ''} ${context}`;
  const dancing = /\b(dancing|dance floor|club|nightclub)\b/i.test(activity) || ['club', 'livehouse'].includes(ev.location);
  const cooking = ev.tags.includes('household-cook') || /\b(cooking|preparing|chopping|baking|kneading)\b/i.test(activity);
  const seated = meal || ev.location === 'living' || ev.location.startsWith('bedroom') || ev.location.startsWith('balcony') || ['cafe', 'bar'].includes(ev.location);
  const lastSpeaker = lines.findLast(l => people.some(c => c.id === l.speaker))?.speaker;
  const staging = (c: Character) => {
    const felt = lines.findLast((l) => l.speaker === c.id && l.emotion)?.emotion;
    return [
      c.swimming ? 'in the pool water up to the chest' : anySwimming ? 'out of the water and dry, sitting at the pool edge or on a lounger' : '',
      !anySwimming && meal ? 'seated on a dining chair at the table, eating from a plate, legs beneath the table' : !anySwimming && dancing ? 'dancing together to the music, moving arms and legs naturally on the dance floor' : !anySwimming && cooking ? 'working at the kitchen counter with food and utensils, hands busy preparing the meal' : !anySwimming && ev.location === 'cafe' ? 'seated at a cafe table, talking over coffee, holding or sipping from a coffee cup' : !anySwimming && ev.location === 'karaoke' ? 'singing into a microphone, moving with the music' : !anySwimming && seated ? ev.location === 'living' ? 'sitting naturally on the sofa' : ev.location.startsWith('bedroom') ? 'sitting on the edge of a bed' : 'seated on a chair' : '',
      poses[c.id] ?? '',
      !poses[c.id] && c.id === lastSpeaker ? 'talking, mid-gesture' : '',
      poses[c.id] ? '' : POSE[felt ?? 'neutral'],
    ].filter(Boolean).join(', ');
  };
  const bg = fileOf(locationRequest(ev.location, ev.slot, s.world.weather)) ?? fileOf(locationRequest(ev.location, ev.slot, 'clear'));
  const who = dressed.map(({ original, character: c }) => {
    const tags = compileAppearanceTags(c);
    const looks = [`adult ${c.gender === 'man' ? 'man' : c.gender === 'woman' ? 'woman' : 'person'}`, ...tags.slice(1).filter((t) => !t.endsWith(' eyes')), c.appearanceText ? sanitizePromptText(c.appearanceText) : ''].filter(Boolean).join(', ');
    return `${original.name.split(' ')[0]} (${looks}), ${staging(original)}`;
  }).join('; ');
  const loc = bg ? ev.location : scenery[ev.location] ?? content().city.nodes.find((n) => n.id === ev.location)?.description ?? `share house ${ev.location}`;
  const style = bg ? 'set in the room from image 1, everything including the people redrawn in the pixel art style and palette of image 1, not a photo' : 'the whole image including the room drawn in the same pixel art style, not a photo';
  const [W, H] = size('freeze');
  return {
    kind: 'freeze',
    prompt: `${config.stylePrefix}, adult, age 20+, freeze frame still at ${loc}, exactly ${people.length} people, each of them appears once, nobody else. Wide shot with all heads and upper bodies clearly visible. ${meal ? 'Everyone is seated around the dining table with plates and food, nobody standing. ' : ''}Scene activity: ${sanitizePromptText(activity)}. From left to right: ${who}. Draw each listed housemate once, with their distinct hair and clothes. Natural candid poses matching the scene activity, not lined up, not posing for the camera. ${style}, ${timeOfDay(ev.slot)} lighting, ${['rain', 'typhoon', 'snow'].includes(s.world.weather) && !isOutdoors(ev.location) ? `${s.world.weather} only outside the windows, dry indoors` : `${s.world.weather} weather`}. No other people, duplicate people, background figures, mirrors, speech bubbles, captions or text${context ? `, ${sanitizePromptText(context)}` : ''}`,
    negative: GLOBAL_NEGATIVE,
    seed: hashSeed(ev.id) % 100000,
    width: W,
    height: H,
    subjectKey: `freeze:${ev.templateId}:${ev.location}:${ev.participants.join('-')}:outfits:${hashSeed(JSON.stringify(dressed.map((c) => c.outfit)))}`,
    ...(bg ? { reference2: bg } : {}),
    meta: { timeOfDay: timeOfDay(ev.slot), people: dressed.map(({ character: c }) => ({ appearance: c.appearance, gender: c.gender, seed: c.portraitSeed })) },
  };
}
