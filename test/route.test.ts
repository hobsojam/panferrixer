import { describe, expect, it } from "vitest";
import { config } from "../src/config";
import { generateWorld } from "../src/local-map";
import { findRoute, isPassable } from "../src/route";
import { mapOf } from "./helpers";

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

describe("the world leaves a passable path", () => {
  // Every town must be walkable from every other, so the robot can always get anywhere.
  it("every town can be walked to from the first town", () => {
    const { map, towns } = generateWorld(config.localMap);
    for (const t of towns) {
      expect(findRoute(towns[0], t, map), `town at ${t.x},${t.y}`).not.toBeNull();
    }
  });
});
