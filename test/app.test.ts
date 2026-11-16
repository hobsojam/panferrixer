import { describe, expect, it } from "vitest";
import { createAppState, updateApp, type AppState } from "../src/app";
import { config } from "../src/config";
import { createDashboardState } from "../src/dashboard";
import { createInitialState } from "../src/flight";

const DT = 1 / 60;
const seeds = () => 12345;

function onDashboardMissile(): AppState {
  const start = createAppState(config);
  if (start.screen !== "dashboard") throw new Error("expected dashboard");
  return { ...start, dashboard: { ...start.dashboard, row: 1, col: 0 } };
}

describe("app screens", () => {
  it("starts on the dashboard", () => {
    expect(createAppState(config).screen).toBe("dashboard");
  });

  it("opens a flight when the missile verb is activated", () => {
    const next = updateApp(onDashboardMissile(), { actions: ["activate"], steering: 0 }, DT, config, seeds);

    expect(next.screen).toBe("flight");
    if (next.screen !== "flight") return;
    expect(next.flight.seed).toBe(12345);
    expect(next.flight.phase).toBe("flight");
  });

  it("keeps the dashboard selection when a flight is opened from it", () => {
    const next = updateApp(onDashboardMissile(), { actions: ["activate"], steering: 0 }, DT, config, seeds);

    if (next.screen !== "flight") throw new Error("expected flight");
    expect(next.dashboard.row).toBe(1);
    expect(next.dashboard.col).toBe(0);
  });

  it("ignores presses during flight so a key tapped mid-flight cannot skip it", () => {
    const flying = updateApp(onDashboardMissile(), { actions: ["activate"], steering: 0 }, DT, config, seeds);

    const after = updateApp(flying, { actions: ["activate", "left"], steering: 0 }, DT, config, seeds);

    expect(after.screen).toBe("flight");
  });

  it("passes steering through to the flight", () => {
    const flying = updateApp(onDashboardMissile(), { actions: ["activate"], steering: 0 }, DT, config, seeds);

    const after = updateApp(flying, { actions: [], steering: 1 }, DT, config, seeds);

    if (after.screen !== "flight") throw new Error("expected flight");
    expect(after.flight.x).toBeGreaterThan(0);
  });

  it("returns to the dashboard from a result screen on activate", () => {
    const base = onDashboardMissile();
    if (base.screen !== "dashboard") throw new Error("expected dashboard");
    const finished: AppState = {
      screen: "flight",
      dashboard: base.dashboard,
      flight: { ...createInitialState(1, config), phase: "miss" },
    };

    const next = updateApp(finished, { actions: ["activate"], steering: 0 }, DT, config, seeds);

    expect(next.screen).toBe("dashboard");
  });

  it("does not return from a result screen without a fresh press", () => {
    const finished: AppState = {
      screen: "flight",
      dashboard: createDashboardState(config),
      flight: { ...createInitialState(1, config), phase: "crash" },
    };

    const next = updateApp(finished, { actions: [], steering: 0 }, DT, config, seeds);

    expect(next.screen).toBe("flight");
  });
});
