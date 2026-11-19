import { describe, expect, it } from "vitest";
import { dashboardOf } from "./helpers";
import { updateApp, type AppState } from "../src/app";
import { config } from "../src/config";
import { createDashboardState, stepDashboard, worldFor, type DashboardState } from "../src/dashboard";
import { createDefence, missileTravelFor } from "../src/defence";
import { createInitialState, flightSecondsFor, updateFlight } from "../src/flight";
import { terminalStart } from "../src/terrain";

// Attack pacing, design-notes 4.10.
const DT = 1 / 60;
const world = worldFor(config);
const hunterIndex = world.targets.findIndex((t) => t.kind === "hunter");
const hunter = world.targets[hunterIndex];

/** Steps the app with no input until it leaves the given screen, or the time runs out. */
function runWhile(state: AppState, screen: AppState["screen"], seconds: number, seed = 5): AppState {
  let s = state;
  for (let i = 0; i < seconds / DT && s.screen === screen; i++) s = updateApp(s, { actions: [], steering: 0 }, DT, config, () => seed);
  return s;
}

/** The robot standing beside an alerted hunter, ready to be attacked. */
function besideAlertedHunter(): AppState {
  return { screen: "dashboard", dashboard: { ...createDashboardState(config), pos: { x: hunter.col, y: hunter.row }, alerted: [hunterIndex] } };
}

describe("first attack after an alert", () => {
  it("a scan that alerts a hunter in range does not bring an attack at once, but soon after", () => {
    // On the Scan verb, standing on the hunter's post.
    const start: AppState = { screen: "dashboard", dashboard: { ...createDashboardState(config), col: 1, pos: { x: hunter.col, y: hunter.row } } };
    const scanned = updateApp(start, { actions: ["activate"], steering: 0 }, DT, config, () => 5);
    if (scanned.screen !== "dashboard") throw new Error("expected dashboard");
    expect(scanned.dashboard.alerted).toContain(hunterIndex);
    const wait = scanned.dashboard.hunterReadyAt[hunterIndex] - scanned.dashboard.time;
    expect(wait).toBeGreaterThanOrEqual(config.dashboard.hunterFirstAttackDelayMin - DT);
    expect(wait).toBeLessThanOrEqual(config.dashboard.hunterFirstAttackDelayMax);

    const early = runWhile(scanned, "dashboard", config.dashboard.hunterFirstAttackDelayMin - 0.2);
    expect(early.screen).toBe("dashboard");
    const later = runWhile(scanned, "dashboard", config.dashboard.hunterFirstAttackDelayMax + 0.5);
    expect(later.screen).toBe("defence");
  });

  it("scanning again does not shorten a wait already set", () => {
    const cooling: DashboardState = {
      ...createDashboardState(config),
      col: 1,
      time: 5,
      pos: { x: hunter.col, y: hunter.row },
      alerted: [],
      hunterReadyAt: { [hunterIndex]: 20 },
    };
    const scanned = stepDashboard(cooling, ["activate"], DT, world).state;
    expect(scanned.hunterReadyAt[hunterIndex]).toBe(20);
  });
});

describe("range shapes the outbound strike", () => {
  it("flight time is a base plus a little per cell, capped at the longest flight", () => {
    expect(flightSecondsFor(0, config)).toBe(config.flight.baseSeconds);
    expect(flightSecondsFor(2, config)).toBe(config.flight.baseSeconds + 2 * config.flight.secondsPerCell);
    expect(flightSecondsFor(100, config)).toBe(config.flight.durationSeconds);
  });

  it("a short flight takes its time and keeps the full terminal approach", () => {
    const seconds = flightSecondsFor(2, config);
    let f = createInitialState(3, config, seconds);
    const long = createInitialState(3, config);
    expect(f.totalDistance).toBeLessThan(long.totalDistance);
    expect(f.totalDistance - terminalStart(f.totalDistance, config)).toBeCloseTo(long.totalDistance - terminalStart(long.totalDistance, config));
    // Fly straight with no terrain: the flight ends after its own duration.
    f = { ...f, terrain: { bands: [] } };
    while (f.phase === "flight" || f.phase === "terminal") f = updateFlight(f, 0, DT, config);
    expect(f.elapsed).toBeCloseTo(seconds, 0);
  });

  it("firing at a near target launches a shorter flight than at a far one", () => {
    const near = { ...dashboardOf(besideAlertedHunter()), alerted: [] };
    const fired = updateApp({ screen: "dashboard", dashboard: { ...near, row: 1, col: 0 } }, { actions: ["activate"], steering: 0 }, DT, config, () => 5);
    expect(fired.screen).toBe("dashboard"); // targeting is open now
    const launched = updateApp(fired, { actions: ["activate"], steering: 0 }, DT, config, () => 5);
    if (launched.screen !== "flight") throw new Error("expected a flight");
    expect(launched.flight.totalDistance).toBeLessThan(createInitialState(5, config).totalDistance);
  });
});

describe("range shapes the inbound strike", () => {
  it("missiles from point blank arrive sooner than from the edge of engagement range", () => {
    expect(missileTravelFor(0, config)).toBe(config.defence.missileTravelNearSeconds);
    expect(missileTravelFor(config.dashboard.hunterEngageRange, config)).toBe(config.defence.missileTravelSeconds);
    expect(missileTravelFor(config.dashboard.hunterEngageRange / 2, config)).toBeCloseTo(
      (config.defence.missileTravelNearSeconds + config.defence.missileTravelSeconds) / 2
    );
  });

  it("an attack from close range has faster missiles", () => {
    const close = createDefence(4, config, 0).missiles[0];
    const far = createDefence(4, config, config.dashboard.hunterEngageRange).missiles[0];
    expect(close.arrive - close.spawn).toBeLessThan(far.arrive - far.spawn);
  });
});
