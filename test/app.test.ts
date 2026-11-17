import { describe, expect, it } from "vitest";
import { createAppState, updateApp, type AppState } from "../src/app";
import { config } from "../src/config";
import { createDashboardState, worldFor } from "../src/dashboard";
import { createInitialState } from "../src/flight";

const DT = 1 / 60;
const seeds = () => 12345;
const world = worldFor(config.dashboard.startNode, config);

/** A dashboard with the cross already on target 0, ready to fire. */
function readyToFire(): AppState {
  const t = world.targets[0];
  const dashboard = { ...createDashboardState(config), mode: "targeting" as const, cross: { col: t.col, row: t.row }, target: 0 };
  return { screen: "dashboard", dashboard };
}

function flyingFromReady(): AppState {
  return updateApp(readyToFire(), { actions: ["activate"], steering: 0 }, DT, config, seeds);
}

describe("app screens", () => {
  it("starts on the dashboard in browse mode", () => {
    const s = createAppState(config);
    expect(s.screen).toBe("dashboard");
    if (s.screen === "dashboard") expect(s.dashboard.mode).toBe("browse");
  });

  it("opens a flight for the confirmed target", () => {
    const next = flyingFromReady();

    expect(next.screen).toBe("flight");
    if (next.screen !== "flight") return;
    expect(next.flight.seed).toBe(12345);
    expect(next.target).toEqual(world.targets[0]);
  });

  it("stays on the dashboard when fire is pressed with no target", () => {
    const base = readyToFire();
    if (base.screen !== "dashboard") throw new Error("expected dashboard");
    const s: AppState = { screen: "dashboard", dashboard: { ...base.dashboard, target: null } };
    const next = updateApp(s, { actions: ["activate"], steering: 0 }, DT, config, seeds);
    expect(next.screen).toBe("dashboard");
  });

  it("ignores presses during flight so a key tapped mid-flight cannot skip it", () => {
    const after = updateApp(flyingFromReady(), { actions: ["activate", "left"], steering: 0 }, DT, config, seeds);
    expect(after.screen).toBe("flight");
  });

  it("passes steering through to the flight", () => {
    const after = updateApp(flyingFromReady(), { actions: [], steering: 1 }, DT, config, seeds);
    if (after.screen !== "flight") throw new Error("expected flight");
    expect(after.flight.x).toBeGreaterThan(0);
  });

  it("returns to the dashboard in browse mode from a result on activate", () => {
    const flying = flyingFromReady();
    if (flying.screen !== "flight") throw new Error("expected flight");
    const finished: AppState = { ...flying, flight: { ...createInitialState(1, config), phase: "miss" } };

    const next = updateApp(finished, { actions: ["activate"], steering: 0 }, DT, config, seeds);

    expect(next.screen).toBe("dashboard");
    if (next.screen === "dashboard") expect(next.dashboard.mode).toBe("browse");
  });

  it("does not return from a result without a fresh press", () => {
    const flying = flyingFromReady();
    if (flying.screen !== "flight") throw new Error("expected flight");
    const finished: AppState = { ...flying, flight: { ...createInitialState(1, config), phase: "crash" } };

    const next = updateApp(finished, { actions: [], steering: 0 }, DT, config, seeds);

    expect(next.screen).toBe("flight");
  });
});
