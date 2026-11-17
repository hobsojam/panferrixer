import { describe, expect, it } from "vitest";
import { config } from "../src/config";
import { createDashboardState, stepDashboard, worldFor, type Action, type DashboardState } from "../src/dashboard";

const DT = 1 / 60;
const world = worldFor(config.dashboard.startNode, config);

function step(state: DashboardState, actions: Action[], dt = DT): DashboardState {
  return stepDashboard(state, actions, dt, world).state;
}

/** A dashboard with Move selected and the point chooser open. */
function choosing(): DashboardState {
  return step(createDashboardState(config), ["activate"]);
}

describe("choosing a walk point", () => {
  it("activating Move opens the chooser with the cross on the robot", () => {
    const s = choosing();
    expect(s.mode).toBe("moving");
    expect(s.cross).toEqual({ col: Math.round(s.pos.x), row: Math.round(s.pos.y) });
  });

  it("the cross moves over the local map and cannot leave it", () => {
    let s = choosing();
    for (let i = 0; i < world.map.cols + 5; i++) s = step(s, ["right"]);
    expect(s.cross.col).toBe(world.map.cols - 1);
    for (let i = 0; i < world.map.rows + 5; i++) s = step(s, ["down"]);
    expect(s.cross.row).toBe(world.map.rows - 1);
  });

  it("cancel leaves the chooser without setting a walk", () => {
    const s = step(choosing(), ["right", "cancel"]);
    expect(s.mode).toBe("browse");
    expect(s.walk).toBeNull();
  });
});

describe("walking", () => {
  it("confirming sets the walk point to the cross", () => {
    const s = step(choosing(), ["right", "right", "activate"]);
    expect(s.mode).toBe("browse");
    expect(s.walk).toEqual({ x: s.pos.x + 2, y: s.pos.y });
  });

  it("moves at the walk speed", () => {
    let s = step(choosing(), ["right", "right", "right", "right", "activate"]);
    const start = { ...s.pos };
    s = step(s, [], 0.5);
    expect(s.pos.x - start.x).toBeCloseTo(config.dashboard.walkSpeed * 0.5, 6);
    expect(s.pos.y).toBeCloseTo(start.y, 6);
  });

  it("stops on the walk point and clears the walk", () => {
    let s = step(choosing(), ["right", "right", "activate"]);
    const destination = { ...s.walk! };
    s = step(s, [], 10);
    expect(s.pos).toEqual(destination);
    expect(s.walk).toBeNull();
  });

  it("does not change the node the robot is at", () => {
    let s = step(choosing(), ["right", "activate"]);
    s = step(s, [], 10);
    expect(s.location).toBe(config.dashboard.startNode);
  });

  it("keeps walking while the player browses the verbs", () => {
    let s = step(choosing(), ["right", "right", "activate"]);
    const before = s.pos.x;
    s = step(s, ["left", "right"], 0.5);
    expect(s.pos.x).toBeGreaterThan(before);
  });

  it("a new walk point redirects a robot already on its way", () => {
    let s = step(choosing(), ["right", "right", "right", "right", "activate"]);
    s = step(s, [], 0.5);
    s = step(s, ["activate"]);
    expect(s.mode).toBe("moving");
    s = step(s, ["left", "left", "left", "left", "left", "left", "activate"]);
    expect(s.walk).toEqual({ x: s.cross.col, y: s.cross.row });
  });
});
