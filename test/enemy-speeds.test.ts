import { describe, expect, it } from "vitest";
import { config } from "../src/config";

// Enemy speeds fit their stances (#117, design-notes 4.10): the heavy defender is slowest, the
// aggressive hunter fastest of those that fight, and the robot can walk away from all of them
// except a patroller running for help.
describe("enemy speeds", () => {
  const d = config.dashboard;

  it("are ordered by role: defender, patroller on its beat, hunter, the robot, a patroller running for help", () => {
    const order = [d.defenderSpeed, d.patrollerSpeed, d.hunterSpeed, d.walkSpeed, d.patrollerRunSpeed];
    for (let i = 1; i < order.length; i++) expect(order[i]).toBeGreaterThan(order[i - 1]);
  });
});
