import { describe, expect, it } from "vitest";
import { config } from "../src/config";
import { createDashboardState, hunterInRange, moveHunters, positionOf, worldFor, type DashboardState } from "../src/dashboard";

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
    const moved = { ...createDashboardState(config), pos: robotAway(10), hunterPos: { [hunterIndex]: { x: post.x + 8, y: post.y } } };
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
