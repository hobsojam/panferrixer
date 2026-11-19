import { describe, expect, it } from "vitest";
import { config } from "../src/config";
import { createDashboardState, moveHunters, patrolOutage, positionOf, stepDashboard, worldFor, type DashboardState, type World } from "../src/dashboard";
import type { LocalMap, Target } from "../src/local-map";
import { mapOf } from "./helpers";

// Cutting power makes the network's hunter patrol its domes: design-notes 4.3.
const DT = 1 / 60;
const base = worldFor(config);
const FAR = { x: 100, y: 100 }; // a robot nobody can see

const flat = mapOf(Array(11).fill("1".repeat(30)));

const HUNTER = 0;
const NEAR_DOME = 1;
const FAR_DOME = 2;
const LOW_DOME = 3;
const STATION = 4;

function target(col: number, row: number, kind: Target["kind"], network = 0): Target {
  return { col, row, kind, hasDrop: false, network };
}

/** A hunter at (2, 2), three domes at increasing distances, and the power station. */
const town: Target[] = [target(2, 2, "hunter"), target(8, 2, "dome"), target(20, 2, "dome"), target(12, 8, "dome"), target(26, 8, "power")];

function worldOn(targets: Target[], map: LocalMap = flat): World {
  return { ...base, map, towns: [], targets };
}

/** Power cut in network 0 at time 0, the robot far away, and the hunter's rounds started. */
function cut(world: World, from: Partial<DashboardState> = {}): DashboardState {
  const s: DashboardState = { ...createDashboardState(config), pos: FAR, ...from, suppressedUntil: { 0: config.dashboard.suppressionSeconds } };
  return patrolOutage(s, 0, world);
}

/** Steps the hunters for `seconds`, noting each building the hunter sets off for. */
function run(s: DashboardState, world: World, seconds: number, stops: number[] = []): DashboardState {
  let state = s;
  for (let i = 0; i < seconds / DT; i++) {
    state = moveHunters({ ...state, time: state.time + DT }, world, DT);
    const stop = state.patrolling[HUNTER]?.stop;
    if (stop !== undefined && stop !== null && stops[stops.length - 1] !== stop) stops.push(stop);
  }
  return state;
}

describe("cutting power makes the hunter patrol its domes", () => {
  it("Grid Disable on a station starts that network's hunter on its rounds, until the power returns", () => {
    const world = worldOn([...town, target(28, 10, "hunter", 1)]);
    const choosing: DashboardState = { ...createDashboardState(config), pos: FAR, mode: "targeting", purpose: "gridDisable", target: STATION };
    const s = stepDashboard(choosing, ["activate"], DT, world).state;
    expect(Object.keys(s.patrolling).map(Number)).toEqual([HUNTER]);
    expect(s.patrolling[HUNTER].until).toBe(s.suppressedUntil[0]);
  });

  it("checks the nearest dome first, then each of the others, then starts a new round", () => {
    const world = worldOn(town);
    const stops: number[] = [];
    run(cut(world), world, 40, stops);
    expect(stops.slice(0, 4)).toEqual([NEAR_DOME, LOW_DOME, FAR_DOME, LOW_DOME]);
  });

  it("goes back to its post when the power comes back", () => {
    const world = worldOn(town);
    const done = run(cut(world), world, config.dashboard.suppressionSeconds + 20);
    expect(done.patrolling[HUNTER]).toBeUndefined();
    expect(positionOf(done, HUNTER, world)).toEqual({ x: 2, y: 2 });
  });

  it("passes over a dome that has been destroyed", () => {
    const world = worldOn(town);
    const stops: number[] = [];
    run(cut(world, { ruins: [NEAR_DOME] }), world, 30, stops);
    expect(stops).not.toContain(NEAR_DOME);
    expect(stops[0]).toBe(LOW_DOME);
  });

  it("with no dome left, waits beside the power station", () => {
    const world = worldOn(town);
    const s = run(cut(world, { ruins: [NEAR_DOME, FAR_DOME, LOW_DOME] }), world, 30);
    const at = positionOf(s, HUNTER, world);
    expect(s.patrolling[HUNTER].stop).toBe(STATION);
    expect(Math.abs(at.x - 26) + Math.abs(at.y - 8)).toBe(1);
  });

  it("seeing the robot on its rounds ends the patrol and alerts it", () => {
    const world = worldOn(town);
    const spotted = run(cut(world, { pos: { x: 8, y: 3 } }), world, 4);
    expect(spotted.alerted).toContain(HUNTER);
    expect(spotted.patrolling[HUNTER]).toBeUndefined();
  });

  it("cutting the power again while it is down extends the rounds", () => {
    const world = worldOn(town);
    const first = run(cut(world), world, 10);
    const extended = patrolOutage({ ...first, suppressedUntil: { 0: 70 } }, 0, world);
    expect(extended.patrolling[HUNTER].until).toBe(70);
    expect(extended.patrolling[HUNTER].stop).toBe(first.patrolling[HUNTER].stop);
  });

  it("an alerted hunter ignores the outage, and a destroyed one cannot respond", () => {
    const world = worldOn(town);
    expect(cut(world, { alerted: [HUNTER] }).patrolling).toEqual({});
    expect(cut(world, { ruins: [HUNTER] }).patrolling).toEqual({});
  });
});

describe("patrolling over terrain", () => {
  /** A wall of high ground down column 15, sealed from top to bottom. */
  const walled = mapOf(Array(11).fill("1".repeat(15) + "2" + "1".repeat(14)));

  it("passes over a dome that high ground cuts it off from", () => {
    const world = worldOn(town, walled); // the far dome (20, 2) is behind the wall
    const stops: number[] = [];
    run(cut(world), world, 40, stops);
    expect(stops).not.toContain(FAR_DOME);
    expect(stops.slice(0, 3)).toEqual([NEAR_DOME, LOW_DOME, NEAR_DOME]);
  });

  it("with nothing it can reach, stays at its post", () => {
    const world = worldOn([target(2, 2, "hunter"), target(20, 2, "dome"), target(26, 8, "power")], walled);
    const s = run(cut(world), world, 10);
    expect(s.patrolling[HUNTER].stop).toBeNull();
    expect(positionOf(s, HUNTER, world)).toEqual({ x: 2, y: 2 });
  });
});
