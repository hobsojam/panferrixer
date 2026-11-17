import type { Config } from "./config";
import { NETWORK, neighboursOf } from "./map";
import { generateLocalMap, targetsFor, type LocalMap, type Target } from "./local-map";

/** The four verbs from design-notes 4.6. Missile and Move work; scan and grid disable do not yet. */
export type Verb = "move" | "scan" | "missile" | "gridDisable";

export type Action = "up" | "down" | "left" | "right" | "activate" | "cancel";

/** The verbs as laid out on screen: a 2x2 grid. */
export const VERB_GRID: readonly (readonly Verb[])[] = [
  ["move", "scan"],
  ["missile", "gridDisable"],
];

export const AVAILABLE_VERBS: readonly Verb[] = ["move", "missile"];

export interface Cross {
  col: number;
  row: number;
}

/** Everything the dashboard needs to know about the robot's current node. */
export interface NodeWorld {
  map: LocalMap;
  targets: readonly Target[];
  range: number;
  neighbours: readonly number[];
  travelSeconds: number;
}

export interface TravelState {
  to: number;
  remaining: number; // seconds left
}

export interface DashboardState {
  row: number;
  col: number;
  energyCells: number;
  shieldPlates: number;
  time: number; // seconds on the dashboard; drives the state-of-mind trace
  location: number; // index of the network node the robot is at
  mode: "browse" | "targeting" | "moving";
  cross: Cross;
  target: number | null; // index into the node's targets, when one is in range
  moveChoice: number; // index into the node's neighbours, while moving
  travel: TravelState | null; // set while the robot is travelling to a node
}

export interface DashboardStep {
  state: DashboardState;
  fire: Target | null; // set on the step where the player confirms a target
}

const worldCache = new Map<number, NodeWorld>();

/** The local patch, targets and links for a node. Cached: the same node is asked for every frame. */
export function worldFor(location: number, cfg: Config): NodeWorld {
  let world = worldCache.get(location);
  if (!world) {
    const map = generateLocalMap(location, cfg.localMap);
    world = {
      map,
      targets: targetsFor(location, map, cfg.localMap),
      range: cfg.dashboard.targetRange,
      neighbours: neighboursOf(location, NETWORK),
      travelSeconds: cfg.dashboard.travelSeconds,
    };
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
    moveChoice: 0,
    travel: null,
  };
}

export function selectedVerb(state: DashboardState): Verb {
  return VERB_GRID[state.row][state.col];
}

/**
 * Pure: moves the selection, moves the cross, chooses a destination, runs travel,
 * and reports a confirmed target. Input is ignored while travelling.
 */
export function stepDashboard(state: DashboardState, actions: readonly Action[], dt: number, world: NodeWorld): DashboardStep {
  let s: DashboardState = { ...state, time: state.time + dt };

  if (s.travel) {
    const remaining = s.travel.remaining - dt;
    if (remaining > 0) return { state: { ...s, travel: { ...s.travel, remaining } }, fire: null };
    return { state: { ...s, location: s.travel.to, travel: null, mode: "browse", target: null }, fire: null };
  }

  let fire: Target | null = null;
  for (const action of actions) {
    if (s.mode === "browse") {
      s = browseAction(s, action, world);
    } else if (s.mode === "moving") {
      s = movingAction(s, action, world);
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

function browseAction(s: DashboardState, action: Action, world: NodeWorld): DashboardState {
  if (action === "up") return { ...s, row: Math.max(0, s.row - 1) };
  if (action === "down") return { ...s, row: Math.min(VERB_GRID.length - 1, s.row + 1) };
  if (action === "left") return { ...s, col: Math.max(0, s.col - 1) };
  if (action === "right") return { ...s, col: Math.min(VERB_GRID[s.row].length - 1, s.col + 1) };
  if (action === "activate") {
    const verb = selectedVerb(s);
    if (verb === "missile") {
      const cross = { col: Math.floor(world.map.cols / 2), row: Math.floor(world.map.rows / 2) };
      return { ...s, mode: "targeting", cross, target: nearestTarget(cross, world) };
    }
    if (verb === "move" && world.neighbours.length > 0) {
      return { ...s, mode: "moving", moveChoice: 0 };
    }
  }
  return s;
}

function movingAction(s: DashboardState, action: Action, world: NodeWorld): DashboardState {
  if (action === "cancel") return { ...s, mode: "browse" };
  if (action === "left" || action === "up") return { ...s, moveChoice: Math.max(0, s.moveChoice - 1) };
  if (action === "right" || action === "down") {
    return { ...s, moveChoice: Math.min(world.neighbours.length - 1, s.moveChoice + 1) };
  }
  if (action === "activate") {
    return {
      ...s,
      mode: "browse",
      travel: { to: world.neighbours[s.moveChoice], remaining: world.travelSeconds },
    };
  }
  return s;
}

function moveCross(s: DashboardState, action: Action, world: NodeWorld): DashboardState {
  const dCol = action === "left" ? -1 : action === "right" ? 1 : 0;
  const dRow = action === "up" ? -1 : action === "down" ? 1 : 0;
  const cross = {
    col: clamp(s.cross.col + dCol, 0, world.map.cols - 1),
    row: clamp(s.cross.row + dRow, 0, world.map.rows - 1),
  };
  return { ...s, cross, target: nearestTarget(cross, world) };
}

/** The target closest to the cross within range; ties go to the earlier target. */
export function nearestTarget(cross: Cross, world: NodeWorld): number | null {
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
