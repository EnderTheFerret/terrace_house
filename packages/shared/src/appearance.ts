// Appearance → image prompt compilation. Pure; the only place prompts are built from appearance data.
import type { Character } from './model';

export type ShotType = 'portrait' | 'bust' | 'full' | 'scene' | 'avatar' | 'sprite';

export const DEFAULT_STYLE_PREFIX =
  'pixel art, 16-bit retro game art, clean pixel clusters, limited pastel palette, soft lighting, reality show still';

/** Global negative prompt; always includes safety terms. */
export const GLOBAL_NEGATIVE =
  'child, kid, teen, teenager, minor, loli, shota, childlike, school uniform, nsfw, nude, explicit, cleavage, gore, blood, blurry, photo, photorealistic, 3d render, text, watermark, signature, logo, deformed hands, extra fingers';

const MINOR_CODED = /\b(child(like)?|kids?|teen(age(r|d)?)?s?|minors?|loli|shota|school ?(girl|boy|uniform)s?|young (girl|boy)|little (girl|boy)|underage|baby[- ]?faced|juvenile)\b/gi;

/** Strip minors-coded terms from any free text that goes into a positive prompt. */
export function sanitizePromptText(text: string): string {
  return text.replace(MINOR_CODED, '').replace(/\s{2,}/g, ' ').replace(/\s+,/g, ',').trim();
}

const SHOT_TAGS: Record<ShotType, string> = {
  portrait: 'character portrait, upper body, facing viewer, plain pastel background, centered',
  bust: 'bust shot, head and shoulders, plain pastel background',
  full: 'full body, standing, plain background',
  scene: 'medium shot, candid documentary framing',
  avatar: 'square avatar, head and shoulders, studio backdrop, tv panel guest',
  sprite: 'top-down rpg sprite, chibi proportions, transparent background',
};

const genderWord = (g: Character['gender']) => (g === 'woman' ? 'woman' : g === 'man' ? 'man' : 'person');

/** Deterministic ordered appearance tags (identical ordering is part of portrait consistency). */
export function compileAppearanceTags(c: Pick<Character, 'age' | 'gender' | 'appearance'>): string[] {
  const a = c.appearance;
  const age = Math.max(20, c.age);
  const tags = [
    `${age}-year-old adult ${genderWord(c.gender)}`,
    `${a.hairStyle} ${a.hairColor} hair`,
    `${a.eyeColor} eyes`,
    `${a.build} build`,
    `${a.skinTone} skin`,
    `wearing ${a.outfit}`,
  ];
  if (a.accessory && a.accessory !== 'none') tags.push(a.accessory);
  return tags.map(sanitizePromptText).filter(Boolean);
}

export interface CompiledPrompt {
  positive: string;
  negative: string;
}

/**
 * compileAppearancePrompt(character, shotType): style prefix + adult tag + appearance tags + shot tags (+ optional scene).
 * Always includes an adult-age tag; always strips minors-coded terms; negative includes safety terms.
 */
export function compileAppearancePrompt(
  c: Pick<Character, 'age' | 'gender' | 'appearance'>,
  shotType: ShotType,
  opts: { stylePrefix?: string; scene?: string; expression?: string } = {},
): CompiledPrompt {
  const parts = [
    sanitizePromptText(opts.stylePrefix ?? DEFAULT_STYLE_PREFIX),
    'adult, age 20+',
    ...compileAppearanceTags(c),
    opts.expression ? sanitizePromptText(opts.expression) : 'calm natural expression',
    SHOT_TAGS[shotType],
  ];
  if (opts.scene) parts.push(sanitizePromptText(opts.scene));
  return { positive: parts.filter(Boolean).join(', '), negative: GLOBAL_NEGATIVE };
}

/** Prompt for a location background (no people). */
export function compileLocationPrompt(name: string, description: string, timeOfDay: string, weather: string, stylePrefix = DEFAULT_STYLE_PREFIX): CompiledPrompt {
  return {
    positive: [sanitizePromptText(stylePrefix), 'background scene, no people, empty', sanitizePromptText(`${name}, ${description}`), `${timeOfDay} lighting`, weather === 'rain' ? 'rainy, wet reflections' : weather === 'snow' ? 'light snow' : weather === 'typhoon' ? 'storm, heavy wind and rain' : 'clear weather'].join(', '),
    negative: `${GLOBAL_NEGATIVE}, people, person, crowd`,
  };
}
