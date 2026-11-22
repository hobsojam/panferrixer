import { describe, expect, it } from "vitest";
import { createAppState, updateApp, type AppState } from "../src/app";
import { config, type Config } from "../src/config";
import { createDashboardState } from "../src/dashboard";
import { createInitialState, updateFlight } from "../src/flight";
import { eventsBetween } from "../src/sound";
import type { FlightState } from "../src/types";

// Point defence (design-notes 4.11): a defended target fires aimed, announced bursts in the
// terminal phase. Never a dice roll: a missile that dodges is never shot down.
const DT = config.simulation.fixedDtSeconds;
const pd = config.pointDefence;

/** A defended flight over open ground, so only the point defence can stop it. */
function defendedFlight(seed = 1): FlightState {
  return { ...createInitialState(seed, config, config.flight.durationSeconds, { pointDefence: true }), terrain: { bands: [] } };
}

type Policy = (s: FlightState) => number;

function fly(state: FlightState, policy: Policy, cfg: Config = config): { end: FlightState; frames: FlightState[] } {
  const frames: FlightState[] = [state];
  let s = state;
  for (let i = 0; i < 10000 && (s.phase === "flight" || s.phase === "terminal"); i++) {
    s = updateFlight(s, policy(s), DT, cfg);
    frames.push(s);
  }
  return { end: s, frames };
}

const straight: Policy = () => 0;

/** Steer toward a lateral position. */
const toward = (s: FlightState, goal: number) => Math.max(-1, Math.min(1, (goal - s.x) * 12));

/**
 * A pilot who keeps clear of every line of fire it can see, flashes and rounds alike, and
 * otherwise heads for the target: of the spots clear of them all, the one nearest the target.
 */
const jinking: Policy = (s) => {
  const lines = [...s.bursts.map((b) => b.aim), ...s.rounds.map((r) => r.x)];
  if (lines.length === 0) return toward(s, 0);
  const spots = Array.from({ length: 81 }, (_, i) => -1 + i * 0.025);
  const clear = spots.filter((g) => lines.every((a) => Math.abs(a - g) > pd.hitHalfWidth * 2.5));
  const goal = clear.sort((a, b) => Math.abs(a) - Math.abs(b))[0] ?? 0;
  return toward(s, goal);
};

describe("point defence", () => {
  it("an undefended target never fires", () => {
    const { frames, end } = fly({ ...createInitialState(1, config), terrain: { bands: [] } }, straight);
    expect(frames.every((f) => f.rounds.length === 0 && f.bursts.length === 0)).toBe(true);
    expect(end.phase).toBe("hit");
  });

  it("holds fire until the terminal phase", () => {
    const { frames } = fly(defendedFlight(), straight);
    for (const f of frames) if (f.phase === "flight") expect(f.bursts.length + f.rounds.length).toBe(0);
  });

  it("shoots down a missile flown straight at it", () => {
    expect(fly(defendedFlight(), straight).end.phase).toBe("shotDown");
  });

  it("a missile that dodges each burst and comes back still hits: it is never a dice roll", () => {
    for (let seed = 1; seed <= 10; seed++) expect(fly(defendedFlight(seed), jinking).end.phase, `seed ${seed}`).toBe("hit");
  });

  it("aims each burst at where the missile is when the flash shows", () => {
    const { frames } = fly(defendedFlight(), (s) => (s.phase === "terminal" ? 0.4 : 0));
    // Moving at a steady rate, the aim leads the missile a little, never trails it.
    const warned = frames.filter((f, i) => i > 0 && f.bursts.length > frames[i - 1].bursts.length);
    expect(warned.length).toBeGreaterThan(0);
    for (const f of warned) {
      const aim = f.bursts[f.bursts.length - 1].aim;
      expect(aim).toBeGreaterThanOrEqual(f.x);
      expect(aim - f.x).toBeLessThan(0.2);
    }
  });

  it("no burst is announced close to the target, so the last one can be dodged", () => {
    const { frames } = fly(defendedFlight(), jinking);
    frames.forEach((f, i) => {
      if (i === 0 || f.bursts.length <= frames[i - 1].bursts.length) return;
      expect(f.totalDistance - f.depth).toBeGreaterThan(pd.ceaseDistance);
    });
  });

  it("rounds leave the muzzle only after the warning", () => {
    const { frames } = fly(defendedFlight(), jinking);
    const first = frames.find((f) => f.bursts.length > 0)!;
    const warnedAt = first.bursts[0].warnedAt;
    for (const f of frames) if (f.elapsed < warnedAt + pd.warningSeconds - 1e-9) expect(f.rounds.length).toBe(0);
  });

  it("is the same every time for the same flying", () => {
    expect(fly(defendedFlight(3), jinking).frames).toEqual(fly(defendedFlight(3), jinking).frames);
  });
});

describe("point defence in the app", () => {
  const seeds = () => 1;

  it("the feel-test toggle defends every target; otherwise none is", () => {
    const dashboard = { ...createDashboardState(config), mode: "targeting" as const, target: 1, purpose: "missile" as const };
    const fire = (cfg: Config) => {
      const out = updateApp({ screen: "dashboard", dashboard }, { actions: ["activate"], steering: 0 }, DT, cfg, seeds);
      if (out.screen !== "flight") throw new Error(`expected a flight, got ${out.screen}`);
      return out.flight.defended;
    };
    expect(fire(config)).toBe(false);
    expect(fire({ ...config, feelTestToggles: { ...config.feelTestToggles, pointDefenceEverywhere: true } })).toBe(true);
  });

  it("a shot-down missile is a result: a press returns to the dashboard and nothing is destroyed", () => {
    const base = createAppState(config);
    if (base.screen !== "dashboard") throw new Error("expected the dashboard");
    const flying: AppState = {
      screen: "flight",
      dashboard: base.dashboard,
      flight: { ...defendedFlight(), phase: "shotDown" },
      target: { col: 0, row: 0, kind: "dome", supplies: [], network: 0 },
      targetIndex: 0,
      shielded: false,
    };
    const back = updateApp(flying, { actions: ["activate"], steering: 0 }, DT, config, seeds);
    expect(back.screen).toBe("dashboard");
    if (back.screen === "dashboard") expect(back.dashboard.ruins).toEqual([]);
  });

  it("sounds: a rattle when a burst is announced, a crash when shot down", () => {
    const base = createAppState(config);
    if (base.screen !== "dashboard") throw new Error("expected the dashboard");
    const as = (flight: FlightState): AppState => ({ screen: "flight", dashboard: base.dashboard, flight, target: { col: 0, row: 0, kind: "dome", supplies: [], network: 0 }, targetIndex: 0, shielded: false });
    const { frames } = fly(defendedFlight(), straight);
    const i = frames.findIndex((f, k) => k > 0 && f.bursts.length > frames[k - 1].bursts.length && frames[k - 1].nextBurstAt !== null);
    expect(eventsBetween(as(frames[i - 1]), as(frames[i]), config)).toEqual(["pointDefence"]);
    const last = frames[frames.length - 1];
    expect(eventsBetween(as(frames[frames.length - 2]), as(last), config)).toEqual(["crash"]);
  });
});
