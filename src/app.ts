import type { Config } from "./config";
import {
  applyShieldHits,
  createDashboardState,
  hunterInRange,
  isPaused,
  isShielded,
  leaveTargeting,
  markRuin,
  moveHunters,
  networkOf,
  openWindow,
  positionOf,
  spendAttack,
  stepDashboard,
  worldFor,
  type Action,
  type DashboardState,
  type World,
} from "./dashboard";
import { createDefence, hitCount, stepDefence, summaryOver, type Aim, type DefenceState } from "./defence";
import { createInitialState, flightSecondsFor, updateFlight } from "./flight";
import type { Target } from "./local-map";
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

/** The shields as shown during an attack: plates standing, and hits taken on the top one. */
export interface ShieldView {
  plates: number;
  hitsOnTop: number;
}

/**
 * The shields as they stand mid-attack: the dashboard's, less every hit taken so far. Shown
 * live, so each hit is felt when it lands; the same hits are applied to the dashboard once,
 * when the attack ends, so nothing is counted twice.
 */
export function shieldsDuringAttack(dashboard: DashboardState, defence: DefenceState, cfg: Config): ShieldView {
  const after = applyShieldHits(dashboard, hitCount(defence), cfg.dashboard.hitsPerPlate);
  return { plates: after.shieldPlates, hitsOnTop: after.shieldHits };
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
    // Hunters move in real time, on every screen, so they keep coming during a flight or an
    // attack. While a chooser is open time stops (design-notes 4.10): they hold still, and
    // nobody attacks.
    const paused = isPaused(state.dashboard);
    const dashboard = paused ? step.state : moveHunters(step.state, world, dt);
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
    if (paused) return { screen: "dashboard", dashboard };
    // An alerted hunter that is close enough, and ready, opens fire, unless the breather after
    // the last attack is still running. A nearer hunter's missiles arrive sooner. There is no
    // breather after the player's own flight: fights alternate turns.
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
    // The attack is over: every missile that got through is a hit on the shields. Then a short
    // breather, so the player always has time to open Missile (which stops time) and strike
    // back. The attacker spends one from its magazine, and withdraws to rearm once it is empty
    // (design-notes 4.10).
    const hit = applyShieldHits(timed, hitCount(defence), cfg.dashboard.hitsPerPlate);
    const spent = spendAttack(hit, state.attacker, world);
    return { screen: "dashboard", dashboard: { ...spent, breatherUntil: spent.time + world.attackBreatherSeconds } };
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
