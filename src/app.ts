import type { Config } from "./config";
import {
  createDashboardState,
  isShielded,
  leaveTargeting,
  markRuin,
  networkOf,
  openWindow,
  stepDashboard,
  worldFor,
  type Action,
  type DashboardState,
} from "./dashboard";
import { createInitialState, updateFlight } from "./flight";
import type { Target } from "./local-map";
import type { FlightState } from "./types";

/**
 * The two screens. The dashboard is persistent: a missile flight is opened from
 * it and returns to it, keeping the dashboard's selection and location.
 * `shielded` is decided at launch: it is the state of the network's shields when the missile was fired.
 */
export type AppState =
  | { screen: "dashboard"; dashboard: DashboardState }
  | { screen: "flight"; dashboard: DashboardState; flight: FlightState; target: Target; targetIndex: number; shielded: boolean };

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
  const world = worldFor(cfg);

  if (state.screen === "dashboard") {
    const step = stepDashboard(state.dashboard, input.actions, dt, world);
    if (step.fire) {
      return {
        screen: "flight",
        dashboard: step.state,
        flight: createInitialState(newSeed(), cfg),
        target: step.fire,
        targetIndex: world.targets.indexOf(step.fire),
        shielded: isShielded(step.state, step.fire),
      };
    }
    return { screen: "dashboard", dashboard: step.state };
  }

  // Flight: presses are ignored, so a key tapped mid-flight cannot skip the result.
  if (isResult(state.flight.phase) && input.actions.includes("activate")) {
    const back = leaveTargeting(state.dashboard);
    // A missile that destroyed an unshielded building leaves a ruin, and any drop under it can now be found.
    // A deflected missile and a power station hit leave nothing behind.
    const destroyed = state.flight.phase === "hit" && !state.shielded && state.target.kind !== "power";
    const dashboard = destroyed ? markRuin(back, state.targetIndex) : back;
    return { screen: "dashboard", dashboard };
  }

  // The shield clock runs in real time, so it keeps running while a missile is in the air.
  const dashboard: DashboardState = { ...state.dashboard, time: state.dashboard.time + dt };
  const flight = updateFlight(state.flight, input.steering, dt, cfg);

  // A hit on a power station takes its network's shields down. The station itself survives.
  if (flight.phase === "hit" && state.flight.phase !== "hit" && state.target.kind === "power") {
    return { ...state, dashboard: openWindow(dashboard, networkOf(state.target), world), flight };
  }
  return { ...state, dashboard, flight };
}
