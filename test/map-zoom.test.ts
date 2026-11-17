import { describe, expect, it } from "vitest";
import { config } from "../src/config";
import { createDashboardState, stepDashboard, worldFor, type Action, type DashboardState } from "../src/dashboard";

const DT = 1 / 60;
const world = worldFor(config);

function step(state: DashboardState, actions: Action[]): DashboardState {
  return stepDashboard(state, actions, DT, world).state;
}

describe("selecting the map panel", () => {
  it("starts on the verb grid at local zoom", () => {
    const s = createDashboardState(config);
    expect(s.mapSelected).toBe(false);
    expect(s.zoom).toBe("local");
  });

  it("right from the last column moves onto the map, and left returns to the grid", () => {
    let s = step(createDashboardState(config), ["right", "right"]);
    expect(s.mapSelected).toBe(true);
    s = step(s, ["left"]);
    expect(s.mapSelected).toBe(false);
    expect(s.col).toBe(1);
  });

  it("up and down do nothing while the map is selected", () => {
    const s = step(createDashboardState(config), ["right", "right", "down", "up"]);
    expect(s.mapSelected).toBe(true);
    expect(s.row).toBe(0);
  });

  it("space on the map toggles the zoom, and does not start a verb", () => {
    let s = step(createDashboardState(config), ["right", "right", "activate"]);
    expect(s.zoom).toBe("full");
    expect(s.mode).toBe("browse");
    s = step(s, ["activate"]);
    expect(s.zoom).toBe("local");
  });

  it("zoom survives leaving the map and choosing a verb", () => {
    let s = step(createDashboardState(config), ["right", "right", "activate", "left", "left", "activate"]);
    expect(s.zoom).toBe("full");
    expect(s.mode).toBe("moving");
  });
});
