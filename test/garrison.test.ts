import { describe, expect, it } from "vitest";
import { updateApp, type AppState } from "../src/app";
import { config } from "../src/config";
import {
  createDashboardState,
  hunterInRange,
  isHidden,
  isShielded,
  moveHunters,
  positionOf,
  spendAttack,
  startHeldWaits,
  startPosition,
  stepDashboard,
  wakeDefender,
  worldFor,
  type DashboardState,
  type World,
} from "../src/dashboard";
import { createInitialState } from "../src/flight";
import { generateWorld, type Target } from "../src/local-map";
import { OFFSETS } from "../src/route";
import { MANY_WORLDS_TIMEOUT_MS, mapOf } from "./helpers";

// Garrisons: defenders live in the domes, at random, and come out when their dome is hit
// (design-notes 4.4). Awake, they guard their dome and do not chase far (design-notes 4.10).
const DT = 1 / 60;
const base = worldFor(config);
const FAR = { x: 100, y: 100 }; // a robot nobody can see

const flat = mapOf(Array(21).fill("1".repeat(40)));

const DOME = 0;
const OTHER_DOME = 1;
const DEFENDER = 2;

function target(col: number, row: number, kind: Target["kind"], network = 0): Target {
  return { col, row, kind, supplies: [], network };
}

/** Two domes; the first holds a defender whose post is the cell below it. */
const town: Target[] = [target(10, 10, "dome"), target(13, 10, "dome"), { ...target(10, 11, "defender"), home: DOME }];
const world: World = { ...base, map: flat, towns: [], targets: town };

function state(from: Partial<DashboardState> = {}): DashboardState {
  return { ...createDashboardState(config), pos: FAR, ...from };
}

/** Steps the enemies for `seconds`, with the robot standing still. */
function run(s: DashboardState, seconds: number): DashboardState {
  let next = s;
  for (let i = 0; i < seconds / DT; i++) next = moveHunters({ ...next, time: next.time + DT }, world, DT);
  return next;
}

describe("placing the garrisons", () => {
  it("every town has its domes, and each network draws 0 to 4 defenders, at most one per dome", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const { towns, targets } = generateWorld({ ...config.localMap, worldSeed: seed });
      for (let network = 0; network < towns.length; network++) {
        const domes = targets.filter((t) => t.kind === "dome" && t.network === network);
        expect(domes, `seed ${seed} network ${network}`).toHaveLength(config.localMap.domesPerTown);
        const defenders = targets.filter((t) => t.kind === "defender" && t.network === network);
        expect(defenders.length).toBeLessThanOrEqual(config.localMap.defendersMax);
        const homes = defenders.map((d) => d.home);
        expect(new Set(homes).size).toBe(homes.length);
        for (const d of defenders) {
          const dome = targets[d.home!];
          expect(dome.kind).toBe("dome");
          expect(dome.network).toBe(network);
          // Its post is the cell outside the dome's door.
          expect(OFFSETS.some(([dx, dy]) => dome.col + dx === d.col && dome.row + dy === d.row)).toBe(true);
        }
      }
    }
  }, MANY_WORLDS_TIMEOUT_MS);

  it("the number of defenders varies between networks", () => {
    const counts = new Set<number>();
    for (let seed = 1; seed <= 5; seed++) {
      const { towns, targets } = generateWorld({ ...config.localMap, worldSeed: seed });
      for (let network = 0; network < towns.length; network++) counts.add(targets.filter((t) => t.kind === "defender" && t.network === network).length);
    }
    expect(counts.size).toBeGreaterThan(2);
  });

  it("a defender's post is never on a building, so it can stand there", () => {
    const buildings = new Set(base.targets.filter((t) => t.kind !== "hunter" && t.kind !== "defender").map((t) => `${t.col},${t.row}`));
    for (const d of base.targets.filter((t) => t.kind === "defender")) expect(buildings.has(`${d.col},${d.row}`)).toBe(false);
  });

  it("defenders asleep in their domes do not push the robot's start away", () => {
    expect(base.targets.some((t) => t.kind === "defender")).toBe(true);
    const withoutDefenders: World = { ...base, targets: base.targets.filter((t) => t.kind !== "defender") };
    expect(startPosition(base, config)).toEqual(startPosition(withoutDefenders, config));
  });
});

describe("a defender asleep in its dome", () => {
  it("is hidden, and cannot be chosen as a missile target even with the cross on it", () => {
    const s = state({ pos: { x: 10, y: 14 }, mode: "targeting", purpose: "missile", cross: { col: 10, row: 12 } });
    expect(isHidden(s, DEFENDER, world)).toBe(true);
    const moved = stepDashboard(s, ["up"], DT, world).state;
    expect(moved.cross).toEqual({ col: 10, row: 11 });
    expect(moved.target).toBe(DOME);
  });

  it("does not see the robot, move or attack, even with the robot beside it", () => {
    const s = run(state({ pos: { x: 11, y: 11 } }), 10);
    expect(s.alerted).toEqual([]);
    expect(positionOf(s, DEFENDER, world)).toEqual({ x: 10, y: 11 });
    expect(hunterInRange(s, world, config.dashboard.hunterEngageRange)).toBeNull();
  });

  it("is not woken by a scan (design-notes 4.4)", () => {
    const s = stepDashboard(state({ pos: { x: 10, y: 13 }, row: 0, col: 1 }), ["activate"], DT, world).state;
    expect(s.pulseStarted).not.toBeNull();
    expect(s.awake).toEqual([]);
    expect(s.alerted).toEqual([]);
  });
});

describe("hitting a dome wakes its defender", () => {
  it("comes out at its post, alerted", () => {
    const s = wakeDefender(state({ pos: { x: 10, y: 15 } }), DOME, world);
    expect(isHidden(s, DEFENDER, world)).toBe(false);
    expect(s.alerted).toEqual([DEFENDER]);
    expect(positionOf(s, DEFENDER, world)).toEqual({ x: 10, y: 11 });
  });

  it("moves at once, but holds its first attack however long the player stays on the result", () => {
    const s = run(wakeDefender(state({ pos: { x: 10, y: 18 } }), DOME, world), 20);
    expect(positionOf(s, DEFENDER, world)).not.toEqual({ x: 10, y: 11 });
    expect(hunterInRange(s, world, config.dashboard.hunterEngageRange)).toBeNull();
  });

  it("starts its 1 to 3 second wait only when the player is back at the dashboard", () => {
    const held = run(wakeDefender(state({ pos: { x: 10, y: 18 } }), DOME, world), 20);
    const back = startHeldWaits(held, world);
    expect(back.heldAttacks).toEqual([]);
    const wait = back.hunterReadyAt[DEFENDER] - back.time;
    expect(wait).toBeGreaterThanOrEqual(config.dashboard.hunterFirstAttackDelayMin);
    expect(wait).toBeLessThanOrEqual(config.dashboard.hunterFirstAttackDelayMax);
    expect(hunterInRange(back, world, config.dashboard.hunterEngageRange)).toBeNull();
    expect(hunterInRange(run(back, wait + 0.1), world, config.dashboard.hunterEngageRange)).toBe(DEFENDER);
  });

  it("only the hit dome's defender wakes, not its neighbours'", () => {
    const pair: World = { ...world, targets: [...town, { ...target(13, 11, "defender"), home: OTHER_DOME }] };
    const s = wakeDefender(state(), OTHER_DOME, pair);
    expect(s.awake).toEqual([3]);
    expect(isHidden(s, DEFENDER, pair)).toBe(true);
  });

  it("a dome with no defender wakes nobody", () => {
    const s = state();
    expect(wakeDefender(s, OTHER_DOME, world)).toBe(s);
  });

  it("can then be targeted, and is one hit from death: it has no shield", () => {
    const s = wakeDefender(state(), DOME, world);
    expect(isShielded(s, town[DEFENDER])).toBe(false);
    const choosing = { ...s, pos: { x: 10, y: 14 }, mode: "targeting" as const, purpose: "missile" as const, cross: { col: 10, row: 12 } };
    expect(stepDashboard(choosing, ["up"], DT, world).state.target).toBe(DEFENDER);
  });
});

describe("an awake defender guards its dome", () => {
  it("closes to its holding range and attacks when the robot is in its guard area", () => {
    const robot = { x: 10, y: 18 };
    const s = run(startHeldWaits(wakeDefender(state({ pos: robot }), DOME, world), world), 5);
    const at = positionOf(s, DEFENDER, world);
    expect(Math.hypot(at.x - robot.x, at.y - robot.y)).toBeLessThanOrEqual(config.dashboard.hunterHoldCells);
    expect(hunterInRange(s, world, config.dashboard.hunterEngageRange)).toBe(DEFENDER);
  });

  it("does not chase the robot out of its guard area: it breaks off and goes home", () => {
    const outside = { x: 10, y: 11 + config.dashboard.defenderGuardCells + 1 };
    const woken = wakeDefender(state({ pos: { x: 10, y: 15 } }), DOME, world);
    const s = run({ ...woken, pos: outside }, 10);
    expect(s.alerted).toEqual([]);
    expect(positionOf(s, DEFENDER, world)).toEqual({ x: 10, y: 11 });
  });

  it("once out, it keeps watch: the robot walking back into sight alerts it again", () => {
    const calm = run({ ...wakeDefender(state(), DOME, world), alerted: [] }, 1);
    expect(calm.alerted).toEqual([]);
    const s = run({ ...calm, pos: { x: 10, y: 14 } }, DT);
    expect(s.alerted).toEqual([DEFENDER]);
  });

  it("rearms at its own post once its magazine is spent", () => {
    let s = wakeDefender(state({ pos: { x: 10, y: 15 } }), DOME, world);
    for (let i = 0; i < config.dashboard.hunterMagazineAttacks; i++) s = spendAttack(s, DEFENDER, world);
    expect(s.alerted).toEqual([]);
    expect(s.rearming[DEFENDER]).toMatchObject({ x: 10, y: 11 });
  });
});

describe("a missile hit on a dome, in the app", () => {
  // The real world: a dome that holds a defender.
  const defenderIndex = base.targets.findIndex((t) => t.kind === "defender");
  const domeIndex = base.targets[defenderIndex].home!;
  const seeds = () => 1;

  function landing(shielded: boolean): AppState {
    const start = createInitialState(1, config);
    const flight = { ...start, phase: "terminal" as const, x: 0, depth: start.totalDistance - 0.001, nextBandIndex: start.terrain.bands.length };
    return { screen: "flight", dashboard: { ...createDashboardState(config), pos: FAR }, flight, target: base.targets[domeIndex], targetIndex: domeIndex, shielded };
  }

  it("wakes the dome's defender when the missile destroys the dome", () => {
    const next = updateApp(landing(false), { actions: [], steering: 0 }, DT, config, seeds);
    if (next.screen !== "flight") throw new Error("expected flight");
    expect(next.flight.phase).toBe("hit");
    expect(next.dashboard.awake).toContain(defenderIndex);
  });

  it("wakes it too when the shield deflects the missile", () => {
    const next = updateApp(landing(true), { actions: [], steering: 0 }, DT, config, seeds);
    if (next.screen !== "flight") throw new Error("expected flight");
    expect(next.dashboard.awake).toContain(defenderIndex);
  });

  it("its wait before attacking starts when the player leaves the result screen", () => {
    let s = updateApp(landing(false), { actions: [], steering: 0 }, DT, config, seeds);
    for (let i = 0; i < 10 / DT; i++) s = updateApp(s, { actions: [], steering: 0 }, DT, config, seeds); // lingering on the result
    s = updateApp(s, { actions: ["activate"], steering: 0 }, DT, config, seeds);
    if (s.screen !== "dashboard") throw new Error("expected dashboard");
    expect(s.dashboard.heldAttacks).toEqual([]);
    expect(s.dashboard.hunterReadyAt[defenderIndex] - s.dashboard.time).toBeGreaterThanOrEqual(config.dashboard.hunterFirstAttackDelayMin);
  });
});
