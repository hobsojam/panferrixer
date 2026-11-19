import { describe, expect, it } from "vitest";
import { config } from "../src/config";
import { createDashboardState, isLow, nearestTarget, selectedVerb, stepDashboard, worldFor, type Action, type DashboardState } from "../src/dashboard";

const DT = 1 / 60;
const world = worldFor(config);

function step(state: DashboardState, actions: Action[]) {
  return stepDashboard(state, actions, DT, world);
}

/** A dashboard already in targeting mode, the robot beside the given target and the cross on it. */
function targetingOn(index: number): DashboardState {
  const t = world.targets[index];
  return { ...createDashboardState(config), pos: { x: t.col, y: t.row }, mode: "targeting", cross: { col: t.col, row: t.row }, target: index };
}

describe("dashboard selection", () => {
  it("starts on the top-left verb in browse mode", () => {
    const s = createDashboardState(config);
    expect(selectedVerb(s)).toBe("move");
    expect(s.mode).toBe("browse");
  });

  it("moves through the 2x2 grid and clamps at the edges", () => {
    let s = createDashboardState(config);
    s = step(s, ["right"]).state;
    expect(selectedVerb(s)).toBe("scan");
    s = step(s, ["down", "down", "left", "left"]).state;
    expect(selectedVerb(s)).toBe("missile");
  });
});

describe("entering targeting", () => {
  it("activating Missile enters targeting with the cross on the robot", () => {
    const s = { ...createDashboardState(config), row: 1, col: 0 };
    const next = step(s, ["activate"]).state;

    expect(next.mode).toBe("targeting");
    expect(next.cross).toEqual({ col: Math.round(s.pos.x), row: Math.round(s.pos.y) });
  });

  it("activating a verb that is not built does nothing", () => {
    const onScan = { ...createDashboardState(config), row: 0, col: 1 };
    expect(step(onScan, ["activate"]).state.mode).toBe("browse");
  });
});

describe("targeting", () => {
  it("moving the cross one step moves it by one cell and keeps the target in range", () => {
    const start = targetingOn(0);
    const next = step(start, ["right"]).state;
    expect(next.cross.col).toBe(Math.min(world.map.cols - 1, start.cross.col + 1));
    expect(next.target).not.toBeNull();
  });

  it("the cross cannot leave the local view: the mini map's rectangle is the missile's reach", () => {
    let s = targetingOn(0);
    const halfCols = (config.localMap.viewCols - 1) / 2;
    const halfRows = (config.localMap.viewRows - 1) / 2;
    for (let i = 0; i < world.map.cols + 5; i++) s = step(s, ["right"]).state;
    expect(s.cross.col).toBe(Math.min(world.map.cols - 1, s.pos.x + halfCols));
    for (let i = 0; i < world.map.rows + 5; i++) s = step(s, ["down"]).state;
    expect(s.cross.row).toBe(Math.min(world.map.rows - 1, s.pos.y + halfRows));
    for (let i = 0; i < world.map.cols + 5; i++) s = step(s, ["left"]).state;
    expect(s.cross.col).toBe(Math.max(0, s.pos.x - halfCols));
  });

  it("a target outside the local view cannot be selected", () => {
    const t = world.targets[0];
    // The robot stands so the target sits one cell past the view's right edge, and the cross is at that edge.
    const halfCols = (config.localMap.viewCols - 1) / 2;
    const pos = { x: t.col - halfCols - 1, y: t.row };
    const s: DashboardState = { ...createDashboardState(config), pos, mode: "targeting", cross: { col: t.col - 2, row: t.row }, target: null };
    const next = step(s, ["right"]).state;
    expect(next.cross.col).toBe(t.col - 1);
    expect(next.target).not.toBe(0);
  });

  it("choosing Missile or Scan from the full map pulls the map back to local", () => {
    const full = { ...createDashboardState(config), zoom: "full" as const };
    const missile = step({ ...full, row: 1, col: 0 }, ["activate"]).state;
    expect(selectedVerb({ ...full, row: 1, col: 0 })).toBe("missile");
    expect(missile.mode).toBe("targeting");
    expect(missile.zoom).toBe("local");
    const scan = step({ ...full, row: 0, col: 1 }, ["activate"]).state;
    expect(selectedVerb({ ...full, row: 0, col: 1 })).toBe("scan");
    expect(scan.zoom).toBe("local");
  });

  it("activating with a target in range fires that target", () => {
    const result = step(targetingOn(1), ["activate"]);
    expect(result.fire).toEqual(world.targets[1]);
  });

  it("activating with no target in range fires nothing", () => {
    const empty = { ...targetingOn(0), target: null };
    expect(step(empty, ["activate"]).fire).toBeNull();
  });

  it("cancel returns to browsing and drops the target", () => {
    const next = step(targetingOn(0), ["cancel"]).state;
    expect(next.mode).toBe("browse");
    expect(next.target).toBeNull();
  });
});

describe("nearestTarget", () => {
  it("returns null when every target is out of range", () => {
    const farCorner = { col: -100, row: -100 };
    expect(nearestTarget(farCorner, world)).toBeNull();
  });

  it("returns the index of a target the cross is on", () => {
    const t = world.targets[2];
    expect(nearestTarget({ col: t.col, row: t.row }, world)).toBe(2);
  });
});

describe("dashboard clock and low state", () => {
  it("advances its clock so the state trace can move", () => {
    expect(step(createDashboardState(config), []).state.time).toBeCloseTo(DT);
  });

  it("is low at and below the threshold, and not above it", () => {
    const threshold = config.dashboard.lowThreshold;
    expect(isLow(threshold, config)).toBe(true);
    expect(isLow(threshold - 1, config)).toBe(true);
    expect(isLow(threshold + 1, config)).toBe(false);
  });
});
