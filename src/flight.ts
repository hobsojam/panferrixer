import type { Config } from "./config";
import { generateTerrain, isBlockedAt } from "./terrain";
import type { FlightState, SteeringInput } from "./types";

export function createInitialState(seed: number, cfg: Config): FlightState {
  return {
    seed,
    depth: 0,
    x: 0,
    velocityX: 0,
    roll: 0,
    phase: "flight",
    elapsed: 0,
    resultElapsed: 0,
    terrain: generateTerrain(seed, cfg),
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

  const forwardSpeed = cfg.flight.totalDistance / cfg.flight.durationSeconds;
  next.depth = state.depth + forwardSpeed * dt;
  next.elapsed = state.elapsed + dt;

  const terminalStartDepth = cfg.flight.totalDistance * cfg.terminalPhase.startFraction;
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

  if (next.depth >= cfg.flight.totalDistance) {
    next.depth = cfg.flight.totalDistance;
    next.phase = Math.abs(next.x) <= cfg.terminalPhase.targetHalfWidth ? "hit" : "miss";
  }

  return next;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
