import type { AppInput, AppState } from "./app";
import type { Config } from "./config";

/**
 * Guards input across screen changes (design-notes 4.8). Space fires in defence, continues
 * after a flight and selects on the dashboard, so presses made on one screen must not
 * spill onto the next. After the screen changes, presses are ignored for a short quiet
 * time, and fire held through the change does not count until it has been released.
 * Pure, so it can be tested without a keyboard.
 */
export interface InputGate {
  screen: AppState["screen"];
  quietFor: number; // seconds left in which presses are ignored
  waitingForRelease: boolean; // fire was held through the change and has not been let go yet
}

export function createInputGate(screen: AppState["screen"]): InputGate {
  return { screen, quietFor: 0, waitingForRelease: false };
}

/** Filters one step's input for the screen the app is on now, and advances the gate. */
export function gateInput(gate: InputGate, screen: AppState["screen"], input: AppInput, dt: number, cfg: Config): { gate: InputGate; input: AppInput } {
  let g = gate;
  if (screen !== g.screen) g = { screen, quietFor: cfg.input.screenChangeQuietSeconds, waitingForRelease: true };
  if (g.waitingForRelease && !input.fire) g = { ...g, waitingForRelease: false };

  const quiet = g.quietFor > 0;
  const gated: AppInput = {
    ...input,
    actions: quiet ? [] : input.actions,
    fire: quiet || g.waitingForRelease ? false : input.fire,
  };
  return { gate: { ...g, quietFor: Math.max(0, g.quietFor - dt) }, input: gated };
}
