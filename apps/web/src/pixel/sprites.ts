// Character sprite sheets (generated per daily outfit, procedural fallback) for the top-down views.
import { useEffect, useState } from 'react';
import { emotePixels, outfitFor, spritePixels, spriteSheetPixels, SPRITE_DIRECTIONS, type Appearance, type Dir, type Occasion, type Pixels } from '@shared-roof/shared';
import { api, waitImage } from '../api';
import { useGame } from '../store';
import { pixelsCanvas, portraitPalette } from '../components/pixel';
import type { Pose } from './house';

type SpriteChar = { id: string; gender: string; appearance: Appearance; portraitSeed: number; appearanceText?: string };

const sheets = new Map<string, Pixels[][]>();
/** Keys whose sheet is loaded, or settled on the procedural sprite (placeholder / unusable image). */
const settled = new Set<string>();
const today = () => useGame.getState().view?.day ?? 0;
/** After 23:00 at home everyone is in their sleepwear. */
const tonight = (): Occasion => (useGame.getState().view?.slot === 'lateNight' ? 'sleep' : 'daily');
const spriteKey = (c: SpriteChar, day: number, occasion: Occasion = 'daily') => {
  const { palette: _palette, ...appearance } = c.appearance;
  return JSON.stringify([c.id, c.portraitSeed, appearance, c.appearanceText ?? '', outfitFor(c, occasion, day)]);
};

/**
 * Today's walk sheets for `characters` (arrivals, loaded saves and replacement players included); tomorrow's are
 * queued in the background. Returns how many are still pending (0 when images are off or offline).
 */
export function useCharacterSprites(characters: readonly SpriteChar[]): number {
  const enabled = useGame(s => s.settings.images);
  const offline = useGame(s => s.health?.imagesOffline);
  const day = useGame(s => s.view?.day ?? 0);
  const [, tick] = useState(0);
  const keys = characters.map(c => spriteKey(c, day));
  const fingerprint = JSON.stringify(keys);
  useEffect(() => {
    if (!enabled) return;
    const ac = new AbortController();
    const timers: number[] = [];
    const settle = (key: string) => { if (!ac.signal.aborted) { settled.add(key); tick(n => n + 1); } };
    const load = (c: SpriteChar, key: string, loadDay = day, occasion: Occasion = 'daily') => {
      // the server answers 409 until the outfit portrait the sheet is drawn from exists
      const retry = () => { if (!ac.signal.aborted) timers.push(window.setTimeout(() => load(c, key, loadDay, occasion), 1500)); };
      void api.charSprite(c.id, loadDay, occasion).then(st => waitImage(st, ready => {
        if (ac.signal.aborted) return;
        if (ready.status === 'failed') return retry();
        if (ready.status !== 'ready' || ready.placeholder || !ready.url) return settle(key);
        const image = new Image();
        image.onload = () => {
          if (ac.signal.aborted) return;
          try {
            const canvas = document.createElement('canvas');
            canvas.width = image.width; canvas.height = image.height;
            const ctx = canvas.getContext('2d')!;
            ctx.drawImage(image, 0, 0);
            sheets.set(key, spriteSheetPixels(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height));
          } catch { /* Keep the detailed procedural sprite if a sheet is unusable. */ }
          settle(key);
        };
        image.onerror = () => settle(key);
        image.src = ready.url;
      }, ac.signal)).catch(retry);
    };
    characters.forEach((c, i) => { if (!settled.has(keys[i])) load(c, keys[i]); });
    // Run the whole outfit → sheet chain while playing, and keep tomorrow's decoded frames ready too.
    if (!offline && keys.every(k => settled.has(k))) for (const c of characters) {
      const key = spriteKey(c, day + 1);
      if (!settled.has(key)) load(c, key, day + 1);
      const night = spriteKey(c, day, 'sleep'); // tonight's sleepwear, in the background
      if (!settled.has(night)) load(c, night, day, 'sleep');
    }
    return () => { ac.abort(); timers.forEach(clearTimeout); };
    // Palette feedback does not change a character's sprite identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, offline, fingerprint, keys.every(k => settled.has(k))]);
  return enabled && !offline ? keys.filter(k => !settled.has(k)).length : 0;
}

function framePixels(c: SpriteChar, dir: Dir, frame: number): [string, Pixels] {
  const night = spriteKey(c, today(), tonight());
  const key = sheets.has(night) ? night : spriteKey(c, today());
  const sheet = useGame.getState().settings.images && sheets.get(key);
  if (sheet) return [`generated-sprite:${key}:${dir}:${frame}`, sheet[SPRITE_DIRECTIONS.indexOf(dir)][frame]];
  const appearance = { ...c.appearance, outfit: outfitFor(c, 'daily', today()), palette: portraitPalette(c.id, c.portraitSeed) ?? c.appearance.palette };
  return [`sprite:${c.id}:${dir}:${frame}:${JSON.stringify(appearance)}`, spritePixels(appearance, dir, frame)];
}

export function sprite(c: SpriteChar, dir: Dir, frame: number): HTMLCanvasElement {
  return pixelsCanvas(...framePixels(c, dir, frame));
}

/**
 * Standing frame reshaped for furniture (frames are 32x40, feet on row 38): seated loses the legs and drops onto the
 * seat; asleep keeps only the head, which lands on the pillow while the bed's blanket covers the rest.
 */
export function posedSprite(c: SpriteChar, pose: Pose, dir: Dir): HTMLCanvasElement {
  const [key, px] = framePixels(c, pose === 'sleep' ? 'down' : dir, 1);
  const top = px.findIndex(row => row.some(Boolean));
  const out: Pixels = px.map(() => Array<string | null>(32).fill(null));
  if (pose === 'sleep') for (let y = top; y < Math.min(40, top + 13); y++) out[y] = px[y].slice();
  else if (pose === 'sit') for (let y = 0; y < 32; y++) if (y + 4 < 40) out[y + 4] = px[y].slice();
  else return pixelsCanvas(key, px);
  return pixelsCanvas(`${key}:${pose}`, out);
}

/** Activity emote above a sprite, or null for activities without one. */
export function emote(kind: string | null): HTMLCanvasElement | null {
  const px = kind ? emotePixels(kind) : null;
  return px ? pixelsCanvas(`emote:${kind}`, px) : null;
}

export const MOOD_ICON: Record<string, { glyph: string; color: string }> = {
  glowing: { glyph: '♥', color: '#e07a6a' },
  good: { glyph: '☺', color: '#5fa86b' },
  okay: { glyph: '·', color: '#8a7f8e' },
  low: { glyph: '☁', color: '#6f86a8' },
  struggling: { glyph: '✕', color: '#7a4a6a' },
};
