import type { Config } from "./config";
import { generateWorld, inTown, townCentres, type LocalMap, type Target, type Town } from "./local-map";
import { createRng } from "./rng";
import { cellKey, findRoute, findRouteToAny, isPassable, OFFSETS, type Blocked } from "./route";

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
  hunterSpeed: number; // cells per second
  hunterLeashCells: number; // how far an alerted hunter chases from its post
  hunterCooldownSeconds: number; // guaranteed quiet after an attack ends (design-notes 4.10)
  hunterCooldownRandomSeconds: number; // plus up to this much more
  hunterFirstAttackDelayMin: number; // the wait before a newly alerted hunter's first attack
  hunterFirstAttackDelayMax: number;
  hunterSightCells: number; // a hunter this close to the robot sees it (design-notes 4.10)
  hunterInvestigateSeconds: number; // how long a hunter searches where it was sent
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
  // What the cross is choosing for: a missile target (any building), or a power station to cut.
  purpose: "missile" | "gridDisable";
  // Hunters (target indices) that have seen the robot on a scan and will open fire when it is close.
  alerted: number[];
  // Where each hunter is now, if it has moved from its post (missing means it is still on its post).
  hunterPos: Record<number, Point>;
  // Dashboard time at which each hunter can attack again.
  hunterReadyAt: Record<number, number>;
  // Hunters sent to look at a place, such as a cut power station: where, and when the search
  // ends (null until it arrives). Missing means it is not investigating.
  investigating: Record<number, Investigation>;
  // Hits taken on the top shield plate so far. A plate goes when it reaches hitsPerPlate.
  shieldHits: number;
}

/** A hunter sent to look at a place: it walks there, searches for a while, then goes home. */
export interface Investigation {
  x: number;
  y: number;
  until: number | null;
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
      hunterSpeed: cfg.dashboard.hunterSpeed,
      hunterLeashCells: cfg.dashboard.hunterLeashCells,
      hunterCooldownSeconds: cfg.dashboard.hunterCooldownSeconds,
      hunterCooldownRandomSeconds: cfg.dashboard.hunterCooldownRandomSeconds,
      hunterFirstAttackDelayMin: cfg.dashboard.hunterFirstAttackDelayMin,
      hunterFirstAttackDelayMax: cfg.dashboard.hunterFirstAttackDelayMax,
      hunterSightCells: cfg.dashboard.hunterSightCells,
      hunterInvestigateSeconds: cfg.dashboard.hunterInvestigateSeconds,
    };
  }
  return cachedWorld;
}

export function createDashboardState(cfg: Config): DashboardState {
  const start = startPosition(worldFor(cfg), cfg);
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
    purpose: "missile",
    alerted: [],
    hunterPos: {},
    hunterReadyAt: {},
    investigating: {},
    shieldHits: 0,
  };
}

/**
 * Where the robot starts (design-notes 4.7): on open ground outside every town and out of
 * sight of every hunter, as near the starting network as that allows, so the player
 * decides when and how to walk in. Searched outward from the starting town by walking
 * distance, so the start is always reachable. Falls back to the town centre.
 */
export function startPosition(world: World, cfg: Config): Point {
  const home = townCentres(cfg.localMap)[cfg.dashboard.startNode];
  const clearance = cfg.dashboard.startClearanceCells;
  const blocked = new Set<number>();
  const posts: Point[] = [];
  for (const t of world.targets) {
    if (t.kind === "hunter") posts.push({ x: t.col, y: t.row });
    else blocked.add(cellKey(world.map, t.col, t.row));
  }
  const outsideTowns = (x: number, y: number) =>
    !world.towns.some((t) => inTown(t, world.townRadiusCols + clearance, world.townRadiusRows + clearance, x, y));
  const unseen = (x: number, y: number) => posts.every((p) => Math.hypot(p.x - x, p.y - y) > world.hunterSightCells + clearance);

  const seen = new Set<number>([cellKey(world.map, home.x, home.y)]);
  const queue: Point[] = [{ x: home.x, y: home.y }];
  for (let head = 0; head < queue.length; head++) {
    const c = queue[head];
    if (outsideTowns(c.x, c.y) && unseen(c.x, c.y)) return c;
    for (const [dx, dy] of OFFSETS) {
      const nx = c.x + dx;
      const ny = c.y + dy;
      const k = cellKey(world.map, nx, ny);
      if (seen.has(k) || !isPassable(world.map, nx, ny, blocked)) continue;
      seen.add(k);
      queue.push({ x: nx, y: ny });
    }
  }
  return { x: home.x, y: home.y };
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
  if (target.kind === "power" || target.kind === "hunter") return false;
  return !isSuppressed(state, networkOf(target));
}

/** Takes a network's shields down for the window, starting now. The window is never shortened. */
export function openWindow(state: DashboardState, network: number, world: World): DashboardState {
  const until = state.time + world.suppressionSeconds;
  return { ...state, suppressedUntil: { ...state.suppressedUntil, [network]: Math.max(until, state.suppressedUntil[network] ?? 0) } };
}

/** Where a target is now. A hunter may have moved from its post; anything else is where it was placed. */
export function positionOf(s: DashboardState, index: number, world: World): Point {
  const moved = s.hunterPos[index];
  if (moved) return moved;
  const t = world.targets[index];
  return { x: t.col, y: t.row };
}

/** The cell a target is in now, for targeting and drawing. */
export function cellOf(s: DashboardState, index: number, world: World): Cross {
  const p = positionOf(s, index, world);
  return { col: Math.round(p.x), row: Math.round(p.y) };
}

/** True for a target that is a building. Hunters are enemies, not buildings. */
export function isBuilding(t: Target): boolean {
  return t.kind !== "hunter";
}

/**
 * The cells the robot cannot enter on top of the terrain: every intact building
 * (design-notes 4.7). A ruin is passable rubble. The power station is never a ruin,
 * so it always blocks.
 */
export function buildingCells(s: DashboardState, world: World): Blocked {
  const blocked = new Set<number>();
  world.targets.forEach((t, index) => {
    if (isBuilding(t) && !s.ruins.includes(index)) blocked.add(cellKey(world.map, t.col, t.row));
  });
  return blocked;
}

/** True while an enemy is passing through an intact building, so the map can show it inside. */
export function isInsideBuilding(s: DashboardState, index: number, world: World): boolean {
  if (isBuilding(world.targets[index])) return false;
  const at = cellOf(s, index, world);
  return buildingCells(s, world).has(cellKey(world.map, at.col, at.row));
}

/**
 * The route the robot would walk to a chosen cell, or null if there is none. High
 * ground is refused. A building has no way in, so choosing one walks to the nearest
 * free cell beside it instead.
 */
export function routeTo(s: DashboardState, cell: Cross, world: World): Point[] | null {
  const blocked = buildingCells(s, world);
  if (!blocked.has(cellKey(world.map, cell.col, cell.row))) {
    return findRoute(s.pos, { x: cell.col, y: cell.row }, world.map, blocked);
  }
  const beside = OFFSETS.map(([dx, dy]) => ({ x: cell.col + dx, y: cell.row + dy })).filter((c) =>
    isPassable(world.map, c.x, c.y, blocked)
  );
  return findRouteToAny(s.pos, beside, world.map, blocked);
}

/** Walks along a route for up to `distance` cells. Returns where it ends up and the route still to go. */
export function walkPoint(pos: Point, route: readonly Point[], distance: number): { pos: Point; route: Point[] } {
  let p = { ...pos };
  let r = [...route];
  let budget = distance;
  while (budget > 0 && r.length > 0) {
    const next = r[0];
    const dx = next.x - p.x;
    const dy = next.y - p.y;
    const d = Math.hypot(dx, dy);
    if (d <= budget) {
      p = { ...next };
      r = r.slice(1);
      budget -= d;
    } else {
      p = { x: p.x + (dx / d) * budget, y: p.y + (dy / d) * budget };
      budget = 0;
    }
  }
  return { pos: p, route: r };
}

/**
 * Hunters that have just noticed the robot become alerted: each waits a moment before its
 * first attack, and drops any search it was on.
 */
export function alertTo(s: DashboardState, indices: readonly number[], world: World): DashboardState {
  const fresh = indices.filter((i) => !s.alerted.includes(i));
  if (fresh.length === 0) return s;
  const investigating = { ...s.investigating };
  for (const i of fresh) delete investigating[i];
  return { ...s, alerted: [...s.alerted, ...fresh], hunterReadyAt: delayFirstAttacks(s, fresh, world), investigating };
}

/**
 * Moves the hunters (design-notes 4.10). Every hunter is always looking: one that comes
 * within sight of the robot is alerted, whatever it was doing. An alerted hunter walks
 * toward the robot, and breaks off once the robot is beyond its leash. A hunter sent to
 * investigate walks there, searches for a while, then goes home. Otherwise it walks back
 * to its post. A destroyed hunter does not move.
 */
export function moveHunters(s: DashboardState, world: World, dt: number): DashboardState {
  let next = s;
  world.targets.forEach((t, index) => {
    if (t.kind !== "hunter" || next.ruins.includes(index)) return;
    const post = { x: t.col, y: t.row };
    const here = positionOf(next, index, world);
    if (distanceTo(next.pos, here.x, here.y) <= world.hunterSightCells) next = alertTo(next, [index], world);
    if (next.alerted.includes(index) && Math.hypot(here.x - post.x, here.y - post.y) > world.hunterLeashCells) {
      next = { ...next, alerted: next.alerted.filter((i) => i !== index) };
    }
    const alerted = next.alerted.includes(index);
    const search = alerted ? undefined : next.investigating[index];

    let goal: Point;
    if (alerted) {
      goal = { x: Math.round(next.pos.x), y: Math.round(next.pos.y) };
    } else if (search) {
      if (here.x === search.x && here.y === search.y) {
        // Arrived: search for a while, then give up and go home.
        if (search.until === null) {
          next = { ...next, investigating: { ...next.investigating, [index]: { ...search, until: next.time + world.hunterInvestigateSeconds } } };
        } else if (next.time >= search.until) {
          const investigating = { ...next.investigating };
          delete investigating[index];
          next = { ...next, investigating };
        }
        return;
      }
      goal = { x: search.x, y: search.y };
    } else {
      if (here.x === post.x && here.y === post.y) return;
      goal = post;
    }
    // Enemies may pass through buildings but never stop on one (design-notes 4.7). Every goal
    // is open ground: the robot cannot stand on a building, a post is never one, and a
    // search point is a free cell beside a building.
    const route = findRoute({ x: Math.round(here.x), y: Math.round(here.y) }, goal, world.map);
    if (route === null) return;
    const walked = walkPoint(here, route, world.hunterSpeed * dt);
    // Once the route is used up the hunter is exactly at its goal, not a rounding error short of it.
    const pos = walked.route.length === 0 ? goal : walked.pos;
    next = { ...next, hunterPos: { ...next.hunterPos, [index]: pos } };
  });
  return next;
}

/**
 * Cutting a power station is noticed at the station, not at the robot (design-notes 4.3):
 * the network's hunter is sent to look, at the free cell beside the station nearest to it.
 * A hunter already chasing the robot ignores the outage.
 */
export function investigateOutage(s: DashboardState, station: Target, world: World): DashboardState {
  const index = world.targets.findIndex((t) => t.kind === "hunter" && t.network === station.network);
  if (index === -1 || s.ruins.includes(index) || s.alerted.includes(index)) return s;
  const blocked = buildingCells(s, world);
  const here = positionOf(s, index, world);
  const beside = OFFSETS.map(([dx, dy]) => ({ x: station.col + dx, y: station.row + dy }))
    .filter((c) => isPassable(world.map, c.x, c.y, blocked))
    .sort((a, b) => Math.hypot(a.x - here.x, a.y - here.y) - Math.hypot(b.x - here.x, b.y - here.y));
  if (beside.length === 0) return s;
  return { ...s, investigating: { ...s.investigating, [index]: { ...beside[0], until: null } } };
}

/** A scan's ring alerts every living hunter it reaches. Alerted hunters stay alerted until they engage. */
export function alertHunters(s: DashboardState, world: World): number[] {
  const found = new Set(s.alerted);
  world.targets.forEach((t, index) => {
    if (t.kind !== "hunter" || s.ruins.includes(index)) return;
    const p = positionOf(s, index, world);
    if (distanceTo(s.pos, p.x, p.y) <= world.directionRadius) found.add(index);
  });
  return [...found];
}

/**
 * A newly alerted hunter waits a moment before its first attack (design-notes 4.10), so it
 * does not open fire the instant the robot is in range. The wait is drawn from the clock and
 * the hunter, so it is reproducible. A hunter still cooling down keeps its longer wait.
 */
export function delayFirstAttacks(s: DashboardState, alerted: readonly number[], world: World): Record<number, number> {
  const ready = { ...s.hunterReadyAt };
  for (const index of alerted) {
    if (s.alerted.includes(index)) continue;
    const roll = createRng(Math.floor(s.time * 1000) * 31 + index)();
    const wait = world.hunterFirstAttackDelayMin + roll * (world.hunterFirstAttackDelayMax - world.hunterFirstAttackDelayMin);
    ready[index] = Math.max(ready[index] ?? 0, s.time + wait);
  }
  return ready;
}

/**
 * The first alerted hunter that is close enough to open fire, or null. A hunter that
 * has been destroyed cannot fire.
 */
export function hunterInRange(s: DashboardState, world: World, range: number): number | null {
  for (const index of s.alerted) {
    const t = world.targets[index];
    if (!t || t.kind !== "hunter" || s.ruins.includes(index)) continue;
    if (s.time < (s.hunterReadyAt[index] ?? 0)) continue;
    const p = positionOf(s, index, world);
    if (distanceTo(s.pos, p.x, p.y) <= range) return index;
  }
  return null;
}

/** Applies missile hits to the shields: each plate absorbs hitsPerPlate hits, then breaks. */
export function applyShieldHits(s: DashboardState, hits: number, hitsPerPlate: number): DashboardState {
  let plates = s.shieldPlates;
  let shieldHits = s.shieldHits;
  for (let i = 0; i < hits && plates > 0; i++) {
    shieldHits += 1;
    if (shieldHits >= hitsPerPlate) {
      plates -= 1;
      shieldHits = 0;
    }
  }
  return { ...s, shieldPlates: plates, shieldHits };
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
      if (s.target !== null && s.purpose === "gridDisable") {
        // Cutting power at a station takes down its network's shields, then starts the cooldown.
        // The network notices: its hunter is sent to look at the station.
        const station = world.targets[s.target];
        const opened = investigateOutage(openWindow(s, networkOf(station), world), station, world);
        s = { ...opened, mode: "browse", target: null, gridReadyAt: s.time + world.gridDisableCooldownSeconds };
      } else if (s.target !== null) {
        fire = world.targets[s.target];
      }
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
  const walked = walkPoint(s.pos, s.route, speed * dt);
  return { ...s, pos: walked.pos, route: walked.route };
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
      return { ...s, mode: "targeting", purpose: "missile", cross, target: nearestTarget(cross, world, anyTarget, (i) => cellOf(s, i, world)) };
    }
    if (verb === "move") {
      const cross = { col: Math.round(s.pos.x), row: Math.round(s.pos.y) };
      return { ...s, mode: "moving", cross };
    }
    if (verb === "scan") {
      return { ...alertTo(s, alertHunters(s, world), world), scan: scanFrom(s, world), pulseStarted: s.time };
    }
    if (verb === "gridDisable" && gridDisableReady(s)) {
      // Choose a power station with the cross, the same way as a missile target.
      const cross = { col: Math.round(s.pos.x), row: Math.round(s.pos.y) };
      return { ...s, mode: "targeting", purpose: "gridDisable", cross, target: nearestTarget(cross, world, isPowerStation, (i) => cellOf(s, i, world)) };
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
    // A building is walked up to, not into.
    const route = routeTo(s, s.cross, world);
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
  const filter = s.purpose === "gridDisable" ? isPowerStation : anyTarget;
  return { ...s, cross, target: nearestTarget(cross, world, filter, (i) => cellOf(s, i, world)) };
}

function anyTarget(): boolean {
  return true;
}

function isPowerStation(t: Target): boolean {
  return t.kind === "power";
}

/** The target closest to the cross within range that passes the filter; ties go to the earlier target. */
export function nearestTarget(
  cross: Cross,
  world: World,
  accept: (t: Target) => boolean = anyTarget,
  cellAt: (index: number) => Cross = (i) => ({ col: world.targets[i].col, row: world.targets[i].row })
): number | null {
  let best: number | null = null;
  let bestDistance = Infinity;
  world.targets.forEach((t, index) => {
    if (!accept(t)) return;
    const at = cellAt(index);
    const distance = Math.max(Math.abs(at.col - cross.col), Math.abs(at.row - cross.row));
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
