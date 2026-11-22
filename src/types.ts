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

export type FlightPhase = "flight" | "terminal" | "hit" | "crash" | "miss" | "shotDown";

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
  // Point defence (design-notes 4.11): a defended target's turret fires aimed bursts in the terminal phase.
  defended: boolean;
  rounds: Round[]; // in the air, coming at the missile
  bursts: Burst[]; // announced by a muzzle flash, then fired as a short stream
  nextBurstAt: number | null; // flight time of the next burst's warning; null until the terminal phase
}

/** One round of point-defence fire: it flies from the target toward the missile along a fixed lateral line. */
export interface Round {
  x: number; // lateral line it flies along, in the missile's -1..1 units
  depth: number; // world depth; falls as it closes on the missile
  firedDepth: number; // the missile's depth when it was fired, for drawing its approach
}

/** A burst: aimed when its warning starts, then its rounds leave the muzzle one after another. */
export interface Burst {
  aim: number; // lateral line, fixed at the warning: dodging after the flash works
  warnedAt: number; // flight time of the muzzle flash
  fired: number; // rounds fired so far
}

export type SteeringInput = number; // -1..1
