import { describe, expect, it } from "vitest";
import { config } from "../src/config";
import { createDashboardState, bearingTo, markRuin, stepDashboard, worldFor, type DashboardState, type World } from "../src/dashboard";
import { updateApp, type AppState } from "../src/app";
import { createInitialState } from "../src/flight";

const DT = 1 / 60;
const base = worldFor(config);

/** A world whose only targets are the given ones, so scan results are predictable. */
function worldWith(targets: World["targets"]): World {
  return { ...base, targets };
}

/** A dashboard standing at (x, y) with the Scan verb selected. */
function scanningAt(x: number, y: number): DashboardState {
  return { ...createDashboardState(config), pos: { x, y }, row: 0, col: 1 };
}

describe("drops and ruins", () => {
  it("a missile hit turns the target into a ruin", () => {
    const world = worldFor(config);
    // A power station is never a ruin, so use the first building that can be destroyed.
    const index = world.targets.findIndex((t) => t.kind !== "power");
    const flying: AppState = {
      screen: "flight",
      dashboard: createDashboardState(config),
      flight: { ...createInitialState(1, config), phase: "hit" },
      target: world.targets[index],
      targetIndex: index,
      shielded: false,
    };
    const next = updateApp(flying, { actions: ["activate"], steering: 0 }, DT, config, () => 1);
    expect(next.screen).toBe("dashboard");
    if (next.screen === "dashboard") expect(next.dashboard.ruins).toEqual([index]);
  });

  it("a miss does not create a ruin", () => {
    const flying: AppState = {
      screen: "flight",
      dashboard: createDashboardState(config),
      flight: { ...createInitialState(1, config), phase: "miss" },
      target: base.targets[0],
      targetIndex: 0,
      shielded: false,
    };
    const next = updateApp(flying, { actions: ["activate"], steering: 0 }, DT, config, () => 1);
    if (next.screen === "dashboard") expect(next.dashboard.ruins).toEqual([]);
  });

  it("marking the same ruin twice does not duplicate it", () => {
    const s = markRuin(markRuin(createDashboardState(config), 3), 3);
    expect(s.ruins).toEqual([3]);
  });

  it("walking within the pickup radius collects a drop automatically", () => {
    const world = worldWith([{ col: 20, row: 5, kind: "dome", hasDrop: true, network: 0 }]);
    const s = { ...scanningAt(19.6, 5), ruins: [0] };
    const next = stepDashboard(s, [], DT, world).state;
    expect(next.found).toEqual([0]);
  });

  it("a building with no drop gives nothing when walked over", () => {
    const world = worldWith([{ col: 20, row: 5, kind: "dome", hasDrop: false, network: 0 }]);
    const next = stepDashboard({ ...scanningAt(20, 5), ruins: [0] }, [], DT, world).state;
    expect(next.found).toEqual([]);
  });

  it("a drop under a building that still stands is not collected", () => {
    const world = worldWith([{ col: 20, row: 5, kind: "dome", hasDrop: true, network: 0 }]);
    const next = stepDashboard(scanningAt(20, 5), [], DT, world).state;
    expect(next.found).toEqual([]);
  });
});

describe("scanning", () => {
  it("reports nothing when there are no ruins with drops", () => {
    const s = stepDashboard(scanningAt(5, 5), ["activate"], DT, worldWith([])).state;
    expect(s.scan).toEqual({ kind: "none" });
  });

  it("reports nothing beyond the direction radius", () => {
    const world = worldWith([{ col: 40, row: 5, kind: "dome", hasDrop: true, network: 0 }]);
    const s = stepDashboard({ ...scanningAt(5, 5), ruins: [0] }, ["activate"], DT, world).state;
    expect(s.scan).toEqual({ kind: "none" });
  });

  it("gives a bearing within the direction radius but not close", () => {
    const world = worldWith([{ col: 5 + 9, row: 5, kind: "dome", hasDrop: true, network: 0 }]);
    const s = stepDashboard({ ...scanningAt(5, 5), ruins: [0] }, ["activate"], DT, world).state;
    expect(s.scan).toEqual({ kind: "signal", bearing: "E", close: false });
  });

  it("is close within the blip radius", () => {
    const world = worldWith([{ col: 5, row: 5 - 3, kind: "dome", hasDrop: true, network: 0 }]);
    const s = stepDashboard({ ...scanningAt(5, 5), ruins: [0] }, ["activate"], DT, world).state;
    expect(s.scan).toEqual({ kind: "signal", bearing: "N", close: true });
  });

  it("ignores drops already found", () => {
    const world = worldWith([{ col: 6, row: 5, kind: "dome", hasDrop: true, network: 0 }]);
    const s = stepDashboard({ ...scanningAt(5, 5), ruins: [0], found: [0] }, ["activate"], DT, world).state;
    expect(s.scan).toEqual({ kind: "none" });
  });

  it("the nearest drop is the one reported", () => {
    const world = worldWith([
      { col: 5, row: 5 + 10, kind: "dome", hasDrop: true, network: 0 },
      { col: 5 + 9, row: 5, kind: "mine", hasDrop: true, network: 0 },
    ]);
    const s = stepDashboard({ ...scanningAt(5, 5), ruins: [0, 1] }, ["activate"], DT, world).state;
    expect(s.scan).toEqual({ kind: "signal", bearing: "E", close: false });
  });
});

describe("bearings", () => {
  it("names the eight compass points, north up the map", () => {
    const p = { x: 10, y: 10 };
    expect(bearingTo(p, 10, 0)).toBe("N");
    expect(bearingTo(p, 20, 10)).toBe("E");
    expect(bearingTo(p, 10, 20)).toBe("S");
    expect(bearingTo(p, 0, 10)).toBe("W");
    expect(bearingTo(p, 20, 0)).toBe("NE");
  });
});
