import type { Config } from "./config";
import { createDashboardState, leaveTargeting, stepDashboard, worldFor, type Action, type DashboardState } from "./dashboard";
import { createInitialState, updateFlight } from "./flight";
import type { Target } from "./local-map";
import type { FlightState } from "./types";

/**
 * The two screens. The dashboard is persistent: a missile flight is opened from
 * it and returns to it, keeping the dashboard's selection and location.
 */
export type AppState =
  | { screen: "dashboard"; dashboard: DashboardState }
  | { screen: "flight"; dashboard: DashboardState; flight: FlightState; target: Target };

export interface AppInput {
  actions: readonly Action[]; // discrete presses this step; ignored during flight
  steering: number; // held left/right, -1..1
}

export function createAppState(cfg: Config): AppState {
  return { screen: "dashboard", dashboard: createDashboardState(cfg) };
}

function isResult(phase: FlightState["phase"]): boolean {
  return phase === "hit" || phase === "crash" || phase === "miss";
}

/** Pure fixed-timestep update for the whole app. */
export function updateApp(
  state: AppState,
  input: AppInput,
  dt: number,
  cfg: Config,
  newSeed: () => number
): AppState {
  if (state.screen === "dashboard") {
    const step = stepDashboard(state.dashboard, input.actions, dt, worldFor(cfg));
    if (step.fire) {
      return {
        screen: "flight",
        dashboard: step.state,
        flight: createInitialState(newSeed(), cfg),
        target: step.fire,
      };
    }
    return { screen: "dashboard", dashboard: step.state };
  }

  // Flight: presses are ignored, so a key tapped mid-flight cannot skip the result.
  if (isResult(state.flight.phase) && input.actions.includes("activate")) {
    return { screen: "dashboard", dashboard: leaveTargeting(state.dashboard) };
  }
  return {
    ...state,
    flight: updateFlight(state.flight, input.steering, dt, cfg),
  };
}
