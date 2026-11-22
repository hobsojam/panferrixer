import { describe, expect, it } from "vitest";
import { dashboardOf, MANY_WORLDS_TIMEOUT_MS } from "./helpers";
import { createAppState, updateApp, type AppState } from "../src/app";
import { config } from "../src/config";
import {
  alertHunters,
  buildingCells,
  createDashboardState,
  moveHunters,
  positionOf,
  scanWakeChance,
  startPosition,
  worldFor,
  type DashboardState,
  type World,
} from "../src/dashboard";
import { generateWorld, inTown } from "../src/local-map";
import { findRoute, isPassable } from "../src/route";

// Hunter sight and the start position: design-notes 4.7 and 4.10. The outage patrol is in outage-patrol.test.ts.
const DT = 1 / 60;
const world = worldFor(config);
const hunterIndex = world.targets.findIndex((t) => t.kind === "hunter");
const hunter = world.targets[hunterIndex];
const post = { x: hunter.col, y: hunter.row };

function run(s: DashboardState, seconds: number, w: World = world): DashboardState {
  let state = s;
  for (let i = 0; i < seconds / DT; i++) state = moveHunters({ ...state, time: state.time + DT }, w, DT);
  return state;
}

describe("the start position", () => {
  function check(w: World, seed: number) {
    const start = startPosition(w, config);
    const clearance = config.dashboard.startClearanceCells;
    for (const t of w.towns) {
      expect(inTown(t, w.townRadiusCols + clearance, w.townRadiusRows + clearance, start.x, start.y), `seed ${seed} starts in a town`).toBe(false);
    }
    for (const t of w.targets.filter((t) => t.kind === "hunter")) {
      expect(Math.hypot(t.col - start.x, t.row - start.y), `seed ${seed} starts in sight of a hunter`).toBeGreaterThan(config.dashboard.hunterSightCells + clearance);
    }
    // Only intact buildings block the robot; it walks through enemies (#99: blocking them here made a
    // defender posted on the town's centre cell look like a wall). Its route is planned the same way.
    const blocked = buildingCells(createDashboardState(config), w);
    expect(isPassable(w.map, start.x, start.y, blocked)).toBe(true);
    expect(findRoute(start, w.towns[config.dashboard.startNode], w.map, blocked), `seed ${seed} cannot walk in`).not.toBeNull();
  }

  it("is outside every town, out of every hunter's sight, on open ground, and can walk in", () => {
    check(world, config.localMap.worldSeed);
  });

  it("holds across many worlds", () => {
    // Seed 57 is the one that found #99.
    for (let seed = 1; seed <= 60; seed++) {
      const generated = generateWorld({ ...config.localMap, worldSeed: seed });
      check({ ...world, ...generated }, seed);
    }
  }, MANY_WORLDS_TIMEOUT_MS);

  it("the game does not open with an attack", () => {
    let s: AppState = createAppState(config);
    for (let i = 0; i < 10 / DT; i++) s = updateApp(s, { actions: [], steering: 0 }, DT, config, () => 1);
    expect(s.screen).toBe("dashboard");
    expect(dashboardOf(s).alerted).toEqual([]);
  });
});

describe("hunters are always looking", () => {
  it("a hunter sees the robot within its sight radius, and waits a moment before attacking", () => {
    const near = { ...createDashboardState(config), pos: { x: post.x + config.dashboard.hunterSightCells - 0.5, y: post.y } };
    const seen = moveHunters(near, world, DT);
    expect(seen.alerted).toContain(hunterIndex);
    expect(seen.hunterReadyAt[hunterIndex]).toBeGreaterThan(seen.time);
  });

  it("but not from further away", () => {
    const apart = { ...createDashboardState(config), pos: { x: post.x + config.dashboard.hunterSightCells + 0.5, y: post.y } };
    expect(moveHunters(apart, world, DT).alerted).not.toContain(hunterIndex);
  });
});

describe("an alerted hunter holds at its preferred range", () => {
  it("closes in from further away, then stops at its range instead of running onto the robot", () => {
    const robot = { x: post.x + config.dashboard.hunterSightCells - 0.5, y: post.y };
    let s: DashboardState = { ...createDashboardState(config), pos: robot };
    s = run(s, 8);
    const p = positionOf(s, hunterIndex, world);
    const range = Math.hypot(p.x - robot.x, p.y - robot.y);
    expect(s.alerted).toContain(hunterIndex);
    expect(range).toBeLessThanOrEqual(config.dashboard.hunterHoldCells);
    expect(range).toBeGreaterThan(1);
  });

  it("does not move while the robot is already within its range", () => {
    const robot = { x: post.x + 2, y: post.y };
    const s = run({ ...createDashboardState(config), pos: robot, alerted: [hunterIndex] }, 3);
    expect(positionOf(s, hunterIndex, world)).toEqual(post);
  });
});

describe("a scan wakes hunters by chance, falling with range", () => {
  const close = config.dashboard.closeRadius;
  const edge = config.dashboard.scanRadius;

  it("certain within the close zone, nothing beyond the ring, falling steadily between", () => {
    expect(scanWakeChance(0, world)).toBe(1);
    expect(scanWakeChance(close, world)).toBe(1);
    expect(scanWakeChance(edge, world)).toBe(0);
    expect(scanWakeChance(edge + 3, world)).toBe(0);
    expect(scanWakeChance(8, world)).toBeCloseTo(2 / 3);
    expect(scanWakeChance(10, world)).toBeCloseTo(1 / 3);
  });

  /** How often a scan at this many cells from the hunter wakes it, over many scan times. */
  function wakeRate(distance: number): number {
    let woken = 0;
    const scans = 600;
    for (let i = 0; i < scans; i++) {
      const s = { ...createDashboardState(config), time: i * 0.37, pos: { x: post.x + distance, y: post.y } };
      if (alertHunters(s, world).includes(hunterIndex)) woken++;
    }
    return woken / scans;
  }

  it("wakes far hunters about as often as their chance says", () => {
    expect(wakeRate(close - 1)).toBe(1);
    expect(wakeRate(8)).toBeGreaterThan(0.55);
    expect(wakeRate(8)).toBeLessThan(0.78);
    expect(wakeRate(10)).toBeGreaterThan(0.23);
    expect(wakeRate(10)).toBeLessThan(0.44);
    expect(wakeRate(edge + 1)).toBe(0);
  });

  it("the same scan gives the same answer, and scanning again rolls again", () => {
    const at = (time: number) => ({ ...createDashboardState(config), time, pos: { x: post.x + 10, y: post.y } });
    expect(alertHunters(at(4.2), world)).toEqual(alertHunters(at(4.2), world));
    const outcomes = new Set(Array.from({ length: 40 }, (_, i) => alertHunters(at(i * 0.5), world).includes(hunterIndex)));
    expect(outcomes.size).toBe(2);
  });
});
