import { describe, expect, it } from "vitest";
import { config } from "../src/config";
import { bearingFrom, generateWorld, inGap, inTown, inWallRing, type LocalMapConfig, type World } from "../src/local-map";
import { cellKey, findRoute, OFFSETS, reachableFrom, type Cell } from "../src/route";
import { MANY_WORLDS_TIMEOUT_MS } from "./helpers";

// Town walls (#89, design-notes 4.7): most towns sit inside a mountain arc with 1 or 2 gaps, a few
// stay open, and no town, or its wall, reaches another's.
const cfg = config.localMap;
const seeds = [cfg.worldSeed, 1, 2, 3, 4, 5, 6, 8];
const worlds: World[] = seeds.map((worldSeed) => generateWorld({ ...cfg, worldSeed }));

function ringOf(world: World, town: number, c: LocalMapConfig = cfg): Cell[] {
  const t = world.towns[town];
  const cells: Cell[] = [];
  for (let y = 0; y < world.map.rows; y++) {
    for (let x = 0; x < world.map.cols; x++) {
      if (inWallRing(t, c.townRadiusCols, c.townRadiusRows, c.wallReach, x, y)) cells.push({ x, y });
    }
  }
  return cells;
}

function isGap(world: World, town: number, c: Cell): boolean {
  const wall = world.walls[town]!;
  const b = bearingFrom(world.towns[town], cfg.townRadiusCols, cfg.townRadiusRows, c.x, c.y);
  return wall.gaps.some((g) => inGap(b, g, wall.gapWidth));
}

describe("town walls", () => {
  it("no town, or the ring its wall stands on, reaches another town's", () => {
    const { towns, map } = worlds[0];
    const outer = (t: Cell, x: number, y: number) => inTown(t, cfg.townRadiusCols * cfg.wallReach, cfg.townRadiusRows * cfg.wallReach, x, y);
    for (let y = 0; y < map.rows; y++) {
      for (let x = 0; x < map.cols; x++) {
        expect(towns.filter((t) => outer(t, x, y)).length).toBeLessThanOrEqual(1);
      }
    }
  });

  it("a few towns stay open, and every other town has 1 or 2 gaps", () => {
    for (const world of worlds) {
      expect(world.walls.filter((w) => w === null)).toHaveLength(Math.round(world.towns.length * cfg.openTownShare));
      for (const wall of world.walls) if (wall) expect([1, 2]).toContain(wall.gaps.length);
    }
  });

  it("the ring is high ground except at the gaps, which are open, and about two thirds of it is wall", () => {
    for (const world of worlds) {
      world.walls.forEach((wall, town) => {
        if (!wall) return;
        const ring = ringOf(world, town);
        let walled = 0;
        for (const c of ring) {
          const high = world.map.tiers[c.y][c.x] === 2;
          expect(high).toBe(!isGap(world, town, c));
          if (high) walled += 1;
        }
        expect(walled / ring.length).toBeGreaterThan(cfg.wallShare - 0.15);
        expect(walled / ring.length).toBeLessThan(cfg.wallShare + 0.15);
      });
    }
  });

  it("the wall cannot be slipped through: a walk from a town crosses its ring only at a gap", () => {
    for (const world of [worlds[0], worlds[1]]) {
      world.walls.forEach((wall, town) => {
        if (!wall) return;
        const t = world.towns[town];
        const far = world.towns[(town + 5) % world.towns.length];
        const route = findRoute(t, far, world.map) ?? [];
        expect(route.length).toBeGreaterThan(0);
        for (const c of route) {
          if (inWallRing(t, cfg.townRadiusCols, cfg.townRadiusRows, cfg.wallReach, c.x, c.y)) expect(isGap(world, town, c)).toBe(true);
        }
      });
    }
  }, MANY_WORLDS_TIMEOUT_MS);

  it("every gap leads out to open ground beyond the town, not into a dead end", () => {
    for (const world of worlds) {
      const { map } = world;
      world.walls.forEach((wall, town) => {
        if (!wall) return;
        const t = world.towns[town];
        const inside = (x: number, y: number) => inTown(t, cfg.townRadiusCols, cfg.townRadiusRows, x, y);
        const beyond = (x: number, y: number) =>
          !world.towns.some((o) => inTown(o, cfg.townRadiusCols * cfg.wallReach, cfg.townRadiusRows * cfg.wallReach, x, y));
        for (const centre of wall.gaps) {
          // Walk out from this gap alone: never back through the town, which would reach the other gap.
          const start = ringOf(world, town).filter((c) => {
            const b = bearingFrom(t, cfg.townRadiusCols, cfg.townRadiusRows, c.x, c.y);
            return inGap(b, centre, wall.gapWidth) && map.tiers[c.y][c.x] !== 2;
          });
          expect(start.length).toBeGreaterThan(0);
          const seen = new Set(start.map((c) => cellKey(map, c.x, c.y)));
          const queue = [...start];
          let out = false;
          for (let head = 0; head < queue.length && !out; head++) {
            const c = queue[head];
            if (beyond(c.x, c.y)) out = true;
            for (const [dx, dy] of OFFSETS) {
              const x = c.x + dx;
              const y = c.y + dy;
              if (x < 0 || y < 0 || x >= map.cols || y >= map.rows || map.tiers[y][x] === 2 || inside(x, y)) continue;
              const k = cellKey(map, x, y);
              if (seen.has(k)) continue;
              seen.add(k);
              queue.push({ x, y });
            }
          }
          expect(out).toBe(true);
        }
      });
    }
  });

  it("every town can still be walked to from every other, on every world", () => {
    for (const world of worlds) {
      const reached = reachableFrom(world.towns[0], world.map);
      for (const t of world.towns) expect(reached.has(cellKey(world.map, t.x, t.y))).toBe(true);
    }
  });
});
