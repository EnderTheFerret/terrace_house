// Top-down pixel renderer for the share house (procedural tiles + furniture), driven by content/house.json.
import { content, hashSeed, mulberry32, shade, type HouseContent, type CharView } from '@shared-roof/shared';

export const TILE = 32;

const house = (): HouseContent => content().house;

export function roomAt(x: number, y: number, floor = 0): string | null {
  const r = house().rooms.find((r) => r.floor === floor && x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);
  return r?.id ?? null;
}

function isDoor(x: number, y: number, nx: number, ny: number, floor = 0): boolean {
  const doors = house().doors.filter((d) => d[2] === floor);
  // door [dx, dy] opens the boundary between (dx,dy) and its neighbour above or to the left
  return doors.some(([dx, dy]) => (dx === x && dy === y && ((nx === x && ny === y - 1) || (nx === x - 1 && ny === y))) || (dx === nx && dy === ny && ((x === nx && y === ny - 1) || (x === nx - 1 && y === ny))));
}

/** Can you walk from tile a to adjacent tile b? (walls between rooms except doors, solid furniture) */
export function passable(ax: number, ay: number, bx: number, by: number, solid: Set<string>, floor = 0): boolean {
  const H = house();
  if (bx < 0 || by < 0 || bx >= H.width || by >= H.height) return false;
  if (solid.has(`${bx},${by}`)) return false;
  const ra = roomAt(ax, ay, floor);
  const rb = roomAt(bx, by, floor);
  if (!rb) return false;
  if (ra !== rb && !isDoor(ax, ay, bx, by, floor)) return false;
  return true;
}

const NO_SOLIDS = new Set<string>();
/**
 * Shortest tile path (BFS, 4-way) around furniture and through doors. The goal itself may be furniture (a seat on the
 * sofa, a bed). Returns the steps after `from`, or null when unreachable.
 */
export function findPath(from: [number, number], to: [number, number], solid: Set<string>, floor = 0): [number, number][] | null {
  const key = (x: number, y: number) => `${x},${y}`;
  const prev = new Map<string, string | null>([[key(...from), null]]);
  const queue: [number, number][] = [from];
  while (queue.length) {
    const [x, y] = queue.shift()!;
    if (x === to[0] && y === to[1]) {
      const path: [number, number][] = [];
      for (let k: string | null = key(x, y); k && k !== key(...from); k = prev.get(k) ?? null) path.unshift(k.split(',').map(Number) as [number, number]);
      return path;
    }
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]] as [number, number][]) {
      if (prev.has(key(nx, ny))) continue;
      const goal = nx === to[0] && ny === to[1];
      if (!passable(x, y, nx, ny, goal ? NO_SOLIDS : solid, floor)) continue;
      prev.set(key(nx, ny), key(x, y));
      queue.push([nx, ny]);
    }
  }
  return null;
}

export function solidTiles(floor = 0): Set<string> {
  const s = new Set<string>();
  for (const f of house().furniture) if (f.floor === floor && f.solid !== false) for (let j = 0; j < f.h; j++) for (let i = 0; i < f.w; i++) s.add(`${f.x + i},${f.y + j}`);
  return s;
}

// Look: warm, saturated handheld-RPG interiors — bold dark outlines, soft drop shadows, 3/4 wall faces.
const FLOOR_TILE = 16;
const tiles = (base: string, grout: string, size: number) => (c: CanvasRenderingContext2D, x: number, y: number) => {
  px(c, base, x, y, FLOOR_TILE, FLOOR_TILE);
  for (let j = 0; j < FLOOR_TILE; j += size) for (let i = 0; i < FLOOR_TILE; i += size) {
    px(c, shade(base, 1.08), x + i + 1, y + j + 1, size - 3, 1); // glaze highlight
    px(c, grout, x + i + size - 1, y + j, 1, size);
    px(c, grout, x + i, y + j + size - 1, size, 1);
  }
};
const carpet = (base: string) => (c: CanvasRenderingContext2D, x: number, y: number) => {
  px(c, base, x, y, FLOOR_TILE, FLOOR_TILE);
  const dot = shade(base, 0.9);
  for (const [i, j] of [[3, 3], [11, 3], [7, 7], [3, 11], [11, 11]]) { px(c, dot, x + i - 1, y + j, 3, 1); px(c, dot, x + i, y + j - 1, 1, 3); }
  px(c, shade(base, 1.06), x + 7, y + 0, 2, 1);
};
const FLOOR: Record<string, (ctx: CanvasRenderingContext2D, x: number, y: number, r: () => number) => void> = {
  wood: (c, x, y, r) => {
    // golden planks, 4 px tall, staggered butt joints
    px(c, '#e8b464', x, y, FLOOR_TILE, FLOOR_TILE);
    for (let j = 0; j < FLOOR_TILE; j += 4) {
      px(c, '#f6cf86', x, y + j, FLOOR_TILE, 1);
      px(c, '#b8773a', x, y + j + 3, FLOOR_TILE, 1);
      const joint = (hashSeed(`${x},${y + j}`) % 12) + 2;
      px(c, '#b8773a', x + joint, y + j, 1, 3);
      if (r() < 0.25) px(c, '#d49a4e', x + Math.floor(r() * 12), y + j + 1 + Math.floor(r() * 2), 3, 1);
    }
  },
  oak: (c, x, y, r) => {
    // pale natural oak, long boards (Terrace House Tokyo)
    px(c, '#e9cfa6', x, y, FLOOR_TILE, FLOOR_TILE);
    for (let j = 0; j < FLOOR_TILE; j += 4) {
      px(c, '#f3dfbd', x, y + j, FLOOR_TILE, 1);
      px(c, '#c9a57a', x, y + j + 3, FLOOR_TILE, 1);
      if (hashSeed(`${x},${y + j}`) % 3 === 0) px(c, '#c9a57a', x + (hashSeed(`${y + j},${x}`) % 14) + 1, y + j, 1, 3);
      if (r() < 0.3) px(c, '#dcbf94', x + Math.floor(r() * 10), y + j + 1, 5, 1); // grain
    }
  },
  'wood-dark': (c, x, y, r) => {
    px(c, '#c89c75', x, y, FLOOR_TILE, FLOOR_TILE);
    for (let j = 0; j < FLOOR_TILE; j += 4) {
      px(c, '#d7b08a', x, y + j, FLOOR_TILE, 1);
      px(c, '#af8260', x, y + j + 3, FLOOR_TILE, 1);
      px(c, '#af8260', x + (hashSeed(`${x},${y + j}`) % 12) + 2, y + j, 1, 3);
      if (r() < 0.3) px(c, '#c0926b', x + Math.floor(r() * 10), y + j + 1, 4, 1);
    }
  },
  'carpet-cream': carpet('#f3e8da'),
  pooldeck: (c, x, y, r) => {
    // pale stone pavers around the pool
    px(c, '#cfc6b8', x, y, FLOOR_TILE, FLOOR_TILE);
    for (const [i, j] of [[0, 0], [8, 0], [0, 8], [8, 8]]) {
      px(c, ['#e4ded3', '#e1dacd', '#e7e0d5'][Math.floor(r() * 3)], x + i, y + j, 7, 7);
      px(c, '#ebe5db', x + i, y + j, 7, 1);
    }
  },
  'tile-cream': tiles('#e9dfcf', '#d2c5b3', 16),
  'tile-blue': tiles('#cfe7f1', '#8fb5cb', 8),
  'carpet-rose': carpet('#eeb7bf'),
  'carpet-slate': carpet('#b4c2d8'),
  grass: (c, x, y, r) => {
    px(c, '#7cbf5a', x, y, FLOOR_TILE, FLOOR_TILE);
    for (let k = 0; k < 5; k++) {
      const gx = x + Math.floor(r() * 14), gy = y + Math.floor(r() * 13);
      px(c, '#5e9f45', gx, gy + 1, 1, 2);
      px(c, '#5e9f45', gx + 2, gy, 1, 3);
      px(c, '#9fd774', gx + 1, gy, 1, 1);
    }
    if (r() < 0.08) { px(c, '#fff4f0', x + 6, y + 6, 2, 2); px(c, '#f6c24e', x + 6, y + 6, 1, 1); } // daisy
  },
  deck: (c, x, y) => {
    px(c, '#c9925a', x, y, FLOOR_TILE, FLOOR_TILE);
    for (let i = 0; i < FLOOR_TILE; i += 4) {
      px(c, '#dfae74', x + i, y, 1, FLOOR_TILE);
      px(c, '#8f5f34', x + i + 3, y, 1, FLOOR_TILE);
      px(c, '#8f5f34', x + i + 1, y + ((i * 5) % 12) + 2, 1, 1); // nail
    }
  },
  stone: (c, x, y, r) => {
    // flagstones with mortar and lit top edges
    px(c, '#a99a8c', x, y, FLOOR_TILE, FLOOR_TILE);
    for (const [i, j, w, h] of [[0, 0, 9, 7], [9, 0, 7, 7], [0, 7, 6, 9], [6, 7, 10, 9]]) {
      px(c, ['#d8cbbb', '#cfc1b0', '#d3c6b6'][Math.floor(r() * 3)], x + i, y + j, w - 1, h - 1);
      px(c, '#e8dccd', x + i, y + j, w - 1, 1);
    }
  },
};

/** Leafy clump: dark outline, mid body, lit tufts. */
const leaves = (c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) => {
  px(c, OUT, x + 1, y, w - 2, h);
  px(c, OUT, x, y + 1, w, h - 2);
  px(c, '#4f9a4f', x + 1, y + 1, w - 2, h - 2);
  px(c, '#7cc46c', x + 2, y + 2, Math.ceil(w / 3), 2);
  px(c, '#7cc46c', x + w - 5, y + 4, 3, 2);
  px(c, '#2f6f3c', x + 2, y + h - 3, w - 4, 1);
};

/** Wallpaper for the 3/4 wall face along a room's north side (null = open air: a low parapet instead). */
const WALL: Record<string, string | null> = { 'carpet-rose': '#f6d6cd', 'carpet-slate': '#d4dbe8', 'tile-blue': '#e3f1f6', 'tile-cream': '#f6e8c8', wood: '#f1d9a8', stone: '#e6d8c4', oak: '#f6f1e9', 'carpet-cream': '#fbf2ea', 'wood-dark': '#554050', deck: null, grass: null, pooldeck: null };
/** Wall-face decor per tile column (lived-in: framed prints, a shelf, a clock), picked by hash; null = bare. */
const DECOR: (Draw | null)[] = [
  (c, x, y) => { px(c, OUT, x + 4, y + 1, 8, 6); px(c, '#f4efe4', x + 5, y + 2, 6, 4); px(c, '#8fb3a0', x + 6, y + 4, 4, 2); px(c, '#e9b07a', x + 8, y + 3, 2, 1); },
  (c, x, y) => { px(c, OUT, x + 3, y + 2, 5, 4); px(c, '#e7c9b0', x + 4, y + 3, 3, 2); px(c, OUT, x + 9, y + 1, 4, 5); px(c, '#b8cde0', x + 10, y + 2, 2, 3); },
  (c, x, y) => { px(c, '#a87b52', x + 1, y + 5, 14, 1); px(c, '#4f9a4f', x + 3, y + 3, 3, 2); px(c, '#e07a6a', x + 8, y + 2, 1, 3); px(c, '#5577aa', x + 9, y + 2, 1, 3); px(c, '#f6d48f', x + 10, y + 3, 1, 2); },
  (c, x, y) => { px(c, OUT, x + 6, y + 1, 5, 5); px(c, '#ffffff', x + 7, y + 2, 3, 3); px(c, OUT, x + 8, y + 3, 1, 1); },
  null, null, null,
];
const WALL_FACE = 28;

type Draw = (c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) => void;
const px = (c: CanvasRenderingContext2D, col: string, x: number, y: number, w: number, h: number) => {
  c.fillStyle = col;
  c.fillRect(x, y, w, h);
};
const OUT = '#3d2630';
const WALL_TOP = '#b98f86'; // lit stone rim along wall tops
const SHADOW = 'rgba(61,38,48,0.28)';
/** Outlined block in 3/4 view: lit top, darker front face, soft shadow on the floor. */
const box = (c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, fill: string) => {
  px(c, SHADOW, x + 2, y + h - 1, w - 1, 3);
  px(c, OUT, x, y, w, h);
  px(c, fill, x + 1, y + 1, w - 2, h - 2);
  px(c, shade(fill, 1.15), x + 1, y + 1, w - 2, 2);
  if (h >= 8) px(c, shade(fill, 0.78), x + 1, y + h - 4, w - 2, 3);
};

const FURN: Record<string, Draw> = {
  stairs: (c, x, y, w, h) => {
    box(c, x, y, w, h, '#bdb4aa');
    for (let j = 4; j < h; j += 4) { px(c, '#e6e9ef', x + 2, y + j, w - 4, 2); px(c, '#8a7f8e', x + 2, y + j + 2, w - 4, 1); }
  },
  bed: (c, x, y, w, h) => {
    box(c, x + 1, y + 1, w - 2, h - 2, '#f7f2ea');
    box(c, x + 3, y + 3, w - 6, 6, '#ffffff'); // pillow
    px(c, OUT, x + 1, y + 10, w - 2, h - 11);
    px(c, '#7fb0e2', x + 2, y + 11, w - 4, h - 14); // blanket
    px(c, '#a6cbef', x + 2, y + 11, w - 4, 2);
    px(c, shade('#7fb0e2', 0.8), x + 2, y + h - 6, w - 4, 3);
  },
  desk: (c, x, y, w, h) => {
    box(c, x + 1, y + 2, w - 2, h - 4, '#b98a5e');
    px(c, '#6fa8d8', x + 4, y + 4, 8, 5);
  },
  bath: (c, x, y, w, h) => {
    box(c, x + 1, y + 1, w - 2, h - 2, '#ffffff');
    px(c, '#9fd3e6', x + 4, y + 4, w - 8, h - 8);
    px(c, '#c6e7f2', x + 5, y + 5, 4, 2);
  },
  washbasin: (c, x, y) => {
    box(c, x + 2, y + 3, 12, 10, '#ffffff');
    px(c, '#9fd3e6', x + 5, y + 6, 6, 4);
    px(c, '#c8ccd6', x + 7, y + 3, 2, 3);
  },
  bench: (c, x, y, w) => {
    box(c, x + 1, y + 5, w - 2, 7, '#b07a4f');
    for (let i = 4; i < w - 2; i += 6) px(c, '#8a5c38', x + i, y + 5, 1, 7);
  },
  planter: (c, x, y) => {
    box(c, x + 3, y + 8, 10, 7, '#c9724e');
    leaves(c, x + 2, y + 1, 12, 8);
    px(c, '#f48fb1', x + 10, y + 3, 2, 2);
    px(c, '#ffd1df', x + 10, y + 3, 1, 1);
  },
  plant: (c, x, y) => {
    box(c, x + 4, y + 10, 8, 5, '#e0c39a');
    leaves(c, x + 3, y + 1, 10, 10);
  },
  railing: (c, x, y, w) => {
    px(c, '#e6e9ef', x, y + 10, w, 2);
    for (let i = 0; i < w; i += 4) px(c, '#c9ced8', x + i, y + 8, 1, 6);
  },
  shoerack: (c, x, y, w) => {
    box(c, x + 1, y + 4, w - 2, 9, '#a07a5a');
    for (let i = 3; i < w - 3; i += 5) px(c, ['#e07a6a', '#5577aa', '#f6d48f', '#2b2b33'][(i / 5) % 4 | 0], x + i, y + 6, 4, 3);
  },
  umbrella: (c, x, y) => {
    box(c, x + 5, y + 6, 6, 8, '#8a8f99');
    px(c, '#e07a6a', x + 6, y + 1, 2, 6);
    px(c, '#5ea3c8', x + 9, y + 2, 2, 5);
  },
  frontdoor: (c, x, y, w, h) => {
    px(c, '#8a5c38', x, y + 1, 4, h - 2);
    px(c, '#f6d48f', x + 2, y + h / 2, 1, 2);
  },
  rug: (c, x, y, w, h) => {
    px(c, shade('#d9856a', 0.7), x + 2, y + 2, w - 4, h - 4);
    px(c, '#d9856a', x + 3, y + 3, w - 6, h - 6);
    px(c, '#f2c7a8', x + 5, y + 5, w - 10, h - 10);
    px(c, '#d9856a', x + 8, y + 8, w - 16, h - 16);
    for (let i = x + 4; i < x + w - 4; i += 3) { px(c, '#f2c7a8', i, y + 1, 1, 2); px(c, '#f2c7a8', i, y + h - 3, 1, 2); } // fringe
  },
  tv: (c, x, y, w) => {
    box(c, x + 2, y + 1, w - 4, 10, '#2b2b33');
    px(c, '#4f6f9a', x + 4, y + 3, w - 8, 6);
    px(c, '#7fa1c8', x + 5, y + 4, 6, 2);
    px(c, '#8a6a4a', x + 6, y + 11, w - 12, 4);
  },
  bookshelf: (c, x, y, w) => {
    box(c, x + 1, y + 1, w - 2, 13, '#9a6b45');
    const cols = ['#e07a6a', '#9fd3e6', '#f6d48f', '#8fd3b8', '#c9b4ef'];
    for (let i = 3; i < w - 3; i += 3) px(c, cols[(i / 3) % 5 | 0], x + i, y + 3, 2, 4);
    for (let i = 4; i < w - 3; i += 3) px(c, cols[(i / 3 + 2) % 5 | 0], x + i, y + 8, 2, 4);
  },
  lowtable: (c, x, y, w) => {
    box(c, x + 2, y + 3, w - 4, 10, '#a8683c');
    box(c, x + 6, y + 5, 5, 4, '#ffffff'); // mug
    box(c, x + w - 11, y + 5, 5, 4, '#e86a5a'); // book
  },
  sofa: (c, x, y, w) => {
    box(c, x + 1, y + 2, w - 2, 13, '#8fb3dd');
    px(c, shade('#8fb3dd', 0.85), x + 2, y + 9, w - 4, 5);
    for (let i = 2 + (w - 4) / 3; i < w - 3; i += (w - 4) / 3) px(c, shade('#8fb3dd', 0.75), x + i, y + 9, 1, 5);
  },
  counter: (c, x, y, w) => {
    // butcher-block top over painted cabinets with handles
    box(c, x, y + 1, w, 14, '#7fb0a0');
    px(c, '#d9a35f', x + 1, y + 2, w - 2, 5);
    px(c, '#efc586', x + 1, y + 2, w - 2, 1);
    px(c, OUT, x + 1, y + 7, w - 2, 1);
    for (let i = x + 4; i < x + w - 3; i += 8) px(c, '#f6e6b8', i, y + 9, 3, 1);
  },
  sink: (c, x, y) => {
    box(c, x, y + 1, 16, 14, '#7fb0a0');
    px(c, '#d9a35f', x + 1, y + 2, 14, 5);
    box(c, x + 3, y + 2, 10, 5, '#c7d6e2');
    px(c, '#8a96a4', x + 7, y, 2, 3);
  },
  stove: (c, x, y, w) => {
    box(c, x, y + 1, w, 14, '#3a3a44');
    for (const dx of [5, w - 11]) {
      px(c, '#6a6a76', x + dx, y + 4, 6, 6);
      px(c, '#2b2b33', x + dx + 2, y + 6, 2, 2);
    }
  },
  fridge: (c, x, y, w, h) => {
    box(c, x + 1, y, w - 2, h, '#f4f6f8');
    px(c, '#c8ccd6', x + 2, y + 12, w - 4, 1);
    px(c, '#8a96a4', x + w - 5, y + 4, 1, 5);
    px(c, '#f6d48f', x + 4, y + 16, 3, 3);
    px(c, '#e07a6a', x + 8, y + 19, 3, 3);
  },
  diningtable: (c, x, y, w, h) => {
    box(c, x + 1, y + 2, w - 2, h - 4, '#a8683c');
    px(c, '#f3e3c2', x + 5, y + h / 2 - 2, w - 10, 3); // runner
    for (let i = 8; i < w - 8; i += 16) {
      box(c, x + i, y + 6, 7, 6, '#ffffff');
      box(c, x + i + 4, y + h - 14, 7, 6, '#ffffff');
    }
  },
  chair: (c, x, y) => {
    box(c, x + 3, y + 2, 10, 4, '#8f5530'); // back rest
    box(c, x + 3, y + 5, 10, 8, '#b8743f');
  },
  pool: (c, x, y, w, h) => {
    box(c, x, y, w, h, '#e6dfd3');
    px(c, '#3fb6d0', x + 3, y + 3, w - 6, h - 6);
    px(c, '#7fd8ea', x + 5, y + 5, w - 14, 2);
    px(c, '#2a8fb0', x + 3, y + 3, w - 6, 2);
  },
  whiteboard: (c, x, y, w) => {
    box(c, x + 1, y + 1, w - 2, 12, '#ffffff');
    px(c, '#e07a6a', x + 4, y + 4, 10, 1);
    px(c, '#5577aa', x + 4, y + 7, 14, 1);
    px(c, '#8fd3b8', x + 4, y + 10, 8, 1);
  },
};

const windowsFor = (floor: number) => house().rooms.filter(r => r.floor === floor && r.y === 0 && WALL[r.material]).flatMap(r => Array.from({ length: Math.max(1, Math.floor((r.w - 1) / 3)) }, (_, i) => r.x + 1 + i * 3));
/** A walled room on the top row at column x (gets a window on its north wall). */
const indoorAt = (x: number, floor: number) => !!WALL[house().rooms.find((r) => r.id === roomAt(x, 0, floor))?.material ?? ''];
/** Lies flat on the floor: no drop shadow. */
const FLAT = new Set(['rug', 'sheepskin', 'sneakers', 'magazines', 'floorcushions', 'pool']);

/** Baked ComfyUI furniture sprites (scripts/assets/house_assets.py), 32 px per tile; missing ones stay procedural. */
const ASSETS = new Map<string, HTMLImageElement>();
/** Embedded game sprites from 0_mem0ry's Midcentury Modern set; licence/source in docs/HOUSE-UPGRADE.md. */
function furnitureFrame(f: HouseContent['furniture'][number]): [number, number, number, number] | null {
  // a chair faces the way its sitter does: facing down shows its front, facing up shows its back, heads show a side
  if (f.type === 'chair') return f.dir === 'down' ? [96, 16, 32, 48] : f.dir === 'left' || f.dir === 'right' ? [160, 16, 32, 48] : [128, 32, 32, 32];
  if (f.type === 'sofa') return f.dir === 'down' ? [192, 432, 48, 48] : [256, 448, 48, 32];
  return null;
}
const BAKED: Record<string, string> = { bath: '2x2', beanbag: '1x1', bed: '1x2', bench: '3x1', bigplant: '1x1', bookshelf: '2x1', clothesrack: '1x1', coatrack: '1x1', counter: '2x1', desk: '1x1', diningtable: '5x2', floorcushions: '2x1', floorlamp: '1x1', fridge: '1x2', guitar: '1x1', island: '3x1', lantern: '1x1', lounger: '1x2', lowtable: '2x1', magazines: '1x1', plant: '1x1', planter: '1x1', pool: '8x3', pouf: '1x1', shoerack: '2x1', sidetable: '1x1', sink: '1x1', sneakers: '1x1', stool: '1x1', stove: '2x1', trashbin: '1x1', tv: '3x1', umbrella: '1x1', washbasin: '1x1', washer: '1x1', weights: '1x1', whiteboard: '2x1' };
let assetsLoading: Promise<void> | null = null;
export function loadHouseAssets(): Promise<void> {
  const keys = new Set(['midcentury', ...Object.entries(BAKED).map(([type, size]) => `${type}_${size}`), ...house().furniture.filter(f => BAKED[f.type] && !['counter', 'sink'].includes(f.type)).map(f => `${f.type}_${f.w}x${f.h}`)]);
  assetsLoading ??= Promise.all([...keys].map((key) => new Promise<void>((done) => {
    const img = new Image();
    img.onload = () => { ASSETS.set(key, img); done(); };
    img.onerror = () => done();
    img.src = `/assets/house/${key}.png`;
  }))).then(() => {});
  return assetsLoading;
}

/** Render the static house layer (floors, walls, furniture) at 2 device px per house px (draw it at half size). */
export function renderHouse(floor = 0): HTMLCanvasElement {
  const H = house();
  const c = document.createElement('canvas');
  c.width = H.width * TILE * 2;
  c.height = H.height * TILE * 2;
  const ctx = c.getContext('2d')!;
  ctx.scale(2, 2);
  ctx.imageSmoothingEnabled = false;
  px(ctx, '#25212b', 0, 0, H.width * TILE, H.height * TILE);
  /** Walls bordering the pool deck are glass (Terrace House Tokyo: the pool behind a sheet of glass). */
  const isGlass = (x: number, y: number) => H.rooms.find((r) => r.id === roomAt(x, y, floor))?.material === 'pooldeck';
  /** Landing cut-out: look down into the floor below, darkened, behind a glass-and-oak balustrade. */
  const drawVoid = (cx: CanvasRenderingContext2D, X: number, Y: number, W: number, Hh: number) => {
    below ??= renderHouse(floor - 1);
    cx.drawImage(below, X * 2, Y * 2, W * 2, Hh * 2, X, Y, W, Hh);
    px(cx, 'rgba(30,24,40,0.35)', X, Y, W, Hh);
    px(cx, 'rgba(30,24,40,0.3)', X, Y, W, 6); // the slab's shadow
    for (const [x, y, w, h] of [[X, Y, W, 2], [X, Y + Hh - 2, W, 2], [X, Y, 2, Hh], [X + W - 2, Y, 2, Hh]] as const) {
      px(cx, 'rgba(200,235,245,0.5)', x, y, w, h);
      px(cx, '#c9a57a', x, y, Math.min(w, W), 1);
    }
  };
  let below: HTMLCanvasElement | undefined;
  for (const r of H.rooms.filter((r) => r.floor === floor)) {
    const rng = mulberry32(hashSeed(r.id));
    const f = FLOOR[r.material] ?? FLOOR.wood;
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) { ctx.save(); ctx.scale(2, 2); f(ctx, x * FLOOR_TILE, y * FLOOR_TILE, () => rng.next()); ctx.restore(); }
  }
  const edgeOf = (x: number, y: number, r: string) => (nx: number, ny: number) => {
    const nr = roomAt(nx, ny, floor);
    return nr !== r && !(nr && isDoor(x, y, nx, ny, floor));
  };
  // 3/4 wall faces along north walls: wallpaper, wainscot, skirting (outdoor rooms get a low parapet)
  for (const r of H.rooms.filter((r) => r.floor === floor)) {
    const paper = r.material in WALL ? WALL[r.material] : WALL.wood;
    for (let x = r.x; x < r.x + r.w; x++) {
      if (!edgeOf(x, r.y, r.id)(x, r.y - 1)) continue;
      const X = x * TILE, Y = r.y * TILE;
      if (isGlass(x, r.y - 1)) { // floor-to-ceiling glass onto the pool deck
        px(ctx, 'rgba(170,220,235,0.55)', X, Y, TILE, WALL_FACE);
        px(ctx, 'rgba(255,255,255,0.7)', X + ((x * 5) % 9) + 2, Y + 1, 3, 1);
        px(ctx, '#55606a', X + TILE - 1, Y, 1, WALL_FACE); // mullion
        px(ctx, SHADOW, X, Y + WALL_FACE, TILE, 1);
        continue;
      }
      if (!paper) { px(ctx, '#e9e2d6', X, Y, TILE, 4); px(ctx, '#bdb2a4', X, Y + 4, TILE, 1); continue; }
      px(ctx, paper, X, Y, TILE, WALL_FACE);
      if (r.material === 'wood-dark') for (let i = 0; i < TILE; i += 4) px(ctx, shade(paper, 0.8), X + i, Y, 1, WALL_FACE); // cabin panelling
      else px(ctx, shade(paper, 1.07), X + ((x * 7) % 12) + 1, Y + 1, 2, 3); // wallpaper motif
      px(ctx, shade(paper, 0.82), X, Y + WALL_FACE - 4, TILE, 3); // wainscot
      px(ctx, OUT, X, Y + WALL_FACE - 1, TILE, 1); // skirting line
      px(ctx, SHADOW, X, Y + WALL_FACE, TILE, 2);
      ctx.save(); ctx.translate(X, Y + 3); ctx.scale(2, 2);
      DECOR[hashSeed(`${r.id}:${x}`) % DECOR.length]?.(ctx, 0, 0, 16, 12); ctx.restore();
    }
  }
  for (const f of H.furniture.filter((f) => f.floor === floor)) {
    const [X, Y, W, Hh] = [f.x * TILE, f.y * TILE, f.w * TILE, f.h * TILE];
    const img = ASSETS.get(`${f.type}_${f.w}x${f.h}`) ?? ASSETS.get(`${f.type}_${BAKED[f.type]}`);
    const atlas = ASSETS.get('midcentury');
    const rect = furnitureFrame(f);
    if (f.type === 'void') drawVoid(ctx, X, Y, W, Hh);
    else if (f.type === 'rug') {
      const col = roomAt(f.x, f.y, floor) === 'living' ? '#6f9293' : '#d0b1a3';
      px(ctx, '#59454e', X + 3, Y + 3, W - 6, Hh - 6);
      px(ctx, col, X + 5, Y + 5, W - 10, Hh - 10);
      px(ctx, '#e3d4ba', X + 9, Y + 9, W - 18, 2); px(ctx, '#e3d4ba', X + 9, Y + Hh - 11, W - 18, 2);
      px(ctx, '#e3d4ba', X + 9, Y + 9, 2, Hh - 18); px(ctx, '#e3d4ba', X + W - 11, Y + 9, 2, Hh - 18);
      for (let i = 8; i < W - 8; i += 5) { px(ctx, '#d8c8b0', X + i, Y + 1, 2, 2); px(ctx, '#d8c8b0', X + i, Y + Hh - 3, 2, 2); }
    }
    else if (f.type === 'counter' || f.type === 'sink') {
      // Fitted units share a continuous worktop and cabinet rhythm at every orientation.
      px(ctx, SHADOW, X + 2, Y + Hh - 2, W - 3, 4);
      px(ctx, '#644a3e', X, Y + 2, W, Hh - 2);
      px(ctx, '#dfd9c8', X + 2, Y + 5, W - 4, Hh - 7);
      px(ctx, '#b58c62', X + 1, Y + 2, W - 2, Math.max(10, Hh - 15));
      px(ctx, '#e2ba86', X + 2, Y + 3, W - 4, 2);
      for (let i = 2; i < W - 2; i += 16) { px(ctx, '#b7afa0', X + i, Y + Hh - 13, 1, 10); px(ctx, '#685146', X + i + 5, Y + Hh - 10, 5, 1); }
      if (f.type === 'sink') { box(ctx, X + 4, Y + 7, W - 8, 12, '#b5c7cc'); px(ctx, '#708d96', X + 7, Y + 10, W - 14, 6); px(ctx, '#e8e4da', X + 13, Y + 2, 3, 8); }
      else { px(ctx, '#d0a26b', X + 6, Y + 8, Math.min(19, W - 12), 9); px(ctx, '#efe2c8', X + 8, Y + 9, Math.min(15, W - 16), 1); }
    }
    else if (atlas && rect) {
      if (!FLAT.has(f.type)) px(ctx, SHADOW, X + 3, Y + Hh - 4, W - 6, 5);
      if (f.type === 'sofa') {
        const [sx, sy, sw, sh] = rect;
        const top = Y + (f.dir === 'down' ? 8 : 20), height = Hh - (f.dir === 'down' ? 8 : 20);
        ctx.drawImage(atlas, sx, sy, 12, sh, X, top, 16, height);
        ctx.drawImage(atlas, sx + 12, sy, sw - 24, sh, X + 16, top, W - 32, height);
        ctx.drawImage(atlas, sx + sw - 12, sy, 12, sh, X + W - 16, top, 16, height);
        for (let i = 1; i < 3; i++) px(ctx, '#b8aca1', X + 12 + Math.round((W - 24) * i / 3), top + height / 3, 1, height / 3);
        px(ctx, '#d5a0a4', X + 14, top + 13, 11, 9); px(ctx, '#96b4b1', X + W - 26, top + 13, 11, 9);
      } else if (f.type === 'chair' && f.dir === 'right') { // the side frame faces left: mirror it
        ctx.save(); ctx.translate(X + W, Y); ctx.scale(-1, 1); ctx.drawImage(atlas, ...rect, 0, 0, W, Hh); ctx.restore();
      } else ctx.drawImage(atlas, ...rect, X, Y, W, Hh);
    }
    else if (img) {
      if (!FLAT.has(f.type)) px(ctx, SHADOW, X + 2, Y + Hh - 2, W - 3, 3);
      ctx.drawImage(img, X, Y, W, Hh);
    } else if (FURN[f.type]) {
      ctx.save(); ctx.translate(X, Y); ctx.scale(2, 2);
      FURN[f.type](ctx, 0, 0, W / 2, Hh / 2); ctx.restore();
    }
    else box(ctx, X, Y, W, Hh, '#cccccc');
    if (f.type === 'bed') {
      const women = roomAt(f.x, f.y, floor) === 'bedroomW';
      const color = women ? '#d997a5' : '#ba8065';
      px(ctx, color, X + 3, Y + Hh - 21, W - 6, 13);
      px(ctx, women ? '#efb7c1' : '#d8a581', X + 3, Y + Hh - 21, W - 6, 2);
      if (!women) for (let i = 4; i < W - 4; i += 7) px(ctx, '#886979', X + i, Y + Hh - 20, 3, 12);
      for (let i = 4; i < W - 4; i += 3) px(ctx, color, X + i, Y + Hh - 8, 1, 3);
    }
  }
  // thick wall tops with a lit rim
  for (let y = 0; y < H.height; y++)
    for (let x = 0; x < H.width; x++) {
      const r = roomAt(x, y, floor);
      if (!r) continue;
      const X = x * TILE, Y = y * TILE;
      const edge = edgeOf(x, y, r);
      if (edge(x, y - 1)) {
        if ((isGlass(x, y - 1) || isGlass(x, y)) && roomAt(x, y - 1, floor)) px(ctx, '#55606a', X, Y - 1, TILE, 2); // thin glass frame
        else { px(ctx, OUT, X, Y - 2, TILE, 5); px(ctx, WALL_TOP, X, Y - 2, TILE, 2); }
      }
      if (edge(x - 1, y)) { px(ctx, OUT, X, Y, 4, TILE); px(ctx, WALL_TOP, X, Y, 2, TILE); }
      if (y === H.height - 1 || (edge(x, y + 1) && !(isGlass(x, y) && roomAt(x, y + 1, floor)))) { px(ctx, OUT, X, Y + TILE - 3, TILE, 3); px(ctx, WALL_TOP, X, Y + TILE - 3, TILE, 1); }
      if (x === H.width - 1 || edge(x + 1, y)) { px(ctx, OUT, X + TILE - 3, Y, 3, TILE); px(ctx, WALL_TOP, X + TILE - 2, Y, 1, TILE); }
    }
  // windows on the outer north wall face
  for (const wx of windowsFor(floor)) {
    if (!indoorAt(wx, floor)) continue;
    px(ctx, OUT, wx * TILE + 2, 3, 48, 20);
    px(ctx, '#a9dcef', wx * TILE + 4, 5, 44, 16);
    px(ctx, '#e4f6fb', wx * TILE + 5, 5, 16, 7);
    px(ctx, OUT, wx * TILE + 25, 5, 2, 16);
    if (floor === 1) { px(ctx, '#ede3dc', wx * TILE, 3, 4, 24); px(ctx, '#ded0ca', wx * TILE + 48, 3, 4, 24); }
  }
  return c;
}

/** Tile-space spot for a character in a room (deterministic by order). */
export function spotFor(room: string, index: number): [number, number] {
  const r = house().rooms.find((x) => x.id === room);
  if (!r) return [9, 12];
  const s = r.spots[index % r.spots.length];
  const extra = Math.floor(index / r.spots.length);
  return [s[0] + (extra % 2), s[1] - extra];
}

/** Furniture that glows after dark: [type, radius in tiles, warm colour]. */
const LIGHTS: [string, number, string][] = [['desk', 2, '255,224,160'], ['stove', 1.6, '255,150,90'], ['tv', 2.2, '150,190,255'], ['floorlamp', 3, '255,214,150'], ['lantern', 2.2, '255,180,100'], ['pool', 4, '120,220,255']];
let lightLayer: HTMLCanvasElement | null = null;

/**
 * Time-of-day light over the finished scene: morning sun shafts from the north windows, a golden afternoon, and a
 * blue night where lamps cut warm pools out of the dark. `hour` is fractional (19.5 = 19:30).
 */
export function drawLighting(ctx: CanvasRenderingContext2D, floor: number, hour: number, weather = 'sunny') {
  const H = house();
  const W = H.width * TILE, Hh = H.height * TILE;
  const night = hour >= 20 || hour < 5 ? 1 : hour >= 18 ? (hour - 18) / 2 : hour < 6 ? 1 - (hour - 5) : 0;
  if (hour >= 6 && hour < 17 && !['cloudy', 'rain', 'typhoon', 'snow'].includes(weather)) { // sun through the windows, slanting with the hour
    const slant = (hour - 11.5) * 3;
    ctx.fillStyle = `rgba(255,236,190,${hour < 9 ? 0.22 : 0.14})`;
    for (const wx of windowsFor(floor)) if (indoorAt(wx, floor)) {
      ctx.beginPath();
      ctx.moveTo(wx * TILE + 3, 9); ctx.lineTo(wx * TILE + 13, 9);
      ctx.lineTo(wx * TILE + 13 - slant * 2, 9 + TILE * 2.5); ctx.lineTo(wx * TILE + 3 - slant * 2, 9 + TILE * 2.5);
      ctx.fill();
    }
    if (floor === 0) for (const r of H.rooms.filter(r => ['living', 'kitchen'].includes(r.id))) {
      ctx.save(); clipRoom(ctx, r);
      ctx.fillStyle = 'rgba(255,236,192,0.22)';
      for (let x = r.x + 1; x < r.x + r.w - 1; x += 3) {
        ctx.beginPath(); ctx.moveTo(x * TILE, r.y * TILE + WALL_FACE);
        ctx.lineTo((x + 1.6) * TILE, r.y * TILE + WALL_FACE);
        ctx.lineTo((x + 3.2) * TILE, (r.y + 4) * TILE); ctx.lineTo((x + 1.6) * TILE, (r.y + 4) * TILE); ctx.fill();
      }
      ctx.restore();
    }
  }
  if (['cloudy', 'rain', 'typhoon', 'snow'].includes(weather)) { ctx.fillStyle = 'rgba(78,101,137,0.12)'; ctx.fillRect(0, 0, W, Hh); }
  if (hour >= 15 && hour < 20) { ctx.fillStyle = `rgba(255,140,60,${Math.min(1, (hour - 15) / 3) * 0.2 * (1 - night)})`; ctx.fillRect(0, 0, W, Hh); }
  if (hour < 9 && hour >= 5) { ctx.fillStyle = 'rgba(255,214,170,0.08)'; ctx.fillRect(0, 0, W, Hh); }
  if (night <= 0) return;
  // darkness with lamp-shaped holes, then a soft warm glow on top
  lightLayer ??= document.createElement('canvas');
  if (lightLayer.width !== W) [lightLayer.width, lightLayer.height] = [W, Hh];
  const l = lightLayer.getContext('2d')!;
  l.globalCompositeOperation = 'source-over';
  l.clearRect(0, 0, W, Hh);
  l.fillStyle = `rgba(16,20,52,${0.58 * night})`;
  l.fillRect(0, 0, W, Hh);
  const lamps = H.furniture.filter((f) => f.floor === floor).flatMap((f) => LIGHTS.filter(([t]) => t === f.type).map(([, r, col]) => ({ x: (f.x + f.w / 2) * TILE, y: (f.y + f.h / 2) * TILE, r: r * TILE, col, room: H.rooms.find(room => room.id === roomAt(f.x, f.y, floor))! })));
  for (const room of H.rooms.filter(r => r.floor === floor && WALL[r.material])) lamps.push({ x: (room.x + room.w / 2) * TILE, y: (room.y + 2) * TILE, r: Math.max(room.w, room.h) * TILE * 0.65, col: room.material === 'wood-dark' ? '255,183,113' : '255,224,183', room });
  l.globalCompositeOperation = 'destination-out';
  for (const p of lamps) {
    l.save(); clipRoom(l, p.room);
    const g = l.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
    g.addColorStop(0, 'rgba(0,0,0,0.9)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    l.fillStyle = g; l.fillRect(p.x - p.r, p.y - p.r, p.r * 2, p.r * 2);
    l.restore();
  }
  ctx.drawImage(lightLayer, 0, 0);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const p of lamps) {
    ctx.save(); clipRoom(ctx, p.room);
    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 0.8);
    g.addColorStop(0, `rgba(${p.col},${0.16 * night})`); g.addColorStop(1, `rgba(${p.col},0)`);
    ctx.fillStyle = g; ctx.fillRect(p.x - p.r, p.y - p.r, p.r * 2, p.r * 2);
    ctx.restore();
  }
  ctx.restore();
}

function clipRoom(ctx: CanvasRenderingContext2D, r: HouseContent['rooms'][number]) {
  ctx.beginPath(); ctx.rect(r.x * TILE + 4, r.y * TILE + 4, r.w * TILE - 8, r.h * TILE - 8); ctx.clip();
}

export function drawWater(ctx: CanvasRenderingContext2D, floor: number, time: number) {
  for (const p of house().furniture.filter(f => f.floor === floor && f.type === 'pool')) {
    ctx.save(); ctx.beginPath(); ctx.rect(p.x * TILE + 16, p.y * TILE + 12, p.w * TILE - 32, p.h * TILE - 28); ctx.clip();
    for (let i = 0; i < 28; i++) {
      const phase = time / 1300 + i;
      const x = p.x * TILE + 16 + (i * 31) % (p.w * TILE - 32);
      const y = p.y * TILE + 12 + (i * 17) % (p.h * TILE - 28);
      ctx.fillStyle = `rgba(205,255,247,${0.15 + 0.12 * Math.sin(phase)})`;
      ctx.fillRect(x + Math.round(Math.sin(phase) * 3), y, 9, 1); ctx.fillRect(x + 3, y + 3, 5, 1);
    }
    ctx.restore();
  }
}

export function drawWeather(ctx: CanvasRenderingContext2D, floor: number, weather: string, time: number) {
  if (!['rain', 'typhoon', 'snow'].includes(weather)) return;
  for (const r of house().rooms.filter(r => r.floor === floor && !WALL[r.material])) {
    ctx.save(); clipRoom(ctx, r);
    const storm = weather === 'typhoon', snow = weather === 'snow';
    ctx.fillStyle = storm ? 'rgba(43,64,99,0.22)' : 'rgba(81,121,151,0.06)'; ctx.fillRect(r.x * TILE, r.y * TILE, r.w * TILE, r.h * TILE);
    const count = Math.ceil(r.w * r.h * (storm ? 2 : 0.9));
    for (let i = 0; i < count; i++) {
      const x = r.x * TILE + (i * 53 + time / (snow ? 110 : storm ? 6 : 24)) % (r.w * TILE);
      const y = r.y * TILE + (i * 37 + time / (snow ? 35 : 4)) % (r.h * TILE);
      ctx.fillStyle = snow ? 'rgba(255,250,246,0.8)' : 'rgba(196,224,239,0.55)';
      ctx.fillRect(Math.round(x), Math.round(y), snow ? 2 : 1, snow ? 2 : storm ? 9 : 5);
      if (!snow && i % 4 === 0) { ctx.fillStyle = 'rgba(223,246,249,0.3)'; ctx.fillRect(Math.round(x) - 2, r.y * TILE + (i * 29) % (r.h * TILE), 5, 1); }
    }
    ctx.restore();
  }
}

export function poolSeat(index: number): Seat | null {
  const p = house().furniture.find(f => f.type === 'pool');
  if (!p || index >= 6) return null;
  return { x: p.x + 1 + (index % 3) * 2, y: p.y + 1 + Math.floor(index / 3), pose: 'swim', dir: 'down' };
}

export function withinPoolWater(x: number, y: number): boolean {
  const p = house().furniture.find(f => f.type === 'pool');
  return !!p && x >= p.x + 1 && x < p.x + p.w - 1 && y >= p.y + 1 && y < p.y + p.h - 1;
}

/** Stable player position and distinct guest destinations regardless of occupancy ordering. */
export function poolPlaces(ids: string[], playerId: string, playerPosition?: [number, number]): Map<string, Seat> {
  const places = new Map<string, Seat>();
  if (ids.includes(playerId)) {
    const first = poolSeat(0)!;
    places.set(playerId, playerPosition ? { ...first, x: playerPosition[0], y: playerPosition[1] } : first);
  }
  const player = places.get(playerId);
  const available = Array.from({ length: 6 }, (_, i) => poolSeat(i)!).filter(s => !player || s.x !== player.x || s.y !== player.y);
  ids.filter(id => id !== playerId).forEach((id, i) => { if (available[i]) places.set(id, available[i]); });
  return places;
}

export function swimSolids(floor = 0): Set<string> {
  const solid = solidTiles(floor);
  for (const p of house().furniture.filter(f => f.floor === floor && f.type === 'pool')) for (let y = p.y; y < p.y + p.h; y++) for (let x = p.x; x < p.x + p.w; x++) solid.delete(`${x},${y}`);
  return solid;
}

export type Pose = 'sit' | 'sleep' | 'cook' | 'swim';
export function facing(from: [number, number], to: [number, number]): 'up' | 'down' | 'left' | 'right' {
  const dx = to[0] - from[0], dy = to[1] - from[1];
  return Math.abs(dx) > Math.abs(dy) ? dx > 0 ? 'right' : 'left' : dy > 0 ? 'down' : 'up';
}

/** Standing conversation partners share two reachable neighbouring tiles. Busy furniture users stay put. */
export function conversationPlaces(room: string, chars: CharView[], reserved: Set<string>): Map<string, [number, number]> {
  const result = new Map<string, [number, number]>();
  const r = house().rooms.find(r => r.id === room);
  if (!r) return result;
  const solid = solidTiles(r.floor);
  const origin = spotFor(room, 0);
  const free: [number, number][] = [];
  for (let y = r.y + 1; y < r.y + r.h - 1; y++) for (let x = r.x + 1; x < r.x + r.w - 1; x++)
    if (!solid.has(`${x},${y}`) && !reserved.has(`${x},${y}`) && findPath(origin, [x, y], solid, r.floor)) free.push([x, y]);
  free.sort((a, b) => Math.hypot(a[0] - origin[0], a[1] - origin[1]) - Math.hypot(b[0] - origin[0], b[1] - origin[1]));
  for (const c of chars) {
    const partner = chars.find(p => p.id === c.talkingTo);
    if (c.isPlayer || !partner || partner.isPlayer || partner.swimming || result.has(c.id) || result.has(partner.id)) continue;
    if (['work', 'sleep', 'nap', 'shower', 'cook', 'eat'].includes(partner.activity ?? '')) continue;
    const first = free.find(a => !reserved.has(`${a[0]},${a[1]}`) && free.some(b => !reserved.has(`${b[0]},${b[1]}`) && Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]) === 1));
    const second = first && free.find(b => !reserved.has(`${b[0]},${b[1]}`) && Math.abs(b[0] - first[0]) + Math.abs(b[1] - first[1]) === 1);
    if (first && second) {
      result.set(c.id, first); result.set(partner.id, second);
      reserved.add(`${first[0]},${first[1]}`); reserved.add(`${second[0]},${second[1]}`);
    }
  }
  return result;
}
export interface Seat { x: number; y: number; pose: Pose; dir: 'up' | 'down' | 'left' | 'right' }

/**
 * Furniture spots for what someone is doing in a room: beds for sleepers, the stove for the cook, chairs and table
 * sides for meals, the sofa for anyone lounging in the living room. Null = no free seat (stand at a normal spot).
 */
export function seatFor(room: string, activity: string | null, index: number): Seat | null {
  if (['seek', 'gossip', 'apologize', 'confess'].includes(activity ?? '')) return null;
  const r = house().rooms.find((x) => x.id === room);
  if (!r) return null;
  const inRoom = house().furniture.filter((f) => f.floor === r.floor && f.x >= r.x && f.x < r.x + r.w && f.y >= r.y && f.y < r.y + r.h);
  const of = (type: string) => inRoom.filter((f) => f.type === type);
  const seats: Seat[] = [];
  if (activity === 'sleep') for (const b of of('bed')) seats.push({ x: b.x, y: b.y, pose: 'sleep', dir: 'down' });
  else if (activity === 'cook') for (const s of of('stove')) for (let i = 0; i < s.w; i++) seats.push({ x: s.x + i, y: s.y + 1, pose: 'cook', dir: 'up' });
  else if (activity === 'eat') {
    for (const t of of('diningtable')) {
      for (const ch of of('chair')) seats.push({ x: ch.x, y: ch.y, pose: 'sit', dir: ch.y < t.y ? 'down' : ch.y >= t.y + t.h ? 'up' : ch.x < t.x ? 'right' : 'left' });
    }
  } else if ((room === 'living' || room === 'stairsUp') && activity !== 'tidy' && activity !== 'exercise') for (const s of of('sofa')) for (let i = 0; i < (s.seats ?? Math.min(3, s.w)); i++) seats.push({ x: s.x + i, y: s.y + (s.dir === 'down' ? s.h - 1 : 0), pose: 'sit', dir: s.dir ?? 'up' });
  return seats[index] ?? null;
}

export const hotspots = (floor = 0) => house().hotspots.filter((h) => h.floor === floor);
export const houseSize = () => [house().width * TILE, house().height * TILE] as const;
