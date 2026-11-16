import { describe, expect, it } from "vitest";
import { config, type Config } from "../src/config";
import { createInitialState, updateFlight } from "../src/flight";
import { findPassablePath } from "../src/terrain";
import type { FlightState, Peak } from "../src/types";

const peak = (center: number, halfWidth: number, height = 50): Peak => ({
  center,
  halfWidth,
  height,
  profile: [{ nx: 0, ny: 1 }],
});

/** A flight with no terrain at all, so outcomes depend only on steering. */
function openFlight(seed = 1): FlightState {
  return { ...createInitialState(seed, config), terrain: { bands: [] } };
}

function flyToResult(state: FlightState, steering: number, cfg: Config = config): FlightState {
  const dt = cfg.simulation.fixedDtSeconds;
  let current = state;
  for (let i = 0; i < 10000 && (current.phase === "flight" || current.phase === "terminal"); i++) {
    current = updateFlight(current, steering, dt, cfg);
  }
  return current;
}

describe("updateFlight outcomes", () => {
  it("hits the target when flown straight down the locked heading", () => {
    const result = flyToResult(openFlight(), 0);

    expect(result.phase).toBe("hit");
    expect(Math.abs(result.x)).toBeLessThanOrEqual(config.terminalPhase.targetHalfWidth);
    expect(result.elapsed).toBeCloseTo(config.flight.durationSeconds, 0);
  });

  it("misses when the missile finishes the flight off course", () => {
    const result = flyToResult(openFlight(), 1);

    expect(result.phase).toBe("miss");
    expect(Math.abs(result.x)).toBeGreaterThan(config.terminalPhase.targetHalfWidth);
  });

  it("crashes when the missile flies into terrain above its altitude", () => {
    const blocked: FlightState = {
      ...openFlight(),
      terrain: { bands: [{ depth: 600, peaks: [peak(0, 1.1)] }] },
    };

    const result = flyToResult(blocked, 0);

    expect(result.phase).toBe("crash");
    expect(result.depth).toBeGreaterThanOrEqual(600);
  });

  it("flies safely through the low flank of a peak that only just clears altitude", () => {
    // Height 20 against a flight height of 18, so only the innermost tenth is a hazard.
    const grazing: FlightState = {
      ...openFlight(),
      terrain: { bands: [{ depth: 600, peaks: [peak(0.3, 0.5, 20)] }] },
      x: 0.6, // inside the peak's lateral span, but out on the low taper
    };

    const result = flyToResult(grazing, 0);

    expect(result.phase).not.toBe("crash");
  });

  it("is safe to steer into a mountain's lateral span once the band is behind", () => {
    const start: FlightState = {
      ...openFlight(),
      terrain: { bands: [{ depth: 600, peaks: [peak(0.5, 0.2)] }] },
      depth: 601,
      nextBandIndex: 1,
    };

    const result = flyToResult(start, 1);

    expect(result.phase).not.toBe("crash");
    expect(result.x).toBeGreaterThan(0.5);
  });

  it("enters the terminal phase before the flight ends", () => {
    const dt = config.simulation.fixedDtSeconds;
    let state = openFlight();
    const phases = new Set<string>();

    for (let i = 0; i < 10000 && (state.phase === "flight" || state.phase === "terminal"); i++) {
      state = updateFlight(state, 0, dt, config);
      phases.add(state.phase);
    }

    expect(phases.has("terminal")).toBe(true);
  });
});

describe("fairness, end to end", () => {
  it("a pilot following the generated path completes the flight, across many seeds", () => {
    const dt = config.simulation.fixedDtSeconds;

    for (let seed = 0; seed < 40; seed++) {
      let state = createInitialState(seed, config);
      const path = findPassablePath(
        state.terrain,
        config.terrain.pathCellCount,
        config.terrain.maxLateralStepPerBand,
        config.camera.height
      );
      expect(path, `seed ${seed} generated no passable path`).not.toBeNull();

      for (let i = 0; i < 10000 && (state.phase === "flight" || state.phase === "terminal"); i++) {
        const target = path![Math.min(state.nextBandIndex, path!.length - 1)] ?? 0;
        state = updateFlight(state, clamp((target - state.x) * 8, -1, 1), dt, config);
      }

      expect(state.phase, `seed ${seed} crashed while flying its own path`).not.toBe("crash");
    }
  });
});

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

describe("steering", () => {
  it("clamps lateral position at the edges without wrapping", () => {
    const dt = config.simulation.fixedDtSeconds;
    let state = openFlight();

    for (let i = 0; i < 300; i++) {
      state = updateFlight(state, -1, dt, config);
    }

    expect(state.x).toBe(-1);
  });

  it("starts centred and level", () => {
    const state = openFlight();
    expect(state.x).toBe(0);
    expect(state.roll).toBe(0);
  });
});

describe("banking", () => {
  const maxRoll = (config.banking.maxRollDegrees * Math.PI) / 180;

  it("rolls into the turn and never past the cap", () => {
    const dt = config.simulation.fixedDtSeconds;
    let state = openFlight();

    for (let i = 0; i < 120; i++) {
      state = updateFlight(state, 1, dt, config);
    }

    expect(state.roll).toBeGreaterThan(0);
    expect(state.roll).toBeLessThanOrEqual(maxRoll + 1e-9);
  });

  it("returns to level once the player stops steering", () => {
    const dt = config.simulation.fixedDtSeconds;
    let state = openFlight();

    for (let i = 0; i < 120; i++) state = updateFlight(state, -1, dt, config);
    expect(state.roll).toBeLessThan(0);

    for (let i = 0; i < 300; i++) state = updateFlight(state, 0, dt, config);
    expect(Math.abs(state.roll)).toBeLessThan(0.01);
  });
});

describe("result phases", () => {
  it("freeze the flight and accumulate result time", () => {
    const dt = config.simulation.fixedDtSeconds;
    const landed = flyToResult(openFlight(), 0);
    const afterwards = updateFlight(landed, 1, dt, config);

    expect(afterwards.phase).toBe(landed.phase);
    expect(afterwards.depth).toBe(landed.depth);
    expect(afterwards.x).toBe(landed.x);
    expect(afterwards.resultElapsed).toBeCloseTo(landed.resultElapsed + dt, 10);
  });
});
