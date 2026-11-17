import { describe, expect, it } from "vitest";
import { config } from "../src/config";
import { generateLocalMap } from "../src/local-map";
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

describe("generated terrain leaves a passable path", () => {
  // From the starting cell, the robot must be able to reach the left and right edges
  // of its patch, so it can always get out of the middle.
  for (let node = 0; node < 10; node++) {
    it(`node ${node}: the start cell reaches both side edges`, () => {
      const map = generateLocalMap(node, config.localMap);
      const start = { x: Math.floor(map.cols / 2), y: Math.floor(map.rows / 2) };
      const rows = [...Array(map.rows).keys()];
      const left = rows.some((y) => findRoute(start, { x: 0, y }, map) !== null);
      const right = rows.some((y) => findRoute(start, { x: map.cols - 1, y }, map) !== null);
      expect(left && right).toBe(true);
    });
  }
});
