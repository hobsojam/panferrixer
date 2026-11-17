import { describe, expect, it } from "vitest";
import { config } from "../src/config";
import { createDashboardState, stepDashboard, worldFor, type Action, type DashboardState, type World } from "../src/dashboard";
import { mapOf } from "./helpers";

const DT = 1 / 60;
const world = worldFor(config);

/** A flat, all-ground patch, so walking tests do not depend on the generated terrain. */
const flatWorld: World = {
  map: mapOf(Array(config.localMap.rows).fill("1".repeat(config.localMap.cols))),
  towns: [],
  townRadiusCols: 7,
  townRadiusRows: 4,
  targets: [],
  range: config.dashboard.targetRange,
  walkSpeed: config.dashboard.walkSpeed,
};

function step(state: DashboardState, actions: Action[], dt = DT, w: World = flatWorld): DashboardState {
  return stepDashboard(state, actions, dt, w).state;
}

/** A dashboard with the robot at the given cell and the point chooser open. */
function choosingAt(x: number, y: number): DashboardState {
  return step({ ...createDashboardState(config), pos: { x, y } }, ["activate"]);
}

describe("choosing a walk point", () => {
  it("activating Move opens the chooser with the cross on the robot", () => {
    const s = step(createDashboardState(config), ["activate"]);
    expect(s.mode).toBe("moving");
    expect(s.cross).toEqual({ col: Math.round(s.pos.x), row: Math.round(s.pos.y) });
  });

  it("the cross moves over the local map and cannot leave it", () => {
    let s = step(createDashboardState(config), ["activate"]);
    for (let i = 0; i < flatWorld.map.cols + 5; i++) s = step(s, ["right"]);
    expect(s.cross.col).toBe(flatWorld.map.cols - 1);
    for (let i = 0; i < flatWorld.map.rows + 5; i++) s = step(s, ["down"]);
    expect(s.cross.row).toBe(flatWorld.map.rows - 1);
  });

  it("cancel leaves the chooser without setting a route", () => {
    const s = step(choosingAt(5, 5), ["right", "cancel"]);
    expect(s.mode).toBe("browse");
    expect(s.route).toEqual([]);
  });

  it("refuses a point on high ground and keeps the chooser open", () => {
    const blocked: World = { ...flatWorld, map: mapOf(["121", "111", "111"]) };
    const start = { ...createDashboardState(config), mode: "moving" as const, pos: { x: 0, y: 1 }, cross: { col: 1, row: 0 } };
    const s = step(start, ["activate"], DT, blocked);
    expect(s.mode).toBe("moving");
    expect(s.route).toEqual([]);
  });
});

describe("walking", () => {
  it("confirming sets a route ending at the cross", () => {
    const s = step(choosingAt(5, 5), ["right", "right", "activate"]);
    expect(s.mode).toBe("browse");
    expect(s.route).toEqual([
      { x: 6, y: 5 },
      { x: 7, y: 5 },
    ]);
  });

  it("moves at the walk speed", () => {
    let s = step(choosingAt(5, 5), ["right", "right", "right", "right", "activate"]);
    const start = { ...s.pos };
    s = step(s, [], 0.5);
    expect(s.pos.x - start.x).toBeCloseTo(config.dashboard.walkSpeed * 0.5, 6);
    expect(s.pos.y).toBeCloseTo(start.y, 6);
  });

  it("stops on the last cell and clears the route", () => {
    let s = step(choosingAt(5, 5), ["right", "right", "activate"]);
    s = step(s, [], 10);
    expect(s.pos).toEqual({ x: 7, y: 5 });
    expect(s.route).toEqual([]);
  });

  it("does not change the node the robot is at", () => {
    let s = step(choosingAt(5, 5), ["right", "activate"]);
    s = step(s, [], 10);
    expect(s.location).toBe(config.dashboard.startNode);
  });

  it("keeps walking while the player browses the verbs", () => {
    let s = step(choosingAt(5, 5), ["right", "right", "activate"]);
    const before = s.pos.x;
    s = step(s, ["left", "right"], 0.5);
    expect(s.pos.x).toBeGreaterThan(before);
  });

  it("a new point redirects a robot already on its way", () => {
    let s = step(choosingAt(5, 5), ["right", "right", "right", "right", "activate"]);
    s = step(s, [], 0.5);
    s = step(s, ["activate"]);
    expect(s.mode).toBe("moving");
    s = step(s, ["left", "left", "left", "left", "left", "left", "activate"]);
    expect(s.route[s.route.length - 1]).toEqual({ x: s.cross.col, y: s.cross.row });
  });

  it("the robot never stands on high ground on the real map", () => {
    let s: DashboardState = { ...createDashboardState(config), mode: "moving" };
    // Aim the cross at the far corner of the patch and walk there.
    const far = { col: world.map.cols - 1, row: world.map.rows - 1 };
    s = { ...s, cross: far };
    s = stepDashboard(s, ["activate"], DT, world).state;
    for (let i = 0; i < 2000; i++) {
      s = stepDashboard(s, [], DT, world).state;
      const cell = { x: Math.round(s.pos.x), y: Math.round(s.pos.y) };
      expect(world.map.tiers[cell.y][cell.x]).not.toBe(2);
    }
  });
});
