import type { Config } from "./config";
import { generateWorld, inTown, townCentres, type LocalMap, type Target, type Town } from "./local-map";
import { findRoute } from "./route";

/** The four verbs from design-notes 4.6. All four work. */
export type Verb = "move" | "scan" | "missile" | "gridDisable";

export type Action = "up" | "down" | "left" | "right" | "activate" | "cancel";

/** The verbs as laid out on screen: a 2x2 grid. */
export const VERB_GRID: readonly (readonly Verb[])[] = [
  ["move", "scan"],
  ["missile", "gridDisable"],
];

export const AVAILABLE_VERBS: readonly Verb[] = ["move", "scan", "missile", "gridDisable"];

/** Eight compass points, north first, clockwise. */
export const BEARINGS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;
export type Bearing = (typeof BEARINGS)[number];

/** What a scan found. Closer gives more: a bearing within the direction range, and a close flag inside the blip range. */
export type ScanResult =
  | { kind: "none" }
  | { kind: "signal"; bearing: Bearing; close: boolean };

export interface Cross {
  col: number;
  row: number;
}

/** A position on the map, in cell units. Whole numbers are cell centres; the robot is drawn at its position. */
export interface Point {
  x: number;
  y: number;
}

/** Everything the dashboard reads about the map. The whole map is one world. */
export interface World {
  map: LocalMap;
  towns: readonly Town[];
  townRadiusCols: number;
  townRadiusRows: number;
  targets: readonly Target[];
  range: number;
  walkSpeed: number; // cells per second
  pickupRadius: number; // a drop within this many cells is collected automatically
  blipRadius: number; // a scan within this many cells is marked close
  directionRadius: number; // a scan within this many cells gives a bearing
  suppressionSeconds: number; // how long a network's shields stay down once opened
  gridDisableCooldownSeconds: number; // time before grid disable can be used again
  scanPulseSeconds: number; // how long a scan's ring takes to reach its full radius
}

export interface DashboardState {
  row: number;
  col: number;
  energyCells: number;
  shieldPlates: number;
  time: number; // seconds on the dashboard; drives the state-of-mind trace
  location: number; // index of the town the robot is in; the last one it was in when between towns
  mode: "browse" | "targeting" | "moving";
  cross: Cross; // the pointer used while targeting or choosing a walk point
  target: number | null; // index into the world's targets, when one is in range
  pos: Point; // where the robot is on the map
  route: Point[]; // cells still to walk through, in order; empty when standing still
  mapSelected: boolean; // the arrows have moved from the verb grid onto the map panel
  zoom: "local" | "full"; // the mini map: a window around the robot, or the whole world
  ruins: number[]; // indices of targets destroyed by a missile
  found: number[]; // indices of ruins whose drop the robot has collected
  scan: ScanResult | null; // the last scan, shown until the next one
  // Network power: for each network (town index), the dashboard time at which its shields come back.
  // A network is suppressed while its time is ahead of the clock.
  suppressedUntil: Record<number, number>;
  gridReadyAt: number; // dashboard time at which grid disable can be used again
  pulseStarted: number | null; // dashboard time of the last scan, for the ring drawn on the mini map
}

export interface DashboardStep {
  state: DashboardState;
  fire: Target | null; // set on the step where the player confirms a target
}

let cachedWorld: World | null = null;

/** The whole map, built once from the config. Deterministic, so every caller sees the same world. */
export function worldFor(cfg: Config): World {
  if (!cachedWorld) {
    const { map, towns, targets } = generateWorld(cfg.localMap);
    cachedWorld = {
      map,
      towns,
      townRadiusCols: cfg.localMap.townRadiusCols,
      townRadiusRows: cfg.localMap.townRadiusRows,
      targets,
      range: cfg.dashboard.targetRange,
      walkSpeed: cfg.dashboard.walkSpeed,
      pickupRadius: cfg.dashboard.pickupRadius,
      blipRadius: cfg.dashboard.blipRadius,
      directionRadius: cfg.dashboard.directionRadius,
      suppressionSeconds: cfg.dashboard.suppressionSeconds,
      gridDisableCooldownSeconds: cfg.dashboard.gridDisableCooldownSeconds,
      scanPulseSeconds: cfg.dashboard.scanPulseSeconds,
    };
  }
  return cachedWorld;
}

export function createDashboardState(cfg: Config): DashboardState {
  const start = townCentres(cfg.localMap)[cfg.dashboard.startNode];
  return {
    row: 0,
    col: 0,
    energyCells: cfg.dashboard.energyCells,
    shieldPlates: cfg.dashboard.shieldPlates,
    time: 0,
    location: cfg.dashboard.startNode,
    mode: "browse",
    cross: { col: start.x, row: start.y },
    target: null,
    pos: { x: start.x, y: start.y },
    route: [],
    mapSelected: false,
    zoom: "local",
    ruins: [],
    found: [],
    scan: null,
    suppressedUntil: {},
    gridReadyAt: 0,
    pulseStarted: null,
  };
}

/** The network a target belongs to: the town it was placed in. */
export function networkOf(target: Target): number {
  return target.network;
}

/** True while a network's shields are down. */
export function isSuppressed(state: DashboardState, network: number): boolean {
  return (state.suppressedUntil[network] ?? 0) > state.time;
}

/**
 * Whether a missile fired now meets shields. Checked at launch: a missile fired while
 * the network is powered deflects, and one fired while it is suppressed destroys the
 * building even if the window closes during its flight. A power station has no shield.
 */
export function isShielded(state: DashboardState, target: Target): boolean {
  if (target.kind === "power") return false;
  return !isSuppressed(state, networkOf(target));
}

/** Takes a network's shields down for the window, starting now. The window is never shortened. */
export function openWindow(state: DashboardState, network: number, world: World): DashboardState {
  const until = state.time + world.suppressionSeconds;
  return { ...state, suppressedUntil: { ...state.suppressedUntil, [network]: Math.max(until, state.suppressedUntil[network] ?? 0) } };
}

/** Grid disable is ready once its cooldown has passed. */
export function gridDisableReady(state: DashboardState): boolean {
  return state.time >= state.gridReadyAt;
}

/** Records a destroyed target as a ruin. Called when a missile hit returns the player to the dashboard. */
export function markRuin(state: DashboardState, index: number): DashboardState {
  if (state.ruins.includes(index)) return state;
  return { ...state, ruins: [...state.ruins, index] };
}

export function selectedVerb(state: DashboardState): Verb {
  return VERB_GRID[state.row][state.col];
}

/**
 * Pure: moves the selection and the cross, sets walk points, advances the walk,
 * and reports a confirmed target. The walk keeps going whatever the mode.
 */
export function stepDashboard(state: DashboardState, actions: readonly Action[], dt: number, world: World): DashboardStep {
  let s: DashboardState = walkStep({ ...state, time: state.time + dt }, dt, world.walkSpeed);
  s = { ...s, location: townIndexAt(s.pos, world, s.location) };
  s = collectDrops(s, world);

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

/** The town the robot is standing in, or the one it was last in when it is between towns. */
function townIndexAt(pos: Point, world: World, current: number): number {
  const x = Math.round(pos.x);
  const y = Math.round(pos.y);
  const found = world.towns.findIndex((t) => inTown(t, world.townRadiusCols, world.townRadiusRows, x, y));
  return found === -1 ? current : found;
}

/** Walks the robot along its route at the walk speed, cell by cell, and stops it at the end. */
function walkStep(s: DashboardState, dt: number, speed: number): DashboardState {
  if (s.route.length === 0) return s;
  let pos = { ...s.pos };
  let route = s.route;
  let budget = speed * dt;
  while (budget > 0 && route.length > 0) {
    const next = route[0];
    const dx = next.x - pos.x;
    const dy = next.y - pos.y;
    const distance = Math.hypot(dx, dy);
    if (distance <= budget) {
      pos = { ...next };
      route = route.slice(1);
      budget -= distance;
    } else {
      pos = { x: pos.x + (dx / distance) * budget, y: pos.y + (dy / distance) * budget };
      budget = 0;
    }
  }
  return { ...s, pos, route };
}

function browseAction(s: DashboardState, action: Action, world: World): DashboardState {
  if (s.mapSelected) {
    // The map panel sits to the right of the grid: left returns to the grid, Space changes zoom.
    if (action === "left") return { ...s, mapSelected: false };
    if (action === "activate") return { ...s, zoom: s.zoom === "local" ? "full" : "local" };
    return s;
  }
  if (action === "up") return { ...s, row: Math.max(0, s.row - 1) };
  if (action === "down") return { ...s, row: Math.min(VERB_GRID.length - 1, s.row + 1) };
  if (action === "left") return { ...s, col: Math.max(0, s.col - 1) };
  if (action === "right") {
    const lastCol = VERB_GRID[s.row].length - 1;
    return s.col === lastCol ? { ...s, mapSelected: true } : { ...s, col: s.col + 1 };
  }
  if (action === "activate") {
    const verb = selectedVerb(s);
    if (verb === "missile") {
      const cross = { col: Math.round(s.pos.x), row: Math.round(s.pos.y) };
      return { ...s, mode: "targeting", cross, target: nearestTarget(cross, world) };
    }
    if (verb === "move") {
      const cross = { col: Math.round(s.pos.x), row: Math.round(s.pos.y) };
      return { ...s, mode: "moving", cross };
    }
    if (verb === "scan") return { ...s, scan: scanFrom(s, world), pulseStarted: s.time };
    if (verb === "gridDisable" && gridDisableReady(s)) {
      // Takes down the shields of the network the robot is standing in, then starts the cooldown.
      const opened = openWindow(s, s.location, world);
      return { ...opened, gridReadyAt: s.time + world.gridDisableCooldownSeconds };
    }
  }
  return s;
}

/** Straight-line distance from the robot to a point on the map. */
function distanceTo(pos: Point, x: number, y: number): number {
  return Math.hypot(x - pos.x, y - pos.y);
}

/** Collects any uncollected drop the robot is standing on. Pickup is automatic, not a verb. */
function collectDrops(s: DashboardState, world: World): DashboardState {
  const picked = s.ruins.filter(
    (i) => world.targets[i].hasDrop && !s.found.includes(i) && distanceTo(s.pos, world.targets[i].col, world.targets[i].row) <= world.pickupRadius
  );
  if (picked.length === 0) return s;
  return { ...s, found: [...s.found, ...picked] };
}

/** The nearest uncollected drop, read as a signal: none, far (a bearing), or close as well. */
function scanFrom(s: DashboardState, world: World): ScanResult {
  let best: Target | null = null;
  let bestDistance = Infinity;
  for (const i of s.ruins) {
    const t = world.targets[i];
    if (!t.hasDrop || s.found.includes(i)) continue;
    const d = distanceTo(s.pos, t.col, t.row);
    if (d < bestDistance) {
      best = t;
      bestDistance = d;
    }
  }
  if (best === null || bestDistance > world.directionRadius) return { kind: "none" };
  return {
    kind: "signal",
    bearing: bearingTo(s.pos, best.col, best.row),
    close: bestDistance <= world.blipRadius,
  };
}

/** Compass bearing from the robot to a point. North is up the map (smaller row numbers). */
export function bearingTo(pos: Point, x: number, y: number): Bearing {
  const degrees = (Math.atan2(x - pos.x, pos.y - y) * 180) / Math.PI;
  const normalised = (degrees + 360) % 360;
  return BEARINGS[Math.round(normalised / 45) % 8];
}

function movingAction(s: DashboardState, action: Action, world: World): DashboardState {
  if (action === "cancel") return { ...s, mode: "browse" };
  if (action === "activate") {
    // High ground, or ground that cannot be reached, is refused: the chooser stays open.
    const route = findRoute(s.pos, { x: s.cross.col, y: s.cross.row }, world.map);
    if (route === null) return s;
    return { ...s, mode: "browse", route };
  }
  return { ...s, cross: shiftCross(s.cross, action, world) };
}

function shiftCross(cross: Cross, action: Action, world: World): Cross {
  const dCol = action === "left" ? -1 : action === "right" ? 1 : 0;
  const dRow = action === "up" ? -1 : action === "down" ? 1 : 0;
  return {
    col: clamp(cross.col + dCol, 0, world.map.cols - 1),
    row: clamp(cross.row + dRow, 0, world.map.rows - 1),
  };
}

function moveCross(s: DashboardState, action: Action, world: World): DashboardState {
  const cross = shiftCross(s.cross, action, world);
  return { ...s, cross, target: nearestTarget(cross, world) };
}

/** The target closest to the cross within range; ties go to the earlier target. */
export function nearestTarget(cross: Cross, world: World): number | null {
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
