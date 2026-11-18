import { describe, expect, it } from "vitest";
import type { AppState } from "../src/app";
import { config } from "../src/config";
import { createDashboardState, stepDashboard, worldFor, type Action, type DashboardState } from "../src/dashboard";
import { createDefence, stepDefence, type DefenceState } from "../src/defence";
import { createInitialState } from "../src/flight";
import { eventsBetween } from "../src/sound";

const DT = 1 / 60;
const world = worldFor(config);

function dash(s: DashboardState): AppState {
  return { screen: "dashboard", dashboard: s };
}

/** Advances the dashboard by one step with the given presses, and returns the sound events it makes. */
function dashEvents(before: DashboardState, actions: Action[]) {
  const after = stepDashboard(before, actions, DT, world).state;
  return eventsBetween(dash(before), dash(after), config);
}

describe("dashboard sounds", () => {
  it("a tick when the selection moves on the verb grid", () => {
    expect(dashEvents(createDashboardState(config), ["right"])).toEqual(["select"]);
  });

  it("a confirm when a verb is opened", () => {
    const onMove = createDashboardState(config);
    expect(dashEvents(onMove, ["activate"])).toContain("confirm");
  });

  it("a confirm when the map zoom changes", () => {
    const onMap = { ...createDashboardState(config), mapSelected: true };
    expect(dashEvents(onMap, ["activate"])).toEqual(["confirm"]);
  });

  it("a cross tick when the cross moves while choosing a point", () => {
    const choosing = { ...createDashboardState(config), mode: "moving" as const };
    expect(dashEvents(choosing, ["right"])).toEqual(["cross"]);
  });

  it("a lock when a target comes into range", () => {
    const t = world.targets[0];
    const targeting = { ...createDashboardState(config), mode: "targeting" as const, cross: { col: t.col - 5, row: t.row }, target: null };
    expect(dashEvents(targeting, ["right", "right", "right", "right"])).toContain("lock");
  });

  it("a scan sound that depends on what was found", () => {
    const near = { ...createDashboardState(config), ruins: [0], pos: { x: 5, y: 5 }, col: 1 };
    const withDrop = { ...near, scan: null };
    const world2 = { ...world, targets: [{ col: 5, row: 7, kind: "dome" as const, hasDrop: true, network: 0 }] };
    const after = stepDashboard({ ...withDrop, ruins: [0] }, ["activate"], DT, { ...world2, range: 2 });
    expect(after.state.scan).toEqual({ origin: { x: 5, y: 5 }, blips: [0], close: true });
    const origin = { x: 5, y: 5 };
    expect(eventsBetween(dash(withDrop), dash({ ...withDrop, scan: after.state.scan }), config)).toEqual(["scanNear"]);
    expect(eventsBetween(dash(withDrop), dash({ ...withDrop, scan: { origin, blips: [], close: false } }), config)).toEqual(["scanNothing"]);
    expect(eventsBetween(dash(withDrop), dash({ ...withDrop, scan: { origin, blips: [0], close: false } }), config)).toEqual(["scanFar"]);
  });

  it("a pickup sound when a drop is collected", () => {
    const before = { ...createDashboardState(config), ruins: [0] };
    const after = { ...before, found: [0] };
    expect(eventsBetween(dash(before), dash(after), config)).toEqual(["pickup"]);
  });

  it("a warning once when shields drop to low", () => {
    const before = { ...createDashboardState(config), shieldPlates: config.dashboard.lowThreshold + 1 };
    const after = { ...before, shieldPlates: config.dashboard.lowThreshold };
    expect(eventsBetween(dash(before), dash(after), config)).toEqual(["warning"]);
    expect(eventsBetween(dash(after), dash({ ...after, shieldPlates: after.shieldPlates - 1 }), config)).toEqual([]);
  });
});

describe("flight sounds", () => {
  const flying = (phase: "flight" | "terminal" | "hit" | "crash" | "miss"): AppState => ({
    screen: "flight",
    dashboard: createDashboardState(config),
    flight: { ...createInitialState(1, config), phase },
    target: world.targets[0],
    targetIndex: 0,
    shielded: false,
  });

  it("launch when a flight starts", () => {
    const launched = eventsBetween(dash(createDashboardState(config)), flying("flight"), config);
    expect(launched).toEqual(["launch"]);
  });

  it("terminal, hit, crash and miss on the matching phase change", () => {
    expect(eventsBetween(flying("flight"), flying("terminal"), config)).toEqual(["terminal"]);
    expect(eventsBetween(flying("terminal"), flying("hit"), config)).toEqual(["hit"]);
    expect(eventsBetween(flying("flight"), flying("crash"), config)).toEqual(["crash"]);
    expect(eventsBetween(flying("terminal"), flying("miss"), config)).toEqual(["miss"]);
  });

  it("no sound when the phase does not change", () => {
    expect(eventsBetween(flying("flight"), flying("flight"), config)).toEqual([]);
  });
});

describe("defence sounds", () => {
  const dashboard = createDashboardState(config);
  const defence = (d: DefenceState): AppState => ({ screen: "defence", dashboard, defence: d, attacker: 0 });
  const base = createDefence(4, config);

  it("the alarm sounds as an attack takes the screen", () => {
    expect(eventsBetween(dash(dashboard), defence(base), config)).toEqual(["incoming"]);
  });

  it("each round fired makes a gun sound", () => {
    const fired = stepDefence(base, { yaw: 0, pitch: 0 }, true, DT, config);
    expect(eventsBetween(defence(base), defence(fired), config)).toEqual(["gun"]);
  });

  it("a missile shot down and a missile getting through each have a sound", () => {
    const [m] = base.missiles;
    const shot = { ...base, missiles: [{ ...m, state: "shot" as const }, ...base.missiles.slice(1)] };
    const hit = { ...base, missiles: [{ ...m, state: "hit" as const }, ...base.missiles.slice(1)] };
    expect(eventsBetween(defence(base), defence(shot), config)).toEqual(["missileDown"]);
    expect(eventsBetween(defence(base), defence(hit), config)).toEqual(["missileHit"]);
  });

  it("each missile leaving the launcher thumps", () => {
    const first = base.missiles[0].spawn;
    const before = { ...base, elapsed: first - DT / 2 };
    const after = stepDefence(before, { yaw: 0, pitch: 0 }, false, DT, config);
    expect(eventsBetween(defence(before), defence(after), config)).toEqual(["missileLaunch"]);
  });

  it("an attack in progress with nothing happening is silent", () => {
    const next = stepDefence(base, { yaw: 0, pitch: 0 }, false, DT, config);
    expect(eventsBetween(defence(base), defence(next), config)).toEqual([]);
  });
});
