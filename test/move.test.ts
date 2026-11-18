import { describe, expect, it } from "vitest";
import { config } from "../src/config";
import { buildingCells, createDashboardState, routeTo, stepDashboard, worldFor, type Action, type DashboardState, type World } from "../src/dashboard";
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
  pickupRadius: config.dashboard.pickupRadius,
  blipRadius: config.dashboard.blipRadius,
  directionRadius: config.dashboard.directionRadius,
  suppressionSeconds: config.dashboard.suppressionSeconds,
  gridDisableCooldownSeconds: config.dashboard.gridDisableCooldownSeconds,
  scanPulseSeconds: config.dashboard.scanPulseSeconds,
  hunterSpeed: config.dashboard.hunterSpeed,
  hunterLeashCells: config.dashboard.hunterLeashCells,
  hunterCooldownSeconds: config.dashboard.hunterCooldownSeconds,
  hunterCooldownRandomSeconds: config.dashboard.hunterCooldownRandomSeconds,
  hunterFirstAttackDelayMin: config.dashboard.hunterFirstAttackDelayMin,
  hunterFirstAttackDelayMax: config.dashboard.hunterFirstAttackDelayMax,
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

describe("buildings block the robot (design-notes 4.7)", () => {
  // A dome at (6, 5) on open ground.
  const withDome: World = { ...flatWorld, targets: [{ col: 6, row: 5, kind: "dome", hasDrop: false, network: 0 }] };
  const at = (x: number, y: number): DashboardState => ({ ...createDashboardState(config), pos: { x, y } });

  it("a route goes around an intact building, never through it", () => {
    const route = routeTo(at(5, 5), { col: 7, row: 5 }, withDome)!;
    expect(route[route.length - 1]).toEqual({ x: 7, y: 5 });
    expect(route.some((c) => c.x === 6 && c.y === 5)).toBe(false);
  });

  it("choosing a building walks to the nearest free cell beside it", () => {
    const route = routeTo(at(3, 5), { col: 6, row: 5 }, withDome)!;
    expect(route[route.length - 1]).toEqual({ x: 5, y: 5 });
  });

  it("choosing a building while already beside it is an empty walk, not a refusal", () => {
    expect(routeTo(at(5, 5), { col: 6, row: 5 }, withDome)).toEqual([]);
  });

  it("confirming a building in the chooser sets a route beside it", () => {
    const start = { ...at(3, 5), mode: "moving" as const, cross: { col: 6, row: 5 } };
    const s = step(start, ["activate"], DT, withDome);
    expect(s.mode).toBe("browse");
    expect(s.route[s.route.length - 1]).toEqual({ x: 5, y: 5 });
  });

  it("a ruin is passable rubble", () => {
    const ruined = { ...at(5, 5), ruins: [0] };
    expect(routeTo(ruined, { col: 6, row: 5 }, withDome)).toEqual([{ x: 6, y: 5 }]);
  });

  it("a hunter is not a building and does not block", () => {
    const withHunter: World = { ...flatWorld, targets: [{ col: 6, row: 5, kind: "hunter", hasDrop: false, network: 0 }] };
    expect(buildingCells(at(5, 5), withHunter).size).toBe(0);
  });

  it("the robot never stands on an intact building on the real map", () => {
    const blocked = buildingCells(createDashboardState(config), world);
    for (const [i, t] of world.targets.entries()) {
      if (t.kind === "hunter") continue;
      let s: DashboardState = { ...createDashboardState(config), mode: "moving", cross: { col: t.col, row: t.row } };
      s = stepDashboard(s, ["activate"], DT, world).state;
      for (let n = 0; n < 1200 && s.route.length > 0; n++) {
        s = stepDashboard(s, [], 1 / 10, world).state;
        expect(blocked.has(Math.round(s.pos.y) * world.map.cols + Math.round(s.pos.x)), `target ${i}`).toBe(false);
      }
    }
  });
});
