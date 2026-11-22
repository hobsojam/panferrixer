import type { Config } from "./config";
import {
  createDashboardState,
  disturbPatrollers,
  drainEnergy,
  hunterInRange,
  isOutOfEnergy,
  isPaused,
  isShielded,
  leaveTargeting,
  markRuin,
  moveHunters,
  networkOf,
  openWindow,
  positionOf,
  spendAttack,
  startHeldWaits,
  stepDashboard,
  wakeDefender,
  worldFor,
  type Action,
  type DashboardState,
  type World,
} from "./dashboard";
import { hitPlate, plateFacing, standing } from "./armour";
import { createDefence, fanHalfArc, hitBearings, stepDefence, summaryOver, type Aim, type DefenceState } from "./defence";
import { createInitialState, flightSecondsFor, updateFlight } from "./flight";
import type { Target } from "./local-map";
import type { FlightState } from "./types";

/**
 * The screens. The dashboard is persistent: a missile flight or a hunter's attack is
 * opened from it and returns to it, keeping the dashboard's selection and location.
 * `shielded` is decided at launch: it is the state of the network's shields when the missile was fired.
 * `destroyed` is death (design-notes 3, items 17 and 18), with its cause: the last shield plate
 * broke during an attack, or the batteries ran flat. A power-down keeps the screen the robot
 * was on (`from`), frozen, so it can flicker and fade. Death leads only to a fresh game; there
 * are no saves yet.
 */
export type AppState = LiveState | { screen: "destroyed"; cause: DeathCause; elapsed: number; seed: number; from: LiveState | null };

/** Every screen on which the robot is still running. */
export type LiveState =
  | { screen: "dashboard"; dashboard: DashboardState }
  | { screen: "flight"; dashboard: DashboardState; flight: FlightState; target: Target; targetIndex: number; shielded: boolean }
  | { screen: "defence"; dashboard: DashboardState; defence: DefenceState; attacker: number };

/** Why the robot stopped: shields gone, or energy gone. */
export type DeathCause = "shields" | "energy";

/** How long the death screen shows before a press can start a new game. */
export function restartAfter(cause: DeathCause, cfg: Config): number {
  return cause === "energy" ? cfg.death.powerDownSeconds + cfg.death.restartAfterSeconds : cfg.death.restartAfterSeconds;
}

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
  return phase === "hit" || phase === "crash" || phase === "miss" || phase === "shotDown";
}

/** The armour as shown during an attack: each plate's integrity, and which plate took the last hit. */
export interface ShieldView {
  plates: number[];
  lastHit: number | null;
}

/**
 * The armour as it stands mid-attack: the dashboard's, less every hit taken so far, each on
 * the plate facing it (armour.ts). Shown live, so each hit is felt where it lands; the same
 * plates are written back to the dashboard once, when the attack ends, so nothing is counted twice.
 */
export function shieldsDuringAttack(dashboard: DashboardState, defence: DefenceState, cfg: Config): ShieldView {
  let plates = dashboard.plates;
  let lastHit: number | null = null;
  for (const yaw of hitBearings(defence)) {
    const hit = hitPlate(plates, plateFacing(yaw, plates.length, fanHalfArc(cfg)));
    plates = hit.plates;
    if (hit.took >= 0) lastHit = hit.took;
  }
  return { plates, lastHit };
}

/** How far the robot is from a target, in map cells. A hunter may have moved from its post. */
function rangeTo(dashboard: DashboardState, index: number, world: World): number {
  const p = positionOf(dashboard, index, world);
  return Math.hypot(p.x - dashboard.pos.x, p.y - dashboard.pos.y);
}

/**
 * Pure fixed-timestep update for the whole app. Zero energy is death (design-notes 3, item 18)
 * on whichever screen the batteries run flat, so it is checked once, after the screen's own step.
 */
export function updateApp(
  state: AppState,
  input: AppInput,
  dt: number,
  cfg: Config,
  newSeed: () => number
): AppState {
  if (state.screen === "destroyed") {
    // The wreck shows for a moment; after that a press starts a new game from the beginning.
    const elapsed = state.elapsed + dt;
    if (elapsed >= restartAfter(state.cause, cfg) && input.actions.includes("activate")) return createAppState(cfg);
    return { ...state, elapsed };
  }
  const next = updateLive(state, input, dt, cfg, newSeed);
  if (next.screen !== "destroyed" && isOutOfEnergy(next.dashboard)) {
    return { screen: "destroyed", cause: "energy", elapsed: 0, seed: newSeed(), from: next };
  }
  return next;
}

function updateLive(state: LiveState, input: AppInput, dt: number, cfg: Config, newSeed: () => number): AppState {
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
        // Point defence (design-notes 4.11) and jamming (4.1): which targets carry them is for escalation
        // to decide; for now only the feel-test toggles turn them on.
        flight: createInitialState(
          newSeed(),
          cfg,
          flightSecondsFor(rangeTo(dashboard, world.targets.indexOf(step.fire), world), cfg),
          { pointDefence: cfg.feelTestToggles.pointDefenceEverywhere, jammer: cfg.feelTestToggles.jammingEverywhere }
        ),
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
      // A patroller is lightly armed: one volley, against a hunter's three (#66).
      const volleys = world.targets[hunter].kind === "patroller" ? cfg.dashboard.patrollerVolleys : cfg.defence.volleys;
      const defence = createDefence(newSeed(), cfg, rangeTo(dashboard, hunter, world), volleys);
      return { screen: "defence", dashboard, defence, attacker: hunter };
    }
    return { screen: "dashboard", dashboard };
  }

  if (state.screen === "defence") {
    // The shield clock and the hunters run during an attack, as they do during a flight.
    const timed = moveHunters(drainEnergy({ ...state.dashboard, time: state.dashboard.time + dt }, dt, 0, world), world, dt);
    // A fresh press fires as well as holding, so a quick tap is never lost between steps.
    const fire = (input.fire ?? false) || input.actions.includes("activate");
    const defence = stepDefence(state.defence, input.aim ?? { yaw: 0, pitch: 0 }, fire, dt, cfg);
    // Zero shields is death (design-notes 3, item 17), the moment the last plate breaks.
    const shields = shieldsDuringAttack(timed, defence, cfg);
    if (standing(shields.plates) === 0) return { screen: "destroyed", cause: "shields", elapsed: 0, seed: newSeed(), from: null };
    // Over, but the summary shows for a moment before the dashboard returns by itself.
    if (!summaryOver(defence, cfg)) return { ...state, dashboard: timed, defence };
    // The attack is over: every missile that got through is a hit on the shields. Then a short
    // breather, so the player always has time to open Missile (which stops time) and strike
    // back. The attacker spends one from its magazine, and withdraws to rearm once it is empty
    // (design-notes 4.10).
    const hit: DashboardState = { ...timed, plates: shields.plates };
    const spent = spendAttack(hit, state.attacker, world);
    return { screen: "dashboard", dashboard: { ...spent, breatherUntil: spent.time + world.attackBreatherSeconds } };
  }

  // Flight: presses are ignored, so a key tapped mid-flight cannot skip the result.
  if (isResult(state.flight.phase) && input.actions.includes("activate")) {
    const back = leaveTargeting(state.dashboard);
    // A missile that destroyed an unshielded building or hunter leaves a ruin, and any drop under it can now be found.
    // A deflected missile and a power station hit leave nothing behind.
    const destroyed = state.flight.phase === "hit" && !state.shielded && state.target.kind !== "power";
    const ruined = destroyed ? markRuin(back, state.targetIndex) : back;
    // A defender woken by this missile starts its wait before attacking only now (design-notes 4.4).
    return { screen: "dashboard", dashboard: startHeldWaits(ruined, world) };
  }

  // The shield clock and the batteries run in real time, so they keep running while a missile is in the air.
  const timed: DashboardState = moveHunters(drainEnergy({ ...state.dashboard, time: state.dashboard.time + dt }, dt, 0, world), world, dt);
  const flight = updateFlight(state.flight, input.steering, dt, cfg);

  // A missile hit is a disturbance: patrollers within earshot come to look (#66).
  const struck = flight.phase === "hit" && state.flight.phase !== "hit";
  const heard = struck
    ? disturbPatrollers(timed, positionOf(timed, state.targetIndex, world), world.patrollerHearingCells, world)
    : timed;
  // A hit on a power station takes its network's shields down. The station itself survives.
  if (struck && state.target.kind === "power") {
    return { ...state, dashboard: openWindow(heard, networkOf(state.target), world), flight };
  }
  // A hit on a dome wakes its defender, if it has one, whether the missile destroys the dome
  // or the shield deflects it (design-notes 4.4). It comes out while the result shows, but
  // holds its first attack until the player is back at the dashboard.
  if (struck && state.target.kind === "dome") {
    return { ...state, dashboard: wakeDefender(heard, state.targetIndex, world), flight };
  }
  return { ...state, dashboard: heard, flight };
}
