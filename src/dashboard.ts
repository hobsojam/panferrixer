import type { Config } from "./config";
import { generateWorld, inTown, townCentres, type LocalMap, type Target, type Town } from "./local-map";
import { createRng } from "./rng";
import { canWalk, stepToward } from "./enemy-move";
import { cellKey, findRoute, findRouteToAny, isPassable, OFFSETS, walkPoint, type Blocked } from "./route";

/** The four verbs from design-notes 4.6. All four work. */
export type Verb = "move" | "scan" | "missile" | "gridDisable";

export type Action = "up" | "down" | "left" | "right" | "activate" | "cancel";

/** The verbs as laid out on screen: a 2x2 grid. */
export const VERB_GRID: readonly (readonly Verb[])[] = [
  ["move", "scan"],
  ["missile", "gridDisable"],
];

export const AVAILABLE_VERBS: readonly Verb[] = ["move", "scan", "missile", "gridDisable"];

/**
 * What a scan found (design-notes 4.2): every ruin within the ring's reach that still holds an
 * uncollected drop, nearest first, and where the robot stood when it scanned. Each blip lights as
 * the ring passes over it and then fades.
 */
export interface ScanResult {
  origin: Point;
  blips: number[]; // target indices of ruins with a drop
  close: boolean; // the nearest blip is within the close radius, for the sound
}

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
  closeRadius: number; // a hunter this close to a scan always wakes
  scanRadius: number; // how far a scan's ring reaches
  suppressionSeconds: number; // how long a network's shields stay down once opened
  gridDisableCooldownSeconds: number; // time before grid disable can be used again
  scanPulseSeconds: number; // how long a scan's ring takes to reach its full radius
  blipSeconds: number; // how long a blip stays lit after the ring reaches it
  hunterSpeed: number; // cells per second
  hunterLeashCells: number; // how far an alerted hunter chases from its post
  attackBreatherSeconds: number; // after any incoming attack, no enemy may start one for this long (design-notes 4.10)
  hunterMagazineAttacks: number; // attacks a hunter can make before it must rearm
  hunterRearmSeconds: number; // how long rearming takes at a dome
  hunterFirstAttackDelayMin: number; // the wait before a newly alerted hunter's first attack
  hunterFirstAttackDelayMax: number;
  hunterSightCells: number; // a hunter this close to the robot sees it (design-notes 4.10)
  hunterHoldCells: number; // an alerted hunter closes to this range, then holds
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
  investigating: Record<number, Errand>;
  // Hunters that have used their magazine and gone to rearm: where, and when rearming ends.
  rearming: Record<number, Errand>;
  // Attacks each hunter has made from its current magazine.
  attacksUsed: Record<number, number>;
  // Dashboard time until which no enemy may start an attack: the breather after an attack.
  breatherUntil: number;
  // Hits taken on the top shield plate so far. A plate goes when it reaches hitsPerPlate.
  shieldHits: number;
}

/** A hunter sent somewhere (to search, or to rearm): it walks there, stays a while, then goes home. */
export interface Errand {
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
      closeRadius: cfg.dashboard.closeRadius,
      scanRadius: cfg.dashboard.scanRadius,
      suppressionSeconds: cfg.dashboard.suppressionSeconds,
      gridDisableCooldownSeconds: cfg.dashboard.gridDisableCooldownSeconds,
      scanPulseSeconds: cfg.dashboard.scanPulseSeconds,
      blipSeconds: cfg.dashboard.blipSeconds,
      hunterSpeed: cfg.dashboard.hunterSpeed,
      hunterLeashCells: cfg.dashboard.hunterLeashCells,
      attackBreatherSeconds: cfg.dashboard.attackBreatherSeconds,
      hunterMagazineAttacks: cfg.dashboard.hunterMagazineAttacks,
      hunterRearmSeconds: cfg.dashboard.hunterRearmSeconds,
      hunterFirstAttackDelayMin: cfg.dashboard.hunterFirstAttackDelayMin,
      hunterFirstAttackDelayMax: cfg.dashboard.hunterFirstAttackDelayMax,
      hunterSightCells: cfg.dashboard.hunterSightCells,
      hunterHoldCells: cfg.dashboard.hunterHoldCells,
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
    rearming: {},
    attacksUsed: {},
    breatherUntil: 0,
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

/**
 * True while a cross chooser is open (Missile, Grid Disable or Move): time stops
 * (design-notes 4.10). The arrow-key chooser is only how a human talks to the robot's
 * targeting computer, which thinks at machine speed.
 */
export function isPaused(s: DashboardState): boolean {
  return s.mode === "targeting" || s.mode === "moving";
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

/**
 * Hunters that have just noticed the robot become alerted: each waits a moment before its
 * first attack, and drops any search it was on.
 */
export function alertTo(s: DashboardState, indices: readonly number[], world: World): DashboardState {
  // A hunter withdrawing to rearm has nothing to attack with, and does not turn back.
  const fresh = indices.filter((i) => !s.alerted.includes(i) && !s.rearming[i]);
  if (fresh.length === 0) return s;
  const investigating = { ...s.investigating };
  for (const i of fresh) delete investigating[i];
  return { ...s, alerted: [...s.alerted, ...fresh], hunterReadyAt: delayFirstAttacks(s, fresh, world), investigating };
}

/**
 * Moves the hunters (design-notes 4.10). Every hunter is always looking: one that comes
 * within sight of the robot is alerted, whatever it was doing. An alerted hunter closes
 * to its preferred range and holds there while it attacks, and breaks off once the robot
 * is beyond its leash. A hunter sent to investigate walks there, searches for a while,
 * then goes home. A hunter that has used its magazine withdraws to a dome, rearms, then
 * goes home no longer alerted. Otherwise it walks back to its post. A destroyed hunter
 * does not move.
 */
export function moveHunters(s: DashboardState, world: World, dt: number): DashboardState {
  let next = s;
  world.targets.forEach((t, index) => {
    if (t.kind !== "hunter" || next.ruins.includes(index)) return;
    const post = { x: t.col, y: t.row };
    const here = positionOf(next, index, world);
    if (distanceTo(next.pos, here.x, here.y) <= world.hunterSightCells) next = alertTo(next, [index], world); // a rearming hunter is skipped
    if (next.alerted.includes(index) && Math.hypot(here.x - post.x, here.y - post.y) > world.hunterLeashCells) {
      next = { ...next, alerted: next.alerted.filter((i) => i !== index) };
    }
    const alerted = next.alerted.includes(index);
    const rearm = next.rearming[index];
    const search = alerted || rearm ? undefined : next.investigating[index];

    let goal: Point;
    if (rearm) {
      if (here.x === rearm.x && here.y === rearm.y) {
        // At the dome: rearm, then go home with a full magazine.
        if (rearm.until === null) {
          next = { ...next, rearming: { ...next.rearming, [index]: { ...rearm, until: next.time + world.hunterRearmSeconds } } };
        } else if (next.time >= rearm.until) {
          const rearming = { ...next.rearming };
          delete rearming[index];
          const attacksUsed = { ...next.attacksUsed };
          delete attacksUsed[index];
          next = { ...next, rearming, attacksUsed };
        }
        return;
      }
      goal = { x: rearm.x, y: rearm.y };
    } else if (alerted) {
      // Close to the preferred range, then hold. Never halt inside a building: carry on through it.
      const inside = buildingCells(next, world).has(cellKey(world.map, Math.round(here.x), Math.round(here.y)));
      if (distanceTo(next.pos, here.x, here.y) <= world.hunterHoldCells && !inside) return;
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
    // Enemies may pass through buildings but never stop on one (design-notes 4.7), and never
    // cross high ground. Every goal is open ground: the robot cannot stand on a building, a
    // post is never one, and a search or rearm point is a free cell beside a building that
    // the hunter can walk to. A goal across high ground is approached as near as the hunter
    // can get, and tried again on the next step.
    const pos = stepToward(here, goal, world.map, world.hunterSpeed * dt);
    next = { ...next, hunterPos: { ...next.hunterPos, [index]: pos } };
  });
  return next;
}

/**
 * Cutting a power station is noticed at the station, not at the robot (design-notes 4.3):
 * the network's hunter is sent to look, at the free cell beside the station nearest to it.
 * A hunter already chasing the robot ignores the outage, and so does one that high ground
 * cuts off from the station.
 */
export function investigateOutage(s: DashboardState, station: Target, world: World): DashboardState {
  const index = world.targets.findIndex((t) => t.kind === "hunter" && t.network === station.network);
  if (index === -1 || s.ruins.includes(index) || s.alerted.includes(index)) return s;
  const blocked = buildingCells(s, world);
  const here = positionOf(s, index, world);
  const beside = OFFSETS.map(([dx, dy]) => ({ x: station.col + dx, y: station.row + dy }))
    .filter((c) => isPassable(world.map, c.x, c.y, blocked) && canWalk(here, c, world.map))
    .sort((a, b) => Math.hypot(a.x - here.x, a.y - here.y) - Math.hypot(b.x - here.x, b.y - here.y));
  if (beside.length === 0) return s;
  return { ...s, investigating: { ...s.investigating, [index]: { ...beside[0], until: null } } };
}

/**
 * A hunter has made an attack (design-notes 4.10). It spends one from its magazine; once the
 * magazine is empty it breaks off and withdraws to rearm at a free cell beside the nearest
 * intact dome in its network that it can walk to, or at its post if there is none.
 */
export function spendAttack(s: DashboardState, index: number, world: World): DashboardState {
  const used = (s.attacksUsed[index] ?? 0) + 1;
  const spent = { ...s, attacksUsed: { ...s.attacksUsed, [index]: used } };
  if (used < world.hunterMagazineAttacks) return spent;
  return { ...spent, alerted: spent.alerted.filter((i) => i !== index), rearming: { ...spent.rearming, [index]: { ...rearmPoint(spent, index, world), until: null } } };
}

/**
 * Where a hunter rearms: beside the nearest intact dome in its network that it can walk to,
 * or its post. A dome cut off by high ground is passed over.
 */
function rearmPoint(s: DashboardState, index: number, world: World): Point {
  const hunter = world.targets[index];
  const here = positionOf(s, index, world);
  const blocked = buildingCells(s, world);
  const byDistance = (cells: Point[]) => cells.sort((a, b) => Math.hypot(a.x - here.x, a.y - here.y) - Math.hypot(b.x - here.x, b.y - here.y));
  const domes = world.targets
    .map((t, i) => ({ t, i }))
    .filter(({ t, i }) => t.kind === "dome" && t.network === hunter.network && !s.ruins.includes(i))
    .map(({ t }) => ({ x: t.col, y: t.row }));
  for (const dome of byDistance(domes)) {
    const beside = OFFSETS.map(([dx, dy]) => ({ x: dome.x + dx, y: dome.y + dy })).filter(
      (c) => isPassable(world.map, c.x, c.y, blocked) && canWalk(here, c, world.map)
    );
    const spot = byDistance(beside)[0];
    if (spot) return spot;
  }
  return { x: hunter.col, y: hunter.row };
}

/**
 * The chance that a scan wakes a hunter this far away (design-notes 4.10): certain within the
 * scan's close zone, then falling steadily to nothing at the edge of the ring.
 */
export function scanWakeChance(distance: number, world: World): number {
  if (distance <= world.closeRadius) return 1;
  if (distance >= world.scanRadius) return 0;
  return (world.scanRadius - distance) / (world.scanRadius - world.closeRadius);
}

/**
 * The hunters a scan wakes, added to those already alerted. Each living hunter in reach rolls
 * against its chance once per scan, reproducibly from the clock and the hunter, so scanning
 * again rolls again. Alerted hunters stay alerted until they engage.
 */
export function alertHunters(s: DashboardState, world: World): number[] {
  const found = new Set(s.alerted);
  world.targets.forEach((t, index) => {
    if (t.kind !== "hunter" || s.ruins.includes(index)) return;
    const p = positionOf(s, index, world);
    const chance = scanWakeChance(distanceTo(s.pos, p.x, p.y), world);
    if (chance >= 1 || (chance > 0 && createRng(Math.floor(s.time * 1000) * 131 + index * 7 + 3)() < chance)) found.add(index);
  });
  return [...found];
}

/**
 * A newly alerted hunter waits a moment before its first attack (design-notes 4.10), so it
 * does not open fire the instant the robot is in range. The wait is drawn from the clock and
 * the hunter, so it is reproducible. A longer wait already set is kept.
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
  // The breather after an attack: nobody may start another yet.
  if (s.time < s.breatherUntil) return null;
  for (const index of s.alerted) {
    const t = world.targets[index];
    if (!t || t.kind !== "hunter" || s.ruins.includes(index) || s.rearming[index]) continue;
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
  // While a chooser is open, time stops: no clock, no walking.
  let s: DashboardState = isPaused(state) ? state : walkStep({ ...state, time: state.time + dt }, dt, world.walkSpeed);
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

/** Every uncollected drop in a ruin within the scan's reach, nearest first. */
function scanFrom(s: DashboardState, world: World): ScanResult {
  const origin = { x: s.pos.x, y: s.pos.y };
  const blips = s.ruins
    .filter((i) => world.targets[i].hasDrop && !s.found.includes(i))
    .map((i) => ({ i, d: distanceTo(origin, world.targets[i].col, world.targets[i].row) }))
    .filter(({ d }) => d <= world.scanRadius)
    .sort((a, b) => a.d - b.d);
  return { origin, blips: blips.map(({ i }) => i), close: blips.length > 0 && blips[0].d <= world.closeRadius };
}

/**
 * How far the scan's ring has reached, as a fraction of its full radius, this many seconds after
 * the scan. It starts fast and slows as it nears the edge. The mini map draws the same curve.
 */
export function ringReach(t: number, world: World): number {
  if (t <= 0) return 0;
  if (t >= world.scanPulseSeconds) return 1;
  const k = t / world.scanPulseSeconds;
  return 1 - (1 - k) ** 2;
}

/**
 * How brightly a ruin's blip shows now, from 0 (not shown) to 1: dark until the ring reaches it,
 * then fading to nothing over blipSeconds. A drop collected since the scan no longer shows.
 */
export function blipStrength(s: DashboardState, index: number, world: World): number {
  if (s.scan === null || s.pulseStarted === null || !s.scan.blips.includes(index) || s.found.includes(index)) return 0;
  const t = world.targets[index];
  const fraction = Math.min(1, distanceTo(s.scan.origin, t.col, t.row) / world.scanRadius);
  // Invert ringReach: the time at which the ring arrives at this distance.
  const arrives = world.scanPulseSeconds * (1 - Math.sqrt(1 - fraction));
  const since = s.time - s.pulseStarted - arrives;
  if (since < 0 || since >= world.blipSeconds) return 0;
  return 1 - since / world.blipSeconds;
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
