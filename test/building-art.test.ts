import { describe, expect, it } from "vitest";
import { BUILDING_ART, hasArt } from "../src/building-art";
import type { TargetKind } from "../src/local-map";

// The hunter has no art yet (placeholder marker in the game).
const KINDS: TargetKind[] = ["power", "mine", "commsCentre", "dome"];

describe("building art", () => {
  it("has art for every target kind", () => {
    for (const kind of KINDS) expect(hasArt(kind)).toBe(true);
  });

  it("keeps every stroke inside its box, with the base at the bottom", () => {
    for (const kind of KINDS) {
      const art = BUILDING_ART[kind]!;
      for (const strokes of [art.full, art.simple]) {
        for (const stroke of Object.values(strokes)) {
          for (const [x, y] of stroke) {
            expect(Math.abs(x), `${kind} x`).toBeLessThanOrEqual(1.2);
            expect(y, `${kind} y`).toBeGreaterThanOrEqual(-1.05);
            expect(y, `${kind} y`).toBeLessThanOrEqual(1e-9); // arc endpoints carry floating-point noise
          }
        }
      }
    }
  });

  it("gives the terminal view more detail than the mini map", () => {
    for (const kind of KINDS) {
      const art = BUILDING_ART[kind]!;
      expect(Object.keys(art.full).length, kind).toBeGreaterThan(Object.keys(art.simple).length);
    }
  });
});
