import { describe, expect, it } from "vitest";
import { createAppState, restartAfter, updateApp, type AppInput, type AppState } from "../src/app";
import { config } from "../src/config";
import { createDashboardState, stepDashboard, worldFor, type DashboardState, type World } from "../src/dashboard";
import { createInitialState } from "../src/flight";
import { generateWorld, type Supply, type Target } from "../src/local-map";
import { eventsBetween } from "../src/sound";

// The energy economy (#15): energy drains with time and walking, drops refill it, and an
// empty bank is death by power-down (design-notes 3, item 18).
const DT = 1 / 60;
const idle: AppInput = { actions: [], steering: 0 };
const press: AppInput = { actions: ["activate"], steering: 0 };
const seeds = () => 5;
const base = worldFor(config);
const FULL = config.dashboard.energyCells;

function dashboardWith(over: Partial<DashboardState>): AppState {
  return { screen: "dashboard", dashboard: { ...createDashboardState(config), ...over } };
}

function run(s: AppState, seconds: number, input: AppInput = idle): AppState {
  let state = s;
  for (let i = 0; i < Math.round(seconds / DT); i++) state = updateApp(state, input, DT, config, seeds);
  return state;
}

function energyOf(s: AppState): number {
  if (s.screen === "destroyed") throw new Error("expected a live screen");
  return s.dashboard.energyCells;
}

describe("energy drains", () => {
  it("drains slowly with time, standing still", () => {
    const s = run(dashboardWith({}), 10);
    expect(energyOf(s)).toBeCloseTo(FULL - 10 * config.energy.drainPerSecond, 5);
  });

  it("walking drains more than standing", () => {
    const start = createDashboardState(config);
    const standing = stepDashboard(start, [], 1, base).state;
    const walking = stepDashboard({ ...start, route: [{ x: start.pos.x + 1, y: start.pos.y }] }, [], 0.2, base).state;
    const perSecondStanding = FULL - standing.energyCells;
    const perSecondWalking = (FULL - walking.energyCells) / 0.2;
    expect(perSecondWalking).toBeGreaterThan(perSecondStanding);
  });

  it("does not drain while a chooser stops time", () => {
    const s = run(dashboardWith({ mode: "targeting" }), 5);
    expect(energyOf(s)).toBe(FULL);
  });

  it("keeps draining during a missile flight", () => {
    const index = base.targets.findIndex((t) => t.kind === "dome");
    const flying: AppState = {
      screen: "flight",
      dashboard: createDashboardState(config),
      flight: createInitialState(1, config),
      target: base.targets[index],
      targetIndex: index,
      shielded: true,
    };
    const after = updateApp(flying, idle, 1, config, seeds);
    expect(energyOf(after)).toBeLessThan(FULL);
  });
});

describe("zero energy is death by power-down", () => {
  it("the robot stops the moment the bank is empty, on the screen it was on", () => {
    const s = updateApp(dashboardWith({ energyCells: 0.0001 }), idle, DT, config, seeds);
    expect(s.screen).toBe("destroyed");
    if (s.screen !== "destroyed") return;
    expect(s.cause).toBe("energy");
    expect(s.from?.screen).toBe("dashboard");
  });

  it("can run flat mid-flight, and the flight is what powers down", () => {
    const index = base.targets.findIndex((t) => t.kind === "dome");
    const flying: AppState = {
      screen: "flight",
      dashboard: { ...createDashboardState(config), energyCells: 0.0001 },
      flight: createInitialState(1, config),
      target: base.targets[index],
      targetIndex: index,
      shielded: true,
    };
    const s = updateApp(flying, idle, DT, config, seeds);
    expect(s.screen === "destroyed" && s.cause === "energy" && s.from?.screen).toBe("flight");
  });

  it("powers down with its own sound, not the explosion", () => {
    const before = dashboardWith({ energyCells: 0.0001 });
    expect(eventsBetween(before, updateApp(before, idle, DT, config, seeds), config)).toEqual(["powerDown"]);
  });

  it("shield death keeps its own cause and explosion", () => {
    const dead: AppState = { screen: "destroyed", cause: "shields", elapsed: 0, seed: 1, from: null };
    expect(eventsBetween(dashboardWith({}), dead, config)).toEqual(["destroyed"]);
  });

  it("waits for the screen to go dark before a press starts a new game", () => {
    let s = updateApp(dashboardWith({ energyCells: 0.0001 }), idle, DT, config, seeds);
    s = run(s, restartAfter("energy", config) - 0.2, press);
    expect(s.screen).toBe("destroyed");
    s = run(s, 0.3);
    expect(updateApp(s, press, DT, config, seeds)).toEqual(createAppState(config));
  });

  it("the power-down lasts longer than the wreck, so the fade is seen before the prompt", () => {
    expect(restartAfter("energy", config)).toBeGreaterThan(restartAfter("shields", config));
  });
});

describe("supplies refill energy and armour", () => {
  /** Standing on the ruin of a dome holding the given supplies. */
  function onRuin(supplies: Supply[], over: Partial<DashboardState>): { s: DashboardState; world: World } {
    const dome: Target = { col: 5, row: 5, kind: "dome", supplies, network: 0 };
    return { s: { ...createDashboardState(config), pos: { x: 5, y: 5 }, ruins: [0], ...over }, world: { ...base, targets: [dome] } };
  }
  function step(supplies: Supply[], over: Partial<DashboardState>): DashboardState {
    const { s, world } = onRuin(supplies, over);
    return stepDashboard(s, [], DT, world).state;
  }

  it("each unit of energy restores a cell", () => {
    const next = step(["energy", "energy"], { energyCells: 3 });
    expect(next.found).toEqual([{ target: 0, supply: "energy" }, { target: 0, supply: "energy" }]);
    expect(next.energyCells).toBeCloseTo(5, 2);
  });

  it("units that would overfill are left for later, the rest taken", () => {
    const { s, world } = onRuin(["energy", "energy"], { energyCells: FULL - 0.5 });
    const next = stepDashboard(s, [], DT, world).state;
    expect(next.found).toEqual([{ target: 0, supply: "energy" }]);
    expect(next.energyCells).toBe(FULL);
    // Drained again, the robot finds the second cell still there.
    const later = stepDashboard({ ...next, energyCells: 4 }, [], DT, world).state;
    expect(later.found).toHaveLength(2);
  });

  it("an energy drop never overfills the bank", () => {
    const next = step(["energy"], { energyCells: FULL - 0.5 });
    expect(next.energyCells).toBe(FULL);
  });

  it("each unit of armour fully mends the weakest plate, broken ones first", () => {
    const next = step(["armour", "armour"], { plates: [3, 0, 2, 3, 0, 1, 3, 0] });
    expect(next.plates).toEqual([3, 3, 2, 3, 3, 1, 3, 0]);
  });

  it("with no plate broken, armour mends the most cracked", () => {
    const next = step(["armour", "armour"], { plates: [3, 2, 1, 3, 3, 1, 3, 3] });
    expect(next.plates).toEqual([3, 2, 3, 3, 3, 3, 3, 3]);
  });

  it("a supply that would be wasted is left for later", () => {
    const { s: full, world } = onRuin(["armour"], {});
    const next = stepDashboard(full, [], DT, world).state;
    expect(next.found).toEqual([]);
    // Once damaged, the same supply is taken.
    const later = stepDashboard({ ...next, plates: [3, 3, 3, 2, 3, 3, 3, 3] }, [], DT, world).state;
    expect(later.found).toEqual([{ target: 0, supply: "armour" }]);
  });

  it("a ruin holding both supplies gives both", () => {
    const next = step(["energy", "armour"], { energyCells: 3, plates: [3, 3, 3, 0, 3, 3, 3, 3] });
    expect(next.found).toEqual([{ target: 0, supply: "energy" }, { target: 0, supply: "armour" }]);
    expect(next.energyCells).toBeCloseTo(4, 2);
    expect(next.plates[3]).toBe(config.dashboard.hitsPerPlate);
  });

  it("from a ruin holding both, only the wanted one is taken and the other waits", () => {
    const { s, world } = onRuin(["energy", "armour"], { energyCells: 3 });
    const next = stepDashboard(s, [], DT, world).state;
    expect(next.found).toEqual([{ target: 0, supply: "energy" }]);
    const later = stepDashboard({ ...next, plates: [3, 3, 2, 3, 3, 3, 3, 3] }, [], DT, world).state;
    expect(later.found).toEqual([{ target: 0, supply: "energy" }, { target: 0, supply: "armour" }]);
  });
});

describe("what each building and enemy holds", () => {
  const { targets } = generateWorld(config.localMap);
  const holding = (kind: Target["kind"]) => targets.filter((t) => t.kind === kind);

  it("power stations and patrollers hold nothing", () => {
    for (const t of targets) if (t.kind === "power" || t.kind === "patroller") expect(t.supplies).toEqual([]);
  });

  it("never more units than a kind's maximum", () => {
    for (const t of targets) {
      const rolls = config.localMap.supplyChances[t.kind as keyof typeof config.localMap.supplyChances];
      if (rolls === undefined) continue;
      for (const supply of ["energy", "armour", "missiles"] as const) {
        expect(t.supplies.filter((s) => s === supply).length).toBeLessThanOrEqual(rolls[supply].max);
      }
    }
  });

  it("hunters lean to missiles and energy, defenders to armour", () => {
    const count = (kind: Target["kind"], supply: Supply) => holding(kind).reduce((n, t) => n + t.supplies.filter((s) => s === supply).length, 0) / holding(kind).length;
    expect(count("hunter", "missiles")).toBeGreaterThan(count("defender", "missiles"));
    expect(count("defender", "armour")).toBeGreaterThan(count("hunter", "armour"));
  });

  it("supplies are rolled unit by unit, so what a building holds varies", () => {
    const buildings = [...holding("dome"), ...holding("mine"), ...holding("commsCentre")];
    const sizes = new Set(buildings.map((t) => t.supplies.length));
    expect(sizes.size).toBeGreaterThan(2);
    expect(buildings.some((t) => new Set(t.supplies).size >= 2)).toBe(true);
  });

  it("every dome holds at least one missile, so a hit with the last missile pays it back", () => {
    for (const t of holding("dome")) expect(t.supplies.filter((s) => s === "missiles").length).toBeGreaterThanOrEqual(1);
  });

  it("domes are the arsenal: they hold more missiles than any other kind of building", () => {
    const missilesPer = (kind: Target["kind"]) => holding(kind).reduce((n, t) => n + t.supplies.filter((s) => s === "missiles").length, 0) / holding(kind).length;
    expect(missilesPer("dome")).toBeGreaterThan(missilesPer("mine"));
    expect(missilesPer("dome")).toBeGreaterThan(missilesPer("commsCentre"));
  });
});
