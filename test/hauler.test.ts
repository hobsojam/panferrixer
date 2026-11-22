import { describe, expect, it } from "vitest";
import { updateApp, type AppState } from "../src/app";
import { config } from "../src/config";
import {
  createDashboardState,
  fleeGoal,
  haulerMindOf,
  hunterInRange,
  moveHunters,
  positionOf,
  scareHaulers,
  stepDashboard,
  worldFor,
  type DashboardState,
  type World,
} from "../src/dashboard";
import { createInitialState } from "../src/flight";
import { generateWorld, isEnemyKind, type Target } from "../src/local-map";
import { cellKey, reachableFrom } from "../src/route";
import { dashboardOf, MANY_WORLDS_TIMEOUT_MS, mapOf, platesWith } from "./helpers";

// Haulers (#67, design-notes 4.10): defensive. They carry cargo round their network's power
// station, mines and domes, flee a threat, and leave their cargo where they are destroyed.
const DT = 1 / 60;
const base = worldFor(config);
const FAR = { x: 1000, y: 1000 }; // a robot nobody can see
const d = config.dashboard;

describe("placement", () => {
  const worlds = [1, 2, 3, 4, 5, 6].map((worldSeed) => generateWorld({ ...config.localMap, worldSeed }));

  it("every network of the default world has its haulers", () => {
    const { towns, targets } = generateWorld(config.localMap);
    for (let network = 0; network < towns.length; network++) {
      expect(targets.filter((t) => t.kind === "hauler" && t.network === network)).toHaveLength(config.localMap.haulersPerTown);
    }
  });

  it("a route runs between open cells beside its network's power station, mines and domes, and starts at its first stop", () => {
    for (const { map, towns, targets } of worlds) {
      const buildings = targets.filter((t) => !isEnemyKind(t.kind));
      const blocked = new Set(buildings.map((t) => cellKey(map, t.col, t.row)));
      const reached = reachableFrom(towns[0], map, blocked);
      for (const h of targets.filter((t) => t.kind === "hauler")) {
        const route = h.beat!;
        expect(route.length).toBeGreaterThanOrEqual(2);
        expect(route[0]).toEqual({ x: h.col, y: h.row });
        expect(new Set(route.map((c) => cellKey(map, c.x, c.y))).size).toBe(route.length);
        const served = (kind: Target["kind"]) =>
          buildings.filter((b) => b.kind === kind && b.network === h.network && route.some((c) => Math.abs(c.x - b.col) + Math.abs(c.y - b.row) === 1));
        expect(served("power")).toHaveLength(1);
        for (const c of route) {
          expect(map.tiers[c.y][c.x]).not.toBe(2);
          expect(blocked.has(cellKey(map, c.x, c.y))).toBe(false);
          expect(reached.has(cellKey(map, c.x, c.y))).toBe(true); // the robot can follow it
          const beside = buildings.filter((b) => b.network === h.network && ["power", "mine", "dome"].includes(b.kind) && Math.abs(c.x - b.col) + Math.abs(c.y - b.row) === 1);
          expect(beside.length).toBeGreaterThan(0);
        }
      }
    }
  }, MANY_WORLDS_TIMEOUT_MS);

  it("no hauler starts on another target's cell", () => {
    for (const { map, targets } of worlds) {
      const cells = targets.map((t) => cellKey(map, t.col, t.row));
      expect(new Set(cells).size).toBe(cells.length);
    }
  });

  it("carries cargo: at least one power pod, never missiles, and is never hardened", () => {
    for (const { targets } of worlds) {
      for (const h of targets.filter((t) => t.kind === "hauler")) {
        expect(h.supplies.filter((s) => s === "energy").length).toBeGreaterThanOrEqual(1);
        expect(h.supplies).not.toContain("missiles");
        expect(h.defences).toBeUndefined();
      }
    }
  });
});

// A flat field with a wall down the middle, open only at the bottom.
const walled = mapOf(Array.from({ length: 21 }, (_, y) => (y < 16 ? "1".repeat(20) + "2" + "1".repeat(19) : "1".repeat(40))));
const ROUTE = [
  { x: 10, y: 5 },
  { x: 30, y: 5 },
];
const HAULER = 0;
const world: World = { ...base, map: walled, towns: [], targets: [{ col: 10, row: 5, kind: "hauler", supplies: ["energy"], network: 0, beat: ROUTE }] };

function state(from: Partial<DashboardState> = {}): DashboardState {
  return { ...createDashboardState(config), pos: FAR, ...from };
}

function run(s: DashboardState, seconds: number, w: World = world): DashboardState {
  let next = s;
  for (let i = 0; i < Math.round(seconds / DT); i++) next = moveHunters({ ...next, time: next.time + DT }, w, DT);
  return next;
}

describe("on its route", () => {
  it("walks its stops in order, again and again, round the high ground", () => {
    let s = state();
    const visits: number[] = [];
    for (let i = 0; i < 120 / DT; i++) {
      s = moveHunters({ ...s, time: s.time + DT }, world, DT);
      const p = positionOf(s, HAULER, world);
      expect(walled.tiers[Math.round(p.y)][Math.round(p.x)]).not.toBe(2);
      const stop = ROUTE.findIndex((c) => c.x === p.x && c.y === p.y);
      if (stop !== -1 && visits[visits.length - 1] !== stop) visits.push(stop);
    }
    expect(visits.slice(0, 4)).toEqual([1, 0, 1, 0]);
  });

  it("walks at its route speed", () => {
    const p = positionOf(run(state(), 1), HAULER, world);
    expect(Math.abs(p.x - 10) + Math.abs(p.y - 5)).toBeCloseTo(d.haulerSpeed, 1);
  });

  it("the haulers of the real world never set foot on high ground", () => {
    let s = { ...createDashboardState(config), pos: FAR };
    const haulers = base.targets.map((t, i) => ({ t, i })).filter(({ t }) => t.kind === "hauler").map(({ i }) => i);
    for (let i = 0; i < 60 / DT; i++) {
      s = moveHunters({ ...s, time: s.time + DT }, base, DT);
      if (i % 30 !== 0) continue;
      for (const h of haulers) {
        const p = positionOf(s, h, base);
        expect(base.map.tiers[Math.round(p.y)][Math.round(p.x)]).not.toBe(2);
      }
    }
  });
});

describe("fleeing", () => {
  const seen = () => state({ pos: { x: 10 + d.haulerSightCells - 0.5, y: 5 } });

  it("seeing the robot, it flees away from it, without attacking or calling anyone", () => {
    const s = run(seen(), 2);
    expect(haulerMindOf(s, HAULER, world).mode).toBe("flee");
    const p = positionOf(s, HAULER, world);
    expect(Math.hypot(p.x - s.pos.x, p.y - s.pos.y)).toBeGreaterThan(d.haulerSightCells);
    expect(s.alerted).toEqual([]);
    expect(s.helpCalls).toEqual([]);
    expect(hunterInRange({ ...s, breatherUntil: 0 }, world, 100)).toBeNull();
  });

  it("flees at its flee speed, faster than it hauls and slower than the robot walks", () => {
    const p = positionOf(run(seen(), 1), HAULER, world);
    expect(Math.abs(p.x - 10) + Math.abs(p.y - 5)).toBeCloseTo(d.haulerFleeSpeed, 1);
    expect(d.haulerFleeSpeed).toBeGreaterThan(d.haulerSpeed);
    expect(d.haulerFleeSpeed).toBeLessThan(d.walkSpeed);
  });

  it("keeps away for its flee time after the last threat, then goes back to its route", () => {
    const scared = scareHaulers(state(), { x: 12, y: 5 }, 5, world);
    const before = run(scared, d.haulerFleeSeconds - 0.1);
    expect(haulerMindOf(before, HAULER, world).mode).toBe("flee");
    const after = run(before, 0.2);
    expect(haulerMindOf(after, HAULER, world).mode).toBe("route");
    // Back to work: it reaches a stop on its route again.
    let s = after;
    for (let i = 0; i < 60 / DT; i++) {
      s = run(s, DT);
      const p = positionOf(s, HAULER, world);
      if (ROUTE.some((c) => c.x === p.x && c.y === p.y)) return;
    }
    throw new Error("never got back to its route");
  });

  it("a fresh threat while fleeing extends its time, never shortens it", () => {
    const first = scareHaulers(state(), { x: 12, y: 5 }, 5, world);
    const later = scareHaulers({ ...run(first, 3) }, { x: 12, y: 5 }, 50, world);
    expect(haulerMindOf(later, HAULER, world).until).toBeCloseTo(later.time + d.haulerFleeSeconds, 5);
    const early = scareHaulers({ ...later, time: later.time - 5 }, { x: 12, y: 5 }, 50, world);
    expect(haulerMindOf(early, HAULER, world).until).toBe(haulerMindOf(later, HAULER, world).until);
  });

  it("its flight never takes it nearer the threat, and a cornered hauler stays put", () => {
    for (const threat of [{ x: 12, y: 5 }, { x: 8, y: 5 }, { x: 10, y: 8 }]) {
      const here = { x: 10, y: 5 };
      const goal = fleeGoal(state(), here, threat, world);
      expect(Math.hypot(goal.x - threat.x, goal.y - threat.y)).toBeGreaterThan(Math.hypot(here.x - threat.x, here.y - threat.y));
      expect(walled.tiers[goal.y][goal.x]).not.toBe(2);
    }
    // A dead end: ground only to the threat's side.
    const pocket = mapOf(["222", "212", "212"]);
    const cornered: World = { ...world, map: pocket };
    expect(fleeGoal(state(), { x: 1, y: 1 }, { x: 1, y: 2 }, cornered)).toEqual({ x: 1, y: 1 });
  });

  it("a scan whose ring reaches it scares it away from where the robot scanned", () => {
    const robot = { x: 10 + d.scanRadius - 1, y: 5 }; // out of sight, inside the ring
    const scanned = stepDashboard(state({ pos: robot, row: 0, col: 1 }), ["activate"], DT, world).state;
    expect(haulerMindOf(scanned, HAULER, world)).toMatchObject({ mode: "flee", threat: robot });
  });

  it("a scan that does not reach it leaves it on its route", () => {
    const robot = { x: 10 + d.scanRadius + 1, y: 5 };
    const scanned = stepDashboard(state({ pos: robot, row: 0, col: 1 }), ["activate"], DT, world).state;
    expect(haulerMindOf(scanned, HAULER, world).mode).toBe("route");
  });
});

describe("a missile hit, in the app", () => {
  const seeds = () => 1;
  const hauler = base.targets.findIndex((t) => t.kind === "hauler");
  const h = base.targets[hauler];

  function landing(targetIndex: number, dashboard: DashboardState): AppState {
    const start = createInitialState(1, config);
    const flight = { ...start, phase: "terminal" as const, x: 0, depth: start.totalDistance - 0.001, nextBandIndex: start.terrain.bands.length };
    return { screen: "flight", dashboard, flight, target: base.targets[targetIndex], targetIndex, shielded: false };
  }

  it("a hit within earshot scares it", () => {
    const dome = base.targets.findIndex((t) => t.kind === "dome" && t.network === h.network);
    expect(Math.hypot(base.targets[dome].col - h.col, base.targets[dome].row - h.row)).toBeLessThanOrEqual(d.haulerHearingCells);
    const next = updateApp(landing(dome, { ...createDashboardState(config), pos: FAR }), { actions: [], steering: 0 }, DT, config, seeds);
    expect(haulerMindOf(dashboardOf(next), hauler, base).mode).toBe("flee");
  });

  it("one hit destroys it where it was struck, and its cargo lies there to be found and collected", () => {
    const near = { x: h.col + 0.5, y: h.row };
    let s: AppState = updateApp(landing(hauler, { ...createDashboardState(config), pos: FAR, hunterPos: { [hauler]: near } }), { actions: [], steering: 0 }, DT, config, seeds);
    if (s.screen !== "flight") throw new Error("expected flight");
    expect(s.flight.phase).toBe("hit");
    expect(s.dashboard.ruins).toContain(hauler);
    const struckAt = positionOf(s.dashboard, hauler, base);
    expect(Math.hypot(struckAt.x - near.x, struckAt.y - near.y)).toBeLessThan(0.1);
    expect(haulerMindOf(s.dashboard, hauler, base).mode).toBe("route"); // it is not scared off by its own hit
    // The result shows for a while: the wreck does not move.
    for (let i = 0; i < 3 / DT; i++) s = updateApp(s, { actions: [], steering: 0 }, DT, config, seeds);
    s = updateApp(s, { actions: ["activate"], steering: 0 }, DT, config, seeds);
    const back = dashboardOf(s);
    expect(s.screen).toBe("dashboard");
    expect(positionOf(back, hauler, base)).toEqual(struckAt);

    // A scan from nearby marks the wreck.
    const nearby = { ...back, pos: { x: struckAt.x, y: struckAt.y + 2 }, row: 0, col: 1 };
    const scanned = stepDashboard(nearby, ["activate"], DT, base).state;
    expect(scanned.scan!.blips).toContain(hauler);

    // Walking onto it collects its cargo.
    const onIt = { ...back, pos: struckAt, energyCells: 2, plates: platesWith(4) };
    const collected = stepDashboard(onIt, [], DT, base).state;
    expect(collected.found.filter((f) => f.target === hauler).map((f) => f.supply).sort()).toEqual([...h.supplies].sort());
  });
});
