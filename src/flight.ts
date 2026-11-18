import type { Config } from "./config";
import { generateTerrain, isBlockedAt, terminalStart } from "./terrain";
import type { FlightState, SteeringInput } from "./types";

/** The missile's forward speed: the same on every flight, so a shorter flight is a shorter course. */
function forwardSpeed(cfg: Config): number {
  return cfg.flight.totalDistance / cfg.flight.durationSeconds;
}

/**
 * How long a flight to a target this many map cells away takes (design-notes 4.10):
 * a base time plus a little per cell, never longer than the longest flight.
 */
export function flightSecondsFor(cells: number, cfg: Config): number {
  return Math.min(cfg.flight.durationSeconds, cfg.flight.baseSeconds + cfg.flight.secondsPerCell * Math.max(0, cells));
}

/** A new flight. Without a duration it is the longest flight. */
export function createInitialState(seed: number, cfg: Config, durationSeconds: number = cfg.flight.durationSeconds): FlightState {
  const totalDistance = forwardSpeed(cfg) * Math.min(durationSeconds, cfg.flight.durationSeconds);
  return {
    seed,
    depth: 0,
    totalDistance,
    x: 0,
    velocityX: 0,
    roll: 0,
    phase: "flight",
    elapsed: 0,
    resultElapsed: 0,
    terrain: generateTerrain(seed, cfg, totalDistance),
    nextBandIndex: 0,
  };
}

function isResult(phase: FlightState["phase"]): boolean {
  return phase === "hit" || phase === "crash" || phase === "miss";
}

/** Pure fixed-timestep update: no drawing, no DOM, no wall-clock reads. */
export function updateFlight(state: FlightState, steering: SteeringInput, dt: number, cfg: Config): FlightState {
  if (isResult(state.phase)) {
    return { ...state, resultElapsed: state.resultElapsed + dt };
  }

  const next: FlightState = { ...state };
  const input = clamp(steering, -1, 1);
  next.velocityX = input * cfg.steering.lateralSpeed;
  next.x = clamp(state.x + next.velocityX * dt, -1, 1);

  const targetRoll = input * (cfg.banking.maxRollDegrees * Math.PI) / 180;
  next.roll = state.roll + (targetRoll - state.roll) * Math.min(1, cfg.banking.smoothingPerSecond * dt);

  next.depth = state.depth + forwardSpeed(cfg) * dt;
  next.elapsed = state.elapsed + dt;

  const terminalStartDepth = terminalStart(state.totalDistance, cfg);
  if (next.phase === "flight" && next.depth >= terminalStartDepth) {
    next.phase = "terminal";
  }

  if (next.phase === "flight" || next.phase === "terminal") {
    const bands = next.terrain.bands;
    while (next.nextBandIndex < bands.length && bands[next.nextBandIndex].depth <= next.depth) {
      if (isBlockedAt(bands[next.nextBandIndex], next.x, cfg.camera.height)) {
        next.phase = "crash";
        return next;
      }
      next.nextBandIndex += 1;
    }
  }

  if (next.depth >= state.totalDistance) {
    next.depth = state.totalDistance;
    next.phase = Math.abs(next.x) <= cfg.terminalPhase.targetHalfWidth ? "hit" : "miss";
  }

  return next;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
