// Procedural pixel art from appearance data: palettes, portrait busts, top-down sprites, SVG export.
// Shared by the server (SVG placeholder images) and the client (canvas sprites), so both look consistent.
import type { Appearance } from './model';
import { hashSeed, mulberry32 } from './rng';

export type Pixels = (string | null)[][];

const HAIR: Record<string, string> = {
  black: '#1e1a26', 'dark brown': '#3b2a24', brown: '#5b3b2a', chestnut: '#7a4630', 'chestnut brown': '#7a4630', auburn: '#8c3b2a',
  'ash blonde': '#c9b48a', 'sun-bleached brown': '#a77c52', 'pink-dyed': '#e58aa9', 'navy-dyed': '#2f4274', 'silver-dyed': '#c9ced8', grey: '#9a9aa2',
};
const SKIN: Record<string, string> = { fair: '#f7dfcd', light: '#f1cfb5', 'light tan': '#e2b48f', tan: '#cf9a70', 'deep tan': '#b07a52', brown: '#8a5a3c' };
const EYES: Record<string, string> = { 'dark brown': '#3a2418', brown: '#5a3a24', hazel: '#7a6a32', grey: '#6f7a86', amber: '#a8701e' };
const PASTEL = ['#f4a7b9', '#a7c7f4', '#b8e2b0', '#f6d48f', '#c9b4ef', '#f7b98a', '#9ad8d8', '#e6e6e6'];
const KEYWORD_COLORS: [RegExp, string][] = [
  [/white|cook|chef/, '#eef0f2'], [/navy/, '#2f3f6e'], [/black|band/, '#2b2b33'], [/denim|jean/, '#5577aa'], [/pastel|pink|rose/, '#f2b5c8'],
  [/cream|beige|linen/, '#efe3c8'], [/green|olive/, '#7fa36b'], [/red/, '#c8504f'], [/yellow/, '#efcf6a'], [/stripe/, '#8fb3dd'], [/grey|gray/, '#9aa0a8'],
  [/hawaiian|graphic|tee/, '#f39a6b'], [/knit|sweater|cardigan/, '#b9a0d8'], [/flannel/, '#b45a4a'],
];

export function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(v * f)));
  const r = ch((n >> 16) & 255);
  const g = ch((n >> 8) & 255);
  const b = ch(n & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

export function palette(a: Appearance) {
  const hairKey = Object.keys(HAIR).find((k) => a.hairColor.toLowerCase().startsWith(k)) ?? a.hairColor.toLowerCase();
  const hair = HAIR[hairKey] ?? PASTEL[hashSeed(a.hairColor) % PASTEL.length];
  const accent = /teal/.test(a.hairColor) ? '#3fb8b0' : null;
  const skin = SKIN[a.skinTone.toLowerCase()] ?? SKIN.light;
  const eye = EYES[a.eyeColor.toLowerCase()] ?? '#4a3020';
  const outfit = KEYWORD_COLORS.find(([re]) => re.test(a.outfit.toLowerCase()))?.[1] ?? PASTEL[hashSeed(a.outfit) % PASTEL.length];
  const pants = /skirt|dress/.test(a.outfit) ? shade(outfit, 0.85) : /short/.test(a.outfit) ? '#4f7fb0' : '#3d4a66';
  return { hair, accent, skin, eye, outfit, pants, line: '#2a2030' };
}

type Style = 'short' | 'long' | 'bob' | 'ponytail' | 'buzz' | 'braids' | 'wavy' | 'messy';
export function hairStyle(s: string): Style {
  const x = s.toLowerCase();
  if (/buzz|crop/.test(x)) return /crop/.test(x) ? 'short' : 'buzz';
  if (/braid|twin|tail/.test(x)) return /pony/.test(x) ? 'ponytail' : 'braids';
  if (/pony/.test(x)) return 'ponytail';
  if (/bob/.test(x)) return 'bob';
  if (/shoulder|wavy/.test(x)) return /long/.test(x) ? 'long' : 'wavy';
  if (/long/.test(x)) return 'long';
  if (/messy/.test(x)) return 'messy';
  return 'short';
}

const grid = (w: number, h: number): Pixels => Array.from({ length: h }, () => Array<string | null>(w).fill(null));
const set = (p: Pixels, x: number, y: number, c: string) => {
  if (y >= 0 && y < p.length && x >= 0 && x < p[0].length) p[y][x] = c;
};
const rect = (p: Pixels, x: number, y: number, w: number, h: number, c: string) => {
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) set(p, i, j, c);
};

function outline(p: Pixels, color: string) {
  const h = p.length;
  const w = p[0].length;
  const out = p.map((r) => r.slice());
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (p[y][x]) continue;
      const n = [p[y - 1]?.[x], p[y + 1]?.[x], p[y]?.[x - 1], p[y]?.[x + 1]].some(Boolean);
      if (n) out[y][x] = color;
    }
  return out;
}

/** 32×32 bust portrait. */
export function portraitPixels(a: Appearance, gender: string, seed = 0): Pixels {
  const pal = palette(a);
  const rng = mulberry32(seed || hashSeed(JSON.stringify(a)));
  const p = grid(32, 32);
  const style = hairStyle(a.hairStyle);
  // long hair behind the head
  if (style === 'long' || style === 'wavy') rect(p, 8, 9, 16, style === 'long' ? 17 : 12, shade(pal.hair, 0.85));
  if (style === 'braids') {
    rect(p, 7, 12, 3, 13, pal.hair);
    rect(p, 22, 12, 3, 13, pal.hair);
  }
  // shoulders / outfit
  const broad = /broad|athletic/.test(a.build) ? 1 : /petite|slim/.test(a.build) ? -1 : 0;
  rect(p, 6 - broad, 26, 20 + broad * 2, 6, pal.outfit);
  rect(p, 8 - broad, 24, 16 + broad * 2, 2, pal.outfit);
  rect(p, 14, 24, 4, 2, shade(pal.outfit, 0.8)); // collar shadow
  if (/apron/.test(a.outfit)) rect(p, 11, 27, 10, 5, '#d8c8a8');
  if (/jacket|cardigan|blazer/.test(a.outfit)) {
    rect(p, 13, 26, 1, 6, shade(pal.outfit, 0.7));
    rect(p, 18, 26, 1, 6, shade(pal.outfit, 0.7));
  }
  // neck
  rect(p, 14, 21, 4, 4, shade(pal.skin, 0.92));
  // head ellipse
  for (let y = 4; y <= 22; y++)
    for (let x = 8; x <= 23; x++) {
      const dx = (x - 15.5) / 7.3;
      const dy = (y - 13) / 8.6;
      if (dx * dx + dy * dy <= 1) set(p, x, y, pal.skin);
    }
  // hair cap
  for (let y = 3; y <= 10; y++)
    for (let x = 7; x <= 24; x++) {
      const dx = (x - 15.5) / 8.4;
      const dy = (y - 11) / 7.8;
      if (dx * dx + dy * dy <= 1 && y <= 8 + (Math.abs(x - 15.5) > 5 ? 2 : 0)) set(p, x, y, pal.hair);
    }
  // fringe
  const fringe = style === 'buzz' ? 0 : style === 'messy' ? 3 : 2;
  for (let x = 9; x <= 22; x++) if (rng.chance(0.75)) rect(p, x, 9, 1, fringe ? rng.int(1, fringe + 1) : 0, pal.hair);
  if (style === 'bob') {
    rect(p, 7, 9, 3, 10, pal.hair);
    rect(p, 22, 9, 3, 10, pal.hair);
  }
  if (style === 'long' || style === 'wavy') {
    rect(p, 7, 9, 2, 14, pal.hair);
    rect(p, 23, 9, 2, 14, pal.hair);
  }
  if (style === 'ponytail') rect(p, 23, 6, 3, 12, pal.hair);
  if (style === 'messy') for (let i = 0; i < 6; i++) set(p, rng.int(8, 24), rng.int(2, 5), pal.hair);
  if (pal.accent) for (let x = 8; x <= 23; x += 2) set(p, x, style === 'bob' ? 18 : 10, pal.accent);
  // eyes, brows, mouth, cheeks
  for (const ex of [11, 18]) {
    rect(p, ex, 13, 3, 2, '#ffffff');
    rect(p, ex + 1, 13, 1, 2, pal.eye);
    set(p, ex + 1, 13, shade(pal.eye, 0.6));
    rect(p, ex, 11, 3, 1, shade(pal.hair, 0.9));
  }
  rect(p, 15, 18, 2, 1, '#c4626a');
  if (gender === 'woman') {
    set(p, 10, 16, '#f2a0a8');
    set(p, 21, 16, '#f2a0a8');
  }
  set(p, 15, 16, shade(pal.skin, 0.85)); // nose
  // accessories
  const acc = a.accessory.toLowerCase();
  if (/glasses/.test(acc)) {
    for (const ex of [10, 17]) {
      rect(p, ex, 12, 5, 1, '#3a3a44');
      rect(p, ex, 15, 5, 1, '#3a3a44');
      set(p, ex, 13, '#3a3a44');
      set(p, ex, 14, '#3a3a44');
      set(p, ex + 4, 13, '#3a3a44');
      set(p, ex + 4, 14, '#3a3a44');
    }
    set(p, 15, 13, '#3a3a44');
    set(p, 16, 13, '#3a3a44');
  }
  if (/beanie|cap/.test(acc)) rect(p, 8, 3, 16, 4, /cap/.test(acc) ? '#d0574e' : '#5e7fb8');
  if (/ear|cuff/.test(acc)) {
    set(p, 8, 15, '#d8dce4');
    set(p, 23, 15, '#d8dce4');
  }
  if (/necklace|shell/.test(acc)) for (let x = 12; x <= 19; x++) set(p, x, x % 2 ? 25 : 26, '#f4efe0');
  if (/scarf/.test(acc)) rect(p, 10, 23, 12, 2, '#c75a5a');
  if (/headphones/.test(acc)) {
    rect(p, 6, 11, 2, 5, '#3a3a44');
    rect(p, 24, 11, 2, 5, '#3a3a44');
    rect(p, 8, 3, 16, 1, '#3a3a44');
  }
  if (/towel/.test(acc)) rect(p, 20, 24, 4, 6, '#f4f0e6');
  if (/clip/.test(acc)) rect(p, 20, 7, 2, 1, '#f7c948');
  return outline(p, pal.line);
}

export type Dir = 'down' | 'up' | 'left' | 'right';

/** 16×20 top-down chibi sprite frame. frame ∈ {0,1,2} (1 = idle, 0/2 = steps). */
export function spritePixels(a: Appearance, dir: Dir, frame: number): Pixels {
  const pal = palette(a);
  const p = grid(16, 20);
  const style = hairStyle(a.hairStyle);
  const step = frame === 1 ? 0 : frame === 0 ? -1 : 1;
  // legs
  const legY = 15;
  if (dir === 'left' || dir === 'right') {
    rect(p, 6 + step, legY, 2, 4, pal.pants);
    rect(p, 8 - step, legY, 2, 4, shade(pal.pants, 0.8));
  } else {
    rect(p, 5, legY, 2, step < 0 ? 3 : 4, pal.pants);
    rect(p, 9, legY, 2, step > 0 ? 3 : 4, pal.pants);
  }
  rect(p, 5, 18, 2, 1, '#3a3036');
  rect(p, 9, 18, 2, 1, '#3a3036');
  // body
  rect(p, 4, 10, 8, 6, pal.outfit);
  if (dir === 'down') rect(p, 7, 10, 2, 1, shade(pal.outfit, 0.8));
  // arms
  if (dir === 'down' || dir === 'up') {
    rect(p, 3, 11 + (step > 0 ? 1 : 0), 1, 4, pal.skin);
    rect(p, 12, 11 + (step < 0 ? 1 : 0), 1, 4, pal.skin);
  } else rect(p, dir === 'left' ? 7 : 8, 11 + step, 1, 4, pal.skin);
  // head
  rect(p, 4, 2, 8, 8, pal.skin);
  rect(p, 3, 3, 10, 6, pal.skin);
  // hair
  const long = style === 'long' || style === 'wavy' || style === 'braids';
  if (dir === 'up') {
    rect(p, 3, 1, 10, 8, pal.hair);
    if (long) rect(p, 4, 8, 8, 4, pal.hair);
    if (style === 'ponytail') rect(p, 7, 8, 2, 4, pal.hair);
  } else {
    rect(p, 3, 1, 10, 3, pal.hair);
    rect(p, 4, 0, 8, 1, pal.hair);
    if (dir === 'down') {
      rect(p, 3, 4, 1, long || style === 'bob' ? 6 : 2, pal.hair);
      rect(p, 12, 4, 1, long || style === 'bob' ? 6 : 2, pal.hair);
      rect(p, 5, 6, 1, 1, pal.line);
      rect(p, 10, 6, 1, 1, pal.line);
      set(p, 7, 8, '#c4626a');
      set(p, 8, 8, '#c4626a');
    } else {
      const back = dir === 'left' ? 9 : 3;
      rect(p, back, 3, 4, long ? 8 : 4, pal.hair);
      set(p, dir === 'left' ? 4 : 11, 6, pal.line);
      if (style === 'ponytail') rect(p, dir === 'left' ? 12 : 1, 4, 2, 5, pal.hair);
    }
  }
  if (pal.accent) {
    set(p, 3, 3, pal.accent);
    set(p, 12, 3, pal.accent);
  }
  if (/glasses/.test(a.accessory) && dir === 'down') {
    rect(p, 4, 6, 3, 1, '#3a3a44');
    rect(p, 9, 6, 3, 1, '#3a3a44');
  }
  if (/cap|beanie/.test(a.accessory)) rect(p, 3, 0, 10, 2, /cap/.test(a.accessory) ? '#d0574e' : '#5e7fb8');
  return outline(p, pal.line);
}

/** Render pixels to a crisp SVG string. */
export function pixelsToSvg(p: Pixels, scale = 8, bg?: string): string {
  const h = p.length;
  const w = p[0].length;
  const rects: string[] = [];
  for (let y = 0; y < h; y++) {
    let x = 0;
    while (x < w) {
      const c = p[y][x];
      if (!c) {
        x++;
        continue;
      }
      let run = 1;
      while (x + run < w && p[y][x + run] === c) run++;
      rects.push(`<rect x="${x}" y="${y}" width="${run}" height="1" fill="${c}"/>`);
      x += run;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w * scale}" height="${h * scale}" shape-rendering="crispEdges">${bg ? `<rect width="${w}" height="${h}" fill="${bg}"/>` : ''}${rects.join('')}</svg>`;
}

/** Pastel background color derived from a key. */
export const keyColor = (key: string) => PASTEL[hashSeed(key) % PASTEL.length];

/** Procedural pixel location background (sky gradient by time, skyline, sea/ground), as SVG. */
export function locationSvg(key: string, timeOfDay: 'morning' | 'day' | 'evening' | 'night', weather: string): string {
  const rng = mulberry32(hashSeed(key));
  const w = 96;
  const h = 64;
  const sky: Record<string, [string, string]> = { morning: ['#cfe6f7', '#f8e1d0'], day: ['#9fd0f0', '#dff1fb'], evening: ['#f3a07a', '#f6d6a0'], night: ['#1f2447', '#43406e'] };
  const [top, bottom] = weather === 'rain' || weather === 'typhoon' ? ['#8c97a8', '#b8c0cc'] : sky[timeOfDay];
  const p = grid(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) p[y][x] = y < 40 ? (y < 20 ? top : bottom) : null;
  const base = keyColor(key);
  let x = 0;
  while (x < w) {
    const bw = rng.int(5, 12);
    const bh = rng.int(8, 24);
    const c = shade(base, 0.55 + rng.next() * 0.3);
    rect(p, x, 40 - bh, bw, bh, c);
    for (let wy = 40 - bh + 2; wy < 38; wy += 3)
      for (let wx = x + 1; wx < x + bw - 1; wx += 2) if (rng.chance(0.5)) set(p, wx, wy, timeOfDay === 'night' || timeOfDay === 'evening' ? '#f6e08a' : shade(c, 1.3));
    x += bw + rng.int(0, 2);
  }
  const ground = /beach|sea|harbor|lighthouse|riverside/.test(key) ? '#5fa3c7' : /park|shrine|onsen|observatory/.test(key) ? '#7fb36a' : '#9a9098';
  rect(p, 0, 40, w, 24, ground);
  for (let i = 0; i < 40; i++) set(p, rng.int(0, w), rng.int(41, h), shade(ground, 1.15));
  if (weather === 'rain' || weather === 'typhoon') for (let i = 0; i < 120; i++) set(p, rng.int(0, w), rng.int(0, h), '#dfe7f2');
  if (weather === 'snow') for (let i = 0; i < 80; i++) set(p, rng.int(0, w), rng.int(0, h), '#ffffff');
  return pixelsToSvg(p, 12);
}
