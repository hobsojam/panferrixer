import { describe, expect, it } from "vitest";
import { updateApp, type AppState } from "../src/app";
import { config } from "../src/config";
import { alertHunters, applyShieldHits, createDashboardState, hunterInRange, isShielded, networkOf, stepDashboard, worldFor, type DashboardState } from "../src/dashboard";
import { combineAim, createDefence, hitCount, isWarning, missileBearing, missileDistance, mouseAim, stepDefence, type DefenceState, type Missile } from "../src/defence";

const DT = 1 / 60;
const world = worldFor(config);

const STILL = { yaw: 0, pitch: 0 };

function run(s: DefenceState, steps: number, fire: (i: number) => boolean = () => false): DefenceState {
  let state = s;
  for (let i = 0; i < steps && !state.done; i++) state = stepDefence(state, STILL, fire(i), DT, config);
  return state;
}

/** A missile that stays on one bearing (no fan), launched at `spawn` from inside the guns' range. */
function oneMissile(yaw: number, pitch: number, spawn = 0, launchDistance = 1): Missile {
  const at = { yaw, pitch };
  return { spawn, arrive: spawn + config.defence.missileTravelSeconds, from: at, to: at, launchDistance, state: "flying", resolvedAt: null };
}

function withMissiles(missiles: Missile[], view = { yaw: 0, pitch: 0 }): DefenceState {
  return { ...createDefence(3, config), ...view, missiles };
}

describe("missile schedule", () => {
  it("is volleys of 3 to 5 missiles, three volleys, spaced out", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const d = createDefence(seed, config);
      const total = d.missiles.length;
      expect(total).toBeGreaterThanOrEqual(3 * config.defence.volleys);
      expect(total).toBeLessThanOrEqual(5 * config.defence.volleys);
    }
  });

  it("nothing leaves the launcher during the warning beat", () => {
    const d = createDefence(7, config);
    expect(isWarning(d, config)).toBe(true);
    for (const m of d.missiles) expect(m.spawn).toBeGreaterThanOrEqual(config.defence.warningSeconds);
  });

  it("each missile takes the same travel time, and the attack ends after the last one arrives", () => {
    const d = createDefence(7, config);
    for (const m of d.missiles) expect(m.arrive - m.spawn).toBeCloseTo(config.defence.missileTravelSeconds);
    const last = Math.max(...d.missiles.map((m) => m.arrive));
    const finished = run(d, Math.ceil((last + 1) / DT));
    expect(finished.done).toBe(true);
  });
});

describe("a strike from a single enemy", () => {
  it("the view starts facing the launcher", () => {
    const d = createDefence(5, config);
    expect(d.yaw).toBe(d.launcher.yaw);
    expect(d.pitch).toBe(0);
  });

  it("every missile leaves the one launcher", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const d = createDefence(seed, config);
      for (const m of d.missiles) {
        expect(m.from).toEqual(d.launcher);
        expect(missileBearing(m, m.spawn)).toEqual(d.launcher);
      }
    }
  });

  it("missiles fan out as they close, arriving from the sky inside the arc", () => {
    for (let seed = 1; seed <= 20; seed++) {
      for (const m of createDefence(seed, config).missiles) {
        expect(missileBearing(m, m.arrive)).toEqual(m.to);
        expect(Math.abs(m.to.yaw)).toBeLessThanOrEqual(config.defence.arcYawDegrees);
        expect(m.to.pitch).toBeGreaterThan(0);
        expect(m.to.pitch).toBeLessThanOrEqual(config.defence.arcPitchUpDegrees);
      }
    }
  });

  it("missiles leave the launcher beyond the guns' range", () => {
    const m = createDefence(5, config).missiles[0];
    expect(missileDistance(m, m.spawn)).toBeGreaterThan(config.defence.gunRange);
    expect(missileDistance(m, m.arrive)).toBe(0);
  });

  it("holding fire on the launcher does not stop an attack", () => {
    const d = run(createDefence(11, config), 60 * 20, () => true);
    expect(hitCount(d) / d.missiles.length).toBeGreaterThan(0.5);
  });

  it("each attack has its own hill silhouette", () => {
    expect(createDefence(1, config).hills).not.toEqual(createDefence(2, config).hills);
    expect(createDefence(1, config).hills).toEqual(createDefence(1, config).hills);
  });
});

describe("turning", () => {
  it("the view turns at the turn rate on both axes", () => {
    const s = stepDefence(withMissiles([oneMissile(0, 0)]), { yaw: 1, pitch: 1 }, false, 0.1, config);
    expect(s.yaw).toBeCloseTo(config.defence.turnRateDegreesPerSecond * 0.1);
    expect(s.pitch).toBeCloseTo(config.defence.turnRateDegreesPerSecond * 0.1);
  });

  it("input beyond full deflection is capped, so the mouse cannot out-turn the keys", () => {
    const s = stepDefence(withMissiles([oneMissile(0, 0)]), { yaw: 50, pitch: 0 }, false, 0.1, config);
    expect(s.yaw).toBeCloseTo(config.defence.turnRateDegreesPerSecond * 0.1);
  });

  it("the view stops at the edges of the arc, and only a little below the horizon", () => {
    let s = withMissiles([oneMissile(0, 0, 100)]);
    for (let i = 0; i < 600; i++) s = stepDefence(s, { yaw: -1, pitch: 1 }, false, DT, config);
    expect(s.yaw).toBe(-config.defence.arcYawDegrees);
    expect(s.pitch).toBe(config.defence.arcPitchUpDegrees);
    for (let i = 0; i < 600; i++) s = stepDefence(s, { yaw: 0, pitch: -1 }, false, DT, config);
    expect(s.pitch).toBe(-config.defence.arcPitchDownDegrees);
  });
});

describe("the guns", () => {
  it("a round on a missile's bearing destroys it, but only once it has flown out to it", () => {
    let s = stepDefence(withMissiles([oneMissile(10, 5)], { yaw: 10, pitch: 5 }), STILL, true, DT, config);
    expect(s.missiles[0].state).toBe("flying");
    for (let i = 0; i < 60 && s.missiles[0].state === "flying"; i++) s = stepDefence(s, STILL, false, DT, config);
    expect(s.missiles[0].state).toBe("shot");
    expect(s.missiles[0].resolvedAt).not.toBeNull();
    expect(s.shots[0].state).toBe("spent");
  });

  it("a round off the missile's bearing misses", () => {
    const s = run(withMissiles([oneMissile(10, 5)], { yaw: -10, pitch: 5 }), 400, (i) => i === 0);
    expect(s.missiles[0].state).toBe("hit");
  });

  it("a round keeps its bearing when the view turns after firing", () => {
    let s = stepDefence(withMissiles([oneMissile(0, 0)]), STILL, true, DT, config);
    for (let i = 0; i < 60 && s.missiles[0].state === "flying"; i++) s = stepDefence(s, { yaw: 1, pitch: 0 }, false, DT, config);
    expect(s.missiles[0].state).toBe("shot");
  });

  it("a round cannot reach a missile beyond the guns' range", () => {
    const far = oneMissile(0, 0, 0, 10); // ten times the guns' range away, and slow to close
    const s = run(withMissiles([far]), 60, (i) => i === 0);
    expect(s.missiles[0].state).toBe("flying");
    expect(s.shots[0].state).toBe("spent");
  });

  it("holding fire is limited by the rate of fire", () => {
    const s = run(withMissiles([oneMissile(0, 0, 100)]), 60, () => true);
    const expected = Math.floor(1 / config.defence.fireIntervalSeconds) + 1;
    expect(s.shots.length).toBeGreaterThanOrEqual(expected - 1);
    expect(s.shots.length).toBeLessThanOrEqual(expected);
  });

  it("a round takes the nearest of two missiles on its bearing", () => {
    const far = oneMissile(0, 0, 0);
    const near = oneMissile(0, 0, -1); // left a second earlier, so it is closer
    let s = stepDefence(withMissiles([far, near]), STILL, true, DT, config);
    for (let i = 0; i < 60 && s.shots[0].state === "flying"; i++) s = stepDefence(s, STILL, false, DT, config);
    expect(s.missiles[1].state).toBe("shot");
    expect(s.missiles[0].state).toBe("flying");
  });

  it("a round that reaches the guns' range without a hit is spent", () => {
    const steps = Math.ceil((1.2 * config.defence.gunRange) / config.defence.shotSpeed / DT);
    const s = run(withMissiles([oneMissile(30, 0, 100)]), steps, (i) => i === 0);
    expect(s.shots[0].state).toBe("spent");
  });

  it("a missile that is not shot down arrives as a hit", () => {
    const d = run(createDefence(9, config), 60 * 20);
    expect(hitCount(d)).toBe(d.missiles.length);
  });
});

describe("balance", () => {
  // A simple competent gunner: turn toward the nearest missile, fire when lined up.
  function gunner(s: DefenceState): { aim: { yaw: number; pitch: number }; fire: boolean } {
    const live = s.missiles.filter((m) => m.state === "flying" && m.spawn <= s.elapsed);
    if (live.length === 0) return { aim: STILL, fire: false };
    const target = live.reduce((a, b) => (missileDistance(a, s.elapsed) < missileDistance(b, s.elapsed) ? a : b));
    const at = missileBearing(target, s.elapsed);
    const step = config.defence.turnRateDegreesPerSecond * DT;
    const aim = {
      yaw: Math.max(-1, Math.min(1, (at.yaw - s.yaw) / step)),
      pitch: Math.max(-1, Math.min(1, (at.pitch - s.pitch) / step)),
    };
    return { aim, fire: Math.hypot(at.yaw - s.yaw, at.pitch - s.pitch) <= config.defence.hitToleranceDegrees };
  }

  it("a competent gunner shoots down most missiles, but not every one every time", () => {
    let shot = 0;
    let total = 0;
    for (let seed = 1; seed <= 20; seed++) {
      let s = createDefence(seed, config);
      for (let i = 0; i < 60 * 30 && !s.done; i++) {
        const g = gunner(s);
        s = stepDefence(s, g.aim, g.fire, DT, config);
      }
      shot += s.missiles.filter((m) => m.state === "shot").length;
      total += s.missiles.length;
    }
    // design-notes 4.9 assumes about half shot down for an average player; a tireless bot should do better.
    expect(shot / total).toBeGreaterThan(0.6);
    expect(shot / total).toBeLessThan(1);
  });
});

describe("shield hits", () => {
  it("three hits take one plate, and two hits leave the top plate cracked", () => {
    const base: DashboardState = createDashboardState(config);
    const three = applyShieldHits(base, 3, 3);
    expect(three.shieldPlates).toBe(config.dashboard.shieldPlates - 1);
    expect(three.shieldHits).toBe(0);
    const two = applyShieldHits(base, 2, 3);
    expect(two.shieldPlates).toBe(config.dashboard.shieldPlates);
    expect(two.shieldHits).toBe(2);
  });

  it("plates never go below zero", () => {
    const base = createDashboardState(config);
    expect(applyShieldHits(base, 1000, 3).shieldPlates).toBe(0);
  });
});

describe("hunters", () => {
  it("every network has exactly one hunter", () => {
    world.towns.forEach((_, network) => {
      const hunters = world.targets.filter((t) => t.kind === "hunter" && networkOf(t) === network);
      expect(hunters).toHaveLength(1);
    });
  });

  it("a hunter is never shielded and never leaves a drop", () => {
    for (const t of world.targets) {
      if (t.kind !== "hunter") continue;
      expect(isShielded(createDashboardState(config), t)).toBe(false);
      expect(t.hasDrop).toBe(false);
    }
  });

  it("a scan alerts the hunters its ring reaches, and only those", () => {
    const hunter = world.targets.find((t) => t.kind === "hunter")!;
    const near = { ...createDashboardState(config), pos: { x: hunter.col, y: hunter.row } };
    expect(alertHunters(near, world)).toContain(world.targets.indexOf(hunter));
    const far = { ...createDashboardState(config), pos: { x: hunter.col + world.scanRadius + 5, y: hunter.row } };
    expect(alertHunters(far, world)).not.toContain(world.targets.indexOf(hunter));
  });

  it("an alerted hunter opens fire only when the robot is within its engage range", () => {
    const hunterIndex = world.targets.findIndex((t) => t.kind === "hunter");
    const hunter = world.targets[hunterIndex];
    const close = { ...createDashboardState(config), pos: { x: hunter.col, y: hunter.row }, alerted: [hunterIndex] };
    expect(hunterInRange(close, world, config.dashboard.hunterEngageRange)).toBe(hunterIndex);
    const apart = { ...close, pos: { x: hunter.col + config.dashboard.hunterEngageRange + 3, y: hunter.row } };
    expect(hunterInRange(apart, world, config.dashboard.hunterEngageRange)).toBeNull();
  });

  it("a destroyed hunter does not fire", () => {
    const hunterIndex = world.targets.findIndex((t) => t.kind === "hunter");
    const hunter = world.targets[hunterIndex];
    const dead = { ...createDashboardState(config), pos: { x: hunter.col, y: hunter.row }, alerted: [hunterIndex], ruins: [hunterIndex] };
    expect(hunterInRange(dead, world, config.dashboard.hunterEngageRange)).toBeNull();
  });
});

describe("the attack from the app", () => {
  it("an alerted hunter in range starts an attack, and its hits come off the shields when it ends", () => {
    const hunterIndex = world.targets.findIndex((t) => t.kind === "hunter");
    const hunter = world.targets[hunterIndex];
    const start: AppState = {
      screen: "dashboard",
      dashboard: { ...createDashboardState(config), pos: { x: hunter.col, y: hunter.row }, alerted: [hunterIndex] },
    };
    const seed = 5;
    const first = updateApp(start, { actions: [], steering: 0 }, DT, config, () => seed);
    expect(first.screen).toBe("defence");

    let state: AppState = first;
    for (let i = 0; i < 60 * 30 && state.screen === "defence"; i++) {
      state = updateApp(state, { actions: [], steering: 0 }, DT, config, () => seed);
    }
    expect(state.screen).toBe("dashboard");
    if (state.screen !== "dashboard") return;

    const total = createDefence(seed, config).missiles.length;
    // Shield points left: each plate is worth hitsPerPlate, less the hits on the top plate.
    const pointsLeft = state.dashboard.shieldPlates * config.dashboard.hitsPerPlate - state.dashboard.shieldHits;
    expect(config.dashboard.shieldPlates * config.dashboard.hitsPerPlate - pointsLeft).toBe(total);
    // The alert stays: the hunter keeps coming until it leaves its leash or dies.
    expect(state.dashboard.alerted).toContain(hunterIndex);
  });

  it("no attack without an alert", () => {
    const hunter = world.targets.find((t) => t.kind === "hunter")!;
    const start: AppState = { screen: "dashboard", dashboard: { ...createDashboardState(config), pos: { x: hunter.col, y: hunter.row } } };
    expect(updateApp(start, { actions: [], steering: 0 }, DT, config, () => 1).screen).toBe("dashboard");
  });
});

describe("scans", () => {
  it("a scan alerts the hunters it reaches", () => {
    const hunter = world.targets.find((t) => t.kind === "hunter")!;
    const start = { ...createDashboardState(config), row: 0, col: 1, pos: { x: hunter.col, y: hunter.row } };
    const scanned = stepDashboard(start, ["activate"], DT, world).state;
    expect(scanned.alerted.length).toBeGreaterThan(0);
  });
});

describe("mouse aiming", () => {
  const most = config.defence.turnRateDegreesPerSecond * DT;

  it("a small movement turns by its degrees, as a fraction of the step's turn", () => {
    const pixels = most / 2 / config.defence.mouseDegreesPerPixel;
    expect(mouseAim(pixels, 0, DT, config).yaw).toBeCloseTo(0.5);
  });

  it("moving the mouse up aims up", () => {
    expect(mouseAim(0, -1, DT, config).pitch).toBeGreaterThan(0);
  });

  it("a big flick is capped at the turn rate, so the mouse never out-turns the keys", () => {
    expect(mouseAim(10000, -10000, DT, config)).toEqual({ yaw: 1, pitch: 1 });
  });

  it("keys and mouse together are still capped", () => {
    expect(combineAim({ yaw: 1, pitch: -1 }, { yaw: 0.6, pitch: -0.6 })).toEqual({ yaw: 1, pitch: -1 });
    expect(combineAim({ yaw: 1, pitch: 0 }, { yaw: -0.25, pitch: 0.5 })).toEqual({ yaw: 0.75, pitch: 0.5 });
  });
});
