import type { Dir, Pixels } from './pixel';

export const SPRITE_DIRECTIONS: Dir[] = ['down', 'up', 'left', 'right'];

/** Split ComfyUI's white studio sheet; remove only border-connected white, keeping white clothes. */
export function spriteSheetPixels(data: Uint8ClampedArray, width: number, height: number): Pixels[] {
  if (width < 4 || height < 1 || data.length !== width * height * 4) throw new Error('invalid sprite image');
  const frames: Pixels[] = [];
  for (let direction = 0; direction < 3; direction++) {
    const start = Math.floor(width * direction / 4);
    const w = Math.floor(width * (direction + 1) / 4) - start;
    const background = new Uint8Array(w * height);
    const queue = new Int32Array(w * height);
    let head = 0, tail = 0;
    const offset = (i: number) => (Math.floor(i / w) * width + start + i % w) * 4;
    for (let i = 0; i < background.length; i++) {
      const k = offset(i);
      background[i] = data[k + 3] < 128 || Math.min(data[k], data[k + 1], data[k + 2]) >= 225 ? 1 : 0;
    }
    const visit = (i: number) => { if (background[i] === 1) { background[i] = 2; queue[tail++] = i; } };
    for (let x = 0; x < w; x++) { visit(x); visit((height - 1) * w + x); }
    for (let y = 0; y < height; y++) { visit(y * w); visit(y * w + w - 1); }
    while (head < tail) {
      const i = queue[head++];
      if (i % w > 0) visit(i - 1);
      if (i % w < w - 1) visit(i + 1);
      if (i >= w) visit(i - w);
      if (i < w * (height - 1)) visit(i + w);
    }
    let left = w, top = height, right = 0, bottom = 0;
    for (let y = 0; y < height; y++) for (let x = 0; x < w; x++) if (background[y * w + x] !== 2) {
      left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x + 1); bottom = Math.max(bottom, y + 1);
    }
    if (left >= right || top >= bottom) throw new Error('empty sprite column');
    const scale = Math.min(28 / (right - left), 36 / (bottom - top));
    const sw = Math.max(1, Math.round((right - left) * scale)), sh = Math.max(1, Math.round((bottom - top) * scale));
    const pixels: Pixels = Array.from({ length: 40 }, () => Array<string | null>(32).fill(null));
    for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
      const sx = left + Math.min(right - left - 1, Math.floor((x + 0.5) * (right - left) / sw));
      const sy = top + Math.min(bottom - top - 1, Math.floor((y + 0.5) * (bottom - top) / sh));
      if (background[sy * w + sx] === 2) continue;
      const k = (sy * width + start + sx) * 4;
      pixels[38 - sh + y][Math.floor((32 - sw) / 2) + x] = '#' + [data[k], data[k + 1], data[k + 2]].map(v => Math.min(255, Math.round(v / 8) * 8).toString(16).padStart(2, '0')).join('');
    }
    frames.push(pixels);
  }
  // Same directional convention as the procedural renderer.
  frames.push(frames[2].map(row => row.slice().reverse()));
  return frames;
}

/** Two alternating foot lifts keep the existing three-frame walk cycle. */
export function spriteWalkPixels(idle: Pixels, dir: Dir, frame: number): Pixels {
  if (frame === 1) return idle;
  const out = idle.map(row => row.slice());
  for (let y = 31; y < 40; y++) out[y].fill(null);
  for (let y = 31; y < 39; y++) for (let x = 0; x < 32; x++) {
    const lift = dir === 'left' || dir === 'right' ? Number(frame === 0) : (x < 16) === (frame === 0) ? 1 : 0;
    if (idle[y][x]) out[y - lift][x] = idle[y][x];
  }
  return out;
}
