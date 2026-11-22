import { describe, expect, it } from "vitest";
import { ART, fittingStrokes } from "../src/building-art";

// Hardened enemies look different (#112): a turret for point defence, a mast for jamming.
describe("fittings", () => {
  const art = ART.defender.full;
  const keys = (f: Parameters<typeof fittingStrokes>[1]) => Object.keys(fittingStrokes(art, f)).sort();

  it("a standard enemy has none", () => {
    expect(keys({})).toEqual([]);
  });

  it("point defence adds a turret, jamming a mast, and both add both", () => {
    expect(keys({ pointDefence: true })).toEqual(["barrel1", "barrel2", "turret"]);
    expect(keys({ jammer: true })).toContain("mast");
    expect(keys({ jammer: true })).not.toContain("turret");
    expect(keys({ pointDefence: true, jammer: true })).toEqual([...keys({ pointDefence: true }), ...keys({ jammer: true })].sort());
  });

  it("fittings rise above the machine, mounted on its top", () => {
    for (const kind of ["hunter", "defender"] as const) {
      const strokes = ART[kind].full;
      const top = Math.min(...Object.values(strokes).flat().map(([, y]) => y));
      const fitted = Object.values(fittingStrokes(strokes, { pointDefence: true, jammer: true })).flat();
      expect(Math.min(...fitted.map(([, y]) => y))).toBeLessThan(top);
      // Every fitting point stays on or above the ground.
      for (const [, y] of fitted) expect(y).toBeLessThanOrEqual(0);
    }
  });
});
