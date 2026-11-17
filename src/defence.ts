import type { Config } from "./config";
import { createRng, rangeInt, rangeFloat } from "./rng";

/** One incoming missile. It flies in along its lane until it arrives, or a tracer shoots it down first. */
export interface Missile {
  spawn: number; // defence clock time it appears
  arrive: number; // defence clock time it reaches the robot
  lane: number; // lateral position, -1..1, where it comes in
  state: "flying" | "shot" | "hit";
}

/** A hunter's attack: the robot steers and fires tracers at incoming missiles. */
export interface DefenceState {
  elapsed: number; // seconds into the engagement
  x: number; // the robot's lateral position, -1..1
  missiles: Missile[];
  tracers: number[]; // times tracers were fired, so the screen can draw them
  lastShot: number; // time of the last tracer, for the cooldown
  done: boolean; // every missile has been shot down or has arrived
}

/** The attack's missile schedule: volleys of 3 to 5, spaced out, all derived from the seed. */
export function createDefence(seed: number, cfg: Config): DefenceState {
  const d = cfg.defence;
  const rng = createRng(seed);
  const missiles: Missile[] = [];
  for (let v = 0; v < d.volleys; v++) {
    const start = d.warningSeconds + v * d.volleyGapSeconds;
    const count = rangeInt(rng, d.volleyMin, d.volleyMax);
    for (let i = 0; i < count; i++) {
      const spawn = start + i * d.missileSpacingSeconds;
      missiles.push({
        spawn,
        arrive: spawn + d.missileTravelSeconds,
        lane: rangeFloat(rng, -d.laneMax, d.laneMax),
        state: "flying",
      });
    }
  }
  return { elapsed: 0, x: 0, missiles, tracers: [], lastShot: -Infinity, done: false };
}

/**
 * One fixed step of the attack. Steering moves the robot along the lanes. A fresh fire
 * press fires a tracer, which shoots down the first airborne missile in its lane.
 * A missile that reaches the robot counts as a hit.
 */
export function stepDefence(s: DefenceState, steering: number, fire: boolean, dt: number, cfg: Config): DefenceState {
  if (s.done) return s;
  const d = cfg.defence;
  const elapsed = s.elapsed + dt;
  const x = clamp(s.x + steering * cfg.steering.lateralSpeed * dt, -1, 1);
  let missiles = s.missiles;
  let tracers = s.tracers;
  let lastShot = s.lastShot;

  if (fire && elapsed - lastShot >= d.tracerCooldownSeconds) {
    lastShot = elapsed;
    tracers = [...tracers, elapsed];
    const hit = missiles.findIndex(
      (m) => m.state === "flying" && m.spawn <= elapsed && Math.abs(m.lane - x) <= d.tracerToleranceLateral
    );
    if (hit >= 0) {
      missiles = missiles.map((m, i) => (i === hit ? { ...m, state: "shot" as const } : m));
    }
  }

  missiles = missiles.map((m) => (m.state === "flying" && m.arrive <= elapsed ? { ...m, state: "hit" as const } : m));
  const done = missiles.every((m) => m.state !== "flying");
  return { elapsed, x, missiles, tracers, lastShot, done };
}

/** Missiles that got through: each one is a hit on the shields. */
export function hitCount(s: DefenceState): number {
  return s.missiles.filter((m) => m.state === "hit").length;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
