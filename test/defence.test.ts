import { describe, expect, it } from "vitest";
import { updateApp, type AppState } from "../src/app";
import { config } from "../src/config";
import { alertHunters, applyShieldHits, createDashboardState, hunterInRange, isShielded, networkOf, stepDashboard, worldFor, type DashboardState } from "../src/dashboard";
import { createDefence, hitCount, stepDefence, type DefenceState } from "../src/defence";

const DT = 1 / 60;
const world = worldFor(config);

function run(s: DefenceState, steps: number, fire: (i: number) => boolean = () => false, steer = 0): DefenceState {
  let state = s;
  for (let i = 0; i < steps && !state.done; i++) state = stepDefence(state, steer, fire(i), DT, config);
  return state;
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

  it("each missile takes the same travel time, and the attack ends after the last one arrives", () => {
    const d = createDefence(7, config);
    for (const m of d.missiles) expect(m.arrive - m.spawn).toBeCloseTo(config.defence.missileTravelSeconds);
    const last = Math.max(...d.missiles.map((m) => m.arrive));
    const finished = run(d, Math.ceil((last + 1) / DT));
    expect(finished.done).toBe(true);
  });
});

describe("tracers", () => {
  it("a tracer in a missile's lane shoots it down", () => {
    const base = createDefence(3, config);
    const s: DefenceState = {
      ...base,
      x: 0.5,
      missiles: [{ spawn: 0, arrive: 5, lane: 0.5, state: "flying" }],
    };
    const shot = stepDefence(s, 0, true, DT, config);
    expect(shot.missiles[0].state).toBe("shot");
  });

  it("a tracer out of the missile's lane misses", () => {
    const base = createDefence(3, config);
    const s: DefenceState = { ...base, x: -0.5, missiles: [{ spawn: 0, arrive: 5, lane: 0.5, state: "flying" }] };
    expect(stepDefence(s, 0, true, DT, config).missiles[0].state).toBe("flying");
  });

  it("tracers are limited by a cooldown", () => {
    const base = createDefence(3, config);
    const s: DefenceState = { ...base, elapsed: 1, lastShot: 1, x: 0, missiles: [{ spawn: 0, arrive: 5, lane: 0, state: "flying" }] };
    const again = stepDefence(s, 0, true, DT, config);
    expect(again.missiles[0].state).toBe("flying");
  });

  it("a missile that is not shot down arrives as a hit", () => {
    const d = run(createDefence(9, config), 60 * 20);
    expect(hitCount(d)).toBe(d.missiles.length);
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
    const far = { ...createDashboardState(config), pos: { x: hunter.col + world.directionRadius + 5, y: hunter.row } };
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
