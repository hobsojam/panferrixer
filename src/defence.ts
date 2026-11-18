import type { Config } from "./config";
import { createRng, rangeInt, rangeFloat } from "./rng";

/**
 * The missile-defence mini-game as a first-person turret (design-notes 4.8). Angles are
 * in degrees: yaw is left (-) and right (+) of the launcher, pitch is down (-) and up (+)
 * from the horizon. Distance runs from 0 at the robot outward; the guns reach `gunRange`
 * and missiles leave the launcher at `launchDistance`, beyond it.
 */

export interface Bearing {
  yaw: number;
  pitch: number;
}

/**
 * One incoming missile. Every missile leaves the one launcher and flies in to the robot,
 * fanning out as it closes: its bearing moves from the launcher's to its arrival bearing,
 * and its distance falls steadily to zero. This is a tuned stand-in for perspective, so a
 * missile starts as a dot on the launcher and swings outward across the sky.
 */
export interface Missile {
  spawn: number; // defence clock time it leaves the launcher
  arrive: number; // defence clock time it reaches the robot
  from: Bearing; // the launcher
  to: Bearing; // where it arrives from, somewhere across the sky
  launchDistance: number;
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
  yaw: number; // where the view, and so the guns, are aimed; it starts on the launcher
  pitch: number;
  launcher: Bearing;
  missiles: Missile[];
  shots: Shot[];
  lastShot: number; // time of the last round, for the rate of fire
  hills: number[]; // the horizon's silhouette: heights in degrees, every HILL_STEP degrees from -HILL_SPAN
  done: boolean; // every missile has been shot down or has arrived
  endedAt: number | null; // when the last missile was resolved; the summary shows from then
}

/** Turning input for one step: each axis -1..1, scaled by the turn rate. */
export interface Aim {
  yaw: number;
  pitch: number;
}

export const HILL_STEP = 4;
export const HILL_SPAN = 100;

/**
 * The attack, all from the seed and the hunter's range: volleys of 3 to 5 missiles from
 * the one launcher, each arriving from its own point across the sky, and a hill
 * silhouette for the horizon. A nearer hunter's missiles arrive sooner.
 */
export function createDefence(seed: number, cfg: Config, rangeCells: number = cfg.dashboard.hunterEngageRange): DefenceState {
  const d = cfg.defence;
  const rng = createRng(seed);
  const travel = missileTravelFor(rangeCells, cfg);
  const launcher = { yaw: 0, pitch: d.launcherPitchDegrees };
  const missiles: Missile[] = [];
  for (let v = 0; v < d.volleys; v++) {
    const start = d.warningSeconds + v * d.volleyGapSeconds;
    const count = rangeInt(rng, d.volleyMin, d.volleyMax);
    for (let i = 0; i < count; i++) {
      const spawn = start + i * d.missileSpacingSeconds;
      missiles.push({
        spawn,
        arrive: spawn + travel,
        from: launcher,
        // Never beyond the arc, so every missile can be turned toward.
        to: {
          yaw: rangeFloat(rng, -1, 1) * Math.min(d.fanYawDegrees, d.arcYawDegrees),
          pitch: rangeFloat(rng, d.fanPitchMinDegrees, Math.min(d.fanPitchMaxDegrees, d.arcPitchUpDegrees)),
        },
        launchDistance: d.launchDistance,
        state: "flying",
        resolvedAt: null,
      });
    }
  }
  const hills = Array.from({ length: Math.floor((2 * HILL_SPAN) / HILL_STEP) + 1 }, () => rangeFloat(rng, 0.3, 2.6));
  return { elapsed: 0, yaw: launcher.yaw, pitch: 0, launcher, missiles, shots: [], lastShot: -Infinity, hills, done: false, endedAt: null };
}

/**
 * How long an incoming missile takes from a hunter this many map cells away (design-notes
 * 4.10): quickest from point blank, slowest from the edge of the hunter's engagement range.
 */
export function missileTravelFor(rangeCells: number, cfg: Config): number {
  const near = cfg.defence.missileTravelNearSeconds;
  const far = cfg.defence.missileTravelSeconds;
  return near + (far - near) * clamp(rangeCells / cfg.dashboard.hunterEngageRange, 0, 1);
}

/** True during the warning beat before the first missile leaves the launcher. */
export function isWarning(s: DefenceState, cfg: Config): boolean {
  return s.elapsed < cfg.defence.warningSeconds;
}

/** How far along its flight a missile is at time t: 0 on the launcher, 1 on arrival. */
function progress(m: Missile, t: number): number {
  return clamp((t - m.spawn) / (m.arrive - m.spawn), 0, 1);
}

/** How far a missile is from the robot at time t: the launch distance when it leaves, 0 when it arrives. */
export function missileDistance(m: Missile, t: number): number {
  return m.launchDistance * (1 - progress(m, t));
}

/** Where a missile is seen at time t: on the launcher at first, swinging out to its arrival bearing. */
export function missileBearing(m: Missile, t: number): Bearing {
  const u = progress(m, t);
  return { yaw: m.from.yaw + (m.to.yaw - m.from.yaw) * u, pitch: m.from.pitch + (m.to.pitch - m.from.pitch) * u };
}

/** How far a round has flown at time t. */
export function shotDistance(shot: Shot, t: number, cfg: Config): number {
  return Math.max(0, (t - shot.fired) * cfg.defence.shotSpeed);
}

/** Angle between two bearings, in degrees. Flat approximation: fine inside a small arc. */
export function separation(a: Bearing, b: Bearing): number {
  return Math.hypot(a.yaw - b.yaw, a.pitch - b.pitch);
}

/**
 * One fixed step of the attack. The view turns at the turn rate and stops at the edge of
 * the arc. Holding fire sends rounds out at the rate of fire, along the current bearing.
 * A round that reaches a missile near its bearing destroys it and is spent; it takes the
 * nearest one it has reached. A round with no hit is spent at the guns' range. A missile
 * that reaches the robot counts as a hit.
 */
export function stepDefence(s: DefenceState, aim: Aim, fire: boolean, dt: number, cfg: Config): DefenceState {
  // Once over, only the clock runs, for the summary (design-notes 4.8).
  if (s.done) return { ...s, elapsed: s.elapsed + dt };
  const d = cfg.defence;
  const elapsed = s.elapsed + dt;
  const turn = d.turnRateDegreesPerSecond * dt;
  const yaw = clamp(s.yaw + clamp(aim.yaw, -1, 1) * turn, s.launcher.yaw - d.arcYawDegrees, s.launcher.yaw + d.arcYawDegrees);
  const pitch = clamp(s.pitch + clamp(aim.pitch, -1, 1) * turn, -d.arcPitchDownDegrees, d.arcPitchUpDegrees);

  const missiles = s.missiles.map((m) => ({ ...m }));
  let shots = s.shots;
  let lastShot = s.lastShot;
  if (fire && elapsed - lastShot >= d.fireIntervalSeconds) {
    lastShot = elapsed;
    shots = [...shots, { fired: elapsed, yaw, pitch, state: "flying" }];
  }

  shots = shots.map((shot) => {
    if (shot.state !== "flying") return shot;
    const reach = Math.min(shotDistance(shot, elapsed, cfg), d.gunRange);
    let best: Missile | null = null;
    for (const m of missiles) {
      if (m.state !== "flying" || m.spawn > elapsed) continue;
      if (separation(missileBearing(m, elapsed), shot) > d.hitToleranceDegrees) continue;
      const md = missileDistance(m, elapsed);
      if (md <= reach && (best === null || md < missileDistance(best, elapsed))) best = m;
    }
    if (best) {
      best.state = "shot";
      best.resolvedAt = elapsed;
      return { ...shot, state: "spent" as const };
    }
    return shotDistance(shot, elapsed, cfg) > d.gunRange ? { ...shot, state: "spent" as const } : shot;
  });

  for (const m of missiles) {
    if (m.state === "flying" && m.arrive <= elapsed) {
      m.state = "hit";
      m.resolvedAt = elapsed;
    }
  }
  const done = missiles.every((m) => m.state !== "flying");
  return { ...s, elapsed, yaw, pitch, missiles, shots, lastShot, done, endedAt: done ? elapsed : null };
}

/**
 * True once the attack is over and its summary has been shown long enough: the attack
 * then returns to the dashboard by itself, with no press needed (design-notes 4.8).
 */
export function summaryOver(s: DefenceState, cfg: Config): boolean {
  return s.done && s.endedAt !== null && s.elapsed - s.endedAt >= cfg.defence.summarySeconds;
}

/** Missiles that got through: each one is a hit on the shields. */
export function hitCount(s: DefenceState): number {
  return s.missiles.filter((m) => m.state === "hit").length;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/**
 * Mouse movement as turning input for one step. The mouse asks for a turn in degrees;
 * it is expressed as a fraction of what the turn rate allows this step, and capped at
 * full deflection, so the mouse turns no faster than the keys (design-notes 4.8).
 * Moving the mouse up aims up.
 */
export function mouseAim(dxPixels: number, dyPixels: number, dt: number, cfg: Config): Aim {
  const most = cfg.defence.turnRateDegreesPerSecond * dt;
  const perPixel = cfg.defence.mouseDegreesPerPixel;
  return { yaw: clamp((dxPixels * perPixel) / most, -1, 1), pitch: clamp((-dyPixels * perPixel) / most, -1, 1) };
}

/** Keys and mouse together, still capped at full deflection. */
export function combineAim(a: Aim, b: Aim): Aim {
  return { yaw: clamp(a.yaw + b.yaw, -1, 1), pitch: clamp(a.pitch + b.pitch, -1, 1) };
}
