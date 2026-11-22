import { describe, expect, it } from "vitest";
import { dashboardOf } from "./helpers";
import { updateApp, type AppInput, type AppState } from "../src/app";
import { config } from "../src/config";
import {
  alertHunters,
  alertTo,
  createDashboardState,
  hunterInRange,
  isPaused,
  moveHunters,
  positionOf,
  spendAttack,
  stepDashboard,
  worldFor,
  type DashboardState, isDisarmed } from "../src/dashboard";
import { createInitialState } from "../src/flight";

// Turn-taking: time stops while targeting, a breather after each attack, and a magazine.
// design-notes 4.10.
const DT = 1 / 60;
const world = worldFor(config);
const hunterIndex = world.targets.findIndex((t) => t.kind === "hunter");
const hunter = world.targets[hunterIndex];
const post = { x: hunter.col, y: hunter.row };
const idle: AppInput = { actions: [], steering: 0 };
const range = config.dashboard.hunterEngageRange;

/** The robot beside an alerted hunter that is ready to attack. */
function beside(extra: Partial<DashboardState> = {}): DashboardState {
  return { ...createDashboardState(config), pos: { ...post }, alerted: [hunterIndex], ...extra };
}

function run(s: DashboardState, seconds: number): DashboardState {
  let state = s;
  for (let i = 0; i < seconds / DT; i++) state = moveHunters({ ...state, time: state.time + DT }, world, DT);
  return state;
}

describe("time stops while a chooser is open", () => {
  it("the Missile, Grid Disable and Move choosers pause; browsing does not", () => {
    const s = createDashboardState(config);
    expect(isPaused({ ...s, mode: "targeting" })).toBe(true);
    expect(isPaused({ ...s, mode: "moving" })).toBe(true);
    expect(isPaused({ ...s, mode: "browse" })).toBe(false);
  });

  it("the clock and the walk stop while choosing", () => {
    const walking: DashboardState = { ...createDashboardState(config), mode: "targeting", route: [{ x: 20, y: 8 }] };
    const after = stepDashboard(walking, [], 1, world).state;
    expect(after.time).toBe(walking.time);
    expect(after.pos).toEqual(walking.pos);
  });

  it("no hunter moves and no attack starts while choosing, even one that is ready and in range", () => {
    const choosing: AppState = { screen: "dashboard" as const, dashboard: { ...beside(), mode: "targeting", hunterPos: { [hunterIndex]: { x: post.x + 3, y: post.y } } } };
    let s: AppState = choosing;
    for (let i = 0; i < 120; i++) s = updateApp(s, idle, DT, config, () => 5);
    expect(s.screen).toBe("dashboard");
    expect(positionOf(dashboardOf(s), hunterIndex, world)).toEqual({ x: post.x + 3, y: post.y });
    // Closing the chooser lets time run again, and the attack comes.
    s = updateApp(s, { ...idle, actions: ["cancel"] }, DT, config, () => 5);
    s = updateApp(s, idle, DT, config, () => 5);
    expect(s.screen).toBe("defence");
  });
});

describe("a breather after each incoming attack", () => {
  it("after an attack ends, no enemy may start another for the breather", () => {
    let s: AppState = updateApp({ screen: "dashboard", dashboard: beside() }, idle, DT, config, () => 5);
    expect(s.screen).toBe("defence");
    for (let i = 0; i < 60 * 30 && s.screen === "defence"; i++) s = updateApp(s, idle, DT, config, () => 5);
    expect(s.screen).toBe("dashboard");
    expect(dashboardOf(s).breatherUntil).toBeCloseTo(dashboardOf(s).time + config.dashboard.attackBreatherSeconds);
    // A second hunter, ready and in range, still has to wait.
    const other = world.targets.findIndex((t, i) => t.kind === "hunter" && i !== hunterIndex);
    const d = dashboardOf(s);
    const crowded = { ...d, alerted: [...d.alerted, other], hunterPos: { ...d.hunterPos, [other]: { ...d.pos } } };
    expect(hunterInRange(crowded, world, range)).toBeNull();
    expect(hunterInRange({ ...crowded, time: crowded.breatherUntil }, world, range)).not.toBeNull();
  });

  it("there is no breather after the player's own flight: a ready hunter attacks at once", () => {
    const landed: AppState = {
      screen: "flight",
      dashboard: beside(),
      flight: { ...createInitialState(1, config), phase: "miss" },
      target: world.targets[0],
      targetIndex: 0,
      shielded: false,
    };
    let s = updateApp(landed, { ...idle, actions: ["activate"] }, DT, config, () => 5);
    expect(s.screen).toBe("dashboard");
    s = updateApp(s, idle, DT, config, () => 5);
    expect(s.screen).toBe("defence");
  });
});

describe("a magazine, then a retreat to rearm", () => {
  it("the first attack spends one and the hunter stays; the last sends it to rearm beside a dome in its network", () => {
    const once = spendAttack(beside(), hunterIndex, world);
    expect(once.attacksUsed[hunterIndex]).toBe(1);
    expect(once.alerted).toContain(hunterIndex);
    expect(once.rearming[hunterIndex]).toBeUndefined();

    const empty = spendAttack(once, hunterIndex, world);
    expect(empty.alerted).not.toContain(hunterIndex);
    expect(empty.rearming[hunterIndex]).toBeDefined();
  });

  it("rearms beside a dome in its own network when there is one", () => {
    // Only some networks have a dome; use a hunter from one that does.
    const domed = world.targets.findIndex((t) => t.kind === "hunter" && world.targets.some((d) => d.kind === "dome" && d.network === t.network));
    const h = world.targets[domed];
    const start = { ...createDashboardState(config), pos: { x: h.col, y: h.row }, alerted: [domed] };
    const spot = spendAttack(spendAttack(start, domed, world), domed, world).rearming[domed];
    const domes = world.targets.filter((t) => t.kind === "dome" && t.network === h.network);
    expect(domes.some((d) => Math.abs(d.col - spot.x) + Math.abs(d.row - spot.y) === 1)).toBe(true);
  });

  it("with no intact dome in its network it cannot rearm: it goes home and stays out of the fight (#102)", () => {
    const domes = world.targets.map((t, i) => (t.kind === "dome" && t.network === hunter.network ? i : -1)).filter((i) => i >= 0);
    const empty = spendAttack(spendAttack(beside({ ruins: domes }), hunterIndex, world), hunterIndex, world);
    expect(empty.rearming[hunterIndex]).toBeUndefined();
    expect(isDisarmed(empty, hunterIndex, world)).toBe(true);
    // Home again, it sees the robot but is not alerted, so it never attacks.
    const home = run(empty, 30);
    expect(positionOf(home, hunterIndex, world)).toEqual(post);
    const seen = run({ ...home, pos: { x: post.x + 1, y: post.y } }, 5);
    expect(seen.alerted).not.toContain(hunterIndex);
  });

  it("chooses again if its dome is destroyed on the way, and goes home unarmed if none is left (#102)", () => {
    const far = { x: -100, y: -100 };
    const empty = spendAttack(spendAttack(beside({ pos: far }), hunterIndex, world), hunterIndex, world);
    const first = empty.rearming[hunterIndex];
    const others = world.targets.map((t, i) => (t.kind === "dome" && t.network === hunter.network && i !== first.dome ? i : -1)).filter((i) => i >= 0);
    // Its dome destroyed while others stand: it heads for another.
    const rerouted = run({ ...empty, ruins: [first.dome] }, DT);
    if (others.length > 0) expect(others).toContain(rerouted.rearming[hunterIndex].dome);
    // Every dome destroyed: no errand, disarmed.
    const stranded = run({ ...empty, ruins: [first.dome, ...others] }, DT);
    expect(stranded.rearming[hunterIndex]).toBeUndefined();
    expect(isDisarmed(stranded, hunterIndex, world)).toBe(true);
  });

  it("it walks to the dome, rearms, then goes home with a full magazine and no alert", () => {
    const far = { x: -100, y: -100 };
    const empty = spendAttack(spendAttack(beside({ pos: far }), hunterIndex, world), hunterIndex, world);
    const spot = empty.rearming[hunterIndex];
    const there = run(empty, 10);
    expect(positionOf(there, hunterIndex, world)).toEqual({ x: spot.x, y: spot.y });
    expect(there.rearming[hunterIndex].until).not.toBeNull();
    const home = run(there, config.dashboard.hunterRearmSeconds + 15);
    expect(home.rearming[hunterIndex]).toBeUndefined();
    expect(home.attacksUsed[hunterIndex]).toBeUndefined();
    expect(home.alerted).not.toContain(hunterIndex);
    expect(positionOf(home, hunterIndex, world)).toEqual(post);
  });

  it("a withdrawing hunter does not notice the robot, cannot be woken by a scan, and does not attack", () => {
    const empty = spendAttack(spendAttack(beside(), hunterIndex, world), hunterIndex, world);
    expect(run(empty, 1).alerted).not.toContain(hunterIndex); // the robot is right beside it
    expect(alertTo(empty, alertHunters(empty, world), world).alerted).not.toContain(hunterIndex);
    expect(hunterInRange({ ...empty, alerted: [hunterIndex] }, world, range)).toBeNull();
  });
});
