import type { Config } from "./config";
import { generateWorld, HAULER_PICKUPS, inTown, isArmedHelper, isEnemyKind, townCentres, walkedCells, type LocalMap, type Supply, type Target, type Town } from "./local-map";
import { createRng } from "./rng";
import { allWhole, fullPlates, mendWeakest, plateToMend } from "./armour";
import { canWalk, reachableGoal, stepToward } from "./enemy-move";
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
  blips: number[]; // target indices of ruins still holding a supply or a part
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
  neighbours: readonly (readonly number[])[]; // per town: the towns its haulers carry to (#121)
  range: number;
  walkSpeed: number; // cells per second
  pickupRadius: number; // a drop within this many cells is collected automatically
  partCount: number; // how many parts the world holds: the whole set
  closeRadius: number; // a hunter this close to a scan always wakes
  scanRadius: number; // how far a scan's ring reaches
  suppressionSeconds: number; // how long a network's shields stay down once opened
  gridDisableCooldownSeconds: number; // time before grid disable can be used again
  scanPulseSeconds: number; // how long a scan's ring takes to reach its full radius
  blipSeconds: number; // how long a blip stays lit after the ring reaches it
  hunterSpeed: number; // cells per second
  hunterEngageRange: number; // an alerted enemy attacks when the robot is this close, over high ground if need be
  attackBreatherSeconds: number; // after any incoming attack, no enemy may start one for this long (design-notes 4.10)
  hunterMagazineAttacks: number; // attacks a hunter can make before it must rearm
  hunterRearmSeconds: number; // how long rearming takes at a dome
  hunterFirstAttackDelayMin: number; // the wait before a newly alerted hunter's first attack
  hunterFirstAttackDelayMax: number;
  hunterSightCells: number; // a hunter this close to the robot sees it (design-notes 4.10)
  hunterHoldCells: number; // an alerted hunter closes to this range, then holds
  defenderSpeed: number; // cells per second
  defenderGuardCells: number; // an awake defender guards this far round its post (design-notes 4.10)
  patrollerSpeed: number; // cells per second on its beat, investigating or fighting
  patrollerRunSpeed: number; // cells per second while running for help
  patrollerSightCells: number;
  patrollerHearingCells: number; // a missile hit or power cut this close draws it in
  patrollerSearchSeconds: number; // how long it looks round a disturbance
  patrollerHelpReachCells: number; // this close to the enemy it fetches, help is raised
  patrollerLeashCells: number; // once fighting, how far it follows from where it started
  patrollerMagazineAttacks: number;
  haulerSpeed: number; // cells per second on its route
  haulerFleeSpeed: number; // cells per second while fleeing
  haulerSightCells: number;
  haulerHearingCells: number; // a missile hit this close scares it
  haulerFleeCells: number; // how many steps over the terrain it looks for somewhere to flee to
  haulerFleeSeconds: number; // how long it keeps away after it last saw or heard the threat
  viewCols: number; // the mini map's local window, in cells: also the reach of the robot's equipment
  viewRows: number;
  // The energy and shield economy (#15). Energy is a slow clock: it drains with time and walking.
  energyMax: number; // battery cells when full
  missileRack: number; // missiles the rack holds when full
  hitsPerPlate: number;
  energyDrainPerSecond: number; // cells drained per second of running time, standing or not
  energyPerCellWalked: number; // extra cells drained per map cell walked
  rechargeSecondsPerCrack: number; // resting time to mend one crack
  rechargeCellsPerCrack: number; // energy one mended crack costs, drawn as it mends
  rechargeFloorCells: number; // recharge stops at this much energy: the low-power line
}

export interface DashboardState {
  row: number;
  col: number;
  energyCells: number; // fractional: energy drains gradually within the current cell
  // The armour plates across the robot's front arc, left to right: each one's integrity, from
  // hitsPerPlate (whole) down to 0 (broken). See armour.ts.
  plates: number[];
  mendProgress: number; // 0..1: how far recharge is through mending the next crack
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
  found: Salvage[]; // supplies the robot has collected, each from its ruin
  parts: number[]; // the parts the robot has collected, in the order found
  missiles: number; // in the rack; one is used by every launch
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
  // Hunters making rounds of their network's domes while its power is cut (design-notes 4.3).
  // Missing means it is not patrolling.
  patrolling: Record<number, Patrol>;
  // Hunters that have used their magazine and gone to rearm: where, and when rearming ends.
  rearming: Record<number, Errand>;
  // Attacks each hunter has made from its current magazine.
  attacksUsed: Record<number, number>;
  // Dashboard time until which no enemy may start an attack: the breather after an attack.
  breatherUntil: number;
  // Defenders (target indices) woken out of their domes. The rest are hidden inside (design-notes 4.4).
  awake: number[];
  // Defenders woken during a flight whose first-attack wait starts when the player is back at the dashboard.
  heldAttacks: number[];
  // What each patroller is doing (#66). Missing means it is on its beat, heading for its second waypoint.
  patrollers: Record<number, PatrollerMind>;
  // Every call for help a patroller has raised, oldest first: observable by game logic and tests.
  helpCalls: HelpCall[];
  // What each hauler is doing (#67, #121). Missing means it is at its first pickup, about to load.
  haulers: Record<number, HaulerMind>;
}

/**
 * A hauler's state of mind (#67, #121, design-notes 4.10). **Hauling**, it goes to load at a pickup
 * (power station or mine) in the town it is in, carries the load to a dome in a neighbouring network,
 * then loads again there. **Fleeing**, it runs from a threat (the robot in sight, a scan ring that
 * reaches it, a missile hit within earshot) to somewhere away from it, and keeps away until `until`
 * has passed without a fresh threat. Then it carries on with the trip it was on.
 */
export interface HaulerMind {
  mode: "haul" | "flee";
  stop: number; // the building (target index) whose dock it is heading for
  loading: boolean; // true heading for a pickup, false carrying a load to a dome
  town: number; // the network that building is in
  from: number | null; // the network its last load came from: it does not carry straight back there if it can help it
  trip: number; // loads delivered so far, which seeds the choice of the next destination
  threat: Point | null; // where the threat was last seen or heard
  goal: Point | null; // where it is fleeing to
  until: number | null; // dashboard time it stops fleeing, if nothing new scares it
}

/**
 * A patroller's state of mind (#66, design-notes 4.10). On its **beat** it walks its loop.
 * **Investigating**, it goes to look at a disturbance, searches a while, then returns to its beat.
 * **Fetching**, it has seen the robot and runs to the nearest armed enemy for help. Once help is
 * raised (or there is none to fetch) it fights: it joins the alerted enemies, with `anchor` as
 * the point its leash is measured from, and goes back to its beat when the fight ends.
 */
export interface PatrollerMind {
  mode: "beat" | "investigate" | "fetch";
  leg: number; // index into its beat of the waypoint it is walking to
  look: Point | null; // where it is going to investigate
  lookUntil: number | null; // when it gives up searching; set on arrival
  helper: number | null; // the enemy it is fetching
  seen: Point | null; // where it saw the robot: help must be able to fight there
  anchor: Point | null; // where it started fighting
}

/** A patroller reached an armed enemy and alerted it to the robot. */
export interface HelpCall {
  patroller: number;
  helper: number;
  time: number;
}

/** An enemy sent to rearm: it walks to the free cell beside a dome, stays a while, then goes home. */
export interface Errand {
  x: number;
  y: number;
  dome: number; // the dome (target index) it rearms at; if it is destroyed first, the enemy chooses again
  until: number | null;
}

/**
 * A hunter's rounds while its network's power is cut: it checks each intact dome in turn,
 * nearest first, and goes home when the power comes back.
 */
export interface Patrol {
  until: number; // dashboard time the power comes back
  stop: number | null; // target index of the building it is walking to
  at: Point | null; // the free cell beside that building it is heading for
  checked: number[]; // buildings already checked this round
}

export interface DashboardStep {
  state: DashboardState;
  fire: Target | null; // set on the step where the player confirms a target
}

let cachedWorld: World | null = null;

/** The whole map, built once from the config. Deterministic, so every caller sees the same world. */
export function worldFor(cfg: Config): World {
  if (!cachedWorld) {
    const { map, towns, targets, neighbours } = generateWorld(cfg.localMap);
    cachedWorld = {
      map,
      towns,
      townRadiusCols: cfg.localMap.townRadiusCols,
      townRadiusRows: cfg.localMap.townRadiusRows,
      targets,
      neighbours,
      range: cfg.dashboard.targetRange,
      walkSpeed: cfg.dashboard.walkSpeed,
      pickupRadius: cfg.dashboard.pickupRadius,
      partCount: cfg.localMap.partCount,
      closeRadius: cfg.dashboard.closeRadius,
      scanRadius: cfg.dashboard.scanRadius,
      suppressionSeconds: cfg.dashboard.suppressionSeconds,
      gridDisableCooldownSeconds: cfg.dashboard.gridDisableCooldownSeconds,
      scanPulseSeconds: cfg.dashboard.scanPulseSeconds,
      blipSeconds: cfg.dashboard.blipSeconds,
      hunterSpeed: cfg.dashboard.hunterSpeed,
      hunterEngageRange: cfg.dashboard.hunterEngageRange,
      attackBreatherSeconds: cfg.dashboard.attackBreatherSeconds,
      hunterMagazineAttacks: cfg.dashboard.hunterMagazineAttacks,
      hunterRearmSeconds: cfg.dashboard.hunterRearmSeconds,
      hunterFirstAttackDelayMin: cfg.dashboard.hunterFirstAttackDelayMin,
      hunterFirstAttackDelayMax: cfg.dashboard.hunterFirstAttackDelayMax,
      hunterSightCells: cfg.dashboard.hunterSightCells,
      hunterHoldCells: cfg.dashboard.hunterHoldCells,
      defenderSpeed: cfg.dashboard.defenderSpeed,
      defenderGuardCells: cfg.dashboard.defenderGuardCells,
      patrollerSpeed: cfg.dashboard.patrollerSpeed,
      patrollerRunSpeed: cfg.dashboard.patrollerRunSpeed,
      patrollerSightCells: cfg.dashboard.patrollerSightCells,
      patrollerHearingCells: cfg.dashboard.patrollerHearingCells,
      patrollerSearchSeconds: cfg.dashboard.patrollerSearchSeconds,
      patrollerHelpReachCells: cfg.dashboard.patrollerHelpReachCells,
      patrollerLeashCells: cfg.dashboard.patrollerLeashCells,
      patrollerMagazineAttacks: cfg.dashboard.patrollerMagazineAttacks,
      haulerSpeed: cfg.dashboard.haulerSpeed,
      haulerFleeSpeed: cfg.dashboard.haulerFleeSpeed,
      haulerSightCells: cfg.dashboard.haulerSightCells,
      haulerHearingCells: cfg.dashboard.haulerHearingCells,
      haulerFleeCells: cfg.dashboard.haulerFleeCells,
      haulerFleeSeconds: cfg.dashboard.haulerFleeSeconds,
      viewCols: cfg.localMap.viewCols,
      viewRows: cfg.localMap.viewRows,
      energyMax: cfg.dashboard.energyCells,
      missileRack: cfg.dashboard.missileRack,
      hitsPerPlate: cfg.dashboard.hitsPerPlate,
      energyDrainPerSecond: cfg.energy.drainPerSecond,
      energyPerCellWalked: cfg.energy.perCellWalked,
      rechargeSecondsPerCrack: cfg.energy.rechargeSecondsPerCrack,
      rechargeCellsPerCrack: cfg.energy.rechargeCellsPerCrack,
      rechargeFloorCells: cfg.dashboard.lowThreshold,
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
    missiles: cfg.dashboard.missileRack,
    plates: fullPlates(cfg.dashboard.shieldPlates, cfg.dashboard.hitsPerPlate),
    mendProgress: 0,
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
    parts: [],
    scan: null,
    suppressedUntil: {},
    gridReadyAt: 0,
    pulseStarted: null,
    purpose: "missile",
    alerted: [],
    hunterPos: {},
    hunterReadyAt: {},
    patrolling: {},
    rearming: {},
    attacksUsed: {},
    breatherUntil: 0,
    awake: [],
    heldAttacks: [],
    patrollers: {},
    helpCalls: [],
    haulers: {},
  };
}

/**
 * Where the robot starts (design-notes 4.7): on open ground outside every town, out of
 * sight of every hunter and of every cell a patroller walks on its beat (#66), and far
 * enough from the map's edges that the local view is not cut off, as near the starting
 * network as that allows, so the player decides when and how to walk in. Searched outward from the starting town by walking
 * distance, so the start is always reachable. Falls back to the town centre.
 */
export function startPosition(world: World, cfg: Config): Point {
  const cached = startCache.get(world);
  if (cached) return { ...cached };
  const home = townCentres(cfg.localMap)[cfg.dashboard.startNode];
  const clearance = cfg.dashboard.startClearanceCells;
  const blocked = new Set<number>();
  const hunters: Point[] = [];
  const beats: Point[] = [];
  for (const t of world.targets) {
    // A defender is asleep in its dome at the start, so only the hunters and patrollers are looking.
    if (t.kind === "hunter") hunters.push({ x: t.col, y: t.row });
    else if (t.kind === "patroller") beats.push(...walkedCells(t.beat ?? [], world.map));
    else if (isBuilding(t)) blocked.add(cellKey(world.map, t.col, t.row));
  }
  const outsideTowns = (x: number, y: number) =>
    !world.towns.some((t) => inTown(t, world.townRadiusCols + clearance, world.townRadiusRows + clearance, x, y));
  const clearOf = (cells: Point[], sight: number) => (x: number, y: number) =>
    cells.every((p) => Math.hypot(p.x - x, p.y - y) > sight + clearance);
  const unseenByHunters = clearOf(hunters, world.hunterSightCells);
  // The local view is centred on the robot: half of it either way must be on the map.
  const halfCols = Math.floor(world.viewCols / 2);
  const halfRows = Math.floor(world.viewRows / 2);
  const inFromEdges = (x: number, y: number) =>
    x >= halfCols && y >= halfRows && x <= world.map.cols - 1 - halfCols && y <= world.map.rows - 1 - halfRows;
  const offEveryBeat = clearOf(beats, world.patrollerSightCells);
  // Best: out of every hunter's sight and off every beat. On a map whose beats leave no such
  // cell near the start, hunters alone: a patroller may then come by, as it would later anyway.
  const start =
    nearestCell(world, home, blocked, (x, y) => inFromEdges(x, y) && outsideTowns(x, y) && unseenByHunters(x, y) && offEveryBeat(x, y)) ??
    nearestCell(world, home, blocked, (x, y) => inFromEdges(x, y) && outsideTowns(x, y) && unseenByHunters(x, y)) ??
    nearestCell(world, home, blocked, (x, y) => outsideTowns(x, y) && unseenByHunters(x, y)) ?? { x: home.x, y: home.y };
  startCache.set(world, start);
  return { ...start };
}

/** The start depends only on the world, and finding it walks every beat, so it is worked out once per world. */
const startCache = new WeakMap<World, Point>();

/** The cell nearest `from` by walking distance that passes `accept`, or null. */
function nearestCell(world: World, from: Point, blocked: Blocked, accept: (x: number, y: number) => boolean): Point | null {
  const seen = new Set<number>([cellKey(world.map, from.x, from.y)]);
  const queue: Point[] = [{ x: from.x, y: from.y }];
  for (let head = 0; head < queue.length; head++) {
    const c = queue[head];
    if (accept(c.x, c.y)) return c;
    for (const [dx, dy] of OFFSETS) {
      const nx = c.x + dx;
      const ny = c.y + dy;
      const k = cellKey(world.map, nx, ny);
      if (seen.has(k) || !isPassable(world.map, nx, ny, blocked)) continue;
      seen.add(k);
      queue.push({ x: nx, y: ny });
    }
  }
  return null;
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
  if (target.kind === "power" || !isBuilding(target)) return false;
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

/** True for a target that is a building. Hunters and defenders are enemies, not buildings. */
export function isBuilding(t: Target): boolean {
  return !isEnemyKind(t.kind);
}

/**
 * True for a defender still asleep in its dome (design-notes 4.4): it is not drawn, cannot be
 * chosen as a target, does not move and does not look. Not knowing which domes are occupied
 * is the point.
 */
export function isHidden(s: DashboardState, index: number, world: World): boolean {
  return world.targets[index].kind === "defender" && !s.awake.includes(index);
}

/**
 * A missile has hit a dome, whether it destroyed it or the shield deflected it (design-notes
 * 4.4). The dome's defender, if it has one, comes out at its post beside the dome and is
 * alerted. Only the hit dome's defender wakes, not its neighbours'. It moves in real time
 * like any enemy, but its first attack is held until the player is back at the dashboard
 * (see startHeldWaits): woken at impact, its usual short wait would otherwise run out
 * while the result shows, and it would always strike first.
 */
export function wakeDefender(s: DashboardState, dome: number, world: World): DashboardState {
  const index = world.targets.findIndex((t) => t.kind === "defender" && t.home === dome);
  if (index === -1 || s.awake.includes(index) || s.ruins.includes(index)) return s;
  const alerted = alertTo({ ...s, awake: [...s.awake, index] }, [index], world);
  return { ...alerted, heldAttacks: [...alerted.heldAttacks, index] };
}

/**
 * The player is back at the dashboard after a flight: each defender woken during it starts
 * its usual 1 to 3 second wait before its first attack now, so the player sees it come out
 * and has a fair chance to strike first (design-notes 4.4).
 */
export function startHeldWaits(s: DashboardState, world: World): DashboardState {
  if (s.heldAttacks.length === 0) return s;
  const ready = { ...s.hunterReadyAt };
  for (const index of s.heldAttacks) {
    ready[index] = s.time + firstAttackWait(s, index, world);
  }
  return { ...s, hunterReadyAt: ready, heldAttacks: [] };
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
 * first attack, and drops any patrol it was on.
 */
export function alertTo(s: DashboardState, indices: readonly number[], world: World): DashboardState {
  // A hunter withdrawing to rearm, or with nowhere left to rearm (#102), has nothing to attack with.
  const fresh = indices.filter((i) => !s.alerted.includes(i) && !s.rearming[i] && !isDisarmed(s, i, world));
  if (fresh.length === 0) return s;
  const patrolling = { ...s.patrolling };
  for (const i of fresh) delete patrolling[i];
  return { ...s, alerted: [...s.alerted, ...fresh], hunterReadyAt: delayFirstAttacks(s, fresh, world), patrolling };
}

/**
 * Moves the enemies (design-notes 4.10). Every hunter is always looking: one that comes
 * within sight of the robot is alerted, whatever it was doing. An alerted hunter closes
 * to its preferred range and holds there while it attacks, but only over its own network's
 * ground (#91): it waits at the edge and fires across it, and breaks off once the robot is
 * outside the network and beyond its sight and range. A fighting patroller is leashed to where
 * it started fighting instead. While its network's power is cut, a hunter makes rounds of the
 * network's domes, then goes home when the power returns. A hunter that has used its magazine withdraws to a dome, rearms, then
 * goes home no longer alerted. Otherwise it walks back to its post. A destroyed hunter
 * does not move.
 *
 * A defender behaves the same once it is awake, but only guards: it sees and chases the robot
 * only while the robot is within its guard area round its post, breaks off once the robot
 * leaves it, and rearms at its own post. It never patrols. A defender asleep in its dome does nothing.
 */
export function moveHunters(s: DashboardState, world: World, dt: number): DashboardState {
  let next = s;
  world.targets.forEach((t, index) => {
    if (!isEnemyKind(t.kind) || next.ruins.includes(index) || isHidden(next, index, world)) return;
    if (t.kind === "hauler") {
      next = stepHauler(next, index, world, dt);
      return;
    }
    const patroller = t.kind === "patroller";
    if (patroller && !next.alerted.includes(index) && !next.rearming[index]) {
      next = stepPatroller(next, index, world, dt);
      return;
    }
    const defender = t.kind === "defender";
    const hunter = t.kind === "hunter";
    // A fighting patroller's leash runs from where it started fighting; it has no post to go home to.
    const post = patroller ? (next.patrollers[index]?.anchor ?? { x: t.col, y: t.row }) : { x: t.col, y: t.row };
    const here = positionOf(next, index, world);
    const robotDistance = distanceTo(next.pos, here.x, here.y);
    // A defender keeps the robot while it is in its guard area, and a patroller while it is on its leash.
    // A hunter never leaves its network (#91): it keeps the robot while the robot is in the network, or
    // still within its sight or missile range across the edge.
    const inReach = defender
      ? distanceTo(next.pos, post.x, post.y) <= world.defenderGuardCells
      : hunter
        ? inNetwork(next.pos, t, world) || robotDistance <= Math.max(world.hunterSightCells, world.hunterEngageRange)
        : Math.hypot(here.x - post.x, here.y - post.y) <= world.patrollerLeashCells;
    if (inReach && robotDistance <= world.hunterSightCells) next = alertTo(next, [index], world); // a rearming enemy is skipped
    if (next.alerted.includes(index) && !inReach) {
      next = { ...next, alerted: next.alerted.filter((i) => i !== index) };
    }
    const alerted = next.alerted.includes(index);
    let rearm: Errand | undefined = next.rearming[index];
    if (rearm && next.ruins.includes(rearm.dome)) {
      // Its dome was destroyed on the way (#102): choose another, or, with none left, go home unarmed.
      const again = rearmPoint(next, index, world);
      const rearming = { ...next.rearming };
      if (again) rearming[index] = again;
      else delete rearming[index];
      next = { ...next, rearming };
      rearm = again ?? undefined;
    }
    let patrol = alerted || rearm ? undefined : next.patrolling[index];
    if (patrol && next.time >= patrol.until) {
      // The power is back: the rounds are over.
      const patrolling = { ...next.patrolling };
      delete patrolling[index];
      next = { ...next, patrolling };
      patrol = undefined;
    }
    if (patrol && (patrol.at === null || (here.x === patrol.at.x && here.y === patrol.at.y))) {
      patrol = nextStop(next, index, patrol, world);
      next = { ...next, patrolling: { ...next.patrolling, [index]: patrol } };
    }

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
      if (robotDistance <= world.hunterHoldCells && !inside) return;
      goal = { x: Math.round(next.pos.x), y: Math.round(next.pos.y) };
      const guarded = hunter ? networkMap(t, world) : null;
      if (guarded) {
        // A hunter closes on the robot only over its own network's ground (#91): it heads for the cell
        // there nearest the robot and waits, firing across the edge if the robot is in range. One that
        // finds itself outside its network goes home first.
        const home = inNetwork(here, t, world);
        const pos = stepToward(here, home ? goal : post, home ? guarded : world.map, world.hunterSpeed * dt);
        next = { ...next, hunterPos: { ...next.hunterPos, [index]: pos } };
        return;
      }
    } else if (patrol?.at) {
      if (here.x === patrol.at.x && here.y === patrol.at.y) return; // its only stop: wait there
      goal = patrol.at;
    } else {
      if (here.x === post.x && here.y === post.y) return;
      goal = post;
    }
    // Enemies may pass through buildings but never stop on one (design-notes 4.7), and never
    // cross high ground. Every goal is open ground: the robot cannot stand on a building, a
    // post is never one, and a patrol stop or rearm point is a free cell beside a building that
    // the hunter can walk to. A goal across high ground is approached as near as the hunter
    // can get, and tried again on the next step.
    const speed = defender ? world.defenderSpeed : patroller ? world.patrollerSpeed : world.hunterSpeed;
    const pos = stepToward(here, goal, world.map, speed * dt);
    next = { ...next, hunterPos: { ...next.hunterPos, [index]: pos } };
  });
  return next;
}

/**
 * Cutting a power station is noticed at the station, not at the robot (design-notes 4.3).
 * The network knows something is wrong but not where, so its hunter leaves its post and
 * makes rounds of the network's domes until the power comes back. A hunter already chasing
 * the robot ignores the outage, and a destroyed one cannot respond. Cutting the power again
 * while it is down only extends the rounds.
 */
export function patrolOutage(s: DashboardState, network: number, world: World): DashboardState {
  const index = world.targets.findIndex((t) => t.kind === "hunter" && t.network === network);
  if (index === -1 || s.ruins.includes(index) || s.alerted.includes(index)) return s;
  const until = s.suppressedUntil[network] ?? s.time;
  const current = s.patrolling[index];
  const patrol: Patrol = current ? { ...current, until } : { until, stop: null, at: null, checked: [] };
  return { ...s, patrolling: { ...s.patrolling, [index]: patrol } };
}

/**
 * The buildings a hunter checks on its rounds: every intact dome in its network, or the
 * power station if the network has no dome left.
 */
function patrolBuildings(s: DashboardState, network: number, world: World): number[] {
  const inNetwork = (kind: Target["kind"]) =>
    world.targets
      .map((t, i) => ({ t, i }))
      .filter(({ t, i }) => t.kind === kind && t.network === network && !s.ruins.includes(i))
      .map(({ i }) => i);
  const domes = inNetwork("dome");
  return domes.length > 0 ? domes : inNetwork("power");
}

/**
 * The hunter's next stop: the nearest building it has not checked this round that it can walk
 * to. Once it has checked them all, a new round starts. With only one building it stays there.
 * A building cut off by high ground is passed over; with none it can reach, it has no stop
 * and goes home.
 */
function nextStop(s: DashboardState, index: number, patrol: Patrol, world: World): Patrol {
  const here = positionOf(s, index, world);
  const blocked = buildingCells(s, world);
  const byDistance = (a: Point, b: Point) => Math.hypot(a.x - here.x, a.y - here.y) - Math.hypot(b.x - here.x, b.y - here.y);
  // Each building it can walk to, with the free cell beside it nearest the hunter.
  const reachable = patrolBuildings(s, world.targets[index].network, world)
    .map((i) => {
      const t = world.targets[i];
      const beside = OFFSETS.map(([dx, dy]) => ({ x: t.col + dx, y: t.row + dy }))
        .filter((c) => isPassable(world.map, c.x, c.y, blocked) && canWalk(here, c, world.map))
        .sort(byDistance);
      return { i, at: beside[0], p: { x: t.col, y: t.row } };
    })
    .filter((r): r is { i: number; at: Point; p: Point } => r.at !== undefined)
    .sort((a, b) => byDistance(a.p, b.p));
  if (reachable.length === 0) return { ...patrol, stop: null, at: null, checked: [] };
  let checked = patrol.stop === null ? patrol.checked : [...patrol.checked, patrol.stop];
  let candidates = reachable.filter((r) => !checked.includes(r.i));
  if (candidates.length === 0) {
    // Round complete: start again, but not at the building it is standing beside.
    checked = [];
    candidates = reachable.length > 1 ? reachable.filter((r) => r.i !== patrol.stop) : reachable;
  }
  return { ...patrol, stop: candidates[0].i, at: candidates[0].at, checked };
}

/** A patroller's state of mind; one never seen to change is on its beat, heading for its second waypoint. */
export function mindOf(s: DashboardState, index: number, world: World): PatrollerMind {
  const beat = world.targets[index].beat ?? [];
  return s.patrollers[index] ?? { mode: "beat", leg: beat.length > 1 ? 1 : 0, look: null, lookUntil: null, helper: null, seen: null, anchor: null };
}

function withMind(s: DashboardState, index: number, mind: PatrollerMind): DashboardState {
  return { ...s, patrollers: { ...s.patrollers, [index]: mind } };
}

/** The town an enemy guards: its network's, or none in a world without towns. */
function homeTown(t: Target, world: World): Town | undefined {
  return t.network === undefined ? undefined : world.towns[t.network];
}

/** True when a point lies in the enemy's own network's area. Without a town, everywhere is its ground. */
function inNetwork(p: Point, t: Target, world: World): boolean {
  const town = homeTown(t, world);
  return !town || inTown(town, world.townRadiusCols, world.townRadiusRows, Math.round(p.x), Math.round(p.y));
}

/** How far a point is from the nearest cell of the enemy's network's area: 0 inside it. */
export function distanceToNetwork(p: Point, t: Target, world: World): number {
  const town = homeTown(t, world);
  if (!town || inNetwork(p, t, world)) return 0;
  let best = Infinity;
  for (let y = town.y - world.townRadiusRows; y <= town.y + world.townRadiusRows; y++) {
    for (let x = town.x - world.townRadiusCols; x <= town.x + world.townRadiusCols; x++) {
      if (inTown(town, world.townRadiusCols, world.townRadiusRows, x, y)) best = Math.min(best, Math.hypot(p.x - x, p.y - y));
    }
  }
  return best;
}

/** Network maps per terrain, keyed by town and area size. */
const networkMaps = new WeakMap<LocalMap, Map<string, LocalMap>>();

/**
 * The ground a hunter guards (#91): the terrain with everything outside its network's area
 * made high ground, so the ordinary enemy routing keeps it inside, and a goal outside is
 * swapped for the nearest cell it can reach within. Built once per network and remembered,
 * which also lets the route cache work on it. Null in a world without towns.
 */
function networkMap(t: Target, world: World): LocalMap | null {
  const town = homeTown(t, world);
  if (!town) return null;
  let known = networkMaps.get(world.map);
  if (!known) {
    known = new Map();
    networkMaps.set(world.map, known);
  }
  const key = `${town.x},${town.y},${world.townRadiusCols},${world.townRadiusRows}`;
  let map = known.get(key);
  if (!map) {
    const tiers = world.map.tiers.map((row, y) =>
      row.map((tier, x) => (inTown(town, world.townRadiusCols, world.townRadiusRows, x, y) ? tier : 2))
    ) as LocalMap["tiers"];
    map = { cols: world.map.cols, rows: world.map.rows, tiers };
    known.set(key, map);
  }
  return map;
}

/**
 * The armed enemy a patroller runs to for help (#66): the nearest hunter or defender that is
 * not destroyed, not already alerted (it is coming anyway), not off rearming (it has nothing
 * to fight with), and that would fight where the robot was seen: inside a defender's guard
 * area, or inside a hunter's network or within missile range of its edge (#91). Help that
 * would turn straight back, or never come, is no help.
 * A defender asleep in its dome counts: the patroller goes to its door and wakes it. Null when
 * there is nobody to fetch. Ties go to the lower index.
 */
export function nearestHelper(s: DashboardState, index: number, world: World, seen: Point = s.pos): number | null {
  const here = positionOf(s, index, world);
  let best: number | null = null;
  let bestDistance = Infinity;
  world.targets.forEach((t, i) => {
    if (!isArmedHelper(t.kind) || s.ruins.includes(i) || s.alerted.includes(i) || s.rearming[i] || isDisarmed(s, i, world)) return;
    const engages =
      t.kind === "defender"
        ? Math.hypot(seen.x - t.col, seen.y - t.row) <= world.defenderGuardCells
        : distanceToNetwork(seen, t, world) <= world.hunterEngageRange;
    if (!engages) return;
    const p = positionOf(s, i, world);
    const d = Math.hypot(p.x - here.x, p.y - here.y);
    if (d < bestDistance) {
      best = i;
      bestDistance = d;
    }
  });
  return best;
}

/** The patroller starts fighting where it stands: it joins the alerted enemies, leashed to this spot. */
function startFighting(s: DashboardState, index: number, world: World): DashboardState {
  const here = positionOf(s, index, world);
  const mind = { ...mindOf(s, index, world), mode: "beat" as const, helper: null, look: null, lookUntil: null, anchor: { ...here } };
  return alertTo(withMind(s, index, mind), [index], world);
}

/**
 * Help arrives (#66): the patroller has reached the armed enemy it was fetching. That enemy is
 * alerted to the robot, and a defender asleep in its dome is woken out of it first. The call is
 * recorded, and the patroller turns to fight alongside it.
 */
function raiseHelp(s: DashboardState, index: number, helper: number, world: World): DashboardState {
  const woken = isHidden(s, helper, world) ? { ...s, awake: [...s.awake, helper] } : s;
  const helped = alertTo(woken, [helper], world);
  const called = { ...helped, helpCalls: [...helped.helpCalls, { patroller: index, helper, time: s.time }] };
  return startFighting(called, index, world);
}

/**
 * One step of a patroller that is not fighting (#66, design-notes 4.10). It is always looking:
 * seeing the robot sends it running for help, or, with nobody left to fetch, straight into the
 * fight. Otherwise it fetches, investigates or walks its beat, as its mind says.
 */
function stepPatroller(s: DashboardState, index: number, world: World, dt: number): DashboardState {
  const beat = world.targets[index].beat ?? [];
  const here = positionOf(s, index, world);
  let mind = mindOf(s, index, world);
  if (mind.mode !== "fetch" && distanceTo(s.pos, here.x, here.y) <= world.patrollerSightCells) {
    mind = { ...mind, mode: "fetch", helper: null, look: null, lookUntil: null, seen: { ...s.pos } };
  }

  if (mind.mode === "fetch") {
    // The helper it chose may have been destroyed, alerted or sent to rearm since: choose again.
    let helper = mind.helper;
    if (helper === null || s.ruins.includes(helper) || s.alerted.includes(helper) || s.rearming[helper]) {
      helper = nearestHelper(s, index, world, mind.seen ?? s.pos);
    }
    if (helper === null) return startFighting(withMind(s, index, mind), index, world);
    const at = positionOf(s, helper, world);
    if (Math.hypot(at.x - here.x, at.y - here.y) <= world.patrollerHelpReachCells) {
      return raiseHelp(withMind(s, index, { ...mind, helper }), index, helper, world);
    }
    const goal = { x: Math.round(at.x), y: Math.round(at.y) };
    return movePatroller(withMind(s, index, { ...mind, helper }), index, goal, world.patrollerRunSpeed * dt, world);
  }

  if (mind.mode === "investigate" && mind.look) {
    if (here.x === mind.look.x && here.y === mind.look.y) {
      // There: look round for a while, then go back to the nearest point of its beat.
      if (mind.lookUntil === null) return withMind(s, index, { ...mind, lookUntil: s.time + world.patrollerSearchSeconds });
      if (s.time < mind.lookUntil) return s;
      return withMind(s, index, { ...mind, mode: "beat", look: null, lookUntil: null, leg: nearestLeg(beat, here) });
    }
    return movePatroller(withMind(s, index, mind), index, mind.look, world.patrollerSpeed * dt, world);
  }

  if (beat.length === 0) return s;
  let leg = mind.leg % beat.length;
  if (here.x === beat[leg].x && here.y === beat[leg].y) leg = (leg + 1) % beat.length;
  if (leg !== mind.leg || mind.mode !== "beat") mind = { ...mind, mode: "beat", leg, look: null, lookUntil: null };
  return movePatroller(withMind(s, index, mind), index, beat[leg], world.patrollerSpeed * dt, world);
}

function movePatroller(s: DashboardState, index: number, goal: Point, distance: number, world: World): DashboardState {
  const pos = stepToward(positionOf(s, index, world), goal, world.map, distance);
  return { ...s, hunterPos: { ...s.hunterPos, [index]: pos } };
}

/** The waypoint of a beat nearest a point. */
function nearestLeg(beat: readonly Point[], p: Point): number {
  let best = 0;
  beat.forEach((c, i) => {
    if (Math.hypot(c.x - p.x, c.y - p.y) < Math.hypot(beat[best].x - p.x, beat[best].y - p.y)) best = i;
  });
  return best;
}

/**
 * Where a patroller goes to look at a disturbance: the spot itself if it is open ground, or the
 * free cell beside an intact building nearest the patroller (enemies never stop on a building),
 * or, across high ground, the nearest cell it can reach. Null if it can reach nowhere.
 */
function lookPoint(s: DashboardState, here: Point, spot: Point, world: World): Point | null {
  const cell = { x: Math.round(spot.x), y: Math.round(spot.y) };
  const blocked = buildingCells(s, world);
  if (blocked.has(cellKey(world.map, cell.x, cell.y))) {
    const beside = OFFSETS.map(([dx, dy]) => ({ x: cell.x + dx, y: cell.y + dy }))
      .filter((c) => isPassable(world.map, c.x, c.y, blocked) && canWalk(here, c, world.map))
      .sort((a, b) => Math.hypot(a.x - here.x, a.y - here.y) - Math.hypot(b.x - here.x, b.y - here.y));
    if (beside.length > 0) return beside[0];
  }
  return reachableGoal(here, cell, world.map);
}

/**
 * Something happened at `spot` (#66): a scan pulse, a missile hit, a power cut. Every patroller
 * on its beat or already investigating within `radius` goes to look, dropping whatever it was
 * looking at before. A patroller running for help or fighting carries on: it already knows.
 */
export function disturbPatrollers(s: DashboardState, spot: Point, radius: number, world: World): DashboardState {
  let next = s;
  world.targets.forEach((t, index) => {
    if (t.kind !== "patroller" || next.ruins.includes(index) || next.alerted.includes(index) || next.rearming[index]) return;
    const mind = mindOf(next, index, world);
    if (mind.mode === "fetch") return;
    const here = positionOf(next, index, world);
    if (Math.hypot(spot.x - here.x, spot.y - here.y) > radius) return;
    const look = lookPoint(next, here, spot, world);
    if (look === null) return;
    next = withMind(next, index, { ...mind, mode: "investigate", look, lookUntil: null });
  });
  return next;
}

/** A hauler's state of mind; one never seen to change is at its first pickup, about to load. */
export function haulerMindOf(s: DashboardState, index: number, world: World): HaulerMind {
  const t = world.targets[index];
  return s.haulers[index] ?? { mode: "haul", stop: t.home ?? -1, loading: true, town: t.network, from: null, trip: 0, threat: null, goal: null, until: null };
}

function withHaulerMind(s: DashboardState, index: number, mind: HaulerMind): DashboardState {
  return { ...s, haulers: { ...s.haulers, [index]: mind } };
}

/** True while a building can take a hauler: it stands, and it has a dock. */
function canDock(s: DashboardState, building: number, world: World): boolean {
  return world.targets[building]?.dock !== undefined && !s.ruins.includes(building);
}

/** A network's intact buildings of these kinds that have a dock, by target index. */
function docksIn(s: DashboardState, network: number, kinds: readonly string[], world: World): number[] {
  return world.targets.flatMap((t, i) => (t.network === network && kinds.includes(t.kind) && canDock(s, i, world) ? [i] : []));
}

/** Of these buildings, the one whose dock is nearest `p`; ties to the lower index. Null if none. */
function nearestDock(buildings: readonly number[], p: Point, world: World): number | null {
  let best: number | null = null;
  let bestDistance = Infinity;
  for (const i of buildings) {
    const dock = world.targets[i].dock!;
    const d = Math.hypot(dock.x - p.x, dock.y - p.y);
    if (d < bestDistance) {
      best = i;
      bestDistance = d;
    }
  }
  return best;
}

/** A well-mixed whole number from a hauler and its trip: the same pair always gives the same number. */
function tripHash(index: number, trip: number): number {
  let h = Math.imul(index + 1, 0x9e3779b1) ^ Math.imul(trip + 1, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * Where a hauler loaded in `town` carries its load (#121): one of the town's neighbours that still
 * has an intact dome to take it, chosen by its trip, so it looks unpredictable but never changes
 * between runs. It never carries straight back to `from` if any other neighbour will do. Null if no
 * neighbour has a dome left.
 */
export function nextDestination(s: DashboardState, index: number, town: number, from: number | null, trip: number, world: World): number | null {
  const open = (world.neighbours[town] ?? []).filter((n) => docksIn(s, n, ["dome"], world).length > 0);
  if (open.length === 0) return null;
  const onward = open.filter((n) => n !== from);
  const choices = onward.length > 0 ? onward : open;
  return choices[tripHash(index, trip) % choices.length];
}

/**
 * A hauler takes fright at a threat at `spot` (#67): it flees from there, and keeps away for
 * haulerFleeSeconds from now. Already fleeing, it turns from the newer threat, and its time is
 * extended, never shortened.
 */
function frighten(s: DashboardState, index: number, spot: Point, world: World): DashboardState {
  const mind = haulerMindOf(s, index, world);
  const until = Math.max(s.time + world.haulerFleeSeconds, mind.until ?? 0);
  const moved = mind.threat === null || mind.threat.x !== spot.x || mind.threat.y !== spot.y;
  return withHaulerMind(s, index, { ...mind, mode: "flee", threat: { ...spot }, goal: moved ? null : mind.goal, until });
}

/**
 * Something threatening happened at `spot` (#67, design-notes 4.2 and 4.10): a scan pulse, or a
 * missile hit. Every hauler within `radius` that is not destroyed flees from it, except `struck`:
 * the hauler the missile hit is a wreck, and its cargo lies where it was hit.
 */
export function scareHaulers(s: DashboardState, spot: Point, radius: number, world: World, struck: number | null = null): DashboardState {
  let next = s;
  world.targets.forEach((t, index) => {
    if (t.kind !== "hauler" || index === struck || next.ruins.includes(index)) return;
    const here = positionOf(next, index, world);
    if (Math.hypot(spot.x - here.x, spot.y - here.y) > radius) return;
    next = frighten(next, index, spot, world);
  });
  return next;
}

/**
 * Where a hauler flees to (#67): of the open cells it can walk to within haulerFleeCells steps
 * over the terrain, the one furthest from the threat. Enemies never stop on a building, so those
 * are passed over. Ties go to the fewer steps, then the lower cell key, so the choice is
 * deterministic. With nowhere further away it stays where it is: cornered.
 */
export function fleeGoal(s: DashboardState, here: Point, threat: Point, world: World): Point {
  const map = world.map;
  const start = { x: Math.round(here.x), y: Math.round(here.y) };
  const buildings = buildingCells(s, world);
  const away = (c: Point) => Math.hypot(c.x - threat.x, c.y - threat.y);
  let best: Point = start;
  let bestAway = buildings.has(cellKey(map, start.x, start.y)) ? -Infinity : away(start);
  const seen = new Set<number>([cellKey(map, start.x, start.y)]);
  let frontier: Point[] = [start];
  for (let step = 0; step < world.haulerFleeCells && frontier.length > 0; step++) {
    const ring: Point[] = [];
    for (const c of frontier) {
      for (const [dx, dy] of OFFSETS) {
        const nx = c.x + dx;
        const ny = c.y + dy;
        if (nx < 0 || ny < 0 || nx >= map.cols || ny >= map.rows || map.tiers[ny][nx] === 2) continue;
        const k = cellKey(map, nx, ny);
        if (seen.has(k)) continue;
        seen.add(k);
        ring.push({ x: nx, y: ny });
      }
    }
    ring.sort((a, b) => cellKey(map, a.x, a.y) - cellKey(map, b.x, b.y));
    for (const c of ring) {
      if (buildings.has(cellKey(map, c.x, c.y))) continue;
      const d = away(c);
      if (d > bestAway) {
        best = c;
        bestAway = d;
      }
    }
    frontier = ring;
  }
  return best;
}

/**
 * One step of a hauler (#67, #121, design-notes 4.10): defensive. It is always looking: the robot in
 * sight is a threat, and it flees. Fleeing, it heads for the place furthest from the threat it can
 * reach soon, choosing again whenever the threat has moved round so that its goal no longer takes it
 * away. Once its time is up with nothing new, it carries on with its trip. Its cargo goes with it: a
 * wreck lies where it fell.
 */
function stepHauler(s: DashboardState, index: number, world: World, dt: number): DashboardState {
  const here = positionOf(s, index, world);
  let next = s;
  if (distanceTo(s.pos, here.x, here.y) <= world.haulerSightCells) {
    next = frighten(next, index, { x: Math.round(s.pos.x), y: Math.round(s.pos.y) }, world);
  }
  let mind = haulerMindOf(next, index, world);

  if (mind.mode === "flee" && mind.threat) {
    if (next.time < (mind.until ?? 0)) {
      const threat = mind.threat;
      const away = (p: Point) => Math.hypot(p.x - threat.x, p.y - threat.y);
      let goal = mind.goal;
      if (goal === null || away(goal) < away(here)) {
        goal = fleeGoal(next, here, threat, world);
        next = withHaulerMind(next, index, { ...mind, goal });
      }
      if (here.x === goal.x && here.y === goal.y) return next;
      return moveHauler(next, index, goal, world.haulerFleeSpeed * dt, world);
    }
    // Nothing new for long enough: back to the trip it was on.
    mind = { ...mind, mode: "haul", threat: null, goal: null, until: null };
    next = withHaulerMind(next, index, mind);
  }

  const planned = planTrip(next, index, mind, here, world);
  if (planned !== mind) next = withHaulerMind(next, index, planned);
  if (!canDock(next, planned.stop, world)) return next; // nowhere to go: it waits
  return moveHauler(next, index, world.targets[planned.stop].dock!, world.haulerSpeed * dt, world);
}

/**
 * A hauler's trip, brought up to date (#121). Arrived at a pickup, it loads and sets off for a dome
 * in the next destination. Arrived at a dome, it unloads, and goes to load again at the nearest
 * pickup in that town. A building destroyed on the way is swapped for the nearest one in the same
 * town that can take it; a load whose destination has no dome left is carried somewhere else.
 * Returns the same mind when nothing changes.
 */
function planTrip(s: DashboardState, index: number, mind: HaulerMind, here: Point, world: World): HaulerMind {
  let m = mind;
  const at = (i: number) => {
    const dock = world.targets[i].dock!;
    return here.x === dock.x && here.y === dock.y;
  };
  // Up to two changes in one step: unload, then load; or load, then set off.
  for (let pass = 0; pass < 2; pass++) {
    if (m.loading) {
      if (!canDock(s, m.stop, world) || !HAULER_PICKUPS.includes(world.targets[m.stop].kind)) {
        const pickup = nearestDock(docksIn(s, m.town, HAULER_PICKUPS, world), here, world);
        if (pickup === null) return m;
        m = { ...m, stop: pickup };
      }
      if (!at(m.stop)) return m;
      // Loaded: off to the next network.
      const destination = nextDestination(s, index, m.town, m.from, m.trip, world);
      if (destination === null) return m; // nowhere to deliver: it waits at the pickup
      const dome = nearestDock(docksIn(s, destination, ["dome"], world), world.towns[m.town] ?? here, world)!;
      m = { ...m, loading: false, stop: dome, from: m.town, town: destination };
      continue;
    }
    if (!canDock(s, m.stop, world)) {
      const dome = nearestDock(docksIn(s, m.town, ["dome"], world), here, world);
      if (dome !== null) {
        m = { ...m, stop: dome };
      } else {
        // The destination has no dome left: carry the load on to another neighbour of where it came from.
        const destination = nextDestination(s, index, m.from ?? m.town, m.town, m.trip, world);
        if (destination === null) return m;
        m = { ...m, town: destination, stop: nearestDock(docksIn(s, destination, ["dome"], world), here, world)! };
      }
    }
    if (!at(m.stop)) return m;
    // Unloaded: load again at the nearest pickup here.
    const pickup = nearestDock(docksIn(s, m.town, HAULER_PICKUPS, world), here, world);
    if (pickup === null) return { ...m, loading: true, trip: m.trip + 1 };
    m = { ...m, loading: true, trip: m.trip + 1, stop: pickup };
  }
  return m;
}

function moveHauler(s: DashboardState, index: number, goal: Point, distance: number, world: World): DashboardState {
  const pos = stepToward(positionOf(s, index, world), goal, world.map, distance);
  return { ...s, hunterPos: { ...s.hunterPos, [index]: pos } };
}

/** How many attacks an enemy's magazine holds. */
function magazineOf(index: number, world: World): number {
  return world.targets[index]?.kind === "patroller" ? world.patrollerMagazineAttacks : world.hunterMagazineAttacks;
}

/**
 * True for an enemy that has used its magazine and has nowhere to rearm (#102): every dome in
 * its network is destroyed. It cannot attack, is not alerted again, and is no help to a patroller;
 * it goes home and stays there, harmless until it is destroyed.
 */
export function isDisarmed(s: DashboardState, index: number, world: World): boolean {
  return (s.attacksUsed[index] ?? 0) >= magazineOf(index, world) && !s.rearming[index];
}

/**
 * An enemy has made an attack (design-notes 4.10). It spends one from its magazine; once the
 * magazine is empty it breaks off and withdraws to rearm at a free cell beside the nearest
 * intact dome in its network that it can walk to. With none, it is disarmed (#102).
 */
export function spendAttack(s: DashboardState, index: number, world: World): DashboardState {
  const used = (s.attacksUsed[index] ?? 0) + 1;
  const spent = { ...s, attacksUsed: { ...s.attacksUsed, [index]: used } };
  if (used < magazineOf(index, world)) return spent;
  const errand = rearmPoint(spent, index, world);
  const alerted = spent.alerted.filter((i) => i !== index);
  if (errand === null) return { ...spent, alerted };
  return { ...spent, alerted, rearming: { ...spent.rearming, [index]: errand } };
}

/**
 * Where an enemy rearms (#102): beside the nearest intact dome in its network that it can walk
 * to. Domes are the arsenal, so a ruin is no use, and a dome cut off by high ground is passed
 * over. Hunters, defenders and patrollers alike. Null when there is none: it cannot rearm.
 */
function rearmPoint(s: DashboardState, index: number, world: World): Errand | null {
  const enemy = world.targets[index];
  const here = positionOf(s, index, world);
  const blocked = buildingCells(s, world);
  const distance = (p: Point) => Math.hypot(p.x - here.x, p.y - here.y);
  const domes = world.targets
    .map((t, i) => ({ t, i }))
    .filter(({ t, i }) => t.kind === "dome" && t.network === enemy.network && !s.ruins.includes(i))
    .sort((a, b) => distance({ x: a.t.col, y: a.t.row }) - distance({ x: b.t.col, y: b.t.row }));
  for (const { t, i } of domes) {
    const beside = OFFSETS.map(([dx, dy]) => ({ x: t.col + dx, y: t.row + dy }))
      .filter((c) => isPassable(world.map, c.x, c.y, blocked) && canWalk(here, c, world.map))
      .sort((a, b) => distance(a) - distance(b));
    if (beside[0]) return { ...beside[0], dome: i, until: null };
  }
  return null;
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
    ready[index] = Math.max(ready[index] ?? 0, s.time + firstAttackWait(s, index, world));
  }
  return ready;
}

/** The wait before an enemy's first attack, drawn from the clock and the enemy so it is reproducible. */
function firstAttackWait(s: DashboardState, index: number, world: World): number {
  const roll = createRng(Math.floor(s.time * 1000) * 31 + index)();
  return world.hunterFirstAttackDelayMin + roll * (world.hunterFirstAttackDelayMax - world.hunterFirstAttackDelayMin);
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
    if (!t || !isEnemyKind(t.kind) || s.ruins.includes(index) || s.rearming[index] || isDisarmed(s, index, world) || isHidden(s, index, world)) continue;
    if (s.time < (s.hunterReadyAt[index] ?? 0) || s.heldAttacks.includes(index)) continue;
    const p = positionOf(s, index, world);
    if (distanceTo(s.pos, p.x, p.y) <= range) return index;
  }
  return null;
}


/** A network as the full map marks it (#90): at its power station, and whether its power is cut. */
export interface NetworkMarker {
  network: number;
  col: number;
  row: number;
  down: boolean;
}

/**
 * The full map's network markers (#90): one per network, at its power station. The station is a
 * real place the robot walks to and cuts with Grid Disable, and it can never be destroyed, so the
 * marker never goes stale. A network without a station is not marked.
 */
export function networkMarkers(s: DashboardState, world: World): NetworkMarker[] {
  return world.towns.flatMap((_, network) => {
    const station = world.targets.find((t) => t.kind === "power" && t.network === network);
    return station ? [{ network, col: station.col, row: station.row, down: isSuppressed(s, network) }] : [];
  });
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
  let s: DashboardState = state;
  if (!isPaused(state)) {
    const walked = walkStep({ ...state, time: state.time + dt }, dt, world.walkSpeed);
    const moved = distanceTo(state.pos, walked.pos.x, walked.pos.y);
    s = recharge(drainEnergy(walked, dt, moved, world), dt, moved, world);
  }
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
        // The network notices: its hunter makes rounds of the domes while the power is down.
        const station = world.targets[s.target];
        // Patrollers within earshot of the station come to look as well (#66).
        const opened = disturbPatrollers(
          patrolOutage(openWindow(s, networkOf(station), world), networkOf(station), world),
          { x: station.col, y: station.row },
          world.patrollerHearingCells,
          world
        );
        s = { ...opened, mode: "browse", target: null, gridReadyAt: s.time + world.gridDisableCooldownSeconds };
      } else if (s.target !== null && s.missiles > 0) {
        // Every launch uses a missile from the rack, whatever the flight's outcome.
        fire = world.targets[s.target];
        s = { ...s, missiles: s.missiles - 1 };
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
      // An empty rack cannot fire, so the targeting cross does not open (design-notes 4.4).
      if (s.missiles <= 0) return s;
      // Equipment only reaches what the local map shows, so using it pulls the map back to local.
      const local: DashboardState = { ...s, zoom: "local" };
      const cross = { col: Math.round(s.pos.x), row: Math.round(s.pos.y) };
      return { ...local, mode: "targeting", purpose: "missile", cross, target: nearestTarget(cross, world, inView(local, world, anyTarget), (i) => cellOf(s, i, world)) };
    }
    if (verb === "move") {
      const cross = { col: Math.round(s.pos.x), row: Math.round(s.pos.y) };
      return { ...s, mode: "moving", cross };
    }
    if (verb === "scan") {
      // A patroller the ring reaches comes to look where the pulse came from (#66).
      // A hauler the ring reaches flees from it (#67).
      const heard = scareHaulers(
        disturbPatrollers(alertTo(s, alertHunters(s, world), world), s.pos, world.scanRadius, world),
        s.pos,
        world.scanRadius,
        world
      );
      return { ...heard, zoom: "local", scan: scanFrom(s, world), pulseStarted: s.time };
    }
    if (verb === "gridDisable" && gridDisableReady(s)) {
      // Choose a power station with the cross, the same way as a missile target.
      const local: DashboardState = { ...s, zoom: "local" };
      const cross = { col: Math.round(s.pos.x), row: Math.round(s.pos.y) };
      return { ...local, mode: "targeting", purpose: "gridDisable", cross, target: nearestTarget(cross, world, inView(local, world, isPowerStation), (i) => cellOf(s, i, world)) };
    }
  }
  return s;
}

/** Straight-line distance from the robot to a point on the map. */
function distanceTo(pos: Point, x: number, y: number): number {
  return Math.hypot(x - pos.x, y - pos.y);
}

/**
 * Energy drains while time runs (#15): slowly with time alone, faster while walking. It is the
 * pressure that keeps the robot moving, and the bank never goes below empty. Empty is death,
 * checked by the app, which knows which screen the robot was on.
 */
export function drainEnergy(s: DashboardState, seconds: number, walkedCells: number, world: World): DashboardState {
  const drain = seconds * world.energyDrainPerSecond + walkedCells * world.energyPerCellWalked;
  if (drain <= 0) return s;
  return { ...s, energyCells: Math.max(0, s.energyCells - drain) };
}

/**
 * Threatened (#82, design-notes 4.9): an attack has just ended and its breather is running, or
 * an alerted enemy is within scan range. The robot cannot rest while threatened. The same state
 * will gate saving (design-notes 3, item 19).
 */
export function isThreatened(s: DashboardState, world: World): boolean {
  if (s.time < s.breatherUntil) return true;
  return s.alerted.some((index) => {
    if (s.ruins.includes(index) || isHidden(s, index, world)) return false;
    const p = positionOf(s, index, world);
    return distanceTo(s.pos, p.x, p.y) <= world.scanRadius;
  });
}

/**
 * Resting (design-notes 4.9): standing still, time running, not threatened, with a cracked
 * plate to mend and energy above the low-power line. No new icon: stopping is resting.
 */
export function isResting(s: DashboardState, world: World): boolean {
  return (
    !isPaused(s) &&
    s.route.length === 0 &&
    plateToMend(s.plates, world.hitsPerPlate) >= 0 &&
    s.energyCells > world.rechargeFloorCells &&
    !isThreatened(s, world)
  );
}

/**
 * Recharge (#82): while resting, cracks mend one at a time, most cracked plate first, and energy
 * drains as they do. Moving or a threat interrupts it, and the crack in progress starts over.
 */
function recharge(s: DashboardState, dt: number, moved: number, world: World): DashboardState {
  if (moved > 0 || !isResting(s, world)) return s.mendProgress === 0 ? s : { ...s, mendProgress: 0 };
  const step = dt / world.rechargeSecondsPerCrack;
  const energyCells = Math.max(0, s.energyCells - step * world.rechargeCellsPerCrack);
  const progress = s.mendProgress + step;
  if (progress < 1) return { ...s, energyCells, mendProgress: progress };
  const plates = [...s.plates];
  plates[plateToMend(plates, world.hitsPerPlate)] += 1;
  return { ...s, energyCells, plates, mendProgress: 0 };
}

/** True once the batteries are flat. */
export function isOutOfEnergy(s: DashboardState): boolean {
  return s.energyCells <= 0;
}

/** One unit of a supply collected from one ruin or wreck. It can hold several, and each is taken on its own. */
export interface Salvage {
  target: number;
  supply: Supply;
}

/** The units still lying in a target's ruin or wreck, one entry each: what it held, less what the robot has taken. */
export function uncollected(s: DashboardState, index: number, world: World): Supply[] {
  const left = [...world.targets[index].supplies];
  for (const f of s.found) {
    if (f.target !== index) continue;
    const at = left.indexOf(f.supply);
    if (at >= 0) left.splice(at, 1);
  }
  return left;
}

/** Whether a target's ruin still holds a part the robot has not collected. */
function holdsPart(s: DashboardState, index: number, world: World): boolean {
  const part = world.targets[index].part;
  return part !== undefined && !s.parts.includes(part);
}

/** Whether a ruin still holds anything worth a scan's mark: a supply or a part. */
function holdsSalvage(s: DashboardState, index: number, world: World): boolean {
  return uncollected(s, index, world).length > 0 || holdsPart(s, index, world);
}

/** Whether a supply would be wasted: energy at a full bank, armour with every plate whole. */
function wouldWaste(s: DashboardState, supply: Supply, world: World): boolean {
  if (supply === "energy") return s.energyCells >= world.energyMax;
  if (supply === "missiles") return s.missiles >= world.missileRack;
  return allWhole(s.plates, world.hitsPerPlate);
}

/** One unit: energy adds a cell; a missile goes in the rack; armour fully mends the weakest plate, a broken one first. */
function applySupply(s: DashboardState, supply: Supply, world: World): DashboardState {
  if (supply === "energy") return { ...s, energyCells: Math.min(world.energyMax, s.energyCells + 1) };
  if (supply === "missiles") return { ...s, missiles: Math.min(world.missileRack, s.missiles + 1) };
  return { ...s, plates: mendWeakest(s.plates, 1, world.hitsPerPlate) };
}

/**
 * Collects the supplies and any part in a ruin or wreck the robot is standing on. Pickup is
 * automatic, not a verb. Each unit is taken on its own: one that would be wasted stays where it
 * is, so the player can come back for it, while the rest are taken. A part is always taken. A
 * wreck lies where its enemy fell, not at its post.
 */
function collectDrops(s: DashboardState, world: World): DashboardState {
  let next = s;
  for (const i of s.ruins) {
    const t = world.targets[i];
    const at = positionOf(next, i, world);
    if (distanceTo(next.pos, at.x, at.y) > world.pickupRadius) continue;
    if (t.part !== undefined && holdsPart(next, i, world)) next = { ...next, parts: [...next.parts, t.part] };
    for (const supply of uncollected(next, i, world)) {
      if (wouldWaste(next, supply, world)) continue;
      next = { ...applySupply(next, supply, world), found: [...next.found, { target: i, supply }] };
    }
  }
  return next;
}

/** Every ruin within the scan's reach that still holds a supply or a part, nearest first. */
function scanFrom(s: DashboardState, world: World): ScanResult {
  const origin = { x: s.pos.x, y: s.pos.y };
  const blips = s.ruins
    .filter((i) => holdsSalvage(s, i, world))
    .map((i) => {
      const at = positionOf(s, i, world);
      return { i, d: distanceTo(origin, at.x, at.y) };
    })
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
 * then fading to nothing over blipSeconds. A ruin emptied since the scan no longer shows.
 */
export function blipStrength(s: DashboardState, index: number, world: World): number {
  if (s.scan === null || s.pulseStarted === null || !s.scan.blips.includes(index) || !holdsSalvage(s, index, world)) return 0;
  const at = positionOf(s, index, world);
  const fraction = Math.min(1, distanceTo(s.scan.origin, at.x, at.y) / world.scanRadius);
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
  return { ...s, cross: shiftCross(s, action, world) };
}

/** The cells the mini map shows at its current zoom: a window round the robot, or the whole world. */
export interface ViewBounds {
  minCol: number;
  maxCol: number;
  minRow: number;
  maxRow: number;
}

/**
 * The cells whose centres lie inside the mini map at its current zoom. In the local view this
 * is also the reach of the robot's equipment (missile, grid disable): the rectangle, not a radius.
 */
export function viewBounds(s: DashboardState, world: World): ViewBounds {
  const map = world.map;
  if (s.zoom === "full") return { minCol: 0, maxCol: map.cols - 1, minRow: 0, maxRow: map.rows - 1 };
  const halfCols = (world.viewCols - 1) / 2;
  const halfRows = (world.viewRows - 1) / 2;
  return {
    minCol: Math.max(0, Math.ceil(s.pos.x - halfCols)),
    maxCol: Math.min(map.cols - 1, Math.floor(s.pos.x + halfCols)),
    minRow: Math.max(0, Math.ceil(s.pos.y - halfRows)),
    maxRow: Math.min(map.rows - 1, Math.floor(s.pos.y + halfRows)),
  };
}

/** True when a cell is inside the view bounds. */
export function inBounds(b: ViewBounds, col: number, row: number): boolean {
  return col >= b.minCol && col <= b.maxCol && row >= b.minRow && row <= b.maxRow;
}

/** Narrows a target filter to targets the mini map currently shows. */
function inView(s: DashboardState, world: World, accept: (t: Target) => boolean): (t: Target, index: number) => boolean {
  const b = viewBounds(s, world);
  return (t, index) => {
    // A defender asleep in its dome cannot be seen, so it cannot be chosen.
    if (!accept(t) || isHidden(s, index, world)) return false;
    const at = cellOf(s, index, world);
    return inBounds(b, at.col, at.row);
  };
}

/** One step of the cross, held inside what the mini map shows. */
function shiftCross(s: DashboardState, action: Action, world: World): Cross {
  const dCol = action === "left" ? -1 : action === "right" ? 1 : 0;
  const dRow = action === "up" ? -1 : action === "down" ? 1 : 0;
  const b = viewBounds(s, world);
  return {
    col: clamp(s.cross.col + dCol, b.minCol, b.maxCol),
    row: clamp(s.cross.row + dRow, b.minRow, b.maxRow),
  };
}

function moveCross(s: DashboardState, action: Action, world: World): DashboardState {
  const cross = shiftCross(s, action, world);
  const filter = s.purpose === "gridDisable" ? isPowerStation : anyTarget;
  return { ...s, cross, target: nearestTarget(cross, world, inView(s, world, filter), (i) => cellOf(s, i, world)) };
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
  accept: (t: Target, index: number) => boolean = anyTarget,
  cellAt: (index: number) => Cross = (i) => ({ col: world.targets[i].col, row: world.targets[i].row })
): number | null {
  let best: number | null = null;
  let bestDistance = Infinity;
  world.targets.forEach((t, index) => {
    if (!accept(t, index)) return;
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
