import { describe, expect, it } from "vitest";
import { config } from "../src/config";
import { createDashboardState, stepDashboard, worldFor } from "../src/dashboard";

const DT = 1 / 60;
const world = worldFor(config);

describe("scan pulse", () => {
  it("a scan starts the ring at the current time", () => {
    const start = { ...createDashboardState(config), row: 0, col: 1, time: 5 };
    const scanned = stepDashboard(start, ["activate"], DT, world).state;
    expect(scanned.pulseStarted).toBeCloseTo(5 + DT);
  });

  it("the ring is not started by other verbs", () => {
    const start = { ...createDashboardState(config), row: 0, col: 0, time: 5 };
    const moved = stepDashboard(start, ["activate"], DT, world).state;
    expect(moved.pulseStarted).toBeNull();
  });
});
