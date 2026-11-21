import { describe, expect, it } from "vitest";
import { config } from "../src/config";
import { createDashboardState, hunterInRange, isInsideBuilding, moveHunters, positionOf, routeTo, worldFor, type DashboardState, type World } from "../src/dashboard";
import { mapOf } from "./helpers";

const DT = 1 / 60;
const world = worldFor(config);
const hunterIndex = world.targets.findIndex((t) => t.kind === "hunter");
const hunter = world.targets[hunterIndex];
const post = { x: hunter.col, y: hunter.row };

/** The robot somewhere in the open, away from the hunter. */
function robotAway(distance: number): { x: number; y: number } {
  return { x: post.x + distance, y: post.y };
}

function run(s: DashboardState, seconds: number): DashboardState {
  let state = s;
  for (let i = 0; i < seconds / DT; i++) state = moveHunters(state, world, DT);
  return state;
}

describe("hunter stages", () => {
  it("an alerted hunter walks toward the robot", () => {
    const robot = robotAway(6);
    const s: DashboardState = { ...createDashboardState(config), pos: robot, alerted: [hunterIndex] };
    const later = run(s, 2);
    const before = Math.hypot(robot.x - post.x, robot.y - post.y);
    const p = positionOf(later, hunterIndex, world);
    const after = Math.hypot(robot.x - p.x, robot.y - p.y);
    expect(after).toBeLessThan(before);
  });

  it("an idle hunter stays on its post", () => {
    const s: DashboardState = { ...createDashboardState(config), pos: robotAway(6) };
    const later = run(s, 2);
    expect(positionOf(later, hunterIndex, world)).toEqual(post);
  });

  it("a hunter that is no longer alerted walks back to its post", () => {
    // The robot is well out of sight on the far side, so the hunter is not drawn to it on the way.
    const moved = { ...createDashboardState(config), pos: robotAway(-20), hunterPos: { [hunterIndex]: { x: post.x + 8, y: post.y } } };
    const later = run(moved, 10);
    expect(positionOf(later, hunterIndex, world)).toEqual(post);
  });


  it("a hunter cannot attack again until it has reloaded", () => {
    const s: DashboardState = {
      ...createDashboardState(config),
      pos: post,
      alerted: [hunterIndex],
      time: 5,
      hunterReadyAt: { [hunterIndex]: 9 },
    };
    expect(hunterInRange(s, world, config.dashboard.hunterEngageRange)).toBeNull();
    expect(hunterInRange({ ...s, time: 9 }, world, config.dashboard.hunterEngageRange)).toBe(hunterIndex);
  });

  it("a destroyed hunter does not move", () => {
    const s: DashboardState = { ...createDashboardState(config), pos: robotAway(3), alerted: [hunterIndex], ruins: [hunterIndex] };
    expect(positionOf(run(s, 2), hunterIndex, world)).toEqual(post);
  });
});

describe("a hunter guards its network (#91)", () => {
  // One town round (10, 10), its area 7 columns by 4 rows each way: columns 3 to 17 on row 10.
  // A ridge of high ground runs down column 19, just outside the town, with open ground beyond and
  // a gap at the top: the long way round, which a hunter free to roam would take.
  const rows = Array.from({ length: 21 }, (_, y) => "1".repeat(18) + (y === 0 ? "11" : "12") + "1".repeat(20));
  const HUNTER = 0;
  const guard: World = {
    ...world,
    map: mapOf(rows),
    towns: [{ x: 10, y: 10 }],
    townRadiusCols: 7,
    townRadiusRows: 4,
    targets: [{ col: 10, row: 10, kind: "hunter", supplies: [], network: 0 }],
  };
  const inArea = (p: { x: number; y: number }) => ((Math.round(p.x) - 10) / 7) ** 2 + ((Math.round(p.y) - 10) / 4) ** 2 <= 1;
  const runIn = (s: DashboardState, seconds: number) => {
    let next = s;
    for (let i = 0; i < seconds / DT; i++) {
      next = moveHunters({ ...next, time: next.time + DT }, guard, DT);
      expect(inArea(positionOf(next, HUNTER, guard)), `left its network at step ${i}`).toBe(true);
    }
    return next;
  };

  it("chasing a robot out of the network, it stops at the edge and stays alerted while the robot is in range", () => {
    // The robot is 5 cells beyond the edge, across the ridge: further than the hunter would like, but in range.
    // The hunter has followed it to just short of the edge.
    const s: DashboardState = { ...createDashboardState(config), pos: { x: 22, y: 10 }, alerted: [HUNTER], hunterPos: { [HUNTER]: { x: 16, y: 10 } } };
    const later = runIn(s, 10);
    expect(positionOf(later, HUNTER, guard)).toEqual({ x: 17, y: 10 });
    expect(later.alerted).toContain(HUNTER);
  });

  it("attacks over the ridge from where it stands", () => {
    const s: DashboardState = { ...createDashboardState(config), pos: { x: 22, y: 10 }, alerted: [HUNTER], hunterPos: { [HUNTER]: { x: 17, y: 10 } } };
    expect(hunterInRange(s, guard, config.dashboard.hunterEngageRange)).toBe(HUNTER);
  });

  it("drops the alert once the robot is outside the network and beyond its sight and range, and goes home", () => {
    const s: DashboardState = { ...createDashboardState(config), pos: { x: 30, y: 10 }, alerted: [HUNTER], hunterPos: { [HUNTER]: { x: 17, y: 10 } } };
    const later = runIn(s, 10);
    expect(later.alerted).not.toContain(HUNTER);
    expect(positionOf(later, HUNTER, guard)).toEqual({ x: 10, y: 10 });
  });

  it("keeps after a robot inside its network, even out of sight", () => {
    const s: DashboardState = { ...createDashboardState(config), pos: { x: 17, y: 10 }, alerted: [HUNTER], hunterPos: { [HUNTER]: { x: 3, y: 10 } } };
    const later = runIn(s, 1);
    expect(later.alerted).toContain(HUNTER);
    expect(positionOf(later, HUNTER, guard).x).toBeGreaterThan(3);
  });

  it("a hunter found outside its network walks home", () => {
    const s: DashboardState = { ...createDashboardState(config), pos: { x: 30, y: 2 }, hunterPos: { [HUNTER]: { x: 17, y: 2 } } };
    let next = s;
    for (let i = 0; i < 15 / DT; i++) next = moveHunters({ ...next, time: next.time + DT }, guard, DT);
    expect(positionOf(next, HUNTER, guard)).toEqual({ x: 10, y: 10 });
  });
});

describe("hunters and buildings (design-notes 4.7)", () => {
  // A hunter at (2, 1) and a solid wall of domes down column 4: the robot could never cross it.
  const rows = 3;
  const wall = Array.from({ length: rows }, (_, row) => ({ col: 4, row, kind: "dome" as const, supplies: [], network: 0 }));
  const walled: World = {
    ...world,
    map: mapOf(Array(rows).fill("1".repeat(15))),
    towns: [],
    targets: [{ col: 2, row: 1, kind: "hunter", supplies: [], network: 0 }, ...wall],
  };
  const chasing: DashboardState = { ...createDashboardState(config), pos: { x: 12, y: 1 }, alerted: [0] };

  it("the wall blocks the robot", () => {
    expect(routeTo({ ...chasing, pos: { x: 2, y: 1 } }, { col: 12, row: 1 }, walled)).toBeNull();
  });

  it("an alerted hunter passes through a building, then holds at its preferred range", () => {
    let s = chasing;
    for (let i = 0; i < 10 / DT; i++) s = moveHunters(s, walled, DT);
    const p = positionOf(s, 0, walled);
    expect(p.x).toBeGreaterThan(4); // through the wall
    const range = Math.hypot(p.x - 12, p.y - 1);
    expect(range).toBeLessThanOrEqual(config.dashboard.hunterHoldCells);
    expect(range).toBeGreaterThan(config.dashboard.hunterHoldCells - 0.5); // it stopped there, not on the robot
  });

  it("never halts inside a building, even within its preferred range", () => {
    // From (2, 1) toward a robot at (8, 1), it reaches its range while inside the wall at x = 4.
    let s: DashboardState = { ...chasing, pos: { x: 8, y: 1 } };
    for (let i = 0; i < 10 / DT; i++) s = moveHunters(s, walled, DT);
    expect(isInsideBuilding(s, 0, walled)).toBe(false);
    expect(positionOf(s, 0, walled).x).toBeGreaterThan(4);
  });

  it("is shown as inside the building while it passes through", () => {
    const inside = { ...chasing, hunterPos: { 0: { x: 4, y: 1 } } };
    expect(isInsideBuilding(inside, 0, walled)).toBe(true);
    expect(isInsideBuilding(chasing, 0, walled)).toBe(false);
  });
});
