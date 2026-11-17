import { describe, expect, it } from "vitest";
import { config } from "../src/config";
import { NETWORK, isConnected } from "../src/map";

describe("network map", () => {
  it("has ten nodes, as design-notes 2.4 describes", () => {
    expect(NETWORK.nodes).toHaveLength(10);
  });

  it("links only real nodes", () => {
    for (const [a, b] of NETWORK.links) {
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThan(NETWORK.nodes.length);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThan(NETWORK.nodes.length);
    }
  });

  it("is connected, so every node is reachable", () => {
    expect(isConnected(NETWORK)).toBe(true);
  });

  it("detects a disconnected layout", () => {
    // Cut node 9 off from every link, so it can never be reached.
    const broken = { nodes: NETWORK.nodes, links: NETWORK.links.filter(([a, b]) => a !== 9 && b !== 9) };
    expect(isConnected(broken)).toBe(false);
  });

  it("starts the robot on a real node", () => {
    expect(config.dashboard.startNode).toBeGreaterThanOrEqual(0);
    expect(config.dashboard.startNode).toBeLessThan(NETWORK.nodes.length);
  });
});
