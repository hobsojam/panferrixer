import type { Config } from "./config";
import {
  applyShieldHits,
  createDashboardState,
  hunterInRange,
  isShielded,
  leaveTargeting,
  markRuin,
  moveHunters,
  networkOf,
  openWindow,
  positionOf,
  stepDashboard,
  worldFor,
  type Action,
  type DashboardState,
  type World,
} from "./dashboard";
import { createDefence, hitCount, stepDefence, summaryOver, type Aim, type DefenceState } from "./defence";
import { createInitialState, flightSecondsFor, updateFlight } from "./flight";
import type { Target } from "./local-map";
import { createRng } from "./rng";
import type { FlightState } from "./types";

/**
 * The screens. The dashboard is persistent: a missile flight or a hunter's attack is
 * opened from it and returns to it, keeping the dashboard's selection and location.
 * `shielded` is decided at launch: it is the state of the network's shields when the missile was fired.
 */
export type AppState =
  | { screen: "dashboard"; dashboard: DashboardState }
  | { screen: "flight"; dashboard: DashboardState; flight: FlightState; target: Target; targetIndex: number; shielded: boolean }
  | { screen: "defence"; dashboard: DashboardState; defence: DefenceState; attacker: number };

export interface AppInput {
  actions: readonly Action[]; // discrete presses this step; ignored during flight
  steering: number; // held left/right, -1..1
  aim?: Aim; // held turning on both axes, -1..1 each; the defence turret. Missing means no turning
  fire?: boolean; // fire held; the defence guns. Missing means not firing
}

export function createAppState(cfg: Config): AppState {
  return { screen: "dashboard", dashboard: createDashboardState(cfg) };
}

function isResult(phase: FlightState["phase"]): boolean {
  return phase === "hit" || phase === "crash" || phase === "miss";
}

/** How far the robot is from a target, in map cells. A hunter may have moved from its post. */
function rangeTo(dashboard: DashboardState, index: number, world: World): number {
  const p = positionOf(dashboard, index, world);
  return Math.hypot(p.x - dashboard.pos.x, p.y - dashboard.pos.y);
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
    // Hunters move in real time, on every screen, so they keep coming during a flight or an attack.
    const dashboard = moveHunters(step.state, world, dt);
    if (step.fire) {
      return {
        screen: "flight",
        dashboard,
        // A nearer target is a shorter flight (design-notes 4.10).
        flight: createInitialState(newSeed(), cfg, flightSecondsFor(rangeTo(dashboard, world.targets.indexOf(step.fire), world), cfg)),
        target: step.fire,
        targetIndex: world.targets.indexOf(step.fire),
        shielded: isShielded(dashboard, step.fire),
      };
    }
    // An alerted hunter that is close enough, and ready again, opens fire. Its alert stays,
    // so it keeps coming after the attack until it leaves its leash or dies. A nearer
    // hunter's missiles arrive sooner. Its cooldown starts when the attack ends.
    const hunter = hunterInRange(dashboard, world, cfg.dashboard.hunterEngageRange);
    if (hunter !== null) {
      const defence = createDefence(newSeed(), cfg, rangeTo(dashboard, hunter, world));
      return { screen: "defence", dashboard, defence, attacker: hunter };
    }
    return { screen: "dashboard", dashboard };
  }

  if (state.screen === "defence") {
    // The shield clock and the hunters run during an attack, as they do during a flight.
    const timed = moveHunters({ ...state.dashboard, time: state.dashboard.time + dt }, world, dt);
    // A fresh press fires as well as holding, so a quick tap is never lost between steps.
    const fire = (input.fire ?? false) || input.actions.includes("activate");
    const defence = stepDefence(state.defence, input.aim ?? { yaw: 0, pitch: 0 }, fire, dt, cfg);
    // Over, but the summary shows for a moment before the dashboard returns by itself.
    if (!summaryOver(defence, cfg)) return { ...state, dashboard: timed, defence };
    // The attack is over: every missile that got through is a hit on the shields. The
    // hunter then holds off long enough for the player to strike back (design-notes 4.10).
    const hit = applyShieldHits(timed, hitCount(defence), cfg.dashboard.hitsPerPlate);
    const cooldown = world.hunterCooldownSeconds + createRng(newSeed())() * world.hunterCooldownRandomSeconds;
    return { screen: "dashboard", dashboard: { ...hit, hunterReadyAt: { ...hit.hunterReadyAt, [state.attacker]: hit.time + cooldown } } };
  }

  // Flight: presses are ignored, so a key tapped mid-flight cannot skip the result.
  if (isResult(state.flight.phase) && input.actions.includes("activate")) {
    const back = leaveTargeting(state.dashboard);
    // A missile that destroyed an unshielded building or hunter leaves a ruin, and any drop under it can now be found.
    // A deflected missile and a power station hit leave nothing behind.
    const destroyed = state.flight.phase === "hit" && !state.shielded && state.target.kind !== "power";
    const dashboard = destroyed ? markRuin(back, state.targetIndex) : back;
    return { screen: "dashboard", dashboard };
  }

  // The shield clock runs in real time, so it keeps running while a missile is in the air.
  const timed: DashboardState = moveHunters({ ...state.dashboard, time: state.dashboard.time + dt }, world, dt);
  const flight = updateFlight(state.flight, input.steering, dt, cfg);

  // A hit on a power station takes its network's shields down. The station itself survives.
  if (flight.phase === "hit" && state.flight.phase !== "hit" && state.target.kind === "power") {
    return { ...state, dashboard: openWindow(timed, networkOf(state.target), world), flight };
  }
  return { ...state, dashboard: timed, flight };
}
