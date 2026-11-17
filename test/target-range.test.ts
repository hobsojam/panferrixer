import { describe, expect, it } from "vitest";
import { config } from "../src/config";
import { nearestTarget, worldFor } from "../src/dashboard";

const world = worldFor(config);

describe("target selection range", () => {
  it("selects a target only when the cross is within the configured range", () => {
    for (let row = 0; row < world.map.rows; row++) {
      for (let col = 0; col < world.map.cols; col++) {
        const index = nearestTarget({ col, row }, world);
        if (index === null) continue;
        const t = world.targets[index];
        const distance = Math.max(Math.abs(t.col - col), Math.abs(t.row - row));
        expect(distance).toBeLessThanOrEqual(config.dashboard.targetRange);
      }
    }
  });

  it("selects nothing for a cross well away from every target", () => {
    let empty = 0;
    for (let row = 0; row < world.map.rows; row++) {
      for (let col = 0; col < world.map.cols; col++) {
        if (nearestTarget({ col, row }, world) === null) empty += 1;
      }
    }
    expect(empty).toBeGreaterThan(0);
  });
});
