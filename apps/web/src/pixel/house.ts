// Top-down pixel renderer for the share house (procedural tiles + furniture), driven by content/house.json.
import { content, hashSeed, mulberry32, shade, type HouseContent } from '@shared-roof/shared';

export const TILE = 16;

const house = (): HouseContent => content().house;

export function roomAt(x: number, y: number): string | null {
  const r = house().rooms.find((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);
  return r?.id ?? null;
}

function isDoor(x: number, y: number, nx: number, ny: number): boolean {
  const doors = house().doors;
  // door [dx, dy] opens the boundary between (dx,dy) and its neighbour above or to the left
  return doors.some(([dx, dy]) => (dx === x && dy === y && ((nx === x && ny === y - 1) || (nx === x - 1 && ny === y))) || (dx === nx && dy === ny && ((x === nx && y === ny - 1) || (x === nx - 1 && y === ny))));
}

/** Can you walk from tile a to adjacent tile b? (walls between rooms except doors, solid furniture) */
export function passable(ax: number, ay: number, bx: number, by: number, solid: Set<string>): boolean {
  const H = house();
  if (bx < 0 || by < 0 || bx >= H.width || by >= H.height) return false;
  if (solid.has(`${bx},${by}`)) return false;
  const ra = roomAt(ax, ay);
  const rb = roomAt(bx, by);
  if (!rb) return false;
  if (ra !== rb && !isDoor(ax, ay, bx, by)) return false;
  return true;
}

export function solidTiles(): Set<string> {
  const s = new Set<string>();
  for (const f of house().furniture) if (f.solid !== false) for (let j = 0; j < f.h; j++) for (let i = 0; i < f.w; i++) s.add(`${f.x + i},${f.y + j}`);
  return s;
}

const FLOOR: Record<string, (ctx: CanvasRenderingContext2D, x: number, y: number, r: () => number) => void> = {
  wood: (c, x, y, r) => {
    c.fillStyle = '#d9a46c';
    c.fillRect(x, y, TILE, TILE);
    c.fillStyle = '#c38c55';
    for (let j = 3; j < TILE; j += 4) c.fillRect(x, y + j, TILE, 1);
    c.fillStyle = '#b97f4c';
    c.fillRect(x + ((y / TILE) % 2 ? 4 : 11), y, 1, 3);
    if (r() < 0.2) c.fillRect(x + Math.floor(r() * 14), y + 1 + Math.floor(r() * 3) * 4, 2, 1);
  },
  'tile-cream': (c, x, y) => {
    c.fillStyle = '#f2e9d6';
    c.fillRect(x, y, TILE, TILE);
    c.fillStyle = '#e6d9bf';
    c.fillRect(x + 8, y, 8, 8);
    c.fillRect(x, y + 8, 8, 8);
    c.fillStyle = '#d8c9ad';
    c.fillRect(x, y + 15, TILE, 1);
    c.fillRect(x + 15, y, 1, TILE);
  },
  'tile-blue': (c, x, y) => {
    c.fillStyle = '#d3e7f2';
    c.fillRect(x, y, TILE, TILE);
    c.fillStyle = '#bfd9ea';
    c.fillRect(x + 8, y, 8, 8);
    c.fillRect(x, y + 8, 8, 8);
    c.fillStyle = '#a9c8dc';
    c.fillRect(x, y + 15, TILE, 1);
    c.fillRect(x + 15, y, 1, TILE);
  },
  'carpet-rose': (c, x, y) => {
    c.fillStyle = '#f2c9cf';
    c.fillRect(x, y, TILE, TILE);
    c.fillStyle = '#e8b4bd';
    for (let j = 0; j < TILE; j += 4) for (let i = (j / 4) % 2 ? 2 : 0; i < TILE; i += 4) c.fillRect(x + i, y + j, 1, 1);
  },
  'carpet-slate': (c, x, y) => {
    c.fillStyle = '#bfcadb';
    c.fillRect(x, y, TILE, TILE);
    c.fillStyle = '#aab7cb';
    for (let j = 0; j < TILE; j += 4) for (let i = (j / 4) % 2 ? 2 : 0; i < TILE; i += 4) c.fillRect(x + i, y + j, 1, 1);
  },
  deck: (c, x, y) => {
    c.fillStyle = '#caa073';
    c.fillRect(x, y, TILE, TILE);
    c.fillStyle = '#a97f55';
    for (let i = 0; i < TILE; i += 5) c.fillRect(x + i, y, 1, TILE);
  },
  stone: (c, x, y, r) => {
    c.fillStyle = '#d4cdc4';
    c.fillRect(x, y, TILE, TILE);
    c.fillStyle = '#bdb4aa';
    for (let k = 0; k < 4; k++) c.fillRect(x + Math.floor(r() * 12), y + Math.floor(r() * 12), 4, 3);
  },
};

type Draw = (c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) => void;
const px = (c: CanvasRenderingContext2D, col: string, x: number, y: number, w: number, h: number) => {
  c.fillStyle = col;
  c.fillRect(x, y, w, h);
};
const OUT = '#4a3c50';
const box = (c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, fill: string) => {
  px(c, OUT, x, y, w, h);
  px(c, fill, x + 1, y + 1, w - 2, h - 2);
  px(c, shade(fill, 1.12), x + 1, y + 1, w - 2, 2);
};

const FURN: Record<string, Draw> = {
  bed: (c, x, y, w, h) => {
    box(c, x + 1, y + 1, w - 2, h - 2, '#f7f2ea');
    px(c, '#fff', x + 3, y + 3, w - 6, 5);
    px(c, '#9fc3e8', x + 2, y + 10, w - 4, h - 12);
    px(c, shade('#9fc3e8', 0.85), x + 2, y + 10, w - 4, 2);
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
    box(c, x + 3, y + 8, 10, 7, '#c27a5a');
    px(c, '#6fae6b', x + 2, y + 2, 12, 7);
    px(c, '#8fcf86', x + 4, y + 3, 4, 3);
    px(c, '#f4a7b9', x + 10, y + 4, 2, 2);
  },
  plant: (c, x, y) => {
    box(c, x + 4, y + 10, 8, 5, '#d8c0a0');
    px(c, '#5f9e5c', x + 3, y + 2, 10, 9);
    px(c, '#82c27a', x + 5, y + 3, 3, 3);
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
    px(c, '#e9b8a4', x + 2, y + 2, w - 4, h - 4);
    px(c, '#f4d4c4', x + 5, y + 5, w - 10, h - 10);
    px(c, '#e9b8a4', x + 8, y + 8, w - 16, h - 16);
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
    box(c, x + 2, y + 3, w - 4, 10, '#b98a5e');
    px(c, '#ffffff', x + 6, y + 6, 4, 3);
    px(c, '#e07a6a', x + w - 10, y + 6, 3, 3);
  },
  sofa: (c, x, y, w) => {
    box(c, x + 1, y + 2, w - 2, 13, '#8fb3dd');
    px(c, shade('#8fb3dd', 0.85), x + 2, y + 9, w - 4, 5);
    for (let i = 2 + (w - 4) / 3; i < w - 3; i += (w - 4) / 3) px(c, shade('#8fb3dd', 0.75), x + i, y + 9, 1, 5);
  },
  counter: (c, x, y, w) => {
    box(c, x, y + 1, w, 14, '#e8e2d6');
    px(c, '#c9c0b0', x + 1, y + 11, w - 2, 3);
  },
  sink: (c, x, y) => {
    box(c, x, y + 1, 16, 14, '#e8e2d6');
    px(c, '#b8c6d4', x + 3, y + 4, 10, 6);
    px(c, '#8a96a4', x + 7, y + 2, 2, 3);
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
    box(c, x + 1, y + 2, w - 2, h - 4, '#c49568');
    for (let i = 8; i < w - 8; i += 16) {
      px(c, '#ffffff', x + i, y + 8, 6, 5);
      px(c, '#ffffff', x + i + 4, y + h - 13, 6, 5);
    }
  },
  chair: (c, x, y) => {
    box(c, x + 3, y + 3, 10, 10, '#b07a4f');
  },
  whiteboard: (c, x, y, w) => {
    box(c, x + 1, y + 1, w - 2, 12, '#ffffff');
    px(c, '#e07a6a', x + 4, y + 4, 10, 1);
    px(c, '#5577aa', x + 4, y + 7, 14, 1);
    px(c, '#8fd3b8', x + 4, y + 10, 8, 1);
  },
};

/** Render the static house layer (floors, walls, furniture) at 1 px = 1 px. Cached by caller. */
export function renderHouse(): HTMLCanvasElement {
  const H = house();
  const c = document.createElement('canvas');
  c.width = H.width * TILE;
  c.height = H.height * TILE;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  for (const r of H.rooms) {
    const rng = mulberry32(hashSeed(r.id));
    const f = FLOOR[r.floor] ?? FLOOR.wood;
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) f(ctx, x * TILE, y * TILE, () => rng.next());
  }
  // rooftop sky edge
  const roof = H.rooms.find((r) => r.id === 'rooftop');
  if (roof) {
    ctx.fillStyle = 'rgba(159,211,230,0.35)';
    ctx.fillRect(roof.x * TILE, roof.y * TILE, roof.w * TILE, 6);
  }
  for (const f of H.furniture) {
    const draw = FURN[f.type];
    if (draw) draw(ctx, f.x * TILE, f.y * TILE, f.w * TILE, f.h * TILE);
    else box(ctx, f.x * TILE, f.y * TILE, f.w * TILE, f.h * TILE, '#cccccc');
  }
  // walls
  ctx.fillStyle = OUT;
  for (let y = 0; y < H.height; y++)
    for (let x = 0; x < H.width; x++) {
      const r = roomAt(x, y);
      if (!r) continue;
      const X = x * TILE;
      const Y = y * TILE;
      const edge = (nx: number, ny: number) => {
        const nr = roomAt(nx, ny);
        return nr !== r && !(nr && isDoor(x, y, nx, ny));
      };
      if (edge(x, y - 1)) ctx.fillRect(X, Y, TILE, 3);
      if (edge(x - 1, y)) ctx.fillRect(X, Y, 3, TILE);
      if (y === H.height - 1 || edge(x, y + 1)) ctx.fillRect(X, Y + TILE - 2, TILE, 2);
      if (x === H.width - 1 || edge(x + 1, y)) ctx.fillRect(X + TILE - 2, Y, 2, TILE);
    }
  // windows on the outer top wall
  ctx.fillStyle = '#bfe3f2';
  for (const wx of [3, 16, 10]) ctx.fillRect(wx * TILE + 3, 0, 10, 2);
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

export const hotspots = () => house().hotspots;
export const houseSize = () => [house().width * TILE, house().height * TILE] as const;
