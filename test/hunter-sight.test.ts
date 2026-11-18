import { describe, expect, it } from "vitest";
import { createAppState, updateApp, type AppState } from "../src/app";
import { config } from "../src/config";
import {
  alertHunters,
  createDashboardState,
  investigateOutage,
  moveHunters,
  positionOf,
  scanWakeChance,
  startPosition,
  stepDashboard,
  worldFor,
  type DashboardState,
  type World,
} from "../src/dashboard";
import { generateWorld, inTown } from "../src/local-map";
import { cellKey, findRoute, isPassable } from "../src/route";

// Hunter sight, investigation and the start position: design-notes 4.3, 4.7 and 4.10.
const DT = 1 / 60;
const world = worldFor(config);
const hunterIndex = world.targets.findIndex((t) => t.kind === "hunter");
const hunter = world.targets[hunterIndex];
const post = { x: hunter.col, y: hunter.row };
const FAR = { x: -100, y: -100 }; // a robot nobody can see

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
    const blocked = new Set(w.targets.filter((t) => t.kind !== "hunter").map((t) => cellKey(w.map, t.col, t.row)));
    expect(isPassable(w.map, start.x, start.y, blocked)).toBe(true);
    expect(findRoute(start, w.towns[config.dashboard.startNode], w.map, blocked), `seed ${seed} cannot walk in`).not.toBeNull();
  }

  it("is outside every town, out of every hunter's sight, on open ground, and can walk in", () => {
    check(world, config.localMap.worldSeed);
  });

  it("holds across many worlds", () => {
    for (let seed = 1; seed <= 25; seed++) {
      const generated = generateWorld({ ...config.localMap, worldSeed: seed });
      check({ ...world, ...generated }, seed);
    }
  });

  it("the game does not open with an attack", () => {
    let s: AppState = createAppState(config);
    for (let i = 0; i < 10 / DT; i++) s = updateApp(s, { actions: [], steering: 0 }, DT, config, () => 1);
    expect(s.screen).toBe("dashboard");
    expect(s.dashboard.alerted).toEqual([]);
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

describe("cutting power sends the hunter to investigate", () => {
  const station = world.targets.find((t) => t.kind === "power" && t.network === hunter.network)!;
  const stationIndex = world.targets.indexOf(station);
  const alone: DashboardState = { ...createDashboardState(config), pos: FAR };

  it("Grid Disable on a station sends that network's hunter, and only that one", () => {
    const choosing: DashboardState = { ...alone, mode: "targeting", purpose: "gridDisable", target: stationIndex };
    const cut = stepDashboard(choosing, ["activate"], DT, world).state;
    expect(Object.keys(cut.investigating).map(Number)).toEqual([hunterIndex]);
    const search = cut.investigating[hunterIndex];
    expect(Math.abs(search.x - station.col) + Math.abs(search.y - station.row)).toBe(1); // beside the station
    expect(search.until).toBeNull();
  });

  it("the hunter walks there, searches for a while, then goes home", () => {
    const sent = investigateOutage(alone, station, world);
    const search = sent.investigating[hunterIndex];
    const arrived = run(sent, 5); // a few cells away, so it is there well before its search ends
    expect(positionOf(arrived, hunterIndex, world)).toEqual({ x: search.x, y: search.y });
    expect(arrived.investigating[hunterIndex].until).not.toBeNull();
    const done = run(arrived, config.dashboard.hunterInvestigateSeconds + 15);
    expect(done.investigating[hunterIndex]).toBeUndefined();
    expect(positionOf(done, hunterIndex, world)).toEqual(post);
  });

  it("seeing the robot on the way ends the search and alerts it", () => {
    const sent = investigateOutage(alone, station, world);
    const search = sent.investigating[hunterIndex];
    const inTheWay = { ...sent, pos: { x: search.x, y: search.y } };
    const spotted = run(inTheWay, 4);
    expect(spotted.alerted).toContain(hunterIndex);
    expect(spotted.investigating[hunterIndex]).toBeUndefined();
  });

  it("an alerted hunter ignores the outage", () => {
    const chasing = { ...alone, alerted: [hunterIndex] };
    expect(investigateOutage(chasing, station, world).investigating).toEqual({});
  });

  it("a destroyed hunter is not sent", () => {
    const dead = { ...alone, ruins: [hunterIndex] };
    expect(investigateOutage(dead, station, world).investigating).toEqual({});
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
