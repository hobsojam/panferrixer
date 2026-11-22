import { describe, expect, it } from "vitest";
import { createAppState, updateApp, type AppState } from "../src/app";
import { config, type Config } from "../src/config";
import { createDashboardState } from "../src/dashboard";
import { createInitialState, jamLevel, jamSpells, updateFlight } from "../src/flight";
import { eventsBetween } from "../src/sound";
import { terminalStart } from "../src/terrain";
import type { FlightState } from "../src/types";

// Jamming (design-notes 4.1): short spells during the cruise when the direction marker is gone
// and the view breaks up. Never in the terminal phase.
const DT = config.simulation.fixedDtSeconds;
const j = config.jammer;
const speed = config.flight.totalDistance / config.flight.durationSeconds;

function jammedFlight(seed = 1, seconds = config.flight.durationSeconds): FlightState {
  return { ...createInitialState(seed, config, seconds, { jammer: true }), terrain: { bands: [] } };
}

describe("jamming spells", () => {
  it("an unjammed flight is never jammed", () => {
    expect(createInitialState(1, config).jams).toEqual([]);
  });

  it("a jammed flight has spells, calm at launch, within the set lengths and gaps", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const spells = jammedFlight(seed).jams;
      expect(spells.length, `seed ${seed}`).toBeGreaterThan(0);
      expect(spells[0].start).toBeGreaterThanOrEqual(j.firstAfterSeconds);
      spells.forEach((s, i) => {
        expect(s.end - s.start).toBeGreaterThanOrEqual(j.spellSecondsMin);
        expect(s.end - s.start).toBeLessThanOrEqual(j.spellSecondsMax);
        if (i > 0) expect(s.start - spells[i - 1].end).toBeGreaterThanOrEqual(j.gapSecondsMin);
      });
    }
  });

  it("every spell is over before the target comes into view", () => {
    for (const seconds of [12, 20, 30]) {
      const f = jammedFlight(3, seconds);
      const terminalAt = terminalStart(f.totalDistance, config) / speed;
      for (const s of f.jams) expect(s.end).toBeLessThanOrEqual(terminalAt - j.clearBeforeTerminalSeconds + 1e-9);
    }
  });

  it("is the same for the same seed", () => {
    expect(jamSpells(5, 2000, config)).toEqual(jamSpells(5, 2000, config));
    expect(jamSpells(5, 2000, config)).not.toEqual(jamSpells(6, 2000, config));
  });

  it("the level ramps up at a spell's start, holds, and ramps down at its end", () => {
    const f = jammedFlight();
    const spell = f.jams[0];
    const at = (t: number) => jamLevel({ ...f, elapsed: t }, config);
    expect(at(spell.start - 0.01)).toBe(0);
    expect(at(spell.start + j.flickerSeconds / 2)).toBeCloseTo(0.5, 5);
    expect(at((spell.start + spell.end) / 2)).toBe(1);
    expect(at(spell.end - j.flickerSeconds / 2)).toBeCloseTo(0.5, 5);
    expect(at(spell.end + 0.01)).toBe(0);
  });

  it("jamming takes information away but never control: the missile flies and steers the same", () => {
    let clear: FlightState = { ...jammedFlight(), jams: [] };
    let jammed = jammedFlight();
    for (let i = 0; i < 600; i++) {
      clear = updateFlight(clear, 0.3, DT, config);
      jammed = updateFlight(jammed, 0.3, DT, config);
    }
    expect(jammed.x).toBe(clear.x);
    expect(jammed.depth).toBe(clear.depth);
  });
});

describe("jamming in the app", () => {
  it("the feel-test toggle jams every target; otherwise none is", () => {
    const dashboard = { ...createDashboardState(config), mode: "targeting" as const, target: 1, purpose: "missile" as const };
    const fire = (cfg: Config) => {
      const out = updateApp({ screen: "dashboard", dashboard }, { actions: ["activate"], steering: 0 }, DT, cfg, () => 1);
      if (out.screen !== "flight") throw new Error(`expected a flight, got ${out.screen}`);
      return out.flight.jams.length;
    };
    expect(fire(config)).toBe(0);
    expect(fire({ ...config, feelTestToggles: { ...config.feelTestToggles, jammingEverywhere: true } })).toBeGreaterThan(0);
  });

  it("static sounds as a spell begins", () => {
    const base = createAppState(config);
    if (base.screen !== "dashboard") throw new Error("expected the dashboard");
    const as = (flight: FlightState): AppState => ({ screen: "flight", dashboard: base.dashboard, flight, target: { col: 0, row: 0, kind: "dome", supplies: [], network: 0 }, targetIndex: 0, shielded: false });
    const f = jammedFlight();
    const before = { ...f, elapsed: f.jams[0].start - DT / 2 };
    const after = { ...f, elapsed: f.jams[0].start + DT / 2 };
    expect(eventsBetween(as(before), as(after), config)).toEqual(["jam"]);
  });
});
