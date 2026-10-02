// Character sprite sheets (procedural from appearance) for the top-down views.
import { useEffect } from 'react';
import { emotePixels, spritePixels, spriteSheetPixels, spriteWalkPixels, SPRITE_DIRECTIONS, type Appearance, type Dir, type Pixels } from '@shared-roof/shared';
import { api, waitImage } from '../api';
import { useGame } from '../store';
import { pixelsCanvas, portraitPalette } from '../components/pixel';

const sheets = new Map<string, Pixels[]>();
const spriteKey = (id: string, a: Appearance, seed: number, text = '') => {
  const { palette: _palette, ...appearance } = a;
  return JSON.stringify([id, seed, appearance, text]);
};

/** Automatically includes arrivals, loaded saves and replacement players. */
export function useCharacterSprites(characters: readonly { id: string; appearance: Appearance; portraitSeed: number; appearanceText?: string }[]) {
  const enabled = useGame(s => s.settings.images);
  const offline = useGame(s => s.health?.imagesOffline);
  const fingerprint = JSON.stringify(characters.map(c => [c.id, c.portraitSeed, spriteKey(c.id, c.appearance, c.portraitSeed, c.appearanceText)]));
  useEffect(() => {
    if (!enabled) return;
    const ac = new AbortController();
    for (const c of characters) {
      const key = spriteKey(c.id, c.appearance, c.portraitSeed, c.appearanceText);
      if (sheets.has(key)) continue;
      void api.charSprite(c.id).then(st => waitImage(st, ready => {
        if (ac.signal.aborted || ready.status !== 'ready' || ready.placeholder || !ready.url) return;
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
        };
        image.src = ready.url;
      }, ac.signal)).catch(() => {});
    }
    return () => ac.abort();
    // Palette feedback does not change a character's sprite identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, offline, fingerprint]);
}

export function sprite(id: string, a: Appearance, dir: Dir, frame: number, seed = 0, text = ''): HTMLCanvasElement {
  const sheet = useGame.getState().settings.images && sheets.get(spriteKey(id, a, seed, text));
  if (sheet) return pixelsCanvas(`generated-sprite:${spriteKey(id, a, seed, text)}:${dir}:${frame}`, spriteWalkPixels(sheet[SPRITE_DIRECTIONS.indexOf(dir)], dir, frame));
  const appearance = { ...a, palette: portraitPalette(id, seed) ?? a.palette };
  return pixelsCanvas(`sprite:${id}:${dir}:${frame}:${JSON.stringify(appearance)}`, spritePixels(appearance, dir, frame));
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
