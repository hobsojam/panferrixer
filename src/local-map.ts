import { NETWORK } from "./map";
import { cellKey, findRoute, isPassable, OFFSETS, reachableFrom, reachableMask, type Cell } from "./route";
import { createRng } from "./rng";

/** 0 = valley, 1 = ground, 2 = high ground. */
export type Tier = 0 | 1 | 2;

export interface LocalMapConfig {
  worldSeed: number;
  cols: number; // the whole map, in cells
  rows: number;
  townRadiusCols: number; // half-size of a town's area, in cells
  townRadiusRows: number;
  smoothingPasses: number;
  valleyBelow: number; // raw height below this is a valley
  highAbove: number; // raw height above this is high ground
  domesPerTown: number; // at least as many as the most defenders a network can draw (design-notes 4.4)
  otherBuildingsPerTown: number; // mines and comms centres, drawn at random
  defendersMax: number; // each network draws 0 to this many defenders, one per dome at most
  // Supplies (design-notes 4.4): for each kind, building or enemy, how many units of each supply
  // it can hold at most, and the chance of each unit, rolled independently. A ruin or wreck may
  // hold nothing, or several units of several supplies. Kinds and supplies not listed hold none.
  supplyChances: Partial<Record<TargetKind, Partial<Record<Supply, SupplyRoll>>>>;
  // Parts (design-notes 4.4): a fixed set placed over the world, not rolled per building.
  partCount: number; // how many parts the world holds
  partWeights: Partial<Record<TargetKind, number>>; // how likely each building kind is to be chosen; kinds not listed are never chosen
  partsPerNetworkMax: number; // no network holds more than this many, so they spread out
  // Patrollers (#66) walk wide beats across the map, a few in each segment of a grid laid over it.
  patrolSegmentsAcross: number;
  patrolSegmentsDown: number;
  patrollersPerSegment: number;
  patrolBeatPoints: number; // waypoints on each patroller's loop
  patrolBeatSpacing: number; // waypoints on one loop are at least this many cells apart
  startTown: number; // the town where the robot begins
  patrolStartClearCells: number; // no beat comes this close to the start town's centre
  viewCols: number; // the mini map's local window
  viewRows: number;
}

export interface LocalMap {
  cols: number;
  rows: number;
  tiers: Tier[][];
}

/** A town is a place on the map: its centre cell. Its area is an ellipse around the centre. */
export interface Town {
  x: number;
  y: number;
}

/** Placeholder target kinds: the comms centre replaces the original beacon (design-notes 4.4). Art is not designed yet. */
export type TargetKind = "power" | "hunter" | "defender" | "patroller" | "mine" | "commsCentre" | "dome";

/** The supplies a ruin can hold. Parts are not rolled: they are a fixed set, placed (design-notes 4.4). */
export type Supply = "energy" | "armour" | "missiles";
export const SUPPLIES: readonly Supply[] = ["energy", "armour", "missiles"];

/**
 * Up to `max` units of a supply: the first `min` (none if missing) are always there, and each
 * of the rest is there with `chance`. A unit is one cell, one plate mended or one missile.
 */
export interface SupplyRoll {
  min?: number;
  max: number;
  chance: number;
}

export interface Target {
  col: number;
  row: number;
  kind: TargetKind;
  supplies: Supply[]; // one entry per unit, hidden in the building or enemy; found only once it is destroyed
  part?: number; // which part (0 to partCount - 1) lies under the building, if any; hidden like supplies
  network: number; // the town (network) it was placed in. Towns can overlap, so position alone does not say
  home?: number; // a defender's dome (target index); its col and row are the free cell beside it, its post
  beat?: Cell[]; // a patroller's loop of waypoints; its col and row are the first, where it starts
}

/** True for the enemies: they move, have no shields and are not buildings. */
export function isEnemyKind(kind: TargetKind): boolean {
  return kind === "hunter" || kind === "defender" || kind === "patroller";
}

/** True for the enemies that carry weapons worth calling for help: not the patroller's light guns. */
export function isArmedHelper(kind: TargetKind): boolean {
  return kind === "hunter" || kind === "defender";
}

export interface World {
  map: LocalMap;
  towns: Town[];
  targets: Target[];
}

/** The other buildings a town may have besides its power station and domes. */
const OTHER_KINDS: readonly TargetKind[] = ["mine", "commsCentre"];

/** Where each town sits: the network's hand-placed positions, spread over the whole map. */
export function townCentres(cfg: LocalMapConfig): Town[] {
  const marginX = cfg.townRadiusCols + 1;
  const marginY = cfg.townRadiusRows + 1;
  return NETWORK.nodes.map((n) => ({
    x: Math.round(marginX + n.x * (cfg.cols - 1 - 2 * marginX)),
    y: Math.round(marginY + n.y * (cfg.rows - 1 - 2 * marginY)),
  }));
}

/** True when (x, y) is inside the town's elliptical area. */
export function inTown(town: Town, radiusCols: number, radiusRows: number, x: number, y: number): boolean {
  const dx = (x - town.x) / radiusCols;
  const dy = (y - town.y) / radiusRows;
  return dx * dx + dy * dy <= 1;
}

/**
 * The whole map: one terrain grid with a town at each network node. Deterministic
 * from the world seed, so the same world is rebuilt every time it is needed.
 * Towns are valley or ground. Afterwards the fewest high-ground cells needed are
 * opened so every town can be walked to from every other.
 */
export function generateWorld(cfg: LocalMapConfig): World {
  const rng = createRng(cfg.worldSeed * 7919);
  let heights: number[][] = Array.from({ length: cfg.rows }, () =>
    Array.from({ length: cfg.cols }, () => rng())
  );
  for (let pass = 0; pass < cfg.smoothingPasses; pass++) {
    heights = smooth(heights);
  }

  const tiers: Tier[][] = heights.map((row) =>
    row.map((h): Tier => (h < cfg.valleyBelow ? 0 : h > cfg.highAbove ? 2 : 1))
  );
  const map: LocalMap = { cols: cfg.cols, rows: cfg.rows, tiers };
  const towns = townCentres(cfg);

  for (const town of towns) {
    for (let y = town.y - cfg.townRadiusRows; y <= town.y + cfg.townRadiusRows; y++) {
      for (let x = town.x - cfg.townRadiusCols; x <= town.x + cfg.townRadiusCols; x++) {
        if (inTown(town, cfg.townRadiusCols, cfg.townRadiusRows, x, y) && tiers[y][x] === 2) tiers[y][x] = 1;
      }
    }
  }

  connectTowns(map, towns);
  return { map, towns, targets: placeTargets(map, towns, cfg) };
}

/** Repeatedly opens the cheapest route from the connected towns to one that is cut off. */
function connectTowns(map: LocalMap, towns: Town[]): void {
  const key = (x: number, y: number) => y * map.cols + x;
  for (;;) {
    const reached = reachableFrom(towns[0], map);
    const unreached = towns.filter((t) => !reached.has(key(t.x, t.y)));
    if (unreached.length === 0) return;

    const sources: Cell[] = [...reached].map((k) => ({ x: k % map.cols, y: Math.floor(k / map.cols) }));
    const goals = new Set(unreached.map((t) => key(t.x, t.y)));
    const path = cheapestPath(map, sources, (x, y) => goals.has(key(x, y)));
    if (path === null) return;
    for (const c of path) {
      if (map.tiers[c.y][c.x] === 2) map.tiers[c.y][c.x] = 1;
    }
  }
}

/**
 * Least high-ground route from any source cell to a goal cell. Entering high ground
 * costs one, anything else costs nothing. Returns the cells from source to goal.
 */
function cheapestPath(map: LocalMap, sources: Cell[], isGoal: (x: number, y: number) => boolean): Cell[] | null {
  const key = (x: number, y: number) => y * map.cols + x;
  const dist = new Map<number, number>();
  const prev = new Map<number, number>();
  let frontier: Cell[] = [];
  for (const s of sources) {
    dist.set(key(s.x, s.y), 0);
    prev.set(key(s.x, s.y), key(s.x, s.y));
    frontier.push(s);
  }

  for (let d = 0; frontier.length > 0; d++) {
    const next: Cell[] = [];
    for (let i = 0; i < frontier.length; i++) {
      const cell = frontier[i];
      const k = key(cell.x, cell.y);
      if (dist.get(k) !== d) continue;
      if (isGoal(cell.x, cell.y)) {
        const path: Cell[] = [];
        let cur = k;
        while (prev.get(cur) !== cur) {
          path.push({ x: cur % map.cols, y: Math.floor(cur / map.cols) });
          cur = prev.get(cur)!;
        }
        path.push({ x: cur % map.cols, y: Math.floor(cur / map.cols) });
        return path.reverse();
      }
      for (const [dx, dy] of OFFSETS) {
        const nx = cell.x + dx;
        const ny = cell.y + dy;
        if (nx < 0 || ny < 0 || nx >= map.cols || ny >= map.rows) continue;
        const nk = key(nx, ny);
        const cost = map.tiers[ny][nx] === 2 ? 1 : 0;
        const nd = d + cost;
        if (!dist.has(nk) || dist.get(nk)! > nd) {
          dist.set(nk, nd);
          prev.set(nk, k);
          (cost === 0 ? frontier : next).push({ x: nx, y: ny });
        }
      }
    }
    frontier = next;
  }
  return null;
}

/**
 * The targets inside the towns: never in a valley, and distinct cells. Each town gets its power
 * station, its hunter, its domes and a few other buildings (#62), then each network's garrison
 * (design-notes 4.4) is hidden in its domes.
 */
function placeTargets(map: LocalMap, towns: Town[], cfg: LocalMapConfig): Target[] {
  const rng = createRng(cfg.worldSeed * 6151 + 1);
  const targets: Target[] = [];
  // Where a hunter may stand: the terrain no longer changes once the towns are joined, so this
  // is worked out once, not for every cell a hunter is tried on.
  const walkable = reachableMask(towns[0], map);
  const plan: readonly ("power" | "hunter" | "dome" | "other")[] = [
    "power",
    "hunter",
    ...Array<"dome">(cfg.domesPerTown).fill("dome"),
    ...Array<"other">(cfg.otherBuildingsPerTown).fill("other"),
  ];
  for (let network = 0; network < towns.length; network++) {
    const town = towns[network];
    let placed = 0;
    for (let attempt = 0; attempt < 500 && placed < plan.length; attempt++) {
      const col = town.x + Math.round((rng() * 2 - 1) * cfg.townRadiusCols);
      const row = town.y + Math.round((rng() * 2 - 1) * cfg.townRadiusRows);
      if (!inTown(town, cfg.townRadiusCols, cfg.townRadiusRows, col, row)) continue;
      if (map.tiers[row][col] === 0) continue;
      if (targets.some((t) => t.col === col && t.row === row)) continue;
      // Buildings block the robot, so a building may not cut off a town or another building.
      // The hunter is not a building and may stand anywhere on ground the robot can walk to,
      // but never on high ground, which blocks enemies too.
      const isHunter = plan[placed] === "hunter";
      if (isHunter && walkable[cellKey(map, col, row)] !== 1) continue;
      if (!isHunter && !keepsRoutesOpen(map, towns, [...targets.filter((t) => !isEnemyKind(t.kind)), { col, row }])) continue;
      // Each network has one power station, placed first, then its hunter, the guard on duty.
      const step = plan[placed];
      const kind: TargetKind = step === "other" ? OTHER_KINDS[Math.floor(rng() * OTHER_KINDS.length)] : step;
      // This draw once rolled a single drop chance. Supplies now have their own stream (rollSupplies),
      // but the draw stays so every world's layout is unchanged.
      rng();
      targets.push({ col, row, kind, supplies: [], network });
      placed += 1;
    }
  }
  const withGarrisons = [...placeParts(map, towns, targets, cfg), ...placeDefenders(map, towns, targets, cfg)];
  return rollSupplies([...withGarrisons, ...placePatrollers(map, towns, withGarrisons, cfg)], cfg);
}

/**
 * What each building and enemy holds (design-notes 4.4): every unit of every supply is rolled on
 * its own, from its kind's chances, so the kind shapes what is likely without making anything
 * certain. A building's ruin and an enemy's wreck are searched alike. Kinds not in the table,
 * such as the power station (it cannot be destroyed) and the patroller, hold nothing. Drawn from
 * its own stream, so changing the chances moves nothing else on the map.
 */
function rollSupplies(targets: readonly Target[], cfg: LocalMapConfig): Target[] {
  const rng = createRng(cfg.worldSeed * 3571 + 9);
  return targets.map((t) => {
    const rolls = cfg.supplyChances[t.kind] ?? {};
    const supplies: Supply[] = [];
    for (const supply of SUPPLIES) {
      const roll = rolls[supply];
      if (roll === undefined) continue;
      const min = roll.min ?? 0;
      for (let unit = 0; unit < roll.max; unit++) if (unit < min || rng() < roll.chance) supplies.push(supply);
    }
    return { ...t, supplies };
  });
}

/**
 * Where the parts lie (design-notes 4.4): a fixed set of `partCount`, placed rather than rolled,
 * so the set is always complete and never duplicated. At most one per building; none in the
 * starting town, so the first part takes some exploring; no more than `partsPerNetworkMax` in any
 * network, so they spread out without a "one per town" pattern; and only in a building whose
 * ruin can be walked to while every other building still stands. Buildings are chosen at random,
 * weighted by kind (domes are the haystack). Drawn from its own stream, so nothing else moves.
 * If too few buildings qualify, fewer parts are placed; the tests hold the default world to the
 * full set.
 */
function placeParts(map: LocalMap, towns: Town[], targets: readonly Target[], cfg: LocalMapConfig): Target[] {
  const rng = createRng(cfg.worldSeed * 5227 + 11);
  const blocked = new Set(targets.filter((t) => !isEnemyKind(t.kind)).map((t) => cellKey(map, t.col, t.row)));
  const walkable = reachableMask(towns[cfg.startTown], map, blocked);
  const reachable = (t: Target) =>
    OFFSETS.some(([dx, dy]) => {
      const x = t.col + dx;
      const y = t.row + dy;
      return x >= 0 && y >= 0 && x < map.cols && y < map.rows && walkable[cellKey(map, x, y)] === 1;
    });
  let candidates = targets
    .map((t, index) => ({ index, weight: cfg.partWeights[t.kind] ?? 0, network: t.network }))
    .filter((c) => c.weight > 0 && c.network !== cfg.startTown && reachable(targets[c.index]));
  const perNetwork = new Map<number, number>();
  const parts = new Map<number, number>(); // target index to part
  while (parts.size < cfg.partCount && candidates.length > 0) {
    const total = candidates.reduce((sum, c) => sum + c.weight, 0);
    let pick = rng() * total;
    const chosen = candidates.find((c) => (pick -= c.weight) < 0) ?? candidates[candidates.length - 1];
    parts.set(chosen.index, parts.size);
    const count = (perNetwork.get(chosen.network) ?? 0) + 1;
    perNetwork.set(chosen.network, count);
    candidates = candidates.filter((c) => c !== chosen && (c.network !== chosen.network || count < cfg.partsPerNetworkMax));
  }
  return targets.map((t, index) => (parts.has(index) ? { ...t, part: parts.get(index) } : t));
}

/**
 * The patrollers (#66): the hunter guards its network, so patrollers cover the ground between.
 * The map is split into a grid of segments, and each segment gets a few patrollers, each walking
 * its own loop of waypoints spread across the segment, ordered round the segment's centre so the
 * loop does not cross itself. Waypoints are open ground (never high ground or a building) that
 * can be walked to from the towns. No loop, waypoints or the routes between them, comes near the
 * town where the robot begins, so the game opens in a quiet corner and the player gets the first
 * look. A segment with too little open ground gets a shorter loop, or none. Drawn from its own
 * stream, so nothing else moves when the patrol rules change.
 */
function placePatrollers(map: LocalMap, towns: Town[], targets: readonly Target[], cfg: LocalMapConfig): Target[] {
  const rng = createRng(cfg.worldSeed * 2741 + 5);
  const reached = reachableFrom(towns[0], map);
  const occupied = new Set(targets.map((t) => cellKey(map, t.col, t.row)));
  const segW = map.cols / cfg.patrolSegmentsAcross;
  const segH = map.rows / cfg.patrolSegmentsDown;
  const start = towns[cfg.startTown] ?? towns[0];
  const clear = (c: Cell) => Math.hypot(c.x - start.x, c.y - start.y) > cfg.patrolStartClearCells;
  const patrollers: Target[] = [];
  for (let sy = 0; sy < cfg.patrolSegmentsDown; sy++) {
    for (let sx = 0; sx < cfg.patrolSegmentsAcross; sx++) {
      const x0 = Math.floor(sx * segW);
      const y0 = Math.floor(sy * segH);
      const x1 = Math.floor((sx + 1) * segW) - 1;
      const y1 = Math.floor((sy + 1) * segH) - 1;
      const centre = { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
      for (let p = 0; p < cfg.patrollersPerSegment; p++) {
        let beat: Cell[] = [];
        // A loop whose walk between waypoints strays near the start town is drawn again.
        for (let tries = 0; tries < 30; tries++) {
          beat = drawBeat();
          if (beat.length >= 2 && loopStaysClear(beat, map, start, clear)) break;
          beat = [];
        }
        if (beat.length < 2) continue;
        const first = beat[0];
        occupied.add(cellKey(map, first.x, first.y));
        patrollers.push({ col: first.x, row: first.y, kind: "patroller", supplies: [], network: nearestTown(towns, first), beat });

        /** Waypoints spread across the segment, ordered round its centre. */
        function drawBeat(): Cell[] {
          const points: Cell[] = [];
          for (let attempt = 0; attempt < 400 && points.length < cfg.patrolBeatPoints; attempt++) {
            const x = x0 + Math.floor(rng() * (x1 - x0 + 1));
            const y = y0 + Math.floor(rng() * (y1 - y0 + 1));
            const k = cellKey(map, x, y);
            if (!reached.has(k) || !isPassable(map, x, y) || occupied.has(k) || !clear({ x, y })) continue;
            if (points.some((c) => Math.hypot(c.x - x, c.y - y) < cfg.patrolBeatSpacing)) continue;
            points.push({ x, y });
          }
          return points.sort((a, b) => Math.atan2(a.y - centre.y, a.x - centre.x) - Math.atan2(b.y - centre.y, b.x - centre.x));
        }
      }
    }
  }
  return patrollers;
}

/**
 * True when every cell walked round a loop is clear: the same answer as checking all of
 * walkedCells, but cheaper when it is false. The legs whose straight line passes nearest the
 * start are routed first, and the first leg that strays ends the check, so a rejected loop
 * usually costs one route search instead of one per leg.
 */
function loopStaysClear(beat: readonly Cell[], map: LocalMap, start: Cell, clear: (c: Cell) => boolean): boolean {
  if (!beat.every(clear)) return false;
  const legs = beat.map((from, i) => ({ from, to: beat[(i + 1) % beat.length] }));
  legs.sort((a, b) => distanceToSegment(start, a.from, a.to) - distanceToSegment(start, b.from, b.to));
  return legs.every(({ from, to }) => (findRoute(from, to, map) ?? []).every(clear));
}

/** Straight-line distance from a point to the segment between two cells. */
function distanceToSegment(p: Cell, a: Cell, b: Cell): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length2 = dx * dx + dy * dy;
  const t = length2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Every cell walked round a loop: the terrain route from each waypoint to the next. */
export function walkedCells(beat: readonly Cell[], map: LocalMap): Cell[] {
  const cells: Cell[] = [...beat];
  beat.forEach((from, i) => {
    cells.push(...(findRoute(from, beat[(i + 1) % beat.length], map) ?? []));
  });
  return cells;
}

/** The index of the town nearest a cell: a patroller belongs to no network, but every target names one. */
function nearestTown(towns: readonly Town[], c: Cell): number {
  let best = 0;
  towns.forEach((t, i) => {
    if (Math.hypot(t.x - c.x, t.y - c.y) < Math.hypot(towns[best].x - c.x, towns[best].y - c.y)) best = i;
  });
  return best;
}

/**
 * Each network's garrison (design-notes 4.4): from 0 to defendersMax defenders, the number drawn
 * per network, each in a different dome chosen at random. A defender's post is a free cell beside
 * its dome that can be walked to from the towns, where it comes out of the door when woken. A
 * network that draws more defenders than it has domes with a free cell places only as many as fit.
 * Drawn from its own stream, so the buildings do not move when the garrison rules change.
 */
function placeDefenders(map: LocalMap, towns: Town[], buildings: readonly Target[], cfg: LocalMapConfig): Target[] {
  const rng = createRng(cfg.worldSeed * 4241 + 3);
  const blocked = new Set(buildings.filter((t) => !isEnemyKind(t.kind)).map((t) => cellKey(map, t.col, t.row)));
  const reached = reachableFrom(towns[0], map, blocked);
  const defenders: Target[] = [];
  for (let network = 0; network < towns.length; network++) {
    const count = Math.floor(rng() * (cfg.defendersMax + 1));
    const domes = buildings.map((t, i) => ({ t, i })).filter(({ t }) => t.kind === "dome" && t.network === network);
    // Shuffle (Fisher-Yates), so which domes are occupied is random.
    for (let i = domes.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [domes[i], domes[j]] = [domes[j], domes[i]];
    }
    let placed = 0;
    for (const { t, i } of domes) {
      if (placed >= count) break;
      const post = OFFSETS.map(([dx, dy]) => ({ col: t.col + dx, row: t.row + dy })).find(
        (c) => reached.has(cellKey(map, c.col, c.row)) && isPassable(map, c.col, c.row, blocked)
      );
      if (!post) continue;
      defenders.push({ ...post, kind: "defender", supplies: [], network, home: i });
      placed += 1;
    }
  }
  return defenders;
}

/**
 * The player's routes survive these buildings (design-notes 4.7): no building sits on a
 * town centre, every town can still be walked to from the first, and every building
 * has a free cell beside it that the robot can reach. Enemies need no such check.
 */
export function keepsRoutesOpen(map: LocalMap, towns: readonly Town[], buildings: readonly { col: number; row: number }[]): boolean {
  if (buildings.some((b) => towns.some((t) => t.x === b.col && t.y === b.row))) return false;
  const blocked = new Set(buildings.map((b) => cellKey(map, b.col, b.row)));
  const reached = reachableMask(towns[0], map, blocked);
  const has = (x: number, y: number) => x >= 0 && y >= 0 && x < map.cols && y < map.rows && reached[cellKey(map, x, y)] === 1;
  if (!towns.every((t) => has(t.x, t.y))) return false;
  return buildings.every((b) => OFFSETS.some(([dx, dy]) => has(b.col + dx, b.row + dy) && isPassable(map, b.col + dx, b.row + dy, blocked)));
}

/** Averages each cell with its neighbours, clamping at the edges. */
function smooth(grid: number[][]): number[][] {
  const rows = grid.length;
  const cols = grid[0].length;
  return grid.map((row, r) =>
    row.map((_, c) => {
      let sum = 0;
      let count = 0;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const rr = Math.min(rows - 1, Math.max(0, r + dr));
          const cc = Math.min(cols - 1, Math.max(0, c + dc));
          sum += grid[rr][cc];
          count += 1;
        }
      }
      return sum / count;
    })
  );
}
