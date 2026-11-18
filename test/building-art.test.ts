import { describe, expect, it } from "vitest";
import { ART, ENEMY_ROLES, hasArt, type EnemyRole } from "../src/building-art";
import type { TargetKind } from "../src/local-map";

const BUILDINGS: TargetKind[] = ["power", "mine", "commsCentre", "dome"];
const EVERYTHING: (TargetKind | EnemyRole)[] = [...BUILDINGS, ...ENEMY_ROLES];

/** True if any stroke of `strokes` is the wide base line every building stands on. */
function hasBaseLine(strokes: Record<string, readonly (readonly [number, number])[]>): boolean {
  return Object.values(strokes).some((s) => s.length === 2 && s.every(([, y]) => y === 0) && Math.abs(s[1][0] - s[0][0]) > 2);
}

describe("line art", () => {
  it("has art for every building kind and every enemy role, including the hunter", () => {
    for (const kind of EVERYTHING) expect(hasArt(kind), kind).toBe(true);
    expect(hasArt("hunter")).toBe(true);
  });

  it("has no art for something that is not a target", () => {
    expect(hasArt("ruin")).toBe(false);
    expect(hasArt("toString")).toBe(false); // not fooled by inherited properties
  });

  it("keeps every stroke inside its box, with the ground at the bottom", () => {
    for (const kind of EVERYTHING) {
      const art = ART[kind];
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
    for (const kind of EVERYTHING) {
      const art = ART[kind];
      expect(Object.keys(art.full).length, kind).toBeGreaterThan(Object.keys(art.simple).length);
    }
  });

  it("draws every role differently, on the map and in the terminal view", () => {
    for (const view of ["simple", "full"] as const) {
      const drawn = EVERYTHING.map((kind) => JSON.stringify(ART[kind][view]));
      expect(new Set(drawn).size, view).toBe(EVERYTHING.length);
    }
  });

  it("stands every enemy on its own legs, wheels or tracks, not a building's base line", () => {
    for (const role of ENEMY_ROLES) {
      expect(hasBaseLine(ART[role].full), role).toBe(false);
      expect(hasBaseLine(ART[role].simple), role).toBe(false);
      // Something touches the ground.
      const lowest = Math.max(...Object.values(ART[role].simple).flatMap((s) => s.map(([, y]) => y)));
      expect(lowest, role).toBeCloseTo(0, 1);
    }
    expect(hasBaseLine(ART.dome.simple)).toBe(true);
  });
});
