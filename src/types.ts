/** A summit on a peak's silhouette: nx spans -1..1 across the base, ny 0..1 up the height. */
export interface PeakPoint {
  nx: number;
  ny: number;
}

export interface Peak {
  center: number; // lateral position, -1..1
  halfWidth: number; // lateral half-width, in the same units as center
  height: number; // world units; cosmetic only, since collision is lateral
  profile: PeakPoint[]; // summits left to right; the two base corners are implicit
}

export interface TerrainBand {
  depth: number; // distance from launch
  peaks: Peak[];
}

export interface Terrain {
  bands: TerrainBand[];
}

export type FlightPhase = "flight" | "terminal" | "hit" | "crash" | "miss";

export interface FlightState {
  seed: number;
  depth: number;
  totalDistance: number; // this flight's course length: shorter for a nearer target
  x: number; // lateral position, -1..1; also the direction-marker position
  velocityX: number;
  roll: number; // radians; cosmetic bank into the turn
  phase: FlightPhase;
  elapsed: number;
  resultElapsed: number; // time spent in a terminal result phase (hit/crash/miss)
  terrain: Terrain;
  nextBandIndex: number;
}

export type SteeringInput = number; // -1..1
