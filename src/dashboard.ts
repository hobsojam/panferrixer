import type { Config } from "./config";
import { generateWorld, inTown, isEnemyKind, townCentres, type LocalMap, type Target, type Town } from "./local-map";
import { createRng } from "./rng";
import { allWhole, fullPlates, mendWeakest, plateToMend } from "./armour";
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
  defenderSpeed: number; // cells per second
  defenderGuardCells: number; // an awake defender guards this far round its post (design-notes 4.10)
  viewCols: number; // the mini map's local window, in cells: also the reach of the robot's equipment
  viewRows: number;
  // The energy and shield economy (#15). Energy is a slow clock: it drains with time and walking.
  energyMax: number; // battery cells when full
  hitsPerPlate: number;
  energyDrainPerSecond: number; // cells drained per second of running time, standing or not
  energyPerCellWalked: number; // extra cells drained per map cell walked
  energyDropCells: number; // cells restored by an energy drop
  armourDropPlates: number; // plates restored by an armour drop
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
}

/** A hunter sent to rearm: it walks there, stays a while, then goes home. */
export interface Errand {
  x: number;
  y: number;
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
      defenderSpeed: cfg.dashboard.defenderSpeed,
      defenderGuardCells: cfg.dashboard.defenderGuardCells,
      viewCols: cfg.localMap.viewCols,
      viewRows: cfg.localMap.viewRows,
      energyMax: cfg.dashboard.energyCells,
      hitsPerPlate: cfg.dashboard.hitsPerPlate,
      energyDrainPerSecond: cfg.energy.drainPerSecond,
      energyPerCellWalked: cfg.energy.perCellWalked,
      energyDropCells: cfg.energy.dropCells,
      armourDropPlates: cfg.energy.armourDropPlates,
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
    // A defender is asleep in its dome at the start, so only the hunters are looking.
    if (t.kind === "hunter") posts.push({ x: t.col, y: t.row });
    else if (isBuilding(t)) blocked.add(cellKey(world.map, t.col, t.row));
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
  // A hunter withdrawing to rearm has nothing to attack with, and does not turn back.
  const fresh = indices.filter((i) => !s.alerted.includes(i) && !s.rearming[i]);
  if (fresh.length === 0) return s;
  const patrolling = { ...s.patrolling };
  for (const i of fresh) delete patrolling[i];
  return { ...s, alerted: [...s.alerted, ...fresh], hunterReadyAt: delayFirstAttacks(s, fresh, world), patrolling };
}

/**
 * Moves the enemies (design-notes 4.10). Every hunter is always looking: one that comes
 * within sight of the robot is alerted, whatever it was doing. An alerted hunter closes
 * to its preferred range and holds there while it attacks, and breaks off once the robot
 * is beyond its leash. While its network's power is cut, a hunter makes rounds of the
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
    const defender = t.kind === "defender";
    const post = { x: t.col, y: t.row };
    const here = positionOf(next, index, world);
    // A hunter's leash is how far it has come from its post; a defender's guard area is where the robot is.
    const inReach = defender
      ? distanceTo(next.pos, post.x, post.y) <= world.defenderGuardCells
      : Math.hypot(here.x - post.x, here.y - post.y) <= world.hunterLeashCells;
    if (inReach && distanceTo(next.pos, here.x, here.y) <= world.hunterSightCells) next = alertTo(next, [index], world); // a rearming enemy is skipped
    if (next.alerted.includes(index) && !inReach) {
      next = { ...next, alerted: next.alerted.filter((i) => i !== index) };
    }
    const alerted = next.alerted.includes(index);
    const rearm = next.rearming[index];
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
      if (distanceTo(next.pos, here.x, here.y) <= world.hunterHoldCells && !inside) return;
      goal = { x: Math.round(next.pos.x), y: Math.round(next.pos.y) };
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
    const pos = stepToward(here, goal, world.map, (defender ? world.defenderSpeed : world.hunterSpeed) * dt);
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
 * or its post. A dome cut off by high ground is passed over. A defender rearms at its own post.
 */
function rearmPoint(s: DashboardState, index: number, world: World): Point {
  const hunter = world.targets[index];
  if (hunter.kind === "defender") return { x: hunter.col, y: hunter.row };
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
    if (!t || !isEnemyKind(t.kind) || s.ruins.includes(index) || s.rearming[index] || isHidden(s, index, world)) continue;
    if (s.time < (s.hunterReadyAt[index] ?? 0) || s.heldAttacks.includes(index)) continue;
    const p = positionOf(s, index, world);
    if (distanceTo(s.pos, p.x, p.y) <= range) return index;
  }
  return null;
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
        const opened = patrolOutage(openWindow(s, networkOf(station), world), networkOf(station), world);
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
      return { ...alertTo(s, alertHunters(s, world), world), zoom: "local", scan: scanFrom(s, world), pulseStarted: s.time };
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

export type DropKind = "energy" | "armour";

/**
 * What a building's drop is (design-notes 4.4): a comms centre's electronics give energy; a mine
 * gives ore, so armour or energy; a dome gives either. Drawn from the target index, so it is
 * fixed for the world and needs no extra draw from the map generator.
 */
export function dropKind(target: Target, index: number): DropKind {
  if (target.kind === "commsCentre") return "energy";
  return createRng(index * 7919 + 13)() < 0.5 ? "energy" : "armour";
}

/** Whether a drop would be wasted: energy at a full bank, armour with every plate whole. */
function wouldWaste(s: DashboardState, kind: DropKind, world: World): boolean {
  if (kind === "energy") return s.energyCells >= world.energyMax;
  return allWhole(s.plates, world.hitsPerPlate);
}

/** Energy adds cells; armour fully mends the weakest plates, broken ones first. */
function applyDrop(s: DashboardState, kind: DropKind, world: World): DashboardState {
  if (kind === "energy") return { ...s, energyCells: Math.min(world.energyMax, s.energyCells + world.energyDropCells) };
  return { ...s, plates: mendWeakest(s.plates, world.armourDropPlates, world.hitsPerPlate) };
}

/**
 * Collects any uncollected drop the robot is standing on. Pickup is automatic, not a verb. A
 * drop that would be wasted stays where it is, so the player can come back for it.
 */
function collectDrops(s: DashboardState, world: World): DashboardState {
  let next = s;
  for (const i of s.ruins) {
    const t = world.targets[i];
    if (!t.hasDrop || next.found.includes(i) || distanceTo(next.pos, t.col, t.row) > world.pickupRadius) continue;
    const kind = dropKind(t, i);
    if (wouldWaste(next, kind, world)) continue;
    next = { ...applyDrop(next, kind, world), found: [...next.found, i] };
  }
  return next;
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
