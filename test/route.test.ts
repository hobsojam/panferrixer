import { describe, expect, it } from "vitest";
import { config } from "../src/config";
import { generateWorld, isEnemyKind } from "../src/local-map";
import { cellKey, findRoute, findRouteToAny, isPassable, OFFSETS } from "../src/route";
import { MANY_WORLDS_TIMEOUT_MS, mapOf } from "./helpers";

describe("passable cells", () => {
  it("high ground is blocked and valleys and ground are not", () => {
    const map = mapOf(["012"]);
    expect(isPassable(map, 0, 0)).toBe(true);
    expect(isPassable(map, 1, 0)).toBe(true);
    expect(isPassable(map, 2, 0)).toBe(false);
    expect(isPassable(map, -1, 0)).toBe(false);
  });
});

describe("findRoute", () => {
  it("is empty when already at the destination", () => {
    expect(findRoute({ x: 1, y: 0 }, { x: 1, y: 0 }, mapOf(["111"]))).toEqual([]);
  });

  it("walks straight along open ground", () => {
    expect(findRoute({ x: 0, y: 0 }, { x: 2, y: 0 }, mapOf(["111"]))).toEqual([
      { x: 1, y: 0 },
      { x: 2, y: 0 },
    ]);
  });

  it("goes around high ground rather than through it", () => {
    const map = mapOf(["121", "121", "111"]);
    const route = findRoute({ x: 0, y: 0 }, { x: 2, y: 0 }, map)!;
    expect(route.length).toBeGreaterThan(2);
    expect(route.every((c) => isPassable(map, c.x, c.y))).toBe(true);
    expect(route[route.length - 1]).toEqual({ x: 2, y: 0 });
  });

  it("returns null when high ground cuts the map off", () => {
    expect(findRoute({ x: 0, y: 0 }, { x: 2, y: 0 }, mapOf(["102"]))).toBeNull();
  });

  it("returns null when the destination itself is high ground", () => {
    expect(findRoute({ x: 0, y: 0 }, { x: 1, y: 0 }, mapOf(["120"]))).toBeNull();
  });

  it("rounds a continuous start position to its cell", () => {
    expect(findRoute({ x: 0.4, y: 0.2 }, { x: 2, y: 0 }, mapOf(["111"]))).toEqual([
      { x: 1, y: 0 },
      { x: 2, y: 0 },
    ]);
  });
});

describe("blocked cells", () => {
  it("a blocked cell is impassable even on open ground", () => {
    const map = mapOf(["111"]);
    expect(isPassable(map, 1, 0, new Set([cellKey(map, 1, 0)]))).toBe(false);
  });

  it("a route goes around a blocked cell", () => {
    const map = mapOf(["111", "111"]);
    const blocked = new Set([cellKey(map, 1, 0)]);
    const route = findRoute({ x: 0, y: 0 }, { x: 2, y: 0 }, map, blocked)!;
    expect(route.some((c) => c.x === 1 && c.y === 0)).toBe(false);
    expect(route[route.length - 1]).toEqual({ x: 2, y: 0 });
  });

  it("returns null when the destination is blocked", () => {
    const map = mapOf(["111"]);
    expect(findRoute({ x: 0, y: 0 }, { x: 2, y: 0 }, map, new Set([cellKey(map, 2, 0)]))).toBeNull();
  });

  it("findRouteToAny walks to the nearest reachable goal", () => {
    const map = mapOf(["11111"]);
    const route = findRouteToAny({ x: 0, y: 0 }, [{ x: 4, y: 0 }, { x: 2, y: 0 }], map);
    expect(route).toEqual([
      { x: 1, y: 0 },
      { x: 2, y: 0 },
    ]);
  });
});

describe("the world leaves a passable path", () => {
  // Every town must be walkable from every other, so the robot can always get anywhere.
  it("every town can be walked to from the first town", () => {
    const { map, towns } = generateWorld(config.localMap);
    for (const t of towns) {
      expect(findRoute(towns[0], t, map), `town at ${t.x},${t.y}`).not.toBeNull();
    }
  });

  // Buildings block the robot (design-notes 4.7), so placement must never cut a route.
  it("buildings never cut off a town or another building, across many seeds", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const { map, towns, targets } = generateWorld({ ...config.localMap, worldSeed: seed });
      const buildings = targets.filter((t) => !isEnemyKind(t.kind));
      const blocked = new Set(buildings.map((b) => cellKey(map, b.col, b.row)));
      expect(buildings.some((b) => towns.some((t) => t.x === b.col && t.y === b.row)), `seed ${seed} building on a town centre`).toBe(false);
      for (const t of towns) {
        expect(findRoute(towns[0], t, map, blocked), `seed ${seed} town at ${t.x},${t.y}`).not.toBeNull();
      }
      for (const b of buildings) {
        const beside = OFFSETS.map(([dx, dy]) => ({ x: b.col + dx, y: b.row + dy }));
        expect(findRouteToAny(towns[0], beside, map, blocked), `seed ${seed} building at ${b.col},${b.row}`).not.toBeNull();
      }
    }
  }, MANY_WORLDS_TIMEOUT_MS);

  it("every network still gets all its buildings and its hunter", () => {
    const { towns, targets } = generateWorld(config.localMap);
    const perTown = 2 + config.localMap.domesPerTown + config.localMap.otherBuildingsPerTown;
    expect(targets.filter((t) => t.kind !== "defender" && t.kind !== "patroller" && t.kind !== "hauler").length).toBe(towns.length * perTown);
  });
});
