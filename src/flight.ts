import type { Config } from "./config";
import { generateTerrain, isBlockedAt, terminalStart } from "./terrain";
import type { Burst, FlightState, Round, SteeringInput } from "./types";

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

/** A new flight. Without a duration it is the longest flight. A defended target has point defence. */
export function createInitialState(seed: number, cfg: Config, durationSeconds: number = cfg.flight.durationSeconds, defended = false): FlightState {
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
    defended,
    rounds: [],
    bursts: [],
    nextBurstAt: null,
  };
}

function isResult(phase: FlightState["phase"]): boolean {
  return phase === "hit" || phase === "crash" || phase === "miss" || phase === "shotDown";
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
    if (next.defended) next.nextBurstAt = next.elapsed + cfg.pointDefence.firstBurstSeconds;
  }

  if (next.defended && next.phase === "terminal") {
    const defended = stepPointDefence(next, dt, cfg);
    if (defended.phase === "shotDown") return defended;
    Object.assign(next, defended);
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

/**
 * Point defence (design-notes 4.11) for one step. A burst is announced by a muzzle flash and aimed
 * then, at where the missile is, leading a steady drift a little; after the flash its rounds leave
 * the muzzle one by one and fly straight at that line. A round that passes the missile close enough
 * destroys it. No new burst is announced close to the target, so the last one can still be dodged.
 */
function stepPointDefence(state: FlightState, dt: number, cfg: Config): FlightState {
  const pd = cfg.pointDefence;
  let bursts = state.bursts;
  let nextBurstAt = state.nextBurstAt;
  const remaining = state.totalDistance - state.depth;
  if (nextBurstAt !== null && state.elapsed >= nextBurstAt && remaining > pd.ceaseDistance) {
    const travel = remaining / (pd.roundSpeed + forwardSpeed(cfg));
    const aim = clamp(state.x + state.velocityX * pd.leadSeconds * Math.min(1, travel), -1, 1);
    bursts = [...bursts, { aim, warnedAt: state.elapsed, fired: 0 }];
    nextBurstAt += pd.burstIntervalSeconds;
  }

  // Rounds leave the muzzle, at the target, once the flash is over.
  let rounds: Round[] = state.rounds.map((r) => ({ ...r, depth: r.depth - pd.roundSpeed * dt }));
  bursts = bursts
    .map((b): Burst => {
      const due = Math.min(pd.roundsPerBurst, Math.floor((state.elapsed - b.warnedAt - pd.warningSeconds) / pd.roundSpacingSeconds) + 1);
      if (due <= b.fired) return b;
      for (let i = b.fired; i < due; i++) rounds.push({ x: b.aim, depth: state.totalDistance, firedDepth: state.depth });
      return { ...b, fired: due };
    })
    .filter((b) => b.fired < pd.roundsPerBurst);

  // A round has reached the missile once it is no longer ahead of it.
  const passed = rounds.filter((r) => r.depth <= state.depth);
  if (passed.some((r) => Math.abs(r.x - state.x) <= pd.hitHalfWidth)) {
    return { ...state, rounds: [], bursts: [], nextBurstAt: null, phase: "shotDown" };
  }
  rounds = rounds.filter((r) => r.depth > state.depth);
  return { ...state, rounds, bursts, nextBurstAt };
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
