import { describe, expect, it } from "vitest";
import { config } from "../src/config";
import { createDashboardState, stepDashboard, worldFor, type Action, type DashboardState, type World } from "../src/dashboard";
import { generateWorld, type Supply, type Target } from "../src/local-map";

// The missile rack (#86, design-notes 4.4): every launch uses a missile, and missiles come only
// from ruins, as a third supply. An empty rack has no floor (author).
const DT = 1 / 60;
const world = worldFor(config);
const RACK = config.dashboard.missileRack;

function step(state: DashboardState, actions: Action[], w: World = world) {
  return stepDashboard(state, actions, DT, w);
}

/** A dashboard already in targeting mode, the robot beside the given target and the cross on it. */
function targetingOn(index: number, over: Partial<DashboardState> = {}): DashboardState {
  const t = world.targets[index];
  return { ...createDashboardState(config), pos: { x: t.col, y: t.row }, mode: "targeting", purpose: "missile", cross: { col: t.col, row: t.row }, target: index, ...over };
}

describe("firing from the rack", () => {
  it("the robot starts with a full rack", () => {
    expect(createDashboardState(config).missiles).toBe(RACK);
  });

  it("every launch uses a missile", () => {
    const result = step(targetingOn(1), ["activate"]);
    expect(result.fire).toEqual(world.targets[1]);
    expect(result.state.missiles).toBe(RACK - 1);
  });

  it("the last missile can be fired, leaving the rack empty", () => {
    const result = step(targetingOn(1, { missiles: 1 }), ["activate"]);
    expect(result.fire).not.toBeNull();
    expect(result.state.missiles).toBe(0);
  });

  it("with an empty rack the targeting cross does not open", () => {
    const browsing = { ...createDashboardState(config), row: 1, col: 0, missiles: 0 };
    expect(step(browsing, ["activate"]).state.mode).toBe("browse");
    expect(step({ ...browsing, missiles: 1 }, ["activate"]).state.mode).toBe("targeting");
  });

  it("an empty rack never fires", () => {
    const result = step(targetingOn(1, { missiles: 0 }), ["activate"]);
    expect(result.fire).toBeNull();
    expect(result.state.missiles).toBe(0);
  });

  it("grid disable needs no missile", () => {
    const station = world.targets.findIndex((t) => t.kind === "power");
    const result = step(targetingOn(station, { purpose: "gridDisable", missiles: 0 }), ["activate"]);
    expect(result.fire).toBeNull();
    expect(result.state.gridReadyAt).not.toBeNull();
  });
});

describe("missile supplies", () => {
  function onRuin(supplies: Supply[], over: Partial<DashboardState>): DashboardState {
    const dome: Target = { col: 5, row: 5, kind: "dome", supplies, network: 0 };
    const w: World = { ...world, targets: [dome] };
    return step({ ...createDashboardState(config), pos: { x: 5, y: 5 }, ruins: [0], ...over }, [], w).state;
  }

  it("each missile found goes in the rack", () => {
    const next = onRuin(["missiles", "missiles"], { missiles: 2 });
    expect(next.missiles).toBe(4);
    expect(next.found).toHaveLength(2);
  });

  it("with room for one, one is taken and the other waits", () => {
    const next = onRuin(["missiles", "missiles"], { missiles: RACK - 1 });
    expect(next.missiles).toBe(RACK);
    expect(next.found).toEqual([{ target: 0, supply: "missiles" }]);
  });

  it("never overfills the rack", () => {
    expect(onRuin(["missiles"], { missiles: RACK - 1 }).missiles).toBe(RACK);
  });

  it("is left in the ruin while the rack is full", () => {
    expect(onRuin(["missiles"], {}).found).toEqual([]);
  });

  it("some buildings in the world hold missiles", () => {
    expect(generateWorld(config.localMap).targets.some((t) => t.supplies.includes("missiles"))).toBe(true);
  });
});

describe("wrecks", () => {
  // A hunter posted at (5, 5) that walked to (15, 5) before it was destroyed there.
  const hunter: Target = { col: 5, row: 5, kind: "hunter", supplies: ["missiles", "energy"], network: 0 };
  const w: World = { ...world, targets: [hunter] };
  const wrecked = (pos: { x: number; y: number }): DashboardState => ({
    ...createDashboardState(config),
    pos,
    ruins: [0],
    hunterPos: { 0: { x: 15, y: 5 } },
    missiles: 3,
    energyCells: 4,
  });

  it("are searched where the enemy fell, not at its post", () => {
    expect(step(wrecked({ x: 5, y: 5 }), [], w).state.found).toEqual([]);
    const there = step(wrecked({ x: 15, y: 5 }), [], w).state;
    expect(there.found).toHaveLength(2);
    expect(there.missiles).toBe(4);
  });

  it("a scan marks the wreck at where it fell", () => {
    // From (25, 5) the wreck is 10 cells away, inside the ring; the post is 20, beyond it.
    const scanned = step({ ...wrecked({ x: 25, y: 5 }), row: 0, col: 1 }, ["activate"], w).state;
    expect(scanned.scan?.blips).toEqual([0]);
  });
});
