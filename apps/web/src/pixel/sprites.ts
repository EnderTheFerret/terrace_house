// Character sprite sheets (procedural from appearance) for the top-down views.
import { spritePixels, type Appearance, type Dir } from '@shared-roof/shared';
import { pixelsCanvas } from '../components/pixel';

export function sprite(id: string, a: Appearance, dir: Dir, frame: number): HTMLCanvasElement {
  return pixelsCanvas(`sprite:${id}:${dir}:${frame}:${a.hairColor}:${a.outfit}`, spritePixels(a, dir, frame));
}

export const MOOD_ICON: Record<string, { glyph: string; color: string }> = {
  glowing: { glyph: '♥', color: '#e07a6a' },
  good: { glyph: '☺', color: '#5fa86b' },
  okay: { glyph: '·', color: '#8a7f8e' },
  low: { glyph: '☁', color: '#6f86a8' },
  struggling: { glyph: '✕', color: '#7a4a6a' },
};
