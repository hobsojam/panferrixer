import { describe, expect, it } from "vitest";
import { config } from "../src/config";
import { createDashboardState, isLow, selectedVerb, stepDashboard } from "../src/dashboard";

const DT = 1 / 60;

describe("dashboard selection", () => {
  it("starts on the top-left verb", () => {
    expect(selectedVerb(createDashboardState(config))).toBe("move");
  });

  it("moves through the 2x2 grid with the arrow keys", () => {
    let state = createDashboardState(config);

    state = stepDashboard(state, ["right"], DT).state;
    expect(selectedVerb(state)).toBe("scan");

    state = stepDashboard(state, ["down"], DT).state;
    expect(selectedVerb(state)).toBe("gridDisable");

    state = stepDashboard(state, ["left"], DT).state;
    expect(selectedVerb(state)).toBe("missile");
  });

  it("clamps at the edges of the grid rather than wrapping", () => {
    let state = createDashboardState(config);

    state = stepDashboard(state, ["up", "left"], DT).state;
    expect(selectedVerb(state)).toBe("move");

    state = stepDashboard(state, ["down", "down", "right", "right"], DT).state;
    expect(selectedVerb(state)).toBe("gridDisable");
  });
});

describe("dashboard activation", () => {
  it("requests a missile only when the missile verb is selected", () => {
    const onMissile = stepDashboard(
      { ...createDashboardState(config), row: 1, col: 0 },
      ["activate"],
      DT
    );
    expect(onMissile.launchMissile).toBe(true);

    const onMove = stepDashboard(createDashboardState(config), ["activate"], DT);
    expect(onMove.launchMissile).toBe(false);
  });

  it("does nothing for verbs that are not yet built", () => {
    const onScan = stepDashboard({ ...createDashboardState(config), row: 0, col: 1 }, ["activate"], DT);
    const onGrid = stepDashboard({ ...createDashboardState(config), row: 1, col: 1 }, ["activate"], DT);

    expect(onScan.launchMissile).toBe(false);
    expect(onGrid.launchMissile).toBe(false);
  });

  it("advances its own clock so the state trace can move", () => {
    const step = stepDashboard(createDashboardState(config), [], DT);
    expect(step.state.time).toBeCloseTo(DT);
  });
});

describe("low state", () => {
  it("is low at and below the threshold, and not above it", () => {
    const threshold = config.dashboard.lowThreshold;
    expect(isLow(threshold, config)).toBe(true);
    expect(isLow(threshold - 1, config)).toBe(true);
    expect(isLow(threshold + 1, config)).toBe(false);
  });
});
