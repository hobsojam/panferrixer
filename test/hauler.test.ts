import { describe, expect, it } from "vitest";
import { updateApp, type AppState } from "../src/app";
import { config } from "../src/config";
import {
  createDashboardState,
  fleeGoal,
  haulerMindOf,
  hunterInRange,
  nextDestination,
  moveHunters,
  positionOf,
  scareHaulers,
  stepDashboard,
  worldFor,
  type DashboardState,
  type World,
} from "../src/dashboard";
import { createInitialState } from "../src/flight";
import { generateWorld, inTown, isEnemyKind } from "../src/local-map";
import { cellKey, findRoute, reachableFrom } from "../src/route";
import { dashboardOf, MANY_WORLDS_TIMEOUT_MS, mapOf, platesWith } from "./helpers";

// Haulers (#67, #121, design-notes 4.10): defensive. They load at a power station or mine, carry
// the load to a dome in a neighbouring network, flee a threat, and leave their cargo where they are
// destroyed.
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

  it("every power station, mine and dome has a dock: a free open cell beside it the robot can reach", () => {
    for (const { map, towns, targets } of worlds) {
      const buildings = targets.filter((t) => !isEnemyKind(t.kind));
      const blocked = new Set(buildings.map((t) => cellKey(map, t.col, t.row)));
      const reached = reachableFrom(towns[0], map, blocked);
      const docked = buildings.filter((t) => ["power", "mine", "dome"].includes(t.kind));
      // Almost every one: only a building with no free side goes without.
      expect(docked.filter((t) => t.dock).length).toBeGreaterThan(docked.length * 0.9);
      const docks = docked.flatMap((t) => (t.dock ? [cellKey(map, t.dock.x, t.dock.y)] : []));
      expect(new Set(docks).size).toBe(docks.length);
      for (const t of docked) {
        if (!t.dock) continue;
        expect(Math.abs(t.dock.x - t.col) + Math.abs(t.dock.y - t.row)).toBe(1);
        expect(map.tiers[t.dock.y][t.dock.x]).not.toBe(2);
        expect(blocked.has(cellKey(map, t.dock.x, t.dock.y))).toBe(false);
        expect(reached.has(cellKey(map, t.dock.x, t.dock.y))).toBe(true); // a hauler can be chased there
      }
      expect(buildings.filter((t) => !["power", "mine", "dome"].includes(t.kind) && t.dock)).toEqual([]);
    }
  }, MANY_WORLDS_TIMEOUT_MS);

  it("a hauler starts at the dock of its own network's power station, about to load", () => {
    for (const { targets } of worlds) {
      targets.forEach((h, index) => {
        if (h.kind !== "hauler") return;
        const home = targets[h.home!];
        expect(home).toMatchObject({ kind: "power", network: h.network });
        expect(home.dock).toEqual({ x: h.col, y: h.row });
        expect(haulerMindOf(createDashboardState(config), index, { ...base, targets })).toMatchObject({ mode: "haul", loading: true, stop: h.home, town: h.network });
      });
    }
  });

  it("neighbours: every town has one, both ways round, and the walk between two passes through no third town", () => {
    const cfg = config.localMap;
    const outer = (t: { x: number; y: number }, c: { x: number; y: number }) =>
      inTown(t, cfg.townRadiusCols * cfg.wallReach, cfg.townRadiusRows * cfg.wallReach, c.x, c.y);
    for (const { map, towns, neighbours } of worlds) {
      neighbours.forEach((list, a) => {
        expect(list.length).toBeGreaterThan(0);
        expect(list).not.toContain(a);
        for (const b of list) {
          expect(neighbours[b]).toContain(a);
          const route = findRoute(towns[Math.min(a, b)], towns[Math.max(a, b)], map)!; // as generated: the lower town first
          const passes = route.some((c) => towns.some((t, i) => i !== a && i !== b && outer(t, c)));
          // Only the stand-in for a town with no clear neighbour may pass another town.
          if (passes) expect(neighbours[a].length === 1 || neighbours[b].length === 1).toBe(true);
        }
      });
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

// A flat field with a wall down the middle, open only at the bottom. Town 0 on the left, town 1 on
// the right, each with a power station and a dome; town 1 has a second dome further from town 0.
const walled = mapOf(Array.from({ length: 21 }, (_, y) => (y < 16 ? "1".repeat(20) + "2" + "1".repeat(19) : "1".repeat(40))));
const HAULER = 0;
const POWER_0 = { x: 10, y: 5 };
const DOME_0 = { x: 10, y: 8 };
const DOME_1 = { x: 30, y: 5 };
const POWER_1 = { x: 30, y: 8 };
const FAR_DOME_1 = { x: 30, y: 2 };
const world: World = {
  ...base,
  map: walled,
  towns: [
    { x: 10, y: 5 },
    { x: 30, y: 5 },
  ],
  neighbours: [[1], [0]],
  targets: [
    { col: 10, row: 5, kind: "hauler", supplies: ["energy"], network: 0, home: 1 },
    { col: 9, row: 5, kind: "power", supplies: [], network: 0, dock: POWER_0 },
    { col: 9, row: 8, kind: "dome", supplies: [], network: 0, dock: DOME_0 },
    { col: 31, row: 8, kind: "power", supplies: [], network: 1, dock: POWER_1 },
    { col: 31, row: 5, kind: "dome", supplies: [], network: 1, dock: DOME_1 },
    { col: 31, row: 2, kind: "dome", supplies: [], network: 1, dock: FAR_DOME_1 },
  ],
};
const DOCKS = [POWER_0, DOME_0, POWER_1, DOME_1, FAR_DOME_1];

function state(from: Partial<DashboardState> = {}): DashboardState {
  return { ...createDashboardState(config), pos: FAR, ...from };
}

function run(s: DashboardState, seconds: number, w: World = world): DashboardState {
  let next = s;
  for (let i = 0; i < Math.round(seconds / DT); i++) next = moveHunters({ ...next, time: next.time + DT }, w, DT);
  return next;
}

/** The docks a hauler stops at, in order, over `seconds`. */
function docksVisited(s: DashboardState, seconds: number, w: World = world): { x: number; y: number }[] {
  const visits: { x: number; y: number }[] = [];
  let next = s;
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    next = moveHunters({ ...next, time: next.time + DT }, w, DT);
    const p = positionOf(next, HAULER, w);
    expect(walled.tiers[Math.round(p.y)][Math.round(p.x)]).not.toBe(2);
    const dock = DOCKS.find((c) => c.x === p.x && c.y === p.y);
    const last = visits[visits.length - 1];
    if (dock && dock !== last) visits.push(dock);
  }
  return visits;
}

describe("hauling between networks", () => {
  it("loads at its power station, carries to a dome in the next network, loads there, and carries back, round the high ground", () => {
    expect(docksVisited(state(), 150).slice(0, 5)).toEqual([DOME_1, POWER_1, DOME_0, POWER_0, DOME_1]);
  });

  it("walks at its hauling speed", () => {
    const p = positionOf(run(state(), 1), HAULER, world);
    expect(Math.abs(p.x - 10) + Math.abs(p.y - 5)).toBeCloseTo(d.haulerSpeed, 1);
  });

  it("a dome destroyed on the way: it carries the load to another dome in the same network", () => {
    const loaded = run(state(), 5);
    expect(haulerMindOf(loaded, HAULER, world)).toMatchObject({ loading: false, town: 1, stop: 4 });
    expect(docksVisited({ ...loaded, ruins: [4] }, 60)[0]).toEqual(FAR_DOME_1);
  });

  it("with no dome left in any neighbour, it waits at its pickup", () => {
    const s = run(state({ ruins: [4, 5] }), 20);
    expect(positionOf(s, HAULER, world)).toEqual(POWER_0);
    expect(haulerMindOf(s, HAULER, world)).toMatchObject({ loading: true, stop: 1 });
  });

  it("its power station is never destroyed, but a pickup that is gives way to the nearest one left", () => {
    const withMine: World = { ...world, targets: [...world.targets, { col: 11, row: 2, kind: "mine", supplies: [], network: 0, dock: { x: 11, y: 3 } }] };
    const s = run(state({ haulers: { [HAULER]: { mode: "haul", stop: 6, loading: true, town: 0, from: 1, trip: 1, threat: null, goal: null, until: null } }, ruins: [6] }), 0.1, withMine);
    expect(haulerMindOf(s, HAULER, withMine)).toMatchObject({ loading: false, from: 0, town: 1 });
  });
});

describe("choosing where to carry a load", () => {
  // Town 1 sits between towns 0 and 2, each with a dome.
  const three: World = {
    ...base,
    map: mapOf(Array.from({ length: 5 }, () => "1".repeat(30))),
    towns: [
      { x: 2, y: 2 },
      { x: 15, y: 2 },
      { x: 28, y: 2 },
    ],
    neighbours: [[1], [0, 2], [1]],
    targets: [
      { col: 15, row: 2, kind: "hauler", supplies: [], network: 1, home: 1 },
      { col: 15, row: 1, kind: "power", supplies: [], network: 1, dock: { x: 15, y: 2 } },
      { col: 2, row: 1, kind: "dome", supplies: [], network: 0, dock: { x: 2, y: 2 } },
      { col: 28, row: 1, kind: "dome", supplies: [], network: 2, dock: { x: 28, y: 2 } },
    ],
  };
  const trips = Array.from({ length: 40 }, (_, trip) => trip);

  it("never carries straight back where its last load came from, while another neighbour will take it", () => {
    for (const trip of trips) {
      expect(nextDestination(state(), 0, 1, 0, trip, three)).toBe(2);
      expect(nextDestination(state(), 0, 1, 2, trip, three)).toBe(0);
    }
  });

  it("with a free choice, it goes each way on some trips: unpredictable to the player, but the same every run", () => {
    const chosen = trips.map((trip) => nextDestination(state(), 0, 1, null, trip, three));
    expect(new Set(chosen)).toEqual(new Set([0, 2]));
    expect(trips.map((trip) => nextDestination(state(), 0, 1, null, trip, three))).toEqual(chosen);
  });

  it("a network with no dome left takes no deliveries: it goes back if that is the only place, and nowhere if nothing is left", () => {
    expect(nextDestination(state({ ruins: [3] }), 0, 1, 0, 0, three)).toBe(0);
    expect(nextDestination(state({ ruins: [2, 3] }), 0, 1, 0, 0, three)).toBeNull();
  });
});

describe("in the real world", () => {
  const haulers = base.targets.map((t, i) => ({ t, i })).filter(({ t }) => t.kind === "hauler").map(({ i }) => i);

  it("haulers never set foot on high ground, and every load goes from a network to one of its neighbours", () => {
    let s = { ...createDashboardState(config), pos: FAR };
    const legs = new Set<string>();
    for (let i = 0; i < 120 / DT; i++) {
      s = moveHunters({ ...s, time: s.time + DT }, base, DT);
      for (const h of haulers) {
        const mind = haulerMindOf(s, h, base);
        if (!mind.loading && mind.from !== null) legs.add(`${mind.from}>${mind.town}`);
        if (i % 30 !== 0) continue;
        const p = positionOf(s, h, base);
        expect(base.map.tiers[Math.round(p.y)][Math.round(p.x)]).not.toBe(2);
      }
    }
    for (const leg of legs) {
      const [from, to] = leg.split(">").map(Number);
      expect(base.neighbours[from]).toContain(to);
    }
    // Within two minutes every hauler has delivered at least one load to another network.
    for (const h of haulers) expect(haulerMindOf(s, h, base).trip).toBeGreaterThanOrEqual(1);
  }, MANY_WORLDS_TIMEOUT_MS);
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

  it("keeps away for its flee time after the last threat, then carries on with its trip", () => {
    const scared = scareHaulers(state(), { x: 12, y: 5 }, 5, world);
    const before = run(scared, d.haulerFleeSeconds - 0.1);
    expect(haulerMindOf(before, HAULER, world).mode).toBe("flee");
    const after = run(before, 0.2);
    expect(haulerMindOf(after, HAULER, world)).toMatchObject({ mode: "haul", stop: haulerMindOf(scared, HAULER, world).stop });
    // Back to work: it reaches a dock again.
    expect(docksVisited(after, 60).length).toBeGreaterThan(0);
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

  it("a scan that does not reach it leaves it hauling", () => {
    const robot = { x: 10 + d.scanRadius + 1, y: 5 };
    const scanned = stepDashboard(state({ pos: robot, row: 0, col: 1 }), ["activate"], DT, world).state;
    expect(haulerMindOf(scanned, HAULER, world).mode).toBe("haul");
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
    expect(haulerMindOf(s.dashboard, hauler, base).mode).toBe("haul"); // it is not scared off by its own hit
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
