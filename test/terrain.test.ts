import { describe, expect, it } from "vitest";
import { config } from "../src/config";
import { findPassablePath, generateTerrain, isBlockedAt, silhouetteHeightAt } from "../src/terrain";
import type { Peak, Terrain } from "../src/types";

const peak = (center: number, halfWidth: number, height = 50): Peak => ({
  center,
  halfWidth,
  height,
  profile: [{ nx: 0, ny: 1 }],
});

// At a flight height of 0 any terrain blocks, which isolates the lateral logic.
const GROUND = 0;
const flightHeight = config.camera.height;

describe("silhouetteHeightAt", () => {
  it("tapers to nothing at the edges of a peak's span", () => {
    const p = peak(0, 0.5, 100);

    expect(silhouetteHeightAt(p, 0)).toBeCloseTo(100);
    expect(silhouetteHeightAt(p, 0.25)).toBeCloseTo(50);
    expect(silhouetteHeightAt(p, 0.5)).toBe(0);
    expect(silhouetteHeightAt(p, 0.9)).toBe(0);
  });

  it("treats the low flanks of a peak as open and only its upper part as a hazard", () => {
    const band = { depth: 100, peaks: [peak(0, 0.5, 36)] }; // twice the flight height

    expect(isBlockedAt(band, 0, flightHeight)).toBe(true); // the summit
    expect(isBlockedAt(band, 0.4, flightHeight)).toBe(false); // out on the taper
  });

  it("treats a hill lower than the flight height as no hazard anywhere", () => {
    const band = { depth: 100, peaks: [peak(0, 0.5, flightHeight - 1)] };

    for (let x = -0.5; x <= 0.5; x += 0.05) {
      expect(isBlockedAt(band, x, flightHeight)).toBe(false);
    }
  });
});

describe("findPassablePath", () => {
  it("finds a path when every band leaves an aligned gap", () => {
    const terrain: Terrain = {
      bands: [
        { depth: 100, peaks: [peak(-0.6, 0.3), peak(0.6, 0.3)] },
        { depth: 200, peaks: [peak(-0.6, 0.3), peak(0.6, 0.3)] },
        { depth: 300, peaks: [peak(-0.6, 0.3), peak(0.6, 0.3)] },
      ],
    };

    const path = findPassablePath(terrain, 21, 0.5, GROUND);

    expect(path).not.toBeNull();
    expect(path).toHaveLength(terrain.bands.length);
    path!.forEach((x) => expect(Math.abs(x)).toBeLessThanOrEqual(0.3));
  });

  it("returns null when a band has no gap at all", () => {
    const terrain: Terrain = {
      bands: [
        { depth: 100, peaks: [peak(-0.6, 0.3), peak(0.6, 0.3)] },
        { depth: 200, peaks: [peak(0, 1.1)] }, // covers the whole lateral range
        { depth: 300, peaks: [peak(-0.6, 0.3), peak(0.6, 0.3)] },
      ],
    };

    expect(findPassablePath(terrain, 21, 0.5, GROUND)).toBeNull();
  });

  it("returns null when per-band gaps exist but are too far apart to steer between", () => {
    const terrain: Terrain = {
      bands: [
        { depth: 100, peaks: [peak(-0.6, 0.3), peak(0.6, 0.3)] }, // gap at the centre
        { depth: 200, peaks: [peak(0, 0.95)] }, // gaps only at the edges
      ],
    };

    expect(findPassablePath(terrain, 41, 0.3, GROUND)).toBeNull();
  });

  it("returns a path of length 1 for a single unobstructed band", () => {
    const terrain: Terrain = { bands: [{ depth: 100, peaks: [] }] };
    const path = findPassablePath(terrain, 11, 0.5, GROUND);

    expect(path).not.toBeNull();
    expect(path).toHaveLength(1);
    expect(Math.abs(path![0])).toBeLessThanOrEqual(0.5);
  });
});

describe("generateTerrain", () => {
  it("always produces a terrain with a passable path, across many seeds", () => {
    for (let seed = 0; seed < 50; seed++) {
      const terrain = generateTerrain(seed, config);
      const path = findPassablePath(terrain, config.terrain.pathCellCount, config.terrain.maxLateralStepPerBand, flightHeight);
      expect(path, `seed ${seed} produced an unpassable terrain`).not.toBeNull();
    }
  });

  it("is deterministic for a given seed", () => {
    expect(generateTerrain(42, config)).toEqual(generateTerrain(42, config));
  });

  it("is no emptier at the lateral edges than in the middle, so no lane is a free ride", () => {
    const samples = [-1, -0.5, 0, 0.5, 1];
    const blocked = new Map(samples.map((x) => [x, 0]));
    let bands = 0;

    for (let seed = 0; seed < 150; seed++) {
      // Skip the opening bands, which are deliberately cleared at the centre.
      for (const band of generateTerrain(seed, config).bands.slice(config.terrain.launchClearBands)) {
        bands++;
        for (const x of samples) {
          if (isBlockedAt(band, x, flightHeight)) blocked.set(x, blocked.get(x)! + 1);
        }
      }
    }

    const rates = samples.map((x) => blocked.get(x)! / bands);
    const lowest = Math.min(...rates);
    const highest = Math.max(...rates);

    expect(lowest).toBeGreaterThan(0.05); // every lane gets blocked sometimes
    expect(highest - lowest).toBeLessThan(0.08); // and no lane is markedly safer than another
  });

  it("keeps every silhouette inside the lateral span used for collision", () => {
    for (let seed = 0; seed < 100; seed++) {
      for (const band of generateTerrain(seed, config).bands) {
        for (const p of band.peaks) {
          expect(p.profile.length).toBeGreaterThan(0);
          for (const point of p.profile) {
            expect(Math.abs(point.nx), `seed ${seed} draws outside its hitbox`).toBeLessThanOrEqual(1);
            expect(point.ny).toBeGreaterThan(0);
            expect(point.ny).toBeLessThanOrEqual(1);
          }
        }
      }
    }
  });

  it("leaves the launch corridor open in the opening bands, across many seeds", () => {
    const { launchClearBands, launchCorridorHalfWidth } = config.terrain;

    for (let seed = 0; seed < 100; seed++) {
      for (const band of generateTerrain(seed, config).bands.slice(0, launchClearBands)) {
        for (let x = -launchCorridorHalfWidth; x <= launchCorridorHalfWidth; x += 0.02) {
          expect(isBlockedAt(band, x, flightHeight), `seed ${seed} blocks the launch corridor`).toBe(false);
        }
      }
    }
  });
});
