import { describe, expect, it } from "vitest";
import { config } from "../src/config";
import { generateTerrain, isBlockedAt } from "../src/terrain";

const cfg = config;
const terminalStart = cfg.flight.totalDistance * cfg.terminalPhase.startFraction;
const approachBands = (seed: number) => generateTerrain(seed, cfg).bands.filter((b) => b.depth >= terminalStart);

describe("the approach to the target", () => {
  it("mountain bands run right up to the target, with no empty stretch", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const bands = generateTerrain(seed, cfg).bands;
      expect(bands[bands.length - 1].depth).toBeGreaterThan(cfg.flight.totalDistance - 2 * cfg.terrain.bandSpacing);
    }
  });

  it("the approach is surrounded: its bands carry mountains", () => {
    let peaks = 0;
    let bands = 0;
    for (let seed = 1; seed <= 20; seed++) {
      for (const b of approachBands(seed)) {
        peaks += b.peaks.length;
        bands += 1;
      }
    }
    expect(peaks / bands).toBeGreaterThan(1);
  });

  it("keeps a clear lane straight to the target on every approach band", () => {
    const lane = cfg.terminalPhase.approachCorridorHalfWidth;
    for (let seed = 1; seed <= 20; seed++) {
      for (const b of approachBands(seed)) {
        for (const x of [0, lane * 0.5, -lane * 0.5, lane]) {
          expect(isBlockedAt(b, x, cfg.camera.height), `seed ${seed} depth ${b.depth} x ${x}`).toBe(false);
        }
      }
    }
  });
});
