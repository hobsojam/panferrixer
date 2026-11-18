import { describe, expect, it } from "vitest";
import { updateApp, type AppInput, type AppState } from "../src/app";
import { config } from "../src/config";
import { createDashboardState, worldFor } from "../src/dashboard";
import { createDefence, stepDefence, summaryOver } from "../src/defence";
import { createInputGate, gateInput } from "../src/input-gate";

// Input between screens: design-notes 4.8.
const DT = 1 / 60;
const quiet = config.input.screenChangeQuietSeconds;
const press: AppInput = { actions: ["activate"], steering: 0, fire: true };
const nothing: AppInput = { actions: [], steering: 0, fire: false };

describe("the screen-change guard", () => {
  it("passes input straight through while the screen stays the same", () => {
    const { input } = gateInput(createInputGate("dashboard"), "dashboard", press, DT, config);
    expect(input.actions).toEqual(["activate"]);
    expect(input.fire).toBe(true);
  });

  it("ignores presses for a moment after the screen changes", () => {
    let gate = createInputGate("defence");
    let out = gateInput(gate, "dashboard", press, DT, config);
    expect(out.input.actions).toEqual([]);
    gate = out.gate;
    for (let t = DT; t < quiet - DT; t += DT) {
      out = gateInput(gate, "dashboard", { ...press, fire: false }, DT, config);
      gate = out.gate;
      expect(out.input.actions).toEqual([]);
    }
    for (let i = 0; i < 3; i++) {
      out = gateInput(gate, "dashboard", nothing, DT, config);
      gate = out.gate;
    }
    expect(gateInput(gate, "dashboard", { ...press, fire: false }, DT, config).input.actions).toEqual(["activate"]);
  });

  it("fire held through the change does not count until it is released", () => {
    let gate = createInputGate("dashboard");
    // Fire held the whole way through the change and past the quiet time.
    for (let t = 0; t < quiet + 0.5; t += DT) {
      const out = gateInput(gate, "defence", { ...nothing, fire: true }, DT, config);
      gate = out.gate;
      expect(out.input.fire).toBe(false);
    }
    // Released, then pressed again: now it counts.
    gate = gateInput(gate, "defence", nothing, DT, config).gate;
    expect(gateInput(gate, "defence", { ...nothing, fire: true }, DT, config).input.fire).toBe(true);
  });

  it("leaves steering and aiming alone", () => {
    const moving: AppInput = { actions: [], steering: 1, aim: { yaw: 1, pitch: -1 }, fire: false };
    const { input } = gateInput(createInputGate("dashboard"), "flight", moving, DT, config);
    expect(input.steering).toBe(1);
    expect(input.aim).toEqual({ yaw: 1, pitch: -1 });
  });
});

describe("the attack summary", () => {
  it("an attack that is over keeps its clock running for the summary, and nothing else changes", () => {
    let s = createDefence(4, config);
    while (!s.done) s = stepDefence(s, { yaw: 0, pitch: 0 }, false, DT, config);
    expect(s.endedAt).toBe(s.elapsed);
    const later = stepDefence(s, { yaw: 1, pitch: 1 }, true, DT, config);
    expect(later.elapsed).toBeCloseTo(s.elapsed + DT);
    expect({ ...later, elapsed: s.elapsed }).toEqual(s);
  });

  it("the summary lasts its time, then is over", () => {
    let s = createDefence(4, config);
    while (!s.done) s = stepDefence(s, { yaw: 0, pitch: 0 }, false, DT, config);
    expect(summaryOver(s, config)).toBe(false);
    for (let t = 0; t < config.defence.summarySeconds - 2 * DT; t += DT) s = stepDefence(s, { yaw: 0, pitch: 0 }, false, DT, config);
    expect(summaryOver(s, config)).toBe(false);
    for (let i = 0; i < 3; i++) s = stepDefence(s, { yaw: 0, pitch: 0 }, false, DT, config);
    expect(summaryOver(s, config)).toBe(true);
  });

  it("the app stays on the attack for the summary, then returns to the dashboard by itself", () => {
    const world = worldFor(config);
    const hunterIndex = world.targets.findIndex((t) => t.kind === "hunter");
    const hunter = world.targets[hunterIndex];
    let s: AppState = { screen: "dashboard", dashboard: { ...createDashboardState(config), pos: { x: hunter.col, y: hunter.row }, alerted: [hunterIndex] } };
    s = updateApp(s, nothing, DT, config, () => 5);
    expect(s.screen).toBe("defence");
    let overAt: number | null = null;
    let steps = 0;
    while (s.screen === "defence" && steps < 60 * 30) {
      s = updateApp(s, nothing, DT, config, () => 5);
      steps++;
      if (s.screen === "defence" && s.defence.done && overAt === null) overAt = steps;
    }
    expect(s.screen).toBe("dashboard");
    expect(overAt).not.toBeNull();
    expect((steps - overAt!) * DT).toBeCloseTo(config.defence.summarySeconds, 1);
  });
});
