import { describe, expect, it } from "vitest";
import { config } from "../src/config";
import { blipStrength, createDashboardState, markRuin, ringReach, stepDashboard, worldFor, type DashboardState, type World } from "../src/dashboard";
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
    const world = worldWith([{ col: 20, row: 5, kind: "dome", supplies: ["energy"], network: 0 }]);
    // Damaged and drained, so whatever the drop holds is wanted (a full robot leaves it: see energy tests).
    const s = { ...scanningAt(19.6, 5), ruins: [0], energyCells: 3, plates: [3, 3, 3, 0, 0, 0, 0, 0] };
    const next = stepDashboard(s, [], DT, world).state;
    expect(next.found).toEqual([{ target: 0, supply: "energy" }]);
  });

  it("a building with no drop gives nothing when walked over", () => {
    const world = worldWith([{ col: 20, row: 5, kind: "dome", supplies: [], network: 0 }]);
    const next = stepDashboard({ ...scanningAt(20, 5), ruins: [0] }, [], DT, world).state;
    expect(next.found).toEqual([]);
  });

  it("a drop under a building that still stands is not collected", () => {
    const world = worldWith([{ col: 20, row: 5, kind: "dome", supplies: ["energy"], network: 0 }]);
    const next = stepDashboard(scanningAt(20, 5), [], DT, world).state;
    expect(next.found).toEqual([]);
  });
});

describe("scanning", () => {
  const scan = (s: DashboardState, world: World) => stepDashboard(s, ["activate"], DT, world).state;

  it("finds nothing when there are no ruins with drops", () => {
    expect(scan(scanningAt(5, 5), worldWith([])).scan?.blips).toEqual([]);
  });

  it("finds nothing beyond the ring's reach", () => {
    const world = worldWith([{ col: 5 + config.dashboard.scanRadius + 1, row: 5, kind: "dome", supplies: ["energy"], network: 0 }]);
    expect(scan({ ...scanningAt(5, 5), ruins: [0] }, world).scan?.blips).toEqual([]);
  });

  it("marks every ruin with a drop within reach, nearest first", () => {
    const world = worldWith([
      { col: 5, row: 5 + 10, kind: "dome", supplies: ["energy"], network: 0 },
      { col: 5 + 3, row: 5, kind: "mine", supplies: ["energy"], network: 0 },
      { col: 5 - 8, row: 5, kind: "dome", supplies: ["energy"], network: 0 },
    ]);
    const s = scan({ ...scanningAt(5, 5), ruins: [0, 1, 2] }, world);
    expect(s.scan?.blips).toEqual([1, 2, 0]);
    expect(s.scan?.origin).toEqual({ x: 5, y: 5 });
  });

  it("does not mark ruins without a drop, buildings still standing, or drops already found", () => {
    const world = worldWith([
      { col: 6, row: 5, kind: "dome", supplies: [], network: 0 },
      { col: 7, row: 5, kind: "dome", supplies: ["energy"], network: 0 },
      { col: 8, row: 5, kind: "dome", supplies: ["energy"], network: 0 },
      { col: 9, row: 5, kind: "dome", supplies: ["energy"], network: 0 },
    ]);
    const s = scan({ ...scanningAt(5, 5), ruins: [0, 2, 3], found: [{ target: 3, supply: "energy" }] }, world);
    expect(s.scan?.blips).toEqual([2]);
  });

  it("is close when the nearest drop is within the close radius", () => {
    const near = worldWith([{ col: 5, row: 5 - 3, kind: "dome", supplies: ["energy"], network: 0 }]);
    const far = worldWith([{ col: 5 + 9, row: 5, kind: "dome", supplies: ["energy"], network: 0 }]);
    expect(scan({ ...scanningAt(5, 5), ruins: [0] }, near).scan?.close).toBe(true);
    expect(scan({ ...scanningAt(5, 5), ruins: [0] }, far).scan?.close).toBe(false);
  });
});

describe("blips", () => {
  const world = worldWith([
    { col: 5 + 2, row: 5, kind: "dome", supplies: ["energy"], network: 0 },
    { col: 5 + 11, row: 5, kind: "dome", supplies: ["energy"], network: 0 },
  ]);
  const scanned = stepDashboard({ ...scanningAt(5, 5), ruins: [0, 1], time: 10 }, ["activate"], DT, world).state;
  const at = (seconds: number, extra: Partial<DashboardState> = {}) => ({ ...scanned, time: scanned.pulseStarted! + seconds, ...extra });

  it("the ring grows from nothing to full reach over the pulse", () => {
    expect(ringReach(0, world)).toBe(0);
    expect(ringReach(world.scanPulseSeconds / 2, world)).toBeGreaterThan(0.5);
    expect(ringReach(world.scanPulseSeconds, world)).toBe(1);
  });

  it("a blip lights when the ring reaches it, so a near one lights before a far one", () => {
    const early = world.scanPulseSeconds * 0.2;
    expect(blipStrength(at(early), 0, world)).toBeGreaterThan(0);
    expect(blipStrength(at(early), 1, world)).toBe(0);
    expect(blipStrength(at(world.scanPulseSeconds), 1, world)).toBeGreaterThan(0);
  });

  it("a blip fades and then is gone", () => {
    const lit = blipStrength(at(world.scanPulseSeconds), 0, world);
    const later = blipStrength(at(world.scanPulseSeconds + world.blipSeconds / 2), 0, world);
    expect(later).toBeGreaterThan(0);
    expect(later).toBeLessThan(lit);
    expect(blipStrength(at(world.scanPulseSeconds + world.blipSeconds), 0, world)).toBe(0);
  });

  it("stays where it was found when the robot moves away", () => {
    const moved = at(world.scanPulseSeconds, { pos: { x: 40, y: 40 } });
    expect(blipStrength(moved, 1, world)).toBeGreaterThan(0);
  });

  it("goes out once its drop is collected", () => {
    expect(blipStrength(at(world.scanPulseSeconds, { found: [{ target: 0, supply: "energy" }] }), 0, world)).toBe(0);
  });

  it("a building the scan did not mark never shows a blip", () => {
    expect(blipStrength(at(world.scanPulseSeconds), 5, world)).toBe(0);
  });
});
