import { type Config } from "./config";
import { createRng, rangeFloat, rangeInt, type Rng } from "./rng";
import type { Peak, PeakPoint, Terrain, TerrainBand } from "./types";

/** Height of a peak's drawn silhouette at a lateral position; 0 outside its span. */
export function silhouetteHeightAt(peak: Peak, x: number): number {
  const u = (x - peak.center) / peak.halfWidth;
  if (u <= -1 || u >= 1) return 0;

  let prev: PeakPoint = { nx: -1, ny: 0 };
  for (const point of peak.profile) {
    if (u <= point.nx) return peak.height * interpolate(prev, point, u);
    prev = point;
  }
  return peak.height * interpolate(prev, { nx: 1, ny: 0 }, u);
}

function interpolate(a: PeakPoint, b: PeakPoint, u: number): number {
  const span = b.nx - a.nx;
  if (span <= 0) return Math.max(a.ny, b.ny);
  return a.ny + ((b.ny - a.ny) * (u - a.nx)) / span;
}

/**
 * The one rule shared by collision and generation: a position is blocked only
 * where terrain rises above the flight height, which on screen is exactly the
 * part of the silhouette standing above the horizon line.
 */
export function isBlockedAt(band: TerrainBand, x: number, flightHeight: number): boolean {
  return band.peaks.some((p) => silhouetteHeightAt(p, x) > flightHeight);
}

/**
 * Finds a sequence of lateral positions (one per band) that a missile could
 * fly through without ever sitting in blocked terrain, moving at most
 * `maxLateralStepPerBand` between one band and the next. Pure and RNG-free,
 * so terrain fixtures can be checked directly in tests.
 */
export function findPassablePath(
  terrain: Terrain,
  pathCellCount: number,
  maxLateralStepPerBand: number,
  flightHeight: number
): number[] | null {
  const cells: number[] = [];
  for (let i = 0; i < pathCellCount; i++) {
    cells.push(-1 + (2 * i) / (pathCellCount - 1));
  }

  let reachable: number[] = [0];
  const parents: Map<number, number>[] = [];

  for (const band of terrain.bands) {
    const parent = new Map<number, number>();
    const next: number[] = [];
    for (const x of cells) {
      if (isBlockedAt(band, x, flightHeight)) continue;
      const prevX = reachable.find((p) => Math.abs(x - p) <= maxLateralStepPerBand);
      if (prevX !== undefined) {
        parent.set(x, prevX);
        next.push(x);
      }
    }
    if (next.length === 0) {
      return null;
    }
    parents.push(parent);
    reachable = next;
  }

  const path: number[] = [];
  let current = reachable[0];
  for (let i = parents.length - 1; i >= 0; i--) {
    path.unshift(current);
    current = parents[i].get(current)!;
  }
  return path;
}

/** Summits stay within -1..1 so the drawn silhouette never exceeds the peak's lateral span. */
function generateProfile(rng: Rng, tc: Config["terrain"]): PeakPoint[] {
  const skew = rangeFloat(rng, -tc.peakSkewMax, tc.peakSkewMax);
  const points: PeakPoint[] = [{ nx: skew, ny: 1 }];

  const extra = rangeInt(rng, 0, tc.peakExtraSummitsMax);
  for (let i = 0; i < extra; i++) {
    const toLeft = rng() < 0.5;
    const lo = toLeft ? -0.9 : skew + 0.15;
    const hi = toLeft ? skew - 0.15 : 0.9;
    if (hi <= lo) continue;
    points.push({ nx: rangeFloat(rng, lo, hi), ny: rangeFloat(rng, tc.peakShoulderMin, tc.peakShoulderMax) });
  }

  return points.sort((a, b) => a.nx - b.nx);
}

function generateBandPeaks(rng: Rng, tc: Config["terrain"], busy: boolean, corridorHalfWidth: number): Peak[] {
  const peaks: Peak[] = [];
  const limit = 1 + tc.placementOverhang;
  const count = busy ? rangeInt(rng, tc.busyPeaksMin, tc.busyPeaksMax) : rangeInt(rng, tc.calmPeaksMin, tc.calmPeaksMax);

  for (let i = 0; i < count; i++) {
    const halfWidth = rangeFloat(rng, tc.peakHalfWidthMin, tc.peakHalfWidthMax);
    let center = rangeFloat(rng, -limit, limit);

    if (corridorHalfWidth > 0) {
      const clearance = corridorHalfWidth + halfWidth;
      if (Math.abs(center) < clearance) center = (center < 0 ? -1 : 1) * clearance;
    }

    peaks.push({
      center,
      halfWidth,
      height: rangeFloat(rng, tc.peakHeightMin, tc.peakHeightMax),
      profile: generateProfile(rng, tc),
    });
  }

  // Low ground detail: visible, but below flight height and so never a hazard.
  const hills = rangeInt(rng, 0, tc.hillsPerBandMax);
  for (let i = 0; i < hills; i++) {
    peaks.push({
      center: rangeFloat(rng, -limit, limit),
      halfWidth: rangeFloat(rng, tc.peakHalfWidthMin * 0.4, tc.peakHalfWidthMin),
      height: rangeFloat(rng, tc.hillHeightMin, tc.hillHeightMax),
      profile: generateProfile(rng, tc),
    });
  }

  return peaks;
}

/** Alternating calm and busy runs, so difficulty has a rhythm rather than being uniform. */
function generateStretches(rng: Rng, tc: Config["terrain"], bandCount: number): boolean[] {
  const busyByBand: boolean[] = [];
  let busy = false;
  while (busyByBand.length < bandCount) {
    const length = rangeInt(rng, tc.stretchBandsMin, tc.stretchBandsMax);
    for (let i = 0; i < length && busyByBand.length < bandCount; i++) busyByBand.push(busy);
    busy = !busy;
  }
  return busyByBand;
}

/**
 * Generates a terrain for the given seed. Passes are carved by construction,
 * but passes in neighbouring bands can still fail to line up within steering
 * range, so the result is validated with `findPassablePath` and regenerated
 * (from a derived sub-seed, still deterministic) until a passable path is
 * found or the attempt budget runs out.
 */
export function generateTerrain(seed: number, cfg: Config): Terrain {
  const tc = cfg.terrain;
  const flightHeight = cfg.camera.height;
  const terminalStartDepth = cfg.flight.totalDistance * cfg.terminalPhase.startFraction;
  const bandDepths: number[] = [];
  // Mountains run all the way to the target, so there is no empty stretch before it.
  for (let depth = tc.bandSpacing; depth < cfg.flight.totalDistance; depth += tc.bandSpacing) {
    bandDepths.push(depth);
  }

  for (let attempt = 0; attempt < tc.maxGenerationAttempts; attempt++) {
    const rng = createRng(seed + attempt * 7919);
    const busyByBand = generateStretches(rng, tc, bandDepths.length);
    const candidate: Terrain = {
      bands: bandDepths.map((depth, index) => {
        // The approach to the target is always busy, with a clear lane straight to it.
        const approach = depth >= terminalStartDepth;
        const corridor = approach
          ? cfg.terminalPhase.approachCorridorHalfWidth
          : index < tc.launchClearBands
            ? tc.launchCorridorHalfWidth
            : 0;
        return { depth, peaks: generateBandPeaks(rng, tc, approach || busyByBand[index], corridor) };
      }),
    };
    if (findPassablePath(candidate, tc.pathCellCount, tc.maxLateralStepPerBand, flightHeight) !== null) {
      return candidate;
    }
  }

  return { bands: bandDepths.map((depth) => ({ depth, peaks: [] })) };
}
