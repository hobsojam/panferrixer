import { describe, expect, it } from "vitest";
import { createAppState, updateApp, type AppState } from "../src/app";
import { config } from "../src/config";
import {
  alertTo,
  createDashboardState,
  destroyEnemy,
  moveHunters,
  positionOf,
  worldFor,
  type DashboardState,
} from "../src/dashboard";
import { EMPTY_LOG, EVENT_LOG_LIMIT, eventsOf, eventsSince, latestEvent, record } from "../src/events";
import { generateWorld, isEnemyKind } from "../src/local-map";

// Game events (#127), in the real world. Help calls are covered by the patroller tests.
const DT = 1 / 60;
const d = config.dashboard;
const world = worldFor(config);
const FAR = { x: 1000, y: 1000 }; // a robot nobody can see
const index = (kind: string) => world.targets.findIndex((t) => t.kind === kind);
const HUNTER = index("hunter");
const ASSESSOR = index("assessor");
const IDLE = { actions: [], steering: 0 } as const;
const PRESS = { actions: ["activate" as const], steering: 0 } as const;

function state(from: Partial<DashboardState> = {}): DashboardState {
  return { ...createDashboardState(config), pos: FAR, ...from };
}

function run(s: DashboardState, seconds: number): DashboardState {
  let next = s;
  for (let i = 0; i < Math.max(1, Math.round(seconds / DT)); i++) next = moveHunters({ ...next, time: next.time + DT }, world, DT);
  return next;
}

/** A flight at a target, launched from the dashboard. */
function launchAt(target: number, from: Partial<DashboardState> = {}): Extract<AppState, { screen: "flight" }> {
  const base = createAppState(config);
  if (base.screen !== "dashboard") throw new Error("not at the dashboard");
  const dashboard = state({ mode: "targeting", purpose: "missile", target, ...from });
  const next = updateApp({ ...base, dashboard }, PRESS, DT, config, () => 1);
  if (next.screen !== "flight") throw new Error("no flight");
  return next;
}

/** Puts the missile on the target's doorstep, then flies until it hits. */
function strike(flight: Extract<AppState, { screen: "flight" }>): Extract<AppState, { screen: "flight" }> {
  const f = flight.flight;
  let s: AppState = { ...flight, flight: { ...f, phase: "terminal", x: 0, velocityX: 0, depth: f.totalDistance - 1, defended: false, nextBandIndex: f.terrain.bands.length } };
  for (let i = 0; i < 120; i++) {
    s = updateApp(s, IDLE, DT, config, () => 1);
    if (s.screen !== "flight") throw new Error("left the flight");
    if (s.flight.phase === "hit") return s;
  }
  throw new Error("never hit");
}

describe("the event log", () => {
  const body = { kind: "robotReported" as const, time: 0, network: 0, at: { x: 1, y: 2 } };

  it("numbers events in order, and gives a consumer only what it has not read", () => {
    let log = record(record(EMPTY_LOG, body), { ...body, network: 1 });
    expect(log.entries.map((e) => e.seq)).toEqual([0, 1]);
    const read = log.next;
    expect(eventsSince(log, read)).toEqual([]);
    log = record(log, { ...body, network: 2 });
    expect(eventsSince(log, read).map((e) => e.network)).toEqual([2]);
    expect(latestEvent(log, "robotReported")!.network).toBe(2);
    expect(latestEvent(log, "bossOut")).toBeNull();
    expect(EMPTY_LOG.entries).toEqual([]);
  });

  it("is bounded, keeping the latest, and numbers carry on", () => {
    let log = EMPTY_LOG;
    for (let i = 0; i < EVENT_LOG_LIMIT + 5; i++) log = record(log, body);
    expect(log.entries).toHaveLength(EVENT_LOG_LIMIT);
    expect(log.entries[0].seq).toBe(5);
    expect(log.next).toBe(EVENT_LOG_LIMIT + 5);
  });
});

describe("events", () => {
  it("an enemy alerted, once until it loses the robot and is alerted again", () => {
    let s = alertTo(state({ time: 4 }), [HUNTER], world);
    expect(latestEvent(s.events, "enemyAlerted")).toMatchObject({
      enemy: HUNTER,
      time: 4,
      network: world.targets[HUNTER].network,
      at: positionOf(s, HUNTER, world),
    });
    s = alertTo(s, [HUNTER], world);
    expect(eventsOf(s.events, "enemyAlerted")).toHaveLength(1);
    s = alertTo({ ...s, alerted: [] }, [HUNTER], world);
    expect(eventsOf(s.events, "enemyAlerted")).toHaveLength(2);
  });

  it("an enemy seeing the robot for a while is alerted once", () => {
    const s = run(state({ pos: positionOf(state(), HUNTER, world) }), 2);
    expect(eventsOf(s.events, "enemyAlerted").filter((e) => e.enemy === HUNTER)).toHaveLength(1);
  });

  it("a missile launched at an enemy, but not at a building", () => {
    const pos = positionOf(state(), HUNTER, world);
    const launched = launchAt(HUNTER, { pos });
    expect(eventsOf(launched.dashboard.events, "underFire")).toMatchObject([{ enemy: HUNTER, network: world.targets[HUNTER].network }]);
    const dome = index("dome");
    expect(eventsOf(launchAt(dome, { pos: positionOf(state(), dome, world) }).dashboard.events, "underFire")).toEqual([]);
  });

  it.each(["hunter", "hauler"])("a %s destroyed in a flight, once, still there back at the dashboard", (kind) => {
    const target = index(kind);
    const hit = strike(launchAt(target));
    const destroyed = [{ kind: "enemyDestroyed", enemy: target }];
    expect(eventsOf(hit.dashboard.events, "enemyDestroyed")).toMatchObject(destroyed);
    let s: AppState = updateApp(hit, IDLE, DT, config, () => 1);
    s = updateApp(s, PRESS, DT, config, () => 1);
    if (s.screen !== "dashboard") throw new Error("not back at the dashboard");
    s = updateApp(s, IDLE, DT, config, () => 1);
    if (s.screen !== "dashboard") throw new Error("left the dashboard");
    expect(eventsOf(s.dashboard.events, "enemyDestroyed")).toMatchObject(destroyed);
    expect(eventsOf(destroyEnemy(s.dashboard, target, world).events, "enemyDestroyed")).toHaveLength(1);
  });

  it("an enemy alerted during an attack, still there back at the dashboard", () => {
    const pos = positionOf(state(), HUNTER, world);
    let s: AppState = updateApp({ screen: "dashboard", dashboard: state({ pos, alerted: [HUNTER], time: 50 }) }, IDLE, DT, config, () => 1);
    if (s.screen !== "defence") throw new Error("no attack");
    s = { ...s, dashboard: alertTo(s.dashboard, [ASSESSOR], world) };
    const read = s.dashboard.events.next - 1; // a consumer that read up to just before this alert
    for (let i = 0; i < 60 / DT && s.screen === "defence"; i++) s = updateApp(s, IDLE, DT, config, () => 1);
    if (s.screen !== "dashboard") throw new Error("not back at the dashboard");
    expect(eventsSince(s.dashboard.events, read)[0]).toMatchObject({ kind: "enemyAlerted", enemy: ASSESSOR });
  });

  it("a replacement begun, once per build", () => {
    const patroller = index("patroller");
    const network = world.targets[patroller].network;
    const s = run(state({ ruins: [patroller] }), 5);
    const begun = eventsOf(s.events, "buildStarted");
    expect(begun).toHaveLength(1);
    expect(begun[0]).toMatchObject({ enemy: patroller, network, dome: s.builds[network].dome });
  });

  it("each boss coming out, once", () => {
    const parts = Array.from({ length: world.partCount }, (_, i) => i);
    const s = run(state({ parts }), 2);
    expect(eventsOf(s.events, "bossOut").map((e) => e.enemy).sort()).toEqual([index("listener"), ASSESSOR].sort());
    expect(eventsOf(run(state({ parts: parts.slice(1) }), 2).events, "bossOut")).toEqual([]);
  });

  it("the assessor reaching towns on its tour, once each visit, and never the listener", () => {
    const s = run(state({ bossesOut: [index("listener"), ASSESSOR] }), 120);
    const reached = eventsOf(s.events, "townReached");
    expect(reached.length).toBeGreaterThan(1);
    for (const e of reached) {
      expect(e.enemy).toBe(ASSESSOR);
      expect(e.at).toEqual({ x: world.towns[e.network].x, y: world.towns[e.network].y });
    }
    for (let i = 1; i < reached.length; i++) expect(reached[i].network).not.toBe(reached[i - 1].network);
  });

  it("the robot reported by comms, once per report", () => {
    const network = world.targets[index("commsCentre")].network;
    const pos = { x: world.towns[network].x, y: world.towns[network].y };
    const s = run(state({ pos }), d.commsNoticeSeconds + 1);
    expect(eventsOf(s.events, "robotReported")).toMatchObject([{ network, at: pos }]);
  });

  it("are the same for the same inputs", () => {
    const go = () => run(state({ pos: positionOf(state(), HUNTER, world), bossesOut: [ASSESSOR] }), 20).events;
    expect(go()).toEqual(go());
  });
});

describe("enemy numbers", () => {
  it("run from 1 within each role, and buildings have none", () => {
    const { targets } = generateWorld(config.localMap);
    for (const kind of new Set(targets.filter((t) => isEnemyKind(t.kind)).map((t) => t.kind))) {
      const numbers = targets.filter((t) => t.kind === kind).map((t) => t.number);
      expect(numbers).toEqual(numbers.map((_, i) => i + 1));
    }
    for (const t of targets.filter((x) => !isEnemyKind(x.kind))) expect(t.number).toBeUndefined();
  });
});
