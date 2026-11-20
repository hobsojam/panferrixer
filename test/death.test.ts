import { describe, expect, it } from "vitest";
import { createAppState, updateApp, type AppInput, type AppState } from "../src/app";
import { config } from "../src/config";
import { createDashboardState, worldFor } from "../src/dashboard";
import { createDefence, hitCount } from "../src/defence";
import { createInputGate, gateInput } from "../src/input-gate";
import { eventsBetween } from "../src/sound";

// Zero shields is death (design-notes 3, item 17), and death starts the game again (#41).
const DT = 1 / 60;
const idle: AppInput = { actions: [], steering: 0 };
const press: AppInput = { actions: ["activate"], steering: 0 };
const seeds = () => 9;
const world = worldFor(config);
const hunterIndex = world.targets.findIndex((t) => t.kind === "hunter");

/** An attack under way, with the robot down to `plates` plates and no hits on the top one. Nobody fires back. */
function underAttack(plates: number): AppState {
  return { screen: "defence", dashboard: { ...createDashboardState(config), shieldPlates: plates, shieldHits: 0 }, defence: createDefence(3, config), attacker: hunterIndex };
}

function runUntil(s: AppState, done: (s: AppState) => boolean, seconds = 30): AppState {
  let state = s;
  for (let i = 0; i < seconds / DT && !done(state); i++) state = updateApp(state, idle, DT, config, seeds);
  return state;
}

describe("zero shields is death", () => {
  it("the robot is destroyed the moment its last plate breaks, before the attack is over", () => {
    const start = underAttack(1);
    if (start.screen !== "defence") throw new Error("expected defence");
    let prev = start;
    let s: AppState = start;
    for (let i = 0; i < 30 / DT && s.screen === "defence"; i++) {
      prev = s;
      s = updateApp(s, idle, DT, config, seeds);
    }
    expect(s.screen).toBe("destroyed");
    if (prev.screen !== "defence") throw new Error("expected defence");
    // The hit that broke the plate is the one that ended it, while missiles were still coming.
    expect(hitCount(prev.defence) + 1).toBeGreaterThanOrEqual(config.dashboard.hitsPerPlate);
    expect(prev.defence.done).toBe(false);
  });

  it("a robot with plates to spare survives the same attack", () => {
    const s = runUntil(underAttack(config.dashboard.shieldPlates), (x) => x.screen !== "defence");
    expect(s.screen).toBe("dashboard");
  });

  it("dying plays the robot's own explosion", () => {
    const s = runUntil(underAttack(1), (x) => x.screen === "destroyed");
    expect(eventsBetween(underAttack(1), s, config)).toEqual(["destroyed"]);
  });
});

describe("after death", () => {
  const dead: AppState = { screen: "destroyed", cause: "shields", elapsed: 0, seed: 1, from: null };

  it("a press does nothing while the wreck is showing", () => {
    let s: AppState = dead;
    for (let i = 0; i < (config.death.restartAfterSeconds - 0.1) / DT; i++) s = updateApp(s, press, DT, config, seeds);
    expect(s.screen).toBe("destroyed");
  });

  it("waits for a press, then starts a new game from the beginning", () => {
    let s: AppState = dead;
    for (let i = 0; i < (config.death.restartAfterSeconds + 5) / DT; i++) s = updateApp(s, idle, DT, config, seeds);
    expect(s.screen).toBe("destroyed");
    expect(updateApp(s, press, DT, config, seeds)).toEqual(createAppState(config));
  });

  it("Space held from the attack does not skip the wreck: the screen change gates it", () => {
    const gate = createInputGate("defence");
    const held = { ...press, fire: true };
    let g = gateInput(gate, "destroyed", held, DT, config);
    expect(g.input.actions).toEqual([]);
    // Still held after the quiet time: ignored until let go and pressed again.
    for (let i = 0; i < 2 / DT; i++) g = gateInput(g.gate, "destroyed", { ...idle, fire: true }, DT, config);
    expect(g.gate.waitingForRelease).toBe(true);
  });
});
