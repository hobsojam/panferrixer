import { describe, expect, it } from "vitest";
import { config } from "../src/config";
import { NETWORK } from "../src/map";

describe("network map", () => {
  it("has ten nodes, as design-notes 2.4 describes", () => {
    expect(NETWORK.nodes).toHaveLength(10);
  });

  it("starts the robot on a real node", () => {
    expect(config.dashboard.startNode).toBeGreaterThanOrEqual(0);
    expect(config.dashboard.startNode).toBeLessThan(NETWORK.nodes.length);
  });
});
