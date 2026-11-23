import { describe, expect, it } from "vitest";
import { createAppState, updateApp, type AppState } from "../src/app";
import { config } from "../src/config";
import {
  createDashboardState,
  disturbPatrollers,
  hunterInRange,
  isHidden,
  markRuin,
  mindOf,
  moveHunters,
  nearestHelper,
  positionOf,
  spendAttack,
  startPosition,
  stepDashboard,
  worldFor,
  type DashboardState,
  type World,
} from "../src/dashboard";
import { generateWorld, isEnemyKind, type Target } from "../src/local-map";
import { cellKey, findRoute, isPassable, reachableFrom } from "../src/route";
import { dashboardOf, mapOf } from "./helpers";

// Patrollers (#66, design-notes 4.10): a wide beat, investigation of disturbances, and a run
// to the nearest armed enemy for help on seeing the robot. Lightly armed once fighting.
const DT = 1 / 60;
const base = worldFor(config);
const FAR = { x: 39, y: 0 }; // a robot nobody can see

const flat = mapOf(Array(21).fill("1".repeat(40)));

function target(col: number, row: number, kind: Target["kind"], extra: Partial<Target> = {}): Target {
  return { col, row, kind, supplies: [], network: 0, ...extra };
}

const BEAT = [
  { x: 5, y: 5 },
  { x: 15, y: 5 },
  { x: 15, y: 15 },
  { x: 5, y: 15 },
];
const PATROLLER = 0;
const HUNTER = 1;
const DOME = 2;
const DEFENDER = 3;
const targets: Target[] = [
  target(5, 5, "patroller", { beat: BEAT }),
  target(34, 10, "hunter"),
  target(14, 12, "dome"),
  target(14, 13, "defender", { home: DOME }),
];
const world: World = { ...base, map: flat, towns: [], targets };

function state(from: Partial<DashboardState> = {}): DashboardState {
  return { ...createDashboardState(config), pos: FAR, ...from };
}

/** Steps the enemies for `seconds`, with the robot standing still. */
function run(s: DashboardState, seconds: number, w: World = world): DashboardState {
  let next = s;
  for (let i = 0; i < Math.round(seconds / DT); i++) next = moveHunters({ ...next, time: next.time + DT }, w, DT);
  return next;
}

/** Steps until `done` holds, or fails after `limit` seconds. */
function runUntil(s: DashboardState, done: (s: DashboardState) => boolean, limit = 60, w: World = world): DashboardState {
  let next = s;
  for (let i = 0; i < limit / DT; i++) {
    if (done(next)) return next;
    next = moveHunters({ ...next, time: next.time + DT }, w, DT);
  }
  throw new Error("condition never held");
}

const at = (s: DashboardState, p: { x: number; y: number }) => {
  const here = positionOf(s, PATROLLER, world);
  return here.x === p.x && here.y === p.y;
};

describe("placing the patrollers", () => {
  it("each segment of the map gets its patrollers, each with a loop of open ground inside the segment", () => {
    for (let seed = 1; seed <= 10; seed++) {
      const cfg = { ...config.localMap, worldSeed: seed };
      const { map, towns, targets: placed } = generateWorld(cfg);
      const patrollers = placed.filter((t) => t.kind === "patroller");
      const segments = cfg.patrolSegmentsAcross * cfg.patrolSegmentsDown;
      expect(patrollers.length, `seed ${seed}`).toBeGreaterThan(segments); // almost every segment gets its full share
      expect(patrollers.length).toBeLessThanOrEqual(segments * cfg.patrollersPerSegment);
      const reached = reachableFrom(towns[0], map);
      const buildings = new Set(placed.filter((t) => !isEnemyKind(t.kind)).map((t) => cellKey(map, t.col, t.row)));
      for (const p of patrollers) {
        const beat = p.beat!;
        expect(beat.length).toBeGreaterThanOrEqual(2);
        expect(beat.length).toBeLessThanOrEqual(cfg.patrolBeatPoints);
        expect({ x: p.col, y: p.row }).toEqual(beat[0]);
        const segW = map.cols / cfg.patrolSegmentsAcross;
        const segH = map.rows / cfg.patrolSegmentsDown;
        // Segment s covers cells floor(s * size) up to floor((s + 1) * size) - 1, as placement draws them.
        const index = (v: number, size: number) => Math.floor((v + 1) / size - 1e-9);
        const seg = (c: { x: number; y: number }) => `${index(c.x, segW)},${index(c.y, segH)}`;
        for (const c of beat) {
          expect(seg(c)).toBe(seg(beat[0]));
          expect(isPassable(map, c.x, c.y)).toBe(true);
          expect(reached.has(cellKey(map, c.x, c.y))).toBe(true);
          expect(buildings.has(cellKey(map, c.x, c.y))).toBe(false);
          for (const d of beat) if (d !== c) expect(Math.hypot(c.x - d.x, c.y - d.y)).toBeGreaterThanOrEqual(cfg.patrolBeatSpacing);
        }
      }
    }
  });

  it("is the same every time for the same seed", () => {
    expect(generateWorld(config.localMap).targets).toEqual(generateWorld(config.localMap).targets);
  });

  it("the robot starts off every beat, out of a patroller's sight", () => {
    const start = startPosition(base, config);
    const reach = config.dashboard.patrollerSightCells + config.dashboard.startClearanceCells;
    for (const p of base.targets.filter((t) => t.kind === "patroller")) {
      const beat = p.beat!;
      beat.forEach((from, i) => {
        for (const c of findRoute(from, beat[(i + 1) % beat.length], base.map) ?? []) {
          expect(Math.hypot(c.x - start.x, c.y - start.y)).toBeGreaterThan(reach);
        }
      });
    }
  });

  it("the game does not open with a patroller finding the robot", () => {
    let s: AppState = createAppState(config);
    for (let i = 0; i < 20 / DT; i++) s = updateApp(s, { actions: [], steering: 0 }, DT, config, () => 1);
    expect(s.screen).toBe("dashboard");
    expect(dashboardOf(s).helpCalls).toEqual([]);
  });
});

describe("the beat", () => {
  it("walks its loop in order while calm, and goes round again", () => {
    let s = state();
    for (const next of [...BEAT.slice(1), BEAT[0], BEAT[1]]) {
      s = runUntil(s, (x) => at(x, next));
    }
    expect(mindOf(s, PATROLLER, world).mode).toBe("beat");
    expect(s.alerted).toEqual([]);
  });

  it("walks at its configured speed", () => {
    const s = run(state(), 1);
    expect(positionOf(s, PATROLLER, world).x).toBeCloseTo(5 + config.dashboard.patrollerSpeed, 5);
  });

  it("goes round high ground rather than through it", () => {
    // A wall between the first two waypoints, with a gap at the bottom.
    const rows = Array(21).fill("1".repeat(40)).map((r: string, y: number) => (y < 12 ? r.slice(0, 10) + "2" + r.slice(11) : r));
    const walled: World = { ...world, map: mapOf(rows) };
    let s = state();
    for (let i = 0; i < 30 / DT && !at(s, BEAT[1]); i++) {
      s = moveHunters({ ...s, time: s.time + DT }, walled, DT);
      const p = positionOf(s, PATROLLER, walled);
      expect(walled.map.tiers[Math.round(p.y)][Math.round(p.x)]).not.toBe(2);
    }
    expect(at(s, BEAT[1])).toBe(true);
  });
});

describe("investigating a disturbance", () => {
  it("goes to look, searches a while, then goes back to its beat", () => {
    const spot = { x: 10, y: 10 };
    let s = disturbPatrollers(state(), spot, config.dashboard.patrollerHearingCells, world);
    expect(mindOf(s, PATROLLER, world).mode).toBe("investigate");
    s = runUntil(s, (x) => at(x, spot));
    const arrived = s.time;
    s = run(s, config.dashboard.patrollerSearchSeconds - 0.5);
    expect(at(s, spot)).toBe(true); // still searching
    s = runUntil(s, (x) => mindOf(x, PATROLLER, world).mode === "beat");
    expect(s.time - arrived).toBeGreaterThanOrEqual(config.dashboard.patrollerSearchSeconds);
    s = run(s, 2);
    expect(at(s, spot)).toBe(false); // back on its way
  });

  it("does not hear a disturbance beyond its hearing", () => {
    const s = disturbPatrollers(state(), { x: 5, y: 5 + config.dashboard.patrollerHearingCells + 1 }, config.dashboard.patrollerHearingCells, world);
    expect(mindOf(s, PATROLLER, world).mode).toBe("beat");
  });

  it("looks from beside a building, never on it", () => {
    const withDome: World = { ...world, targets: [...targets, target(9, 5, "dome")] };
    let s = disturbPatrollers(state(), { x: 9, y: 5 }, 15, withDome);
    const look = mindOf(s, PATROLLER, withDome).look!;
    expect(look).not.toEqual({ x: 9, y: 5 });
    expect(Math.abs(look.x - 9) + Math.abs(look.y - 5)).toBe(1);
    s = runUntil(s, (x) => at(x, look), 30, withDome);
    expect(at(s, look)).toBe(true);
  });

  it("a scan whose ring reaches it draws it to where the robot scanned from", () => {
    const robot = { x: 14, y: 5 };
    // Out of sight, inside the ring.
    const s0 = state({ pos: robot, hunterPos: { [PATROLLER]: { x: 5, y: 12 } } });
    const scanned = stepDashboard({ ...s0, row: 0, col: 1 }, ["activate"], DT, world).state;
    expect(mindOf(scanned, PATROLLER, world)).toMatchObject({ mode: "investigate", look: robot });
  });

  it("a power cut within earshot draws it to the station", () => {
    const withStation: World = { ...world, targets: [...targets, target(12, 8, "power")] };
    const station = withStation.targets.length - 1;
    const s0 = state({ pos: { x: 12, y: 4 }, row: 1, col: 1 });
    // Open Grid Disable, bring the cross down to the station, then confirm.
    const opened = stepDashboard(s0, ["activate", "down", "down", "down", "down"], DT, withStation).state;
    expect(opened.target).toBe(station);
    const cut = stepDashboard(opened, ["activate"], DT, withStation).state;
    const mind = mindOf(cut, PATROLLER, withStation);
    expect(mind.mode).toBe("investigate");
    expect(Math.abs(mind.look!.x - 12) + Math.abs(mind.look!.y - 8)).toBe(1);
  });
});

describe("seeing the robot: running for help", () => {
  const seen = () => state({ pos: { x: 5 + config.dashboard.patrollerSightCells - 0.5, y: 5 } });

  it("does not behave like a hunter: it runs to the nearest armed enemy, not at the robot", () => {
    const s = run(seen(), 0.5);
    const mind = mindOf(s, PATROLLER, world);
    expect(mind.mode).toBe("fetch");
    expect(mind.helper).toBe(DEFENDER); // the defender's door at (14, 13) is nearer than the hunter at (34, 10)
    expect(s.alerted).not.toContain(PATROLLER);
    expect(hunterInRange({ ...s, breatherUntil: 0 }, world, 100)).toBeNull(); // it does not attack while running
  });

  it("runs at its run speed", () => {
    const s = run(seen(), 1);
    const p = positionOf(s, PATROLLER, world);
    const moved = Math.abs(p.x - 5) + Math.abs(p.y - 5);
    expect(moved).toBeCloseTo(config.dashboard.patrollerRunSpeed, 1);
  });

  it("on arrival raises help: the helper is alerted, a sleeping defender comes out, and the call is recorded", () => {
    const s = runUntil(seen(), (x) => x.helpCalls.length > 0);
    expect(s.helpCalls).toEqual([{ patroller: PATROLLER, helper: DEFENDER, time: expect.any(Number) }]);
    expect(isHidden(s, DEFENDER, world)).toBe(false);
    expect(s.alerted).toContain(DEFENDER);
    // And it turns to fight alongside.
    expect(s.alerted).toContain(PATROLLER);
  });

  it("does not fetch an enemy that would not fight where the robot was seen", () => {
    // Seen far from the defender's dome, beyond its guard area: only the hunter will come.
    const s = state({ pos: { x: 5, y: 5 } });
    expect(nearestHelper(s, PATROLLER, world, { x: 30, y: 2 })).toBe(HUNTER);
  });

  it("fetches a hunter only for a robot in its network or within missile range of its edge (#91)", () => {
    // The hunter's network is the town round (34, 10): its area runs from column 27 to 41.
    const guarded: World = { ...world, towns: [{ x: 34, y: 10 }], targets: [targets[0], targets[1]] };
    const s = state({ pos: { x: 5, y: 5 } });
    expect(nearestHelper(s, PATROLLER, guarded, { x: 34, y: 10 })).toBe(1); // in the network
    expect(nearestHelper(s, PATROLLER, guarded, { x: 22, y: 10 })).toBe(1); // 5 cells beyond the edge: in range
    expect(nearestHelper(s, PATROLLER, guarded, { x: 20, y: 10 })).toBeNull(); // 7 cells beyond: it would not come
    expect(nearestHelper(s, PATROLLER, guarded, { x: 0, y: 0 })).toBeNull();
  });

  it("does not fetch an enemy that is already alerted, destroyed or rearming", () => {
    const s = seen();
    expect(nearestHelper({ ...s, alerted: [DEFENDER] }, PATROLLER, world)).toBe(HUNTER);
    expect(nearestHelper(markRuin(s, DEFENDER), PATROLLER, world)).toBe(HUNTER);
    expect(nearestHelper({ ...s, rearming: { [DEFENDER]: { x: 0, y: 0, dome: 0, until: null } } }, PATROLLER, world)).toBe(HUNTER);
    // Another patroller is not armed help.
    const twoPatrollers: World = { ...world, targets: [targets[0], target(6, 5, "patroller", { beat: BEAT })] };
    expect(nearestHelper(s, PATROLLER, twoPatrollers)).toBeNull();
  });

  it("chooses again if its helper is destroyed on the way", () => {
    let s = run(seen(), 0.5);
    s = run(markRuin(s, DEFENDER), 0.1);
    expect(mindOf(s, PATROLLER, world).helper).toBe(HUNTER);
    s = runUntil(s, (x) => x.helpCalls.length > 0);
    expect(s.helpCalls[0].helper).toBe(HUNTER);
    expect(s.alerted).toContain(HUNTER);
  });

  it("with nobody left to fetch, it fights at once", () => {
    const alone: World = { ...world, targets: [targets[0]] };
    const s = run(state({ pos: { x: 8, y: 5 } }), DT, alone);
    expect(s.alerted).toContain(PATROLLER);
    expect(s.helpCalls).toEqual([]);
  });

  it("killing it before it gets there means no help comes", () => {
    let s = run(seen(), 1);
    s = run(markRuin(s, PATROLLER), 30);
    expect(s.helpCalls).toEqual([]);
    expect(isHidden(s, DEFENDER, world)).toBe(true);
    // A destroyed patroller stays where it fell and does nothing.
    const fell = positionOf(s, PATROLLER, world);
    expect(positionOf(run(s, 5), PATROLLER, world)).toEqual(fell);
  });
});

describe("lightly armed", () => {
  const alone: World = { ...world, targets: [targets[0]] };

  it("once fighting, it attacks when in range and ready", () => {
    let s = run(state({ pos: { x: 8, y: 5 } }), DT, alone);
    s = run(s, config.dashboard.hunterFirstAttackDelayMax + 0.1, alone);
    expect(hunterInRange(s, alone, config.dashboard.hunterEngageRange)).toBe(PATROLLER);
  });

  it("its attack is a single volley, lighter than a hunter's", () => {
    // Put a fighting patroller next to the robot at the start of a real game, and step once.
    const app = createAppState(config);
    const d = dashboardOf(app);
    const index = base.targets.findIndex((t) => t.kind === "patroller");
    const ready: DashboardState = {
      ...d,
      alerted: [index],
      hunterPos: { [index]: { x: d.pos.x + 2, y: d.pos.y } },
      patrollers: { [index]: { mode: "beat", leg: 1, look: null, lookUntil: null, helper: null, seen: null, anchor: { x: d.pos.x + 2, y: d.pos.y } } },
    };
    const next = updateApp({ screen: "dashboard", dashboard: ready }, { actions: [], steering: 0 }, DT, config, () => 1);
    expect(next.screen).toBe("defence");
    if (next.screen !== "defence") return;
    expect(next.attacker).toBe(index);
    expect(next.defence.missiles.length).toBeLessThanOrEqual(config.defence.volleyMax * config.dashboard.patrollerVolleys);
  });

  it("uses its own magazine, then withdraws to rearm", () => {
    let s = state({ alerted: [PATROLLER] });
    for (let i = 1; i < config.dashboard.patrollerMagazineAttacks; i++) s = spendAttack(s, PATROLLER, world);
    expect(s.rearming[PATROLLER]).toBeUndefined();
    s = spendAttack(s, PATROLLER, world);
    expect(s.rearming[PATROLLER]).toBeDefined();
    expect(s.alerted).not.toContain(PATROLLER);
  });

  it("breaks off past its leash and goes back to its beat", () => {
    let s = run(state({ pos: { x: 8, y: 5 } }), DT, alone);
    expect(s.alerted).toContain(PATROLLER);
    // The robot walks away; the patroller follows until its leash runs out.
    s = { ...s, pos: { x: 39, y: 20 } };
    const anchor = mindOf(s, PATROLLER, alone).anchor!;
    s = runUntil(s, (x) => !x.alerted.includes(PATROLLER), 60, alone);
    const p = positionOf(s, PATROLLER, alone);
    const strayed = Math.hypot(p.x - anchor.x, p.y - anchor.y);
    // It gives up the moment it passes its leash, and starts back on the same step.
    expect(Math.abs(strayed - config.dashboard.patrollerLeashCells)).toBeLessThan(0.1);
    s = runUntil(s, (x) => BEAT.some((b) => at(x, b)), 60, alone);
    expect(mindOf(s, PATROLLER, alone).mode).toBe("beat");
  });
});
