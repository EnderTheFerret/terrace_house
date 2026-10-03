import { describe, expect, it } from 'vitest';
import { content } from '@shared-roof/shared';
import { findPath, passable, solidTiles } from './house';

describe('house layout', () => {
  it('walks around furniture and through doors, never through a wall or a solid piece', () => {
    const solid = solidTiles(0);
    // entrance -> far side of the kitchen: has to use the entrance/living and living/kitchen doors
    const path = findPath([2, 12], [25, 10], solid, 0)!;
    expect(path).not.toBeNull();
    let [x, y] = [2, 12];
    for (const [nx, ny] of path) {
      expect(passable(x, y, nx, ny, solid, 0)).toBe(true);
      [x, y] = [nx, ny];
    }
    // a seat on the sofa is solid furniture but still a valid goal
    const sofa = content().house.furniture.find((f) => f.type === 'sofa' && f.floor === 0)!;
    expect(findPath([9, 9], [sofa.x, sofa.y], solid, 0)?.at(-1)).toEqual([sofa.x, sofa.y]);
  });
  it('every room spot and hotspot is reachable from the stairs on its floor (upstairs women\'s room included)', () => {
    for (const floor of [0, 1]) {
      const solid = solidTiles(floor);
      const stairs = content().house.hotspots.find((h) => h.floor === floor && h.action.startsWith('stairs'))!;
      const targets = [...content().house.rooms.filter((r) => r.floor === floor).flatMap((r) => r.spots), ...content().house.hotspots.filter((h) => h.floor === floor).map((h) => [h.x, h.y])];
      for (const [tx, ty] of targets) expect(findPath([stairs.x, stairs.y], [tx, ty], solid, floor), `${floor}:${tx},${ty}`).not.toBeNull();
    }
  });
});
