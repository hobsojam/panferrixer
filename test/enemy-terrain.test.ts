import { describe, expect, it } from "vitest";
import { config } from "../src/config";
import { createDashboardState, moveHunters, positionOf, spendAttack, worldFor, type DashboardState, type World, isDisarmed } from "../src/dashboard";
import { reachableGoal, stepToward } from "../src/enemy-move";
import { generateWorld, type LocalMap, type Target } from "../src/local-map";
import { cellKey, reachableFrom } from "../src/route";
import { MANY_WORLDS_TIMEOUT_MS, mapOf } from "./helpers";

const DT = 1 / 60;
const base = worldFor(config);

/** A wall of high ground down column 7, open at the bottom row. */
const gapped = mapOf([
  "111111121111111",
  "111111121111111",
  "111111121111111",
  "111111121111111",
  "111111121111111",
  "111111121111111",
  "111111111111111",
]);

/** The same wall, sealed from top to bottom. */
const sealed = mapOf(Array(7).fill("111111121111111"));

function onHighGround(map: LocalMap, p: { x: number; y: number }): boolean {
  return map.tiers[Math.round(p.y)][Math.round(p.x)] === 2;
}

function hunterAt(col: number, row: number): Target {
  return { col, row, kind: "hunter", supplies: [], network: 0 };
}

function worldOn(map: LocalMap, targets: Target[]): World {
  return { ...base, map, towns: [], targets };
}

/** Steps the hunters for `seconds`, failing if any of them ever stands on high ground. */
function run(s: DashboardState, world: World, seconds: number): DashboardState {
  let state = s;
  for (let i = 0; i < seconds / DT; i++) {
    state = moveHunters(state, world, DT);
    world.targets.forEach((t, index) => {
      if (t.kind === "hunter") expect(onHighGround(world.map, positionOf(state, index, world))).toBe(false);
    });
  }
  return state;
}

describe("shared enemy movement over terrain", () => {
  it("routes around high ground to reach its goal", () => {
    let p = { x: 2, y: 1 };
    for (let i = 0; i < 200; i++) {
      p = stepToward(p, { x: 12, y: 1 }, gapped, 0.25);
      expect(onHighGround(gapped, p)).toBe(false);
    }
    expect(p).toEqual({ x: 12, y: 1 });
  });

  it("goes to the nearest cell it can reach when the goal is across the high ground", () => {
    expect(reachableGoal({ x: 2, y: 1 }, { x: 12, y: 1 }, sealed)).toEqual({ x: 6, y: 1 });
  });

  it("treats a goal on the high ground itself as unreachable", () => {
    expect(reachableGoal({ x: 2, y: 4 }, { x: 7, y: 4 }, sealed)).toEqual({ x: 6, y: 4 });
  });

  it("waits at the edge without tunnelling, jittering or getting stuck", () => {
    let p = { x: 2, y: 1 };
    for (let i = 0; i < 200; i++) p = stepToward(p, { x: 12, y: 1 }, sealed, 0.25);
    expect(p).toEqual({ x: 6, y: 1 });
    // Further steps toward the same unreachable goal leave it exactly where it is.
    expect(stepToward(p, { x: 12, y: 1 }, sealed, 0.25)).toEqual(p);
  });

  it("is deterministic: the same steps give the same path", () => {
    const walk = () => {
      const path: { x: number; y: number }[] = [];
      let p = { x: 2.3, y: 0.6 };
      for (let i = 0; i < 80; i++) path.push((p = stepToward(p, { x: 12, y: 3 }, gapped, 0.3)));
      return path;
    };
    expect(walk()).toEqual(walk());
  });

  it("finishes the last fraction of a cell rather than snapping onto it", () => {
    const p = stepToward({ x: 5.4, y: 1 }, { x: 5, y: 1 }, sealed, 0.1);
    expect(p.x).toBeCloseTo(5.3);
  });
});

describe("hunters and high ground", () => {
  const robot = { x: 12, y: 1 };

  it("an alerted hunter goes round a high-ground wall to reach its preferred range", () => {
    const world = worldOn(gapped, [hunterAt(2, 1)]);
    const s: DashboardState = { ...createDashboardState(config), pos: robot, alerted: [0] };
    const later = run(s, world, 15);
    const p = positionOf(later, 0, world);
    expect(p.x).toBeGreaterThan(7); // through the gap
    expect(Math.hypot(p.x - robot.x, p.y - robot.y)).toBeLessThanOrEqual(config.dashboard.hunterHoldCells);
  });

  it("an alerted hunter that cannot reach the robot waits at the edge and stays alerted", () => {
    const world = worldOn(sealed, [hunterAt(2, 1)]);
    const s: DashboardState = { ...createDashboardState(config), pos: robot, alerted: [0] };
    const later = run(s, world, 10);
    expect(positionOf(later, 0, world)).toEqual({ x: 6, y: 1 });
    expect(later.alerted).toContain(0);
  });

  it("walks home around the high ground once it is no longer alerted", () => {
    const world = worldOn(gapped, [hunterAt(2, 1)]);
    // The robot is far out of sight, so the hunter is not drawn back to it.
    const s: DashboardState = { ...createDashboardState(config), pos: { x: 100, y: 100 }, hunterPos: { 0: { x: 9, y: 1 } } };
    const later = run(s, world, 15);
    expect(positionOf(later, 0, world)).toEqual({ x: 2, y: 1 });
  });

  it("rearms at a dome it can walk to, passing over a nearer one cut off by high ground", () => {
    const nearDome: Target = { col: 9, row: 1, kind: "dome", supplies: [], network: 0 };
    const farDome: Target = { col: 1, row: 5, kind: "dome", supplies: [], network: 0 };
    const world = worldOn(sealed, [hunterAt(5, 1), nearDome, farDome]);
    const s: DashboardState = { ...createDashboardState(config), alerted: [0], attacksUsed: { 0: config.dashboard.hunterMagazineAttacks - 1 } };
    const spent = spendAttack(s, 0, world);
    const spot = spent.rearming[0];
    expect(Math.abs(spot.x - farDome.col) + Math.abs(spot.y - farDome.row)).toBe(1);
  });

  it("cannot rearm when every dome is cut off (#102)", () => {
    const dome: Target = { col: 9, row: 1, kind: "dome", supplies: [], network: 0 };
    const world = worldOn(sealed, [hunterAt(5, 1), dome]);
    const s: DashboardState = { ...createDashboardState(config), alerted: [0], attacksUsed: { 0: config.dashboard.hunterMagazineAttacks - 1 } };
    const spent = spendAttack(s, 0, world);
    expect(spent.rearming[0]).toBeUndefined();
    expect(isDisarmed(spent, 0, world)).toBe(true);
  });
});

describe("hunter placement", () => {
  it("puts every hunter on ground the robot can walk to, never high ground, for many seeds", () => {
    for (let seed = 1; seed <= 25; seed++) {
      const { map, towns, targets } = generateWorld({ ...config.localMap, worldSeed: seed });
      const reached = reachableFrom(towns[0], map);
      for (const t of targets.filter((t) => t.kind === "hunter")) {
        expect(map.tiers[t.row][t.col]).not.toBe(2);
        expect(reached.has(cellKey(map, t.col, t.row))).toBe(true);
      }
    }
  }, MANY_WORLDS_TIMEOUT_MS);
});
