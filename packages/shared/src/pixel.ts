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
  [/coral/, '#e8817c'], [/blue/, '#5d9dcc'], [/hawaiian|graphic|tee/, '#f39a6b'], [/knit|sweater|cardigan/, '#b9a0d8'], [/flannel/, '#b45a4a'],
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
  const hair = a.palette?.hair ?? HAIR[hairKey] ?? PASTEL[hashSeed(a.hairColor) % PASTEL.length];
  const accent = /teal/.test(a.hairColor) ? '#3fb8b0' : null;
  const skin = a.palette?.skin ?? SKIN[a.skinTone.toLowerCase()] ?? SKIN.light;
  const eye = EYES[a.eyeColor.toLowerCase()] ?? '#4a3020';
  const outfit = a.palette?.outfit ?? KEYWORD_COLORS.find(([re]) => re.test(a.outfit.toLowerCase()))?.[1] ?? PASTEL[hashSeed(a.outfit) % PASTEL.length];
  const pants = /bikini|swimsuit|trunks|board shorts/i.test(a.outfit) ? outfit : /skirt|dress/.test(a.outfit) ? shade(outfit, 0.85) : /short/.test(a.outfit) ? '#4f7fb0' : '#3d4a66';
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

/**
 * 16×20 top-down chibi sprite frame. frame ∈ {0,1,2} (1 = idle, 0/2 = steps).
 * Light comes from the top-left: every fill gets a darker right/bottom edge, hair gets a highlight.
 */
function spriteBase(a: Appearance, dir: Dir, frame: number): Pixels {
  const pal = palette(a);
  const p = grid(16, 20);
  const style = hairStyle(a.hairStyle);
  const step = frame === 1 ? 0 : frame === 0 ? -1 : 1;
  const side = dir === 'left' || dir === 'right';
  const flip = (x: number) => (dir === 'left' ? 15 - x : x); // profiles are drawn facing right, mirrored for left
  const outfit = a.outfit.toLowerCase();
  const acc = a.accessory.toLowerCase();
  const swimwear = /bikini|swimsuit|trunks|board shorts/.test(outfit);
  const bikini = /bikini/.test(outfit);
  const trunks = /trunks|board shorts/.test(outfit);
  const skirt = /skirt|dress/.test(outfit);
  const shorts = /short/.test(outfit) || trunks;
  const w = /broad|athletic/.test(a.build) ? 1 : /petite|slim/.test(a.build) ? -1 : 0;
  const dark = (c: string) => shade(c, 0.78);
  const shoe = swimwear ? pal.skin : '#3a3036';

  // legs + shoes (skin shows under skirts and shorts)
  const legTop = skirt ? 17 : shorts ? 16 : 15;
  if (side) {
    for (const [lx, d] of [[6 + step, 1], [8 - step, 0.8]] as const) {
      const x = Math.min(flip(lx), flip(lx + 1));
      rect(p, x, 15, 2, 3, shade(swimwear || skirt || shorts ? pal.skin : pal.pants, d));
      rect(p, x, 15, 2, legTop - 15, shade(pal.pants, d));
      rect(p, x, 18, 2, 1, shoe);
    }
  } else {
    for (const [lx, lift] of [[5, step < 0], [9, step > 0]] as const) {
      const h = lift ? 3 : 4;
      rect(p, lx, 15, 2, h, swimwear || skirt || shorts ? pal.skin : pal.pants);
      if (!swimwear && !skirt && !shorts) set(p, lx + 1, 15 + h - 1, dark(pal.pants));
      if (skirt || shorts) rect(p, lx, 15, 2, legTop - 15, pal.pants);
      rect(p, lx, 15 + h - 1, 2, 1, shoe);
    }
  }
  // torso with side shading; skirts flare out
  rect(p, 4 - w, 10, 8 + w * 2, 6, pal.outfit);
  rect(p, 11 + w, 10, 1, 6, dark(pal.outfit));
  if (swimwear) {
    rect(p, 4 - w, 10, 8 + w * 2, 6, pal.skin);
    rect(p, 11 + w, 10, 1, 6, shade(pal.skin, 0.85));
    if (bikini) rect(p, 4 - w, 11, 8 + w * 2, 2, pal.outfit);
    if (trunks || bikini) rect(p, 4 - w, 14, 8 + w * 2, trunks ? 3 : 2, pal.outfit);
    if (!bikini && !trunks) rect(p, 5 - w, 11, 6 + w * 2, 5, pal.outfit);
  }
  if (skirt) {
    rect(p, 3 - w, 14, 10 + w * 2, 3, shade(pal.outfit, 0.92));
    rect(p, 12 + w, 14, 1, 3, dark(pal.outfit));
  }
  if (/stripe/.test(outfit)) for (let y = 11; y < 16; y += 2) rect(p, 4 - w, y, 8 + w * 2, 1, '#f4f6fa');
  if (!side && dir === 'down') {
    if (/jacket|cardigan|blazer|coat|hoodie/.test(outfit)) {
      rect(p, 7, 10, 2, 5, /hoodie/.test(outfit) ? shade(pal.outfit, 0.85) : '#f4f0e6');
      set(p, 6, 11, dark(pal.outfit));
      set(p, 9, 11, dark(pal.outfit));
    } else if (!swimwear) rect(p, 7, 10, 2, 1, dark(pal.outfit)); // collar
    if (/apron/.test(outfit)) rect(p, 5, 12, 6, 4, '#e9dcc0');
  }
  // arms: sleeves in outfit colour, skin hands; they swing with the step
  if (side) {
    const ax = flip(8);
    rect(p, ax, 11 + step, 1, 3, dark(swimwear ? pal.skin : pal.outfit));
    set(p, ax, 14 + step, pal.skin);
  } else {
    for (const [ax, sw] of [[3 - w, step > 0 ? 1 : 0], [12 + w, step < 0 ? 1 : 0]] as const) {
      const sleeve = swimwear ? pal.skin : pal.outfit;
      rect(p, ax, 11 + sw, 1, 3, ax > 8 ? dark(sleeve) : sleeve);
      set(p, ax, 14 + sw, pal.skin);
    }
  }
  // neck + rounded head
  rect(p, 7, 9, 2, 2, shade(pal.skin, 0.88));
  rect(p, 4, 2, 8, 8, pal.skin);
  rect(p, 3, 3, 10, 6, pal.skin);
  rect(p, 12, 3, 1, 6, shade(pal.skin, 0.9));
  // hair
  const hl = shade(pal.hair, 1.35);
  const long = style === 'long' || style === 'wavy' || style === 'braids';
  const ends = (x: number, y: number, ww: number, h: number) => {
    rect(p, x, y, ww, h, pal.hair);
    if (style === 'wavy') for (let i = 0; i < ww; i += 2) set(p, x + i, y + h - 1, dark(pal.hair));
  };
  if (style === 'buzz') {
    rect(p, 4, 1, 8, 2, dark(pal.hair));
    if (dir === 'up') rect(p, 3, 2, 10, 5, dark(pal.hair));
  } else if (dir === 'up') {
    rect(p, 3, 1, 10, 8, pal.hair);
    rect(p, 4, 0, 8, 1, pal.hair);
    if (long) ends(4, 9, 8, style === 'long' ? 5 : 3);
    if (style === 'bob') ends(3, 8, 10, 2);
    if (style === 'ponytail') ends(7, 8, 2, 5);
    if (style === 'braids') {
      ends(3, 9, 2, 6);
      ends(11, 9, 2, 6);
    }
    set(p, 5, 2, hl);
  } else if (dir === 'down') {
    rect(p, 3, 1, 10, 3, pal.hair);
    rect(p, 4, 0, 8, 1, pal.hair);
    // fringe: a few strands hang over the forehead
    for (const x of style === 'messy' ? [4, 6, 9, 11] : [4, 5, 10, 11]) set(p, x, 4, pal.hair);
    if (style === 'messy') for (const x of [3, 7, 12]) set(p, x, 0, pal.hair);
    const sideLen = style === 'long' ? 9 : long || style === 'bob' ? 6 : 2;
    ends(3, 4, 1, sideLen);
    ends(12, 4, 1, sideLen);
    if (style === 'bob') {
      set(p, 2, 8, pal.hair);
      set(p, 13, 8, pal.hair);
    }
    if (style === 'ponytail') rect(p, 13, 3, 1, 3, pal.hair);
    if (style === 'braids') {
      ends(2, 7, 1, 5);
      ends(13, 7, 1, 5);
    }
    set(p, 5, 1, hl);
    set(p, 6, 1, hl);
    // face: two-pixel eyes with a highlight, blush, small mouth
    for (const ex of [5, 10]) {
      set(p, ex, 6, pal.line);
      set(p, ex, 7, pal.eye);
    }
    set(p, 4, 8, shade(pal.skin, 0.88));
    set(p, 11, 8, shade(pal.skin, 0.88));
    set(p, 7, 8, '#b85a64');
    set(p, 8, 8, '#b85a64');
  } else {
    // profile facing right (mirrored for left): hair covers the back of the head
    rect(p, flip(3), 1, 1, 1, pal.hair);
    for (let x = 3; x <= 11; x++) rect(p, flip(x), x < 5 ? 1 : 0, 1, x < 9 ? 4 : 3, pal.hair);
    for (let x = 3; x <= 6; x++) rect(p, flip(x), 4, 1, long ? 7 : 4, pal.hair);
    if (style === 'bob') rect(p, Math.min(flip(3), flip(6)), 8, 4, 1, pal.hair);
    if (style === 'ponytail') ends(Math.min(flip(1), flip(2)), 4, 2, 6);
    if (style === 'long') ends(Math.min(flip(3), flip(6)), 10, 4, 3);
    set(p, flip(6), 1, hl);
    set(p, flip(10), 6, pal.line);
    set(p, flip(10), 7, pal.eye);
    set(p, flip(13), 6, shade(pal.skin, 0.9)); // nose
    set(p, flip(11), 8, '#b85a64');
  }
  if (pal.accent) {
    set(p, 3, 3, pal.accent);
    set(p, 12, 3, pal.accent);
  }
  // accessories
  if (/glasses/.test(acc)) {
    if (dir === 'down') {
      rect(p, 4, 6, 3, 1, '#3a3a44');
      rect(p, 9, 6, 3, 1, '#3a3a44');
      rect(p, 7, 6, 2, 1, '#3a3a44');
    } else if (side) rect(p, Math.min(flip(9), flip(11)), 6, 3, 1, '#3a3a44');
  }
  if (/cap|beanie/.test(acc)) {
    const c = /cap/.test(acc) ? '#d0574e' : '#5e7fb8';
    rect(p, 3, 0, 10, 2, c);
    rect(p, 3, 2, 10, 1, dark(c));
    if (/cap/.test(acc) && dir === 'down') rect(p, 4, 3, 8, 1, dark(c)); // brim
    if (/cap/.test(acc) && side) rect(p, Math.min(flip(11), flip(14)), 2, 4, 1, dark(c));
  }
  if (/headphones/.test(acc)) {
    rect(p, 4, 0, 8, 1, '#3a3a44');
    if (!side) {
      rect(p, 2, 4, 1, 3, '#3a3a44');
      rect(p, 13, 4, 1, 3, '#3a3a44');
    } else rect(p, flip(7), 4, 2, 3, '#3a3a44');
  }
  if (/scarf/.test(acc)) {
    rect(p, 4, 10, 8, 1, '#c75a5a');
    if (dir === 'down') rect(p, 9, 11, 1, 3, '#c75a5a');
  }
  if (/clip/.test(acc) && dir !== 'up') set(p, side ? flip(9) : 10, 1, '#f7c948');
  if (/ear|cuff/.test(acc) && dir === 'down') {
    set(p, 3, 7, '#d8dce4');
    set(p, 12, 7, '#d8dce4');
  }
  return p;
}

/** Detailed 32×40 frames for every Appearance, including future arrivals and custom players. */
export function spritePixels(a: Appearance, dir: Dir, frame: number): Pixels {
  const pal = palette(a);
  const base = spriteBase(a, dir, frame);
  const p = grid(32, 40);
  for (let y = 0; y < 20; y++) for (let x = 0; x < 16; x++) {
    const color = base[y][x];
    if (color) rect(p, x * 2, 2 + Math.floor(y * 1.8), 2, Math.ceil((y + 1) * 1.8) - Math.floor(y * 1.8), color);
  }
  const highlight = shade(pal.hair, 1.55);
  const shadow = shade(pal.hair, 0.72);
  const outfit = a.outfit.toLowerCase();
  const acc = a.accessory.toLowerCase();
  // Fine hair clusters follow the silhouette rather than a flat enlarged fill.
  const swimwear = /bikini|swimsuit|trunks|board shorts/.test(outfit);
  for (let y = 3; y < 23; y++) for (let x = 4; x < 28; x++) {
    if (p[y][x] !== pal.hair) continue;
    if ((x + y * 2) % 11 === 0 && p[y + 1]?.[x] === pal.hair) {
      set(p, x, y, x < 17 ? highlight : shadow);
      set(p, x, y + 1, x < 17 ? shade(pal.hair, 1.25) : shadow);
    }
  }
  const face = dir === 'down';
  const side = dir === 'left' || dir === 'right';
  const flip = (x: number) => dir === 'left' ? 31 - x : x;
  if (face || side) {
    for (const ex of face ? [10, 20] : [flip(20)]) {
      rect(p, ex, 13, 2, 4, pal.line);
      set(p, ex, 14, pal.eye);
      set(p, ex, 13, '#fffaf3');
    }
    if (face) {
      set(p, 15, 17, shade(pal.skin, 0.85));
      rect(p, 14, 19, 3, 1, '#a45f68');
      set(p, 9, 18, shade(pal.skin, 0.88));
      set(p, 22, 18, shade(pal.skin, 0.88));
    }
  }
  const trim = shade(pal.outfit, 0.68);
  const light = shade(pal.outfit, 1.18);
  if (face) {
    if (!swimwear) {
      rect(p, 10, 22, 3, 1, light);
      rect(p, 19, 23, 2, 1, light);
    }
    if (!swimwear && /jacket|cardigan|coat|blazer|hoodie|shirt/.test(outfit)) {
      for (const x of [12, 19]) {
        rect(p, x, 23, 1, 7, trim);
        rect(p, x + 1, 24, 1, 5, light);
      }
      for (const y of [24, 27, 30]) set(p, 18, y, '#e2cf9f');
      for (const x of [9, 21]) {
        rect(p, x, 25, 3, 1, trim);
        rect(p, x, 26, 1, 2, light);
      }
    }
    if (/apron/.test(outfit)) {
      rect(p, 11, 27, 10, 1, '#c4ad84');
      rect(p, 14, 28, 5, 3, '#e9dcc0');
      rect(p, 14, 28, 5, 1, '#b8a17d');
    }
    if (/graphic|band/.test(outfit)) {
      rect(p, 14, 25, 4, 3, '#f0d8b1');
      set(p, 16, 26, trim);
    }
    if (/hoodie/.test(outfit)) for (const x of [14, 17]) rect(p, x, 23, 1, 3, '#f4f0e6');
    if (/necklace|shell/.test(acc)) {
      for (const x of [12, 14, 17, 19]) set(p, x, 22 + (x > 12 && x < 19 ? 1 : 0), '#f4efe0');
      rect(p, 15, 24, 2, 1, '#e1d3ad');
    }
    if (/towel/.test(acc)) {
      rect(p, 21, 22, 3, 7, '#f4f0e6');
      rect(p, 22, 26, 2, 1, '#a3b8ca');
    }
    if (/glasses/.test(acc)) {
      for (const x of [8, 18]) {
        rect(p, x, 12, 6, 1, '#625963');
        rect(p, x, 16, 6, 1, '#625963');
        rect(p, x, 13, 1, 3, '#625963');
        rect(p, x + 5, 13, 1, 3, '#625963');
      }
      rect(p, 14, 13, 4, 1, '#625963');
    }
  } else if (dir === 'up' && !swimwear) {
    rect(p, 11, 24, 10, 1, trim);
    rect(p, 12, 25, 8, 1, light);
    if (/apron/.test(outfit)) {
      rect(p, 10, 28, 12, 1, '#d7c29b');
      rect(p, 15, 28, 2, 3, '#d7c29b');
    }
  } else if (!swimwear) {
    rect(p, flip(17), 23, 1, 5, light);
    rect(p, flip(17), 28, 2, 1, trim);
  }
  // Shoe caps, cuffs and knuckles retain detail during walking.
  for (let y = 27; y < 38; y++) for (let x = 5; x < 27; x++) {
    if (p[y][x] === '#3a3036' && p[y - 1]?.[x] !== '#3a3036') set(p, x, y, '#71636b');
    if (p[y][x] === pal.skin && p[y + 1]?.[x] !== pal.skin) set(p, x, y, shade(pal.skin, 0.8));
  }
  if (pal.accent) for (const x of [6, 7, 24, 25]) for (let y = 16; y < 21; y++) if (p[y][x] === pal.hair) set(p, x, y, pal.accent);
  return outline(p, pal.line);
}

/** Tiny 7×7 (5×5 + outline) activity emote drawn above a sprite (zZ asleep, steam while cooking, a note for hobbies, …). */
export function emotePixels(kind: string): Pixels | null {
  const shapes: Record<string, [string, string[]]> = {
    sleep: ['#6f86a8', ['###..', '..#..', '.#...', '###.#', '....#']],
    cook: ['#e07a6a', ['.#.#.', '#.#..', '.#.#.', '#.#..', '#####']],
    eat: ['#c49568', ['.#.#.', '.#.#.', '#####', '.###.', '..#..']],
    hobby: ['#7a5fb8', ['..##.', '..#.#', '..#..', '###..', '##...']],
    work: ['#5f8a6b', ['.###.', '#...#', '#####', '#...#', '#####']],
    exercise: ['#e0a040', ['..#..', '.##..', '#####', '..##.', '..#..']],
    text: ['#5e7fb8', ['####.', '#..#.', '#..#.', '####.', '.#...']],
    tidy: ['#5fa3c7', ['..#..', '..#..', '..#..', '.###.', '#####']],
    retreat: ['#8a7f8e', ['.....', '.....', '#.#.#', '.....', '.....']],
  };
  const s = shapes[kind];
  if (!s) return null;
  const p = grid(7, 7);
  s[1].forEach((row, y) => [...row].forEach((ch, x) => ch === '#' && set(p, x + 1, y + 1, s[0])));
  return outline(p, '#fffaf3');
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
  return pixelsToSvg(locationPixels(key, timeOfDay, weather), 12);
}

/** Freeze-frame placeholder: everyone's portrait bust (up to six, overlapping like a group shot) over the location. */
export function freezePixels(key: string, timeOfDay: 'morning' | 'day' | 'evening' | 'night', people: { appearance: Appearance; gender: string; seed: number }[]): Pixels {
  const p = locationPixels(key, timeOfDay, 'sunny');
  const group = people.slice(0, 6);
  group.forEach((who, i) => {
    const bust = portraitPixels(who.appearance, who.gender, who.seed);
    const ox = group.length === 1 ? 32 : group.length === 2 ? 14 + i * 38 : Math.round(((p[0].length - 32) * i) / (group.length - 1));
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) if (bust[y][x]) set(p, ox + x, 32 + y, bust[y][x]!);
  });
  // letterbox bars for the "freeze" look
  rect(p, 0, 0, p[0].length, 4, '#1e1a26');
  rect(p, 0, p.length - 4, p[0].length, 4, '#1e1a26');
  return p;
}

export function locationPixels(key: string, timeOfDay: 'morning' | 'day' | 'evening' | 'night', weather: string): Pixels {
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
  // Local procedural art also works while the image service is offline.
  const indoor = /^(living|kitchen|bathroom|smallBathroom|bedroom[MW]|entrance|stairs(Up)?)$/.test(key);
  if (indoor) {
    rect(p, 0, 0, 96, 40, '#e6d4bc'); rect(p, 0, 40, 96, 24, '#b68d70');
    for (let y = 42; y < 64; y += 6) rect(p, 0, y, 96, 1, '#9d765c');
    rect(p, 8, 8, 22, 24, '#f1ede3'); rect(p, 10, 10, 18, 20, top);
    rect(p, 18, 10, 1, 20, '#f1ede3'); rect(p, 10, 20, 18, 1, '#f1ede3');
    rect(p, 77, 29, 4, 19, '#956b48'); rect(p, 71, 26, 16, 5, '#6d9a69');
    if (key === 'kitchen') {
      rect(p, 36, 26, 34, 18, '#efe8d5'); rect(p, 36, 25, 34, 2, '#62616b');
      rect(p, 39, 29, 8, 5, '#8aaeb3'); rect(p, 51, 29, 7, 5, '#bb6860'); rect(p, 60, 29, 7, 5, '#6f8bac');
      rect(p, 6, 35, 17, 21, '#a9bbc2'); rect(p, 7, 38, 14, 1, '#627680');
      rect(p, 30, 49, 35, 5, '#d3a777'); rect(p, 32, 54, 3, 10, '#8c694d'); rect(p, 60, 54, 3, 10, '#8c694d');
    } else if (key.startsWith('bedroom')) {
      rect(p, 32, 39, 41, 18, '#d3adbe'); rect(p, 32, 39, 41, 4, '#fff1df'); rect(p, 35, 43, 10, 5, '#fff5e6');
      rect(p, 55, 12, 24, 15, '#7e9a98'); rect(p, 57, 14, 20, 11, '#e5c585');
    } else if (/Bathroom|bathroom/.test(key)) {
      rect(p, 35, 20, 28, 33, '#c2dfe1'); rect(p, 39, 23, 20, 26, '#9ab8c8'); rect(p, 68, 40, 18, 6, '#f2eee6');
    } else {
      rect(p, 22, 44, 47, 16, '#c18577'); rect(p, 20, 40, 51, 6, '#dc9a87'); rect(p, 37, 53, 26, 5, '#dfbd8b');
      rect(p, 47, 17, 18, 12, '#567487'); rect(p, 48, 18, 16, 10, '#b2cdca');
    }
  } else if (key === 'house') {
    rect(p, 25, 13, 47, 41, '#f0e6d1'); rect(p, 23, 12, 51, 3, '#c8bda7');
    rect(p, 43, 37, 10, 17, '#8e7463');
    for (const bx of [29, 55]) { rect(p, bx, 19, 13, 11, '#8faeb8'); rect(p, bx - 2, 30, 17, 2, '#a68e74'); rect(p, bx - 2, 32, 17, 2, '#6f9a7d'); }
    rect(p, 10, 48, 16, 2, '#a78058'); rect(p, 13, 50, 2, 7, '#a78058'); rect(p, 21, 50, 2, 7, '#a78058');
  } else if (/backyard|balcony/.test(key)) {
    rect(p, 0, 44, 96, 20, '#ac9275'); rect(p, 32, 48, 32, 4, '#b88352'); rect(p, 37, 52, 3, 12, '#805c40'); rect(p, 57, 52, 3, 12, '#805c40');
    for (let bx = 5; bx < 96; bx += 11) { rect(p, bx, 19 + bx % 3, 2, 2, '#f9de99'); }
  } else if (/market|konbini|grill|cafe/.test(key)) {
    for (let bx = 8; bx < 96; bx += 24) { rect(p, bx, 35, 20, 5, bx % 3 ? '#c2776a' : '#ceaf71'); rect(p, bx + 2, 40, 16, 7, '#866752'); }
  }
  if (!indoor) for (const bx of [3, 83]) {
    rect(p, bx + 4, 28, 2, 25, '#9b805a'); rect(p, bx, 25, 12, 3, '#68916a'); rect(p, bx + 2, 22, 8, 3, '#68916a');
  }
  if (weather === 'rain' || weather === 'typhoon') for (let i = 0; i < 120; i++) set(p, rng.int(0, w), rng.int(0, h), '#dfe7f2');
  if (weather === 'snow') for (let i = 0; i < 80; i++) set(p, rng.int(0, w), rng.int(0, h), '#ffffff');
  return p;
}
