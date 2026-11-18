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

  it("an alerted hunter gives up and breaks off when the robot is beyond its leash", () => {
    const far = { x: post.x + config.dashboard.hunterLeashCells + 5, y: post.y };
    const s: DashboardState = { ...createDashboardState(config), pos: far, alerted: [hunterIndex], hunterPos: { [hunterIndex]: { x: post.x + config.dashboard.hunterLeashCells + 1, y: post.y } } };
    const later = moveHunters(s, world, DT);
    expect(later.alerted).not.toContain(hunterIndex);
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

describe("hunters and buildings (design-notes 4.7)", () => {
  // A hunter at (2, 1) and a solid wall of domes down column 4: the robot could never cross it.
  const rows = 3;
  const wall = Array.from({ length: rows }, (_, row) => ({ col: 4, row, kind: "dome" as const, hasDrop: false, network: 0 }));
  const walled: World = {
    ...world,
    map: mapOf(Array(rows).fill("1".repeat(15))),
    towns: [],
    targets: [{ col: 2, row: 1, kind: "hunter", hasDrop: false, network: 0 }, ...wall],
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
