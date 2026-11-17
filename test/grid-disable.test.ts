import { describe, expect, it } from "vitest";
import { config } from "../src/config";
import { createDashboardState, gridDisableReady, isSuppressed, networkOf, stepDashboard, worldFor, type DashboardState } from "../src/dashboard";
import type { Target } from "../src/local-map";

const DT = 1 / 60;
const world = worldFor(config);

function powerOf(network: number): Target {
  const t = world.targets.find((x) => x.kind === "power" && networkOf(x) === network);
  if (!t) throw new Error(`no power station in network ${network}`);
  return t;
}

/** Grid disable with the cross on a power station, ready to confirm. */
function choosingStation(network: number, time = 0): DashboardState {
  const station = powerOf(network);
  return {
    ...createDashboardState(config),
    mode: "targeting",
    purpose: "gridDisable",
    cross: { col: station.col, row: station.row },
    target: world.targets.indexOf(station),
    time,
  };
}

describe("grid disable", () => {
  it("activating it asks the player to choose a power station", () => {
    const onGrid = { ...createDashboardState(config), row: 1, col: 1 };
    const chooser = stepDashboard(onGrid, ["activate"], DT, world).state;
    expect(chooser.mode).toBe("targeting");
    expect(chooser.purpose).toBe("gridDisable");
    expect(isSuppressed(chooser, 0)).toBe(false);
  });

  it("the cross only selects power stations", () => {
    const building = world.targets.find((t) => t.kind !== "power")!;
    const onBuilding = { ...choosingStation(0), cross: { col: building.col, row: building.row }, target: null };
    const moved = stepDashboard(onBuilding, ["right"], DT, world).state;
    expect(moved.target === null || world.targets[moved.target].kind === "power").toBe(true);
  });

  it("confirming on a power station cuts that station's network, and starts a cooldown", () => {
    const network = networkOf(powerOf(1));
    const step = stepDashboard(choosingStation(network), ["activate"], DT, world).state;
    expect(isSuppressed(step, network)).toBe(true);
    expect(isSuppressed(step, 0)).toBe(network === 0);
    expect(gridDisableReady(step)).toBe(false);
    expect(step.mode).toBe("browse");
  });

  it("does nothing while cooling down", () => {
    const cooling = { ...createDashboardState(config), row: 1, col: 1, location: 0, time: 10, gridReadyAt: 40 };
    const step = stepDashboard(cooling, ["activate"], DT, world).state;
    expect(step.mode).toBe("browse");
    expect(step.suppressedUntil).toEqual({});
    expect(step.gridReadyAt).toBe(40);
  });

  it("the window closes once its time has passed", () => {
    const network = networkOf(powerOf(0));
    const opened = stepDashboard(choosingStation(network), ["activate"], DT, world).state;
    const later = { ...opened, time: opened.time + config.dashboard.suppressionSeconds + 1 };
    expect(isSuppressed(later, network)).toBe(false);
  });
});
