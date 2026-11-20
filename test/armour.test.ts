import { describe, expect, it } from "vitest";
import { allWhole, cracksOn, fullPlates, hitPlate, mendWeakest, plateFacing, plateTaking, standing } from "../src/armour";

// The arc damage model (#82): each plate guards a slice of the front arc.
const ARC = 34;

describe("which plate faces a missile", () => {
  it("the row spans the arc, leftmost plate on the left", () => {
    expect(plateFacing(-ARC, 8, ARC)).toBe(0);
    expect(plateFacing(-0.1, 8, ARC)).toBe(3);
    expect(plateFacing(0.1, 8, ARC)).toBe(4);
    expect(plateFacing(ARC, 8, ARC)).toBe(7);
  });

  it("a bearing beyond the arc still lands on an end plate", () => {
    expect(plateFacing(-90, 8, ARC)).toBe(0);
    expect(plateFacing(90, 8, ARC)).toBe(7);
  });
});

describe("hits", () => {
  it("a hit cracks the plate facing it, and three break it", () => {
    let plates = fullPlates(8, 3);
    plates = hitPlate(plates, 5).plates;
    expect(plates).toEqual([3, 3, 3, 3, 3, 2, 3, 3]);
    expect(cracksOn(plates[5], 3)).toBe(1);
    plates = hitPlate(hitPlate(plates, 5).plates, 5).plates;
    expect(plates[5]).toBe(0);
    expect(standing(plates)).toBe(7);
    expect(cracksOn(plates[5], 3)).toBe(0);
  });

  it("a hit on a broken plate spills to the nearest standing one", () => {
    expect(plateTaking([3, 3, 0, 0, 0, 3, 3, 3], 3)).toBe(1);
    expect(plateTaking([3, 3, 0, 0, 0, 3, 3, 3], 4)).toBe(5);
  });

  it("on a tie the stronger neighbour takes it, then the left one", () => {
    expect(plateTaking([3, 1, 0, 3, 3, 3, 3, 3], 2)).toBe(3);
    expect(plateTaking([3, 3, 0, 1, 3, 3, 3, 3], 2)).toBe(1);
    expect(plateTaking([3, 3, 0, 3, 3, 3, 3, 3], 2)).toBe(1);
  });

  it("with nothing standing, a hit lands nowhere", () => {
    const hit = hitPlate([0, 0, 0], 1);
    expect(hit.took).toBe(-1);
    expect(hit.plates).toEqual([0, 0, 0]);
  });

  it("the robot still takes 24 hits in all, wherever they come from", () => {
    for (const aim of [() => 0, () => 7, (i: number) => i % 8, (i: number) => (i * 5) % 8]) {
      let plates = fullPlates(8, 3);
      let hits = 0;
      while (standing(plates) > 0) plates = hitPlate(plates, aim(hits++)).plates;
      expect(hits).toBe(24);
    }
  });

  it("spread hits crack plates; focused hits break them", () => {
    let spread = fullPlates(8, 3);
    let focused = fullPlates(8, 3);
    for (let i = 0; i < 6; i++) {
      spread = hitPlate(spread, i).plates;
      focused = hitPlate(focused, 0).plates;
    }
    expect(standing(spread)).toBe(8);
    expect(standing(focused)).toBe(6);
  });
});

describe("mending", () => {
  it("mends the weakest plates fully, broken first", () => {
    expect(mendWeakest([3, 1, 0, 2, 3, 0, 3, 3], 2, 3)).toEqual([3, 1, 3, 2, 3, 3, 3, 3]);
    expect(mendWeakest([3, 1, 3, 2, 3, 3, 3, 3], 2, 3)).toEqual([3, 3, 3, 3, 3, 3, 3, 3]);
  });

  it("knows when there is nothing to mend", () => {
    expect(allWhole(fullPlates(8, 3), 3)).toBe(true);
    expect(allWhole([3, 3, 2], 3)).toBe(false);
  });
});
