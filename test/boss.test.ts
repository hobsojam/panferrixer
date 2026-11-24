import { describe, expect, it } from "vitest";
import { createAppState, updateApp, type AppState } from "../src/app";
import { config } from "../src/config";
import {
  bossMindOf,
  createDashboardState,
  hunterInRange,
  isDisarmed,
  isHidden,
  moveHunters,
  positionOf,
  REPLACEABLE,
  spendAttack,
  stepDashboard,
  uncollected,
  worldFor,
  type DashboardState,
} from "../src/dashboard";

// The bosses (#71, design-notes 4.15), in the real world.
const DT = 1 / 60;
const d = config.dashboard;
const world = worldFor(config);
const START = world.towns[config.localMap.startTown];
const LISTENER = world.targets.findIndex((t) => t.kind === "listener");
const ASSESSOR = world.targets.findIndex((t) => t.kind === "assessor");
const COMMS = world.targets.findIndex((t) => t.kind === "commsCentre" && t.network !== config.localMap.startTown);
const REPORTING = world.targets[COMMS].network;
const FAR = { x: 1000, y: 1000 }; // a robot nobody can see
const IN_TOWN = { x: world.towns[REPORTING].x, y: world.towns[REPORTING].y };
const BOSSES: [string, number][] = [["listener", LISTENER], ["assessor", ASSESSOR]];

function state(from: Partial<DashboardState> = {}): DashboardState {
  return { ...createDashboardState(config), pos: FAR, bossesOut: [LISTENER, ASSESSOR], ...from };
}

function run(s: DashboardState, seconds: number, each: (s: DashboardState) => void = () => {}): DashboardState {
  let next = s;
  for (let i = 0; i < Math.max(1, Math.round(seconds / DT)); i++) {
    next = moveHunters({ ...next, time: next.time + DT }, world, DT);
    each(next);
  }
  return next;
}

function onHighGround(s: DashboardState, i: number): boolean {
  const p = positionOf(s, i, world);
  return world.map.tiers[Math.round(p.y)][Math.round(p.x)] === 2;
}

describe("coming out", () => {
  const allParts = Array.from({ length: config.localMap.partCount }, (_, i) => i);
  const before = (from: Partial<DashboardState> = {}) => state({ bossesOut: [], ...from });

  it("is not before every part is collected: no boss is seen, moves, hears or is reported to", () => {
    for (const pos of [IN_TOWN, positionOf(state(), LISTENER, world), positionOf(state(), ASSESSOR, world)]) {
      const s = run(before({ pos, parts: allParts.slice(1) }), 20);
      expect(s.bossesOut).toEqual([]);
      expect(s.lastReport).toBeNull();
      expect(s.bosses).toEqual({});
      for (const [, i] of BOSSES) {
        expect(isHidden(s, i, world)).toBe(true);
        expect(s.hunterPos[i]).toBeUndefined();
        expect(s.alerted).not.toContain(i);
      }
    }
  });

  it("is once the last part is collected, and they stay out", () => {
    const s = run(before({ parts: allParts }), DT);
    expect([...s.bossesOut].sort()).toEqual([LISTENER, ASSESSOR].sort());
    expect(isHidden(s, ASSESSOR, world)).toBe(false);
  });

  it.each(BOSSES)("the %s waits until the robot is well away from where it appears", (_, i) => {
    const s = run(before({ parts: allParts, pos: positionOf(state(), i, world) }), DT);
    expect(s.bossesOut).not.toContain(i);
    expect(run({ ...s, pos: FAR }, DT).bossesOut).toContain(i);
  });
});

describe("boss wrecks", () => {
  it.each(BOSSES)("the %s's holds energy, armour and missiles", (_, i) => {
    expect(new Set(world.targets[i].supplies)).toEqual(new Set(["energy", "armour", "missiles"]));
    expect([...uncollected(state({ ruins: [i] }), i, world)]).toEqual(world.targets[i].supplies);
  });
});

describe("boss placement", () => {
  it("places exactly one of each, in different towns away from the start, on open ground", () => {
    for (const [kind] of BOSSES) expect(world.targets.filter((t) => t.kind === kind)).toHaveLength(1);
    const [l, a] = [world.targets[LISTENER], world.targets[ASSESSOR]];
    expect(l.network).not.toBe(a.network);
    for (const t of [l, a]) {
      expect(t.network).not.toBe(config.localMap.startTown);
      expect(world.map.tiers[t.row][t.col]).not.toBe(2);
      expect(world.targets.filter((o) => o.col === t.col && o.row === t.row)).toHaveLength(1);
    }
    expect(l.defences).toEqual({ jammer: true });
    expect(a.defences).toEqual({ pointDefence: true });
  });
});

describe("calm roaming", () => {
  it("is deterministic, crosses networks, and never enters high ground or heads for the start town", () => {
    const headed = new Map(BOSSES.map(([, i]) => [i, new Set<number>()]));
    let high = false;
    const end = run(state(), 180, (s) => {
      for (const [, i] of BOSSES) {
        high ||= onHighGround(s, i);
        headed.get(i)!.add(bossMindOf(s, i, world).town);
      }
    });
    expect(high).toBe(false);
    for (const towns of headed.values()) {
      expect(towns.size).toBeGreaterThan(1);
      expect(towns.has(config.localMap.startTown)).toBe(false);
    }
    const again = run(state(), 180);
    for (const [, i] of BOSSES) {
      expect(positionOf(again, i, world)).toEqual(positionOf(end, i, world));
      expect(end.alerted).not.toContain(i);
    }
  });
});

describe("comms reports", () => {
  it("alert the assessor and send the listener to search, and repeat on an interval", () => {
    const s = run(state({ pos: IN_TOWN }), DT);
    expect(s.lastReport).toMatchObject({ network: REPORTING, at: IN_TOWN });
    expect(s.alerted).toContain(ASSESSOR);
    expect(bossMindOf(s, LISTENER, world).look).not.toBeNull();
    const first = s.lastReport!.time;
    expect(run(s, d.commsReportSeconds - 1).lastReport!.time).toBe(first);
    expect(run(s, d.commsReportSeconds + 1).lastReport!.time).toBeGreaterThan(first);
  });

  it("are not made by a destroyed comms centre, one without power, or with the robot outside", () => {
    const silenced = world.targets.flatMap((t, i) => (t.kind === "commsCentre" && t.network === REPORTING ? [i] : []));
    expect(run(state({ pos: IN_TOWN, ruins: silenced }), DT).lastReport).toBeNull();
    expect(run(state({ pos: IN_TOWN, suppressedUntil: { [REPORTING]: 100 } }), DT).lastReport).toBeNull();
    expect(run(state(), DT).lastReport).toBeNull();
  });
});

describe("the assessor", () => {
  it("pursues across networks over passable ground until it reaches the robot, and never lets go", () => {
    let high = false;
    const s = run(state({ pos: { x: START.x, y: START.y }, alerted: [ASSESSOR] }), 150, (st) => {
      high ||= onHighGround(st, ASSESSOR);
    });
    expect(high).toBe(false);
    const p = positionOf(s, ASSESSOR, world);
    expect(Math.hypot(p.x - START.x, p.y - START.y)).toBeLessThanOrEqual(d.hunterHoldCells + 0.1);
    const away = world.towns[world.targets[ASSESSOR].network];
    expect(run({ ...s, pos: { x: away.x, y: away.y } }, 1).alerted).toContain(ASSESSOR);
  });

  it("is slower than the robot, as is the listener", () => {
    expect(d.assessorSpeed).toBeLessThan(d.walkSpeed);
    expect(d.listenerSpeed).toBeLessThan(d.walkSpeed);
  });
});

describe("the listener", () => {
  const at = positionOf(state(), LISTENER, world);

  it("searches where a report came from, then goes back to roaming", () => {
    const s = run(state({ pos: IN_TOWN }), DT);
    const look = bossMindOf(s, LISTENER, world).look!;
    let arrived = false;
    const end = run({ ...s, pos: FAR, alerted: [] }, 120, (st) => {
      const p = positionOf(st, LISTENER, world);
      arrived ||= p.x === look.x && p.y === look.y;
    });
    expect(arrived).toBe(true);
    expect(bossMindOf(end, LISTENER, world).look).toBeNull();
  });

  it("hears a scan within its hearing, but not beyond", () => {
    const toward = at.x > world.map.cols / 2 ? -1 : 1;
    const scan = (cells: number) =>
      stepDashboard(state({ row: 0, col: 1, pos: { x: at.x + toward * cells, y: at.y } }), ["activate"], DT, world).state;
    expect(bossMindOf(scan(d.listenerHearingCells - 2), LISTENER, world).look).not.toBeNull();
    expect(bossMindOf(scan(d.listenerHearingCells + 2), LISTENER, world).look).toBeNull();
  });

  it("is alerted by sight, loses a robot that gets away, and searches where it was", () => {
    const seen = run(state({ pos: { ...at } }), DT);
    expect(seen.alerted).toContain(LISTENER);
    const lost = run({ ...seen, pos: { x: START.x, y: START.y } }, DT);
    expect(lost.alerted).not.toContain(LISTENER);
    expect(bossMindOf(lost, LISTENER, world).look).not.toBeNull();
  });
});

describe("boss combat", () => {
  it.each(BOSSES)("the %s attacks in range, waits its interval, and never withdraws", (_, boss) => {
    const s = state({ pos: positionOf(state(), boss, world), alerted: [boss], time: 50 });
    expect(hunterInRange(s, world, d.hunterEngageRange)).toBe(boss);
    let spent = s;
    for (let i = 0; i < 5; i++) spent = spendAttack(spent, boss, world);
    expect(spent.alerted).toContain(boss);
    expect(spent.rearming[boss]).toBeUndefined();
    expect(isDisarmed(spent, boss, world)).toBe(false);
    expect(hunterInRange(spent, world, d.hunterEngageRange)).toBeNull();
    expect(hunterInRange({ ...spent, time: 50 + d.bossAttackIntervalSeconds }, world, d.hunterEngageRange)).toBe(boss);
  });

  it("the assessor's attack has more volleys than the listener's", () => {
    const missiles = (boss: number) => {
      const dashboard = state({ pos: positionOf(state(), boss, world), alerted: [boss], time: 50, hunterReadyAt: {} });
      const app = updateApp({ screen: "dashboard", dashboard }, { steering: { left: false, right: false }, actions: [] } as never, DT, config, () => 1);
      if (app.screen !== "defence") throw new Error("no attack");
      expect(app.attacker).toBe(boss);
      return app.defence.missiles.length;
    };
    expect(missiles(ASSESSOR)).toBeGreaterThan(missiles(LISTENER));
  });

  it.each(BOSSES)("one missile destroys the %s, and its defences are in the flight", (_, boss) => {
    const base = createAppState(config);
    if (base.screen !== "dashboard") throw new Error("not at the dashboard");
    const input = { steering: { left: false, right: false }, actions: ["activate"] } as never;
    const dashboard = state({ pos: positionOf(state(), boss, world), mode: "targeting", purpose: "missile", target: boss });
    const launched: AppState = updateApp({ ...base, dashboard }, input, DT, config, () => 1);
    if (launched.screen !== "flight") throw new Error("no flight");
    expect(launched.shielded).toBe(false);
    expect(launched.flight.defended).toBe(boss === ASSESSOR);
    expect(launched.flight.jams.length > 0).toBe(boss === LISTENER);
    const back = updateApp({ ...launched, flight: { ...launched.flight, phase: "hit" } }, input, DT, config, () => 1);
    if (back.screen !== "dashboard") throw new Error("not back at the dashboard");
    expect(back.dashboard.ruins).toContain(boss);
  });

  it("neither is replaced, moves or is alerted once destroyed", () => {
    expect(REPLACEABLE).not.toContain("listener");
    expect(REPLACEABLE).not.toContain("assessor");
    const s = run(state({ pos: IN_TOWN, ruins: [LISTENER, ASSESSOR] }), d.replacementSeconds * 2);
    for (const [, boss] of BOSSES) {
      expect(s.ruins).toContain(boss);
      expect(s.alerted).not.toContain(boss);
      expect(s.hunterPos[boss]).toBeUndefined();
      for (const b of Object.values(s.builds)) expect(b.target).not.toBe(boss);
    }
  });
});
