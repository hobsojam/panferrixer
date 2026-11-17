import { describe, expect, it } from "vitest";
import { updateApp, type AppState } from "../src/app";
import { config } from "../src/config";
import { createDashboardState, gridDisableReady, isShielded, isSuppressed, networkOf, stepDashboard, worldFor, type DashboardState } from "../src/dashboard";
import { createInitialState } from "../src/flight";
import type { Target } from "../src/local-map";

const DT = 1 / 60;
const world = worldFor(config);

/** The power station of a network, which every network has exactly one of. */
function powerOf(network: number): Target {
  const t = world.targets.find((x) => x.kind === "power" && networkOf(x) === network);
  if (!t) throw new Error(`no power station in network ${network}`);
  return t;
}

function flightFrom(dashboard: DashboardState, target: Target, phase: "flight" | "hit" | "miss" | "crash", shielded: boolean): AppState {
  return {
    screen: "flight",
    dashboard,
    flight: { ...createInitialState(1, config), phase },
    target,
    targetIndex: world.targets.indexOf(target),
    shielded,
  };
}

describe("networks and power stations", () => {
  it("every town has exactly one power station", () => {
    world.towns.forEach((_, network) => {
      const powers = world.targets.filter((t) => t.kind === "power" && networkOf(t) === network);
      expect(powers).toHaveLength(1);
    });
  });

  it("a power station never leaves a drop", () => {
    for (const t of world.targets) if (t.kind === "power") expect(t.hasDrop).toBe(false);
  });
});

describe("grid disable", () => {
  it("opens the window for the network the robot is in, and starts a cooldown", () => {
    const start = createDashboardState(config);
    const onGrid = { ...start, row: 1, col: 1, location: 0 };
    const step = stepDashboard(onGrid, ["activate"], DT, world).state;
    expect(isSuppressed(step, 0)).toBe(true);
    expect(gridDisableReady(step)).toBe(false);
  });

  it("does nothing while cooling down", () => {
    const start = createDashboardState(config);
    const cooling = { ...start, row: 1, col: 1, location: 0, time: 10, gridReadyAt: 40 };
    const step = stepDashboard(cooling, ["activate"], DT, world).state;
    expect(step.suppressedUntil).toEqual({});
    expect(step.gridReadyAt).toBe(40);
  });

  it("the window closes once its time has passed", () => {
    const start = createDashboardState(config);
    const opened = stepDashboard({ ...start, row: 1, col: 1, location: 0 }, ["activate"], DT, world).state;
    const later = { ...opened, time: opened.time + config.dashboard.suppressionSeconds + 1 };
    expect(isSuppressed(later, 0)).toBe(false);
  });
});

describe("shields at launch", () => {
  it("a power station is never shielded", () => {
    expect(isShielded(createDashboardState(config), powerOf(0))).toBe(false);
  });

  it("a building in a powered network is shielded", () => {
    const building = world.targets.find((t) => t.kind !== "power" && networkOf(t) === 0);
    expect(building).toBeDefined();
    expect(isShielded(createDashboardState(config), building!)).toBe(true);
  });

  it("a building in a suppressed network is not shielded", () => {
    const building = world.targets.find((t) => t.kind !== "power" && networkOf(t) === 0)!;
    const down = { ...createDashboardState(config), suppressedUntil: { 0: 100 } };
    expect(isShielded(down, building)).toBe(false);
  });

  it("a missile fired while suppressed stays unshielded even if the window closes in flight", () => {
    const building = world.targets.find((t) => t.kind !== "power" && networkOf(t) === 0)!;
    const down = { ...createDashboardState(config), suppressedUntil: { 0: 5 }, time: 4 };
    const fired = updateApp({ screen: "dashboard", dashboard: { ...down, row: 0, col: 0, mode: "targeting", target: world.targets.indexOf(building), cross: { col: building.col, row: building.row } } }, { actions: ["activate"], steering: 0 }, DT, config, () => 1);
    expect(fired.screen).toBe("flight");
    if (fired.screen !== "flight") return;
    expect(fired.shielded).toBe(false);
    // Fly on past the end of the window: the launch decision still stands.
    let state: AppState = fired;
    for (let i = 0; i < 60 * 3; i++) state = updateApp(state, { actions: [], steering: 0 }, DT, config, () => 1);
    expect(state.screen === "flight" && state.dashboard.time > 5).toBe(true);
    expect(state.screen === "flight" && state.shielded).toBe(false);
  });
});

describe("what a hit does", () => {
  it("a deflected hit leaves no ruin", () => {
    const building = world.targets.find((t) => t.kind !== "power" && networkOf(t) === 0)!;
    const flying = flightFrom(createDashboardState(config), building, "hit", true);
    const next = updateApp(flying, { actions: ["activate"], steering: 0 }, DT, config, () => 1);
    if (next.screen === "dashboard") expect(next.dashboard.ruins).toEqual([]);
  });

  it("an unshielded hit on a building leaves a ruin", () => {
    const building = world.targets.find((t) => t.kind !== "power" && networkOf(t) === 0)!;
    const flying = flightFrom(createDashboardState(config), building, "hit", false);
    const next = updateApp(flying, { actions: ["activate"], steering: 0 }, DT, config, () => 1);
    if (next.screen === "dashboard") expect(next.dashboard.ruins).toEqual([world.targets.indexOf(building)]);
  });

  it("a hit on a power station opens its network's window and leaves no ruin", () => {
    const power = powerOf(0);
    const base = createInitialState(1, config);
    // One step from the end of the flight, dead ahead, so the next step lands the missile on the target.
    const nearEnd: AppState = {
      screen: "flight",
      dashboard: { ...createDashboardState(config), time: 3 },
      flight: { ...base, phase: "terminal", depth: config.flight.totalDistance - 0.01, x: 0, nextBandIndex: base.terrain.bands.length },
      target: power,
      targetIndex: world.targets.indexOf(power),
      shielded: false,
    };
    const landed = updateApp(nearEnd, { actions: [], steering: 0 }, DT, config, () => 1);
    expect(landed.screen).toBe("flight");
    if (landed.screen !== "flight") return;
    expect(landed.flight.phase).toBe("hit");
    expect(isSuppressed(landed.dashboard, 0)).toBe(true);
    const done = updateApp(landed, { actions: ["activate"], steering: 0 }, DT, config, () => 1);
    if (done.screen === "dashboard") expect(done.dashboard.ruins).toEqual([]);
  });

  it("the shield clock runs during flight", () => {
    const building = world.targets.find((t) => t.kind !== "power")!;
    const flying = flightFrom(createDashboardState(config), building, "flight", true);
    const next = updateApp(flying, { actions: [], steering: 0 }, DT, config, () => 1);
    if (next.screen === "flight") expect(next.dashboard.time).toBeCloseTo(DT);
  });
});

describe("overlapping towns", () => {
  it("a building is only unshielded by its own network's window, even where towns overlap", () => {
    const network = (t: Target) => networkOf(t);
    for (const building of world.targets.filter((t) => t.kind !== "power")) {
      const own = network(building);
      const ownDown = { ...createDashboardState(config), suppressedUntil: { [own]: 1000 } };
      expect(isShielded(ownDown, building)).toBe(false);
      const otherDown = { ...createDashboardState(config), suppressedUntil: { [own + 1]: 1000 } };
      expect(isShielded(otherDown, building)).toBe(true);
    }
  });
});
