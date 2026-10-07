import { describe, expect, it } from 'vitest';
import { content, createGame, projectForPlayer } from '@shared-roof/shared';
import { conversationPlaces, facing, findPath, passable, poolPlaces, poolSeat, seatFor, solidTiles, swimSolids, withinPoolWater } from './house';

describe('house layout', () => {
  it('allows walking across the empty floor above both tubs while blocking the tubs themselves', () => {
    for (const [floor, x, y] of [[0, 1, 15], [1, 23, 1]]) {
      const solid = solidTiles(floor);
      for (const tx of [x, x + 1]) {
        expect(passable(tx, y - 1, tx, y, solid, floor)).toBe(true);
        expect(passable(tx, y, tx, y + 1, solid, floor)).toBe(false);
      }
      expect(passable(x, y, x + 1, y, solid, floor)).toBe(true);
    }
  });
  it('stages conversation partners on adjacent reachable floor tiles and faces them toward each other', () => {
    const s = createGame({ seed: 9, moveInDay: false });
    s.characters.ren.lastAction = 'seek'; s.characters.ren.actionTarget = 'mio';
    const chars = projectForPlayer(s).characters.filter(c => ['ren', 'mio'].includes(c.id));
    const places = conversationPlaces('living', chars, new Set());
    const a = places.get('ren')!, b = places.get('mio')!;
    expect(places.size).toBe(2);
    expect(Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1])).toBe(1);
    expect(solidTiles(0).has(a.join(','))).toBe(false);
    expect(findPath(a, b, solidTiles(0))).toEqual([b]);
    expect(facing(a, b)).not.toBe(facing(b, a));
    expect(seatFor('living', 'seek', 0)).toBeNull();
    expect(findPath(a, [1, 12], solidTiles(0))).not.toBeNull();
    expect(findPath(b, [2, 12], solidTiles(0))).not.toBeNull();
  });
  it('leaves the living room kitchen doorway clear in both directions', () => {
    const solid = solidTiles(0);
    expect(passable(15, 8, 16, 8, solid)).toBe(true);
    expect(passable(16, 8, 15, 8, solid)).toBe(true);
    expect(findPath([14, 10], [18, 8], solid)).toContainEqual([15, 8]);
  });
  it('keeps the player visible when new swimmers precede them in occupancy', () => {
    const first = poolSeat(0)!;
    const group = poolPlaces(['kai', 'ron', 'player'], 'player', [first.x, first.y]);
    expect(group.get('player')).toEqual(first);
    expect(new Set([...group.values()].map(s => `${s.x},${s.y}`)).size).toBe(3);
    const moved = poolSeat(2)!;
    const full = poolPlaces(['a', 'b', 'c', 'd', 'e', 'player'], 'player', [moved.x, moved.y]);
    expect(new Set([...full.values()].map(s => `${s.x},${s.y}`)).size).toBe(6);
    expect(full.get('player')).toEqual(moved);
  });
  it('provides six distinct real dining chairs and six reachable sofa places', () => {
    const solid = solidTiles(0);
    for (const [room, activity] of [['kitchen', 'eat'], ['living', 'hangout']]) {
      const seats = Array.from({ length: 6 }, (_, i) => seatFor(room, activity, i)!);
      expect(seats.every(Boolean)).toBe(true);
      expect(new Set(seats.map(s => `${s.x},${s.y}`)).size).toBe(6);
      const stairs = content().house.hotspots.find(h => h.action === 'stairs-up')!;
      for (const s of seats) expect(findPath([stairs.x, stairs.y], [s.x, s.y], solid, 0), `${room}:${s.x},${s.y}`).not.toBeNull();
      expect(seatFor(room, activity, 6)).toBeNull();
    }
  });
  it('keeps water blocked for walkers but gives six swimmers distinct reachable water places', () => {
    const dry = solidTiles(0), water = swimSolids(0);
    const seats = Array.from({ length: 6 }, (_, i) => poolSeat(i)!);
    expect(new Set(seats.map(s => `${s.x},${s.y}`)).size).toBe(6);
    for (const s of seats) {
      expect(withinPoolWater(s.x, s.y)).toBe(true);
      expect(dry.has(`${s.x},${s.y}`)).toBe(true);
      expect(water.has(`${s.x},${s.y}`)).toBe(false);
      expect(findPath([8, 4], [s.x, s.y], water, 0)).not.toBeNull();
    }
    expect(poolSeat(6)).toBeNull();
    const p = content().house.furniture.find(f => f.type === 'pool')!;
    expect(withinPoolWater(p.x, p.y + 1)).toBe(false);
    expect(withinPoolWater(p.x + 1, p.y + p.h - 1)).toBe(false);
  });
  it('walks around furniture and through doors, never through a wall or a solid piece', () => {
    const solid = solidTiles(0);
    // entrance -> far side of the kitchen: has to use the entrance/living and living/kitchen doors
    const path = findPath([3, 10], [24, 9], solid, 0)!;
    expect(path).not.toBeNull();
    let [x, y] = [3, 10];
    for (const [nx, ny] of path) {
      expect(passable(x, y, nx, ny, solid, 0)).toBe(true);
      [x, y] = [nx, ny];
    }
    // a seat on the sofa is solid furniture but still a valid goal
    const sofa = content().house.furniture.find((f) => f.type === 'sofa' && f.floor === 0)!;
    expect(findPath([6, 11], [sofa.x, sofa.y], solid, 0)?.at(-1)).toEqual([sofa.x, sofa.y]);
  });
  it('every room spot and hotspot is reachable from the stairs on its floor (upstairs women\'s room included)', () => {
    for (const floor of [0, 1]) {
      const solid = solidTiles(floor);
      for (const r of content().house.rooms.filter(r => r.floor === floor)) for (const [x, y] of r.spots) expect(solid.has(`${x},${y}`), `${r.id} standing spot ${x},${y}`).toBe(false);
      const stairs = content().house.hotspots.find((h) => h.floor === floor && h.action.startsWith('stairs'))!;
      const targets = [...content().house.rooms.filter((r) => r.floor === floor).flatMap((r) => r.spots), ...content().house.hotspots.filter((h) => h.floor === floor).map((h) => [h.x, h.y])];
      for (const [tx, ty] of targets) expect(findPath([stairs.x, stairs.y], [tx, ty], solid, floor), `${floor}:${tx},${ty}`).not.toBeNull();
    }
  });
});
