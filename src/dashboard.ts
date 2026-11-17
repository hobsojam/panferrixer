import type { Config } from "./config";
import { generateLocalMap, targetsFor, type LocalMap, type Target } from "./local-map";

/** The four verbs from design-notes 4.6. Only "missile" does anything in this slice. */
export type Verb = "move" | "scan" | "missile" | "gridDisable";

export type Action = "up" | "down" | "left" | "right" | "activate" | "cancel";

/** The verbs as laid out on screen: a 2x2 grid. */
export const VERB_GRID: readonly (readonly Verb[])[] = [
  ["move", "scan"],
  ["missile", "gridDisable"],
];

export const AVAILABLE_VERBS: readonly Verb[] = ["missile"];

export interface Cross {
  col: number;
  row: number;
}

/** What the targeting cross can pick from, for the robot's current node. */
export interface TargetingWorld {
  map: LocalMap;
  targets: readonly Target[];
  range: number;
}

export interface DashboardState {
  row: number;
  col: number;
  energyCells: number;
  shieldPlates: number;
  time: number; // seconds on the dashboard; drives the state-of-mind trace
  location: number; // index of the network node the robot is at
  mode: "browse" | "targeting";
  cross: Cross;
  target: number | null; // index into the world's targets, when one is in range
}

export interface DashboardStep {
  state: DashboardState;
  fire: Target | null; // set on the step where the player confirms a target
}

const worldCache = new Map<number, TargetingWorld>();

/** The local patch and its targets for a node. Cached: the same node is asked for every frame. */
export function worldFor(location: number, cfg: Config): TargetingWorld {
  let world = worldCache.get(location);
  if (!world) {
    const map = generateLocalMap(location, cfg.localMap);
    world = { map, targets: targetsFor(location, map, cfg.localMap), range: cfg.dashboard.targetRange };
    worldCache.set(location, world);
  }
  return world;
}

export function createDashboardState(cfg: Config): DashboardState {
  return {
    row: 0,
    col: 0,
    energyCells: cfg.dashboard.energyCells,
    shieldPlates: cfg.dashboard.shieldPlates,
    time: 0,
    location: cfg.dashboard.startNode,
    mode: "browse",
    cross: { col: Math.floor(cfg.localMap.cols / 2), row: Math.floor(cfg.localMap.rows / 2) },
    target: null,
  };
}

export function selectedVerb(state: DashboardState): Verb {
  return VERB_GRID[state.row][state.col];
}

/** Pure: moves the selection, moves the cross while targeting, and reports a confirmed target. */
export function stepDashboard(state: DashboardState, actions: readonly Action[], dt: number, world: TargetingWorld): DashboardStep {
  let s: DashboardState = { ...state, time: state.time + dt };
  let fire: Target | null = null;

  for (const action of actions) {
    if (s.mode === "browse") {
      s = browseAction(s, action, world);
    } else if (action === "cancel") {
      s = { ...s, mode: "browse", target: null };
    } else if (action === "activate") {
      if (s.target !== null) fire = world.targets[s.target];
    } else {
      s = moveCross(s, action, world);
    }
  }

  return { state: s, fire };
}

function browseAction(s: DashboardState, action: Action, world: TargetingWorld): DashboardState {
  if (action === "up") return { ...s, row: Math.max(0, s.row - 1) };
  if (action === "down") return { ...s, row: Math.min(VERB_GRID.length - 1, s.row + 1) };
  if (action === "left") return { ...s, col: Math.max(0, s.col - 1) };
  if (action === "right") return { ...s, col: Math.min(VERB_GRID[s.row].length - 1, s.col + 1) };
  if (action === "activate" && selectedVerb(s) === "missile") {
    const cross = { col: Math.floor(world.map.cols / 2), row: Math.floor(world.map.rows / 2) };
    return { ...s, mode: "targeting", cross, target: nearestTarget(cross, world) };
  }
  return s;
}

function moveCross(s: DashboardState, action: Action, world: TargetingWorld): DashboardState {
  const dCol = action === "left" ? -1 : action === "right" ? 1 : 0;
  const dRow = action === "up" ? -1 : action === "down" ? 1 : 0;
  const cross = {
    col: clamp(s.cross.col + dCol, 0, world.map.cols - 1),
    row: clamp(s.cross.row + dRow, 0, world.map.rows - 1),
  };
  return { ...s, cross, target: nearestTarget(cross, world) };
}

/** The target closest to the cross within range; ties go to the earlier target. */
export function nearestTarget(cross: Cross, world: TargetingWorld): number | null {
  let best: number | null = null;
  let bestDistance = Infinity;
  world.targets.forEach((t, index) => {
    const distance = Math.max(Math.abs(t.col - cross.col), Math.abs(t.row - cross.row));
    if (distance <= world.range && distance < bestDistance) {
      best = index;
      bestDistance = distance;
    }
  });
  return best;
}

/** Back to browsing after a flight, with the verb selection kept. */
export function leaveTargeting(state: DashboardState): DashboardState {
  return { ...state, mode: "browse", target: null };
}

/** A bar is low when at or below the threshold: the last cell or plate flashes and the trace agitates. */
export function isLow(count: number, cfg: Config): boolean {
  return count <= cfg.dashboard.lowThreshold;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
