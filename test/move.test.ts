import { describe, expect, it } from "vitest";
import { config } from "../src/config";
import { createDashboardState, stepDashboard, worldFor, type Action, type DashboardState } from "../src/dashboard";
import { NETWORK, neighboursOf } from "../src/map";

const DT = 1 / 60;
const start = config.dashboard.startNode;
const world = worldFor(start, config);

function step(state: DashboardState, actions: Action[], dt = DT) {
  return stepDashboard(state, actions, dt, world);
}

/** A dashboard with the Move verb selected. */
function onMove(): DashboardState {
  return { ...createDashboardState(config), row: 0, col: 0 };
}

describe("network neighbours", () => {
  it("lists the linked nodes in order", () => {
    expect(neighboursOf(0, NETWORK)).toEqual([1, 5]);
  });

  it("gives every node at least one neighbour, so the robot can always move", () => {
    for (let node = 0; node < NETWORK.nodes.length; node++) {
      expect(neighboursOf(node, NETWORK).length, `node ${node}`).toBeGreaterThan(0);
    }
  });
});

describe("moving", () => {
  it("activating Move opens the node chooser on the first neighbour", () => {
    const next = step(onMove(), ["activate"]).state;
    expect(next.mode).toBe("moving");
    expect(next.moveChoice).toBe(0);
  });

  it("arrows cycle through neighbours and stop at the ends", () => {
    let s = step(onMove(), ["activate"]).state;
    s = step(s, ["right", "right", "right"]).state;
    expect(s.moveChoice).toBe(world.neighbours.length - 1);
    s = step(s, ["left", "left", "left"]).state;
    expect(s.moveChoice).toBe(0);
  });

  it("cancel leaves the chooser without travelling", () => {
    let s = step(onMove(), ["activate"]).state;
    s = step(s, ["cancel"]).state;
    expect(s.mode).toBe("browse");
    expect(s.travel).toBeNull();
  });

  it("confirming starts travel to the chosen neighbour", () => {
    let s = step(onMove(), ["activate"]).state;
    s = step(s, ["right", "activate"]).state;
    expect(s.travel).toEqual({ to: world.neighbours[1], remaining: world.travelSeconds });
  });

  it("arrives at the destination once the travel time has passed", () => {
    let s = step(onMove(), ["activate"]).state;
    s = step(s, ["activate"]).state;
    const destination = world.neighbours[0];

    s = step(s, [], world.travelSeconds / 2).state;
    expect(s.location).toBe(start);
    expect(s.travel).not.toBeNull();

    s = step(s, [], world.travelSeconds).state;
    expect(s.location).toBe(destination);
    expect(s.travel).toBeNull();
    expect(s.mode).toBe("browse");
  });

  it("ignores input while travelling", () => {
    let s = step(onMove(), ["activate"]).state;
    s = step(s, ["activate"]).state;
    const during = step(s, ["right", "activate", "cancel"]).state;
    expect(during.travel).not.toBeNull();
    expect(during.location).toBe(start);
  });
});
