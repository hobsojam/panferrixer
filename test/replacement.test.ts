import { describe, expect, it } from "vitest";
import { config } from "../src/config";
import {
  createDashboardState,
  haulerMindOf,
  moveHunters,
  nextDestination,
  positionOf,
  stockOf,
  uncollected,
  worldFor,
  type DashboardState,
  type World,
} from "../src/dashboard";
import type { Target } from "../src/local-map";
import { mapOf } from "./helpers";

// Replacement (#70, design-notes 2.6): working domes build destroyed patrollers, haulers and
// defenders again, from the supplies haulers deliver. Hunters are never replaced.
const DT = 1 / 60;
const d = config.dashboard;
const base = worldFor(config);
const FAR = { x: 1000, y: 1000 }; // a robot nobody can see

const POWER = 0;
const DOME = 1;
const SECOND_DOME = 2;
const PATROLLER = 3;
const DEFENDER = 4;
const HUNTER = 5;
const HAULER = 6;
const OTHER_PATROLLER = 7;
const DOME_DOOR = { x: 5, y: 3 };

// Town 0 on the left with two domes and one of each enemy; town 1 on the right with a dome.
const targets: Target[] = [
  { col: 2, row: 5, kind: "power", supplies: [], network: 0, dock: { x: 3, y: 5 } },
  { col: 5, row: 2, kind: "dome", supplies: [], network: 0, dock: DOME_DOOR },
  { col: 8, row: 2, kind: "dome", supplies: [], network: 0, dock: { x: 8, y: 3 } },
  { col: 10, row: 8, kind: "patroller", supplies: [], network: 0, beat: [{ x: 10, y: 8 }, { x: 12, y: 8 }] },
  { col: 4, row: 2, kind: "defender", supplies: [], network: 0, home: DOME },
  { col: 6, row: 6, kind: "hunter", supplies: [], network: 0 },
  { col: 3, row: 5, kind: "hauler", supplies: ["energy", "armour"], network: 0, home: POWER },
  { col: 15, row: 8, kind: "patroller", supplies: [], network: 1, beat: [{ x: 15, y: 8 }, { x: 17, y: 8 }] },
  { col: 15, row: 2, kind: "dome", supplies: [], network: 1, dock: { x: 15, y: 3 } },
  { col: 17, row: 5, kind: "power", supplies: [], network: 1, dock: { x: 16, y: 5 } },
];
// The world the haulers work in; most tests use the quiet one, without the hauler, so stock
// changes only by building.
const hauling: World = {
  ...base,
  map: mapOf(Array.from({ length: 10 }, () => "1".repeat(20))),
  towns: [
    { x: 5, y: 5 },
    { x: 15, y: 5 },
  ],
  neighbours: [[1], [0]],
  targets,
};
const world: World = { ...hauling, targets: targets.map((t, i) => (i === HAULER ? { col: 0, row: 9, kind: "mine" as const, supplies: [], network: 0 } : t)) };

function state(from: Partial<DashboardState> = {}): DashboardState {
  return { ...createDashboardState(config), pos: FAR, ...from };
}

function run(s: DashboardState, seconds: number, w: World = world): DashboardState {
  let next = s;
  for (let i = 0; i < Math.round(seconds / DT); i++) next = moveHunters({ ...next, time: next.time + DT }, w, DT);
  return next;
}

describe("building a replacement", () => {
  it("a working, supplied dome builds a destroyed patroller again, spending one supply, and it comes out of the door", () => {
    const begun = run(state({ ruins: [PATROLLER] }), 1);
    expect(begun.builds[0]).toMatchObject({ target: PATROLLER, dome: DOME });
    expect(stockOf(begun, 0, world)).toBe(d.startingStock - 1);

    const almost = run(begun, d.replacementSeconds - 2);
    expect(almost.ruins).toContain(PATROLLER);

    // Finished: standing at the dome's door, then back to its beat.
    let s = almost;
    while (s.ruins.includes(PATROLLER)) s = run(s, DT);
    const p = positionOf(s, PATROLLER, world);
    expect(Math.hypot(p.x - DOME_DOOR.x, p.y - DOME_DOOR.y)).toBeLessThan(d.patrollerSpeed * DT * 2);
    expect(s.builds[0]).toBeUndefined();
    expect(s.produced[0]).toBe(1);
    const later = positionOf(run(s, 30), PATROLLER, world);
    expect(Math.hypot(later.x - DOME_DOOR.x, later.y - DOME_DOOR.y)).toBeGreaterThan(3);
  });

  it("not immediately: nothing comes back before replacementSeconds of building", () => {
    expect(d.replacementSeconds).toBeGreaterThanOrEqual(30);
    expect(run(state({ ruins: [PATROLLER] }), d.replacementSeconds - 0.5).ruins).toContain(PATROLLER);
  });

  it("a hunter is never built again", () => {
    const s = run(state({ ruins: [HUNTER] }), d.replacementSeconds * 2);
    expect(s.ruins).toContain(HUNTER);
    expect(s.builds).toEqual({});
  });

  it("a defender is built only by its own dome, and goes back inside it, asleep", () => {
    const homeless = run(state({ ruins: [DEFENDER, DOME] }), d.replacementSeconds * 2);
    expect(homeless.ruins).toContain(DEFENDER);
    expect(homeless.builds).toEqual({});

    const s = run(state({ ruins: [DEFENDER], awake: [DEFENDER], alerted: [DEFENDER] }), d.replacementSeconds + 2);
    expect(s.ruins).not.toContain(DEFENDER);
    expect(s.awake).not.toContain(DEFENDER);
    expect(s.alerted).not.toContain(DEFENDER);
    expect(positionOf(s, DEFENDER, world)).toEqual({ x: 4, y: 2 });
  });

  it("a hauler is built again and goes back to work, with no cargo, and its old wreck's leftovers are gone", () => {
    const wrecked = state({ ruins: [HAULER], hunterPos: { [HAULER]: { x: 12, y: 6 } } });
    expect(uncollected(wrecked, HAULER, hauling)).toEqual(["energy", "armour"]);
    const s = run(wrecked, d.replacementSeconds + 2, hauling);
    expect(s.ruins).not.toContain(HAULER);
    expect(haulerMindOf(s, HAULER, hauling)).toMatchObject({ mode: "haul", loading: true, stop: POWER });
    expect(uncollected(s, HAULER, hauling)).toEqual([]);
    // Destroyed again, its wreck holds nothing.
    expect(uncollected({ ...s, ruins: [HAULER] }, HAULER, hauling)).toEqual([]);
  });

  it("one at a time per network, the first lost first; each network builds its own", () => {
    const s = run(state({ ruins: [OTHER_PATROLLER, PATROLLER, DEFENDER] }), 1);
    expect(s.builds[0].target).toBe(PATROLLER);
    expect(s.builds[1].target).toBe(OTHER_PATROLLER);
    const next = run(s, d.replacementSeconds + 1);
    expect(next.ruins).not.toContain(PATROLLER);
    expect(next.builds[0].target).toBe(DEFENDER);
  });
});

describe("what a dome needs", () => {
  it("no intact dome, no build", () => {
    const s = run(state({ ruins: [PATROLLER, DOME, SECOND_DOME] }), d.replacementSeconds * 2);
    expect(s.ruins).toContain(PATROLLER);
    expect(s.builds[0]).toBeUndefined();
  });

  it("with its power cut, a network starts nothing", () => {
    const s = run(state({ ruins: [PATROLLER], suppressedUntil: { 0: 1000 } }), 5);
    expect(s.builds[0]).toBeUndefined();
    expect(stockOf(s, 0, world)).toBe(d.startingStock);
  });

  it("with no supply in stock, it starts nothing, and starts once a supply arrives", () => {
    const empty = run(state({ ruins: [PATROLLER], stock: { 0: 0 } }), 5);
    expect(empty.builds[0]).toBeUndefined();
    const supplied = run({ ...empty, stock: { 0: 1 } }, DT);
    expect(supplied.builds[0]).toMatchObject({ target: PATROLLER, progress: 0 });
    expect(stockOf(supplied, 0, world)).toBe(0);
  });
});

describe("interruption and resumption", () => {
  it("a power cut pauses a build, which keeps its progress and carries on when the power returns", () => {
    const begun = run(state({ ruins: [PATROLLER] }), 10);
    const progress = begun.builds[0].progress;
    const cut = run({ ...begun, suppressedUntil: { 0: begun.time + 20 } }, 19);
    expect(cut.builds[0].progress).toBeCloseTo(progress, 5);
    const back = run(cut, 6);
    expect(back.builds[0].progress).toBeGreaterThan(progress + 4);
    expect(back.builds[0].progress).toBeLessThan(progress + 6);
  });

  it("losing the building dome loses the build and its supply; it starts again from nothing at another dome", () => {
    const begun = run(state({ ruins: [PATROLLER] }), 30);
    expect(begun.builds[0].dome).toBe(DOME);
    const after = run({ ...begun, ruins: [...begun.ruins, DOME] }, 2 * DT);
    expect(after.builds[0]).toMatchObject({ target: PATROLLER, dome: SECOND_DOME });
    expect(after.builds[0].progress).toBeLessThan(0.1);
    expect(stockOf(after, 0, world)).toBe(d.startingStock - 2);
  });
});

describe("caps", () => {
  it("a network that has built its share builds no more", () => {
    const s = run(state({ ruins: [PATROLLER], produced: { 0: d.replacementsPerNetworkMax } }), 5);
    expect(s.builds[0]).toBeUndefined();
  });

  it("once the world has built its share, finished or under way, nobody builds more", () => {
    expect(run(state({ ruins: [PATROLLER], produced: { 1: d.replacementsMax } }), 5).builds[0]).toBeUndefined();
    const one: World = { ...world, replacementsMax: 1 };
    const s = run(state({ ruins: [PATROLLER, OTHER_PATROLLER] }), 5, one);
    expect(Object.keys(s.builds)).toHaveLength(1);
  });

  it("the caps hold however long the war goes on: kill everything again and again, and no more than the caps come back", () => {
    let s = state();
    let built = 0;
    for (let round = 0; round < 8; round++) {
      s = run({ ...s, ruins: [...new Set([...s.ruins, PATROLLER, OTHER_PATROLLER, DEFENDER])], stock: { 0: d.stockMax, 1: d.stockMax } }, d.replacementSeconds + 2);
      built = Object.values(s.produced).reduce((a, b) => a + b, 0);
    }
    expect(s.produced[0]).toBe(d.replacementsPerNetworkMax);
    expect(s.produced[1]).toBe(d.replacementsPerNetworkMax);
    expect(built).toBeLessThanOrEqual(d.replacementsMax);
  });
});

describe("the haulers' part", () => {
  it("a delivery adds one supply to the network it is unloaded in, up to the cap", () => {
    let s = state();
    while (haulerMindOf(s, HAULER, hauling).trip === 0) s = run(s, DT, hauling);
    expect(haulerMindOf(s, HAULER, hauling).town).toBe(1);
    expect(stockOf(s, 1, hauling)).toBe(d.startingStock + 1);

    let full = state({ stock: { 1: d.stockMax } });
    while (haulerMindOf(full, HAULER, hauling).trip === 0) full = run(full, DT, hauling);
    expect(stockOf(full, 1, hauling)).toBe(d.stockMax);
  });

  it("a hauler carries to the neediest neighbour: the one with the least in stock", () => {
    const three: World = {
      ...world,
      towns: [
        { x: 2, y: 5 },
        { x: 10, y: 5 },
        { x: 18, y: 5 },
      ],
      neighbours: [[1], [0, 2], [1]],
      targets: [
        { col: 10, row: 4, kind: "power", supplies: [], network: 1, dock: { x: 10, y: 5 } },
        { col: 2, row: 4, kind: "dome", supplies: [], network: 0, dock: { x: 2, y: 5 } },
        { col: 18, row: 4, kind: "dome", supplies: [], network: 2, dock: { x: 18, y: 5 } },
      ],
    };
    for (let trip = 0; trip < 20; trip++) {
      expect(nextDestination(state({ stock: { 0: 0, 2: 3 } }), 0, 1, null, trip, three)).toBe(0);
      expect(nextDestination(state({ stock: { 0: 3, 2: 1 } }), 0, 1, null, trip, three)).toBe(2);
    }
  });

  it("killing haulers starves a network: with none delivering, a network builds only from what it has", () => {
    // No hauler delivers in the quiet world, so town 0 builds only its starting stock.
    let s = state();
    for (let round = 0; round < 5; round++) s = run({ ...s, ruins: [...new Set([...s.ruins, PATROLLER])] }, d.replacementSeconds + 2);
    expect(s.produced[0]).toBe(d.startingStock);
    expect(stockOf(s, 0, world)).toBe(0);
  });
});
