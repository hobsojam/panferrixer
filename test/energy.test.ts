import { describe, expect, it } from "vitest";
import { createAppState, restartAfter, updateApp, type AppInput, type AppState } from "../src/app";
import { config } from "../src/config";
import { createDashboardState, dropKind, stepDashboard, worldFor, type DashboardState, type DropKind, type World } from "../src/dashboard";
import { createInitialState } from "../src/flight";
import type { Target } from "../src/local-map";
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

describe("drops refill energy and armour", () => {
  // Ten domes far apart; the test picks one whose drop is of the kind it wants.
  const domes: Target[] = Array.from({ length: 10 }, (_, i) => ({ col: 5 + i * 6, row: 5, kind: "dome", hasDrop: true, network: 0 }));
  const world: World = { ...base, targets: domes };
  const indexOf = (kind: DropKind) => domes.findIndex((t, i) => dropKind(t, i) === kind);

  /** Standing on the ruin of a dome holding the given kind of drop. */
  function onDrop(kind: DropKind, over: Partial<DashboardState>): DashboardState {
    const i = indexOf(kind);
    return { ...createDashboardState(config), pos: { x: domes[i].col, y: domes[i].row }, ruins: [i], ...over };
  }

  it("both kinds turn up among domes", () => {
    expect(indexOf("energy")).toBeGreaterThanOrEqual(0);
    expect(indexOf("armour")).toBeGreaterThanOrEqual(0);
  });

  it("a comms centre's electronics always give energy", () => {
    for (let i = 0; i < 20; i++) expect(dropKind({ col: 0, row: 0, kind: "commsCentre", hasDrop: true, network: 0 }, i)).toBe("energy");
  });

  it("an energy drop restores cells", () => {
    const next = stepDashboard(onDrop("energy", { energyCells: 3 }), [], DT, world).state;
    expect(next.found).toEqual([indexOf("energy")]);
    expect(next.energyCells).toBeCloseTo(3 + config.energy.dropCells, 2);
  });

  it("an energy drop never overfills the bank", () => {
    const next = stepDashboard(onDrop("energy", { energyCells: FULL - 0.5 }), [], DT, world).state;
    expect(next.energyCells).toBe(FULL);
  });

  it("an armour drop restores plates", () => {
    const next = stepDashboard(onDrop("armour", { shieldPlates: 3, shieldHits: 2 }), [], DT, world).state;
    expect(next.shieldPlates).toBe(3 + config.energy.armourDropPlates);
    expect(next.shieldHits).toBe(2);
  });

  it("an armour drop that reaches full also mends the cracks", () => {
    const max = config.dashboard.shieldPlates;
    const next = stepDashboard(onDrop("armour", { shieldPlates: max - 1, shieldHits: 2 }), [], DT, world).state;
    expect(next.shieldPlates).toBe(max);
    expect(next.shieldHits).toBe(0);
  });

  it("a drop that would be wasted is left for later", () => {
    const next = stepDashboard(onDrop("armour", {}), [], DT, world).state;
    expect(next.found).toEqual([]);
    // Once damaged, the same drop is taken.
    const later = stepDashboard({ ...next, shieldHits: 1 }, [], DT, world).state;
    expect(later.found).toEqual([indexOf("armour")]);
  });
});
