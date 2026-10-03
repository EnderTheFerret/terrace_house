import type { Dir, Pixels } from './pixel';

export const SPRITE_DIRECTIONS: Dir[] = ['down', 'up', 'left', 'right'];

/** Sheet rows as the walk LoRA draws them; right is mirrored from left (the model often faces it the wrong way). */
const SHEET_ROW: Record<Dir, number> = { down: 0, left: 1, right: 2, up: 3 };

/** Border-connected near-white (or transparent) pixels of one cell; white clothes inside the outline survive. */
function cellBackground(data: Uint8ClampedArray, width: number, x0: number, y0: number, w: number, h: number): Uint8Array {
  const background = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  let head = 0, tail = 0;
  for (let i = 0; i < background.length; i++) {
    const k = ((y0 + Math.floor(i / w)) * width + x0 + i % w) * 4;
    background[i] = data[k + 3] < 128 || Math.min(data[k], data[k + 1], data[k + 2]) >= 225 ? 1 : 0;
  }
  const visit = (i: number) => { if (background[i] === 1) { background[i] = 2; queue[tail++] = i; } };
  for (let x = 0; x < w; x++) { visit(x); visit((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { visit(y * w); visit(y * w + w - 1); }
  while (head < tail) {
    const i = queue[head++];
    if (i % w > 0) visit(i - 1);
    if (i % w < w - 1) visit(i + 1);
    if (i >= w) visit(i - w);
    if (i < w * (h - 1)) visit(i + w);
  }
  return background;
}

/**
 * Split a generated 4x4 walk sheet into 32x40 frames: result[direction][frame], directions in SPRITE_DIRECTIONS
 * order, frames 0-2 as drawn (1 = standing). One shared crop and scale for every cell keeps the model's own
 * stride offsets, so walking does not jitter or change size.
 */
export function spriteSheetPixels(data: Uint8ClampedArray, width: number, height: number): Pixels[][] {
  if (width < 4 || height < 4 || data.length !== width * height * 4) throw new Error('invalid sprite image');
  const cw = Math.floor(width / 4), ch = Math.floor(height / 4);
  const cells = new Map<string, Uint8Array>();
  let left = cw, top = ch, right = 0, bottom = 0;
  for (const row of [SHEET_ROW.down, SHEET_ROW.left, SHEET_ROW.up]) for (let col = 0; col < 3; col++) {
    const bg = cellBackground(data, width, col * cw, row * ch, cw, ch);
    cells.set(`${row}:${col}`, bg);
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) if (bg[y * cw + x] !== 2) {
      left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x + 1); bottom = Math.max(bottom, y + 1);
    }
  }
  if (left >= right || top >= bottom) throw new Error('empty sprite sheet');
  // Cells are drawn at 4x a 32 px grid; go back to that grid unless the figure would not fit the frame.
  const scale = Math.min(32 / cw, 32 / (right - left), 38 / (bottom - top));
  const sw = Math.max(1, Math.round((right - left) * scale)), sh = Math.max(1, Math.round((bottom - top) * scale));
  const hex = (k: number) => '#' + [data[k], data[k + 1], data[k + 2]].map(v => Math.min(255, Math.round(v / 8) * 8).toString(16).padStart(2, '0')).join('');
  const frame = (row: number, col: number): Pixels => {
    const bg = cells.get(`${row}:${col}`)!;
    const pixels: Pixels = Array.from({ length: 40 }, () => Array<string | null>(32).fill(null));
    const span = (i: number, n: number, from: number, size: number) => {
      const a = from + Math.floor(i * size / n);
      return [a, Math.max(a + 1, from + Math.floor((i + 1) * size / n))];
    };
    for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
      // majority vote per source block: empty if mostly background, else its most common colour
      const counts = new Map<string, number>();
      let empty = 0, total = 0;
      const [y0, y1] = span(y, sh, top, bottom - top), [x0, x1] = span(x, sw, left, right - left);
      for (let sy = y0; sy < y1; sy++)
        for (let sx = x0; sx < x1; sx++) {
          total++;
          if (bg[sy * cw + sx] === 2) { empty++; continue; }
          const c = hex(((row * ch + sy) * width + col * cw + sx) * 4);
          counts.set(c, (counts.get(c) ?? 0) + 1);
        }
      if (empty * 2 >= total) continue;
      pixels[38 - sh + y][Math.floor((32 - sw) / 2) + x] = [...counts].reduce((a, b) => (b[1] > a[1] ? b : a))[0];
    }
    return pixels;
  };
  const walk = (row: number) => [0, 1, 2].map(col => frame(row, col));
  const leftWalk = walk(SHEET_ROW.left);
  return [walk(SHEET_ROW.down), walk(SHEET_ROW.up), leftWalk, leftWalk.map(f => f.map(r => r.slice().reverse()))];
}
