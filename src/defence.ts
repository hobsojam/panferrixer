import type { Config } from "./config";
import { createRng, rangeInt, rangeFloat } from "./rng";

/**
 * The missile-defence mini-game as a first-person turret (design-notes 4.8). Angles are
 * in degrees: yaw is left (-) and right (+), pitch is down (-) and up (+). Distance runs
 * from 0 at the robot to 1 where a missile appears, which is also the guns' range.
 */

/** One incoming missile. It flies straight at the robot along a fixed bearing, growing as it closes. */
export interface Missile {
  spawn: number; // defence clock time it appears
  arrive: number; // defence clock time it reaches the robot
  yaw: number; // its bearing, inside the turret's arc
  pitch: number;
  state: "flying" | "shot" | "hit";
  resolvedAt: number | null; // when it was shot down or arrived, for the burst and flash
}

/** One round from the guns. It flies out along the bearing the view had when it was fired. */
export interface Shot {
  fired: number;
  yaw: number;
  pitch: number;
  state: "flying" | "spent"; // spent: it hit a missile or ran out of range
}

/** A hunter's attack. The robot holds still; the view turns within its arc and the guns fire at the aim point. */
export interface DefenceState {
  elapsed: number; // seconds into the engagement
  yaw: number; // where the view, and so the guns, are aimed
  pitch: number;
  missiles: Missile[];
  shots: Shot[];
  lastShot: number; // time of the last round, for the rate of fire
  done: boolean; // every missile has been shot down or has arrived
}

/** Turning input for one step: each axis -1..1, scaled by the turn rate. */
export interface Aim {
  yaw: number;
  pitch: number;
}

/** The attack's missile schedule: volleys of 3 to 5, spaced out, on bearings inside the arc. All from the seed. */
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
        // Never beyond the arc, so every missile can be turned toward.
        yaw: rangeFloat(rng, -1, 1) * Math.min(d.spawnYawDegrees, d.arcYawDegrees),
        pitch: rangeFloat(rng, -1, 1) * Math.min(d.spawnPitchDegrees, d.arcPitchDegrees),
        state: "flying",
        resolvedAt: null,
      });
    }
  }
  return { elapsed: 0, yaw: 0, pitch: 0, missiles, shots: [], lastShot: -Infinity, done: false };
}

/** True during the warning beat before the first missile appears. */
export function isWarning(s: DefenceState, cfg: Config): boolean {
  return s.elapsed < cfg.defence.warningSeconds;
}

/** How far a missile is from the robot at time t: 1 when it appears, 0 when it arrives. */
export function missileDistance(m: Missile, t: number): number {
  return clamp(1 - (t - m.spawn) / (m.arrive - m.spawn), 0, 1);
}

/** How far a round has flown at time t. */
export function shotDistance(shot: Shot, t: number, cfg: Config): number {
  return Math.max(0, (t - shot.fired) * cfg.defence.shotSpeed);
}

/** Angle between two bearings, in degrees. Flat approximation: fine inside a small arc. */
export function separation(a: { yaw: number; pitch: number }, b: { yaw: number; pitch: number }): number {
  return Math.hypot(a.yaw - b.yaw, a.pitch - b.pitch);
}

/**
 * One fixed step of the attack. The view turns at the turn rate and stops at the edge of
 * the arc. Holding fire sends rounds out at the rate of fire, along the current bearing.
 * A round that reaches a missile on its bearing destroys it and is spent; it takes the
 * nearest one it has reached. A missile that reaches the robot counts as a hit.
 */
export function stepDefence(s: DefenceState, aim: Aim, fire: boolean, dt: number, cfg: Config): DefenceState {
  if (s.done) return s;
  const d = cfg.defence;
  const elapsed = s.elapsed + dt;
  const turn = d.turnRateDegreesPerSecond * dt;
  const yaw = clamp(s.yaw + clamp(aim.yaw, -1, 1) * turn, -d.arcYawDegrees, d.arcYawDegrees);
  const pitch = clamp(s.pitch + clamp(aim.pitch, -1, 1) * turn, -d.arcPitchDegrees, d.arcPitchDegrees);

  const missiles = s.missiles.map((m) => ({ ...m }));
  let shots = s.shots;
  let lastShot = s.lastShot;
  if (fire && elapsed - lastShot >= d.fireIntervalSeconds) {
    lastShot = elapsed;
    shots = [...shots, { fired: elapsed, yaw, pitch, state: "flying" }];
  }

  shots = shots.map((shot) => {
    if (shot.state !== "flying") return shot;
    const reach = shotDistance(shot, elapsed, cfg);
    let best: Missile | null = null;
    for (const m of missiles) {
      if (m.state !== "flying" || m.spawn > elapsed) continue;
      if (separation(m, shot) > d.hitToleranceDegrees) continue;
      const md = missileDistance(m, elapsed);
      if (md <= reach && (best === null || md < missileDistance(best, elapsed))) best = m;
    }
    if (best) {
      best.state = "shot";
      best.resolvedAt = elapsed;
      return { ...shot, state: "spent" as const };
    }
    return reach > 1 ? { ...shot, state: "spent" as const } : shot;
  });

  for (const m of missiles) {
    if (m.state === "flying" && m.arrive <= elapsed) {
      m.state = "hit";
      m.resolvedAt = elapsed;
    }
  }
  const done = missiles.every((m) => m.state !== "flying");
  return { elapsed, yaw, pitch, missiles, shots, lastShot, done };
}

/** Missiles that got through: each one is a hit on the shields. */
export function hitCount(s: DefenceState): number {
  return s.missiles.filter((m) => m.state === "hit").length;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
