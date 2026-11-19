import { NETWORK } from "./map";
import { cellKey, isPassable, OFFSETS, reachableFrom, type Cell } from "./route";
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
  dropChance: number; // chance that a building holds a drop
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
export type TargetKind = "power" | "hunter" | "defender" | "mine" | "commsCentre" | "dome";

export interface Target {
  col: number;
  row: number;
  kind: TargetKind;
  hasDrop: boolean; // the drop is hidden under the building; found only once it is destroyed
  network: number; // the town (network) it was placed in. Towns can overlap, so position alone does not say
  home?: number; // a defender's dome (target index); its col and row are the free cell beside it, its post
}

/** True for the enemies: they move, have no shields and are not buildings. */
export function isEnemyKind(kind: TargetKind): boolean {
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
      if (isHunter && !reachableFrom(towns[0], map).has(cellKey(map, col, row))) continue;
      if (!isHunter && !keepsRoutesOpen(map, towns, [...targets.filter((t) => !isEnemyKind(t.kind)), { col, row }])) continue;
      // Each network has one power station, placed first. It is never a drop: it cannot be destroyed.
      // The hunter, placed second, is the network's guard on duty. It has no drop.
      const step = plan[placed];
      const kind: TargetKind = step === "other" ? OTHER_KINDS[Math.floor(rng() * OTHER_KINDS.length)] : step;
      const hasDrop = rng() < cfg.dropChance && kind !== "power" && kind !== "hunter";
      targets.push({ col, row, kind, hasDrop, network });
      placed += 1;
    }
  }
  return [...targets, ...placeDefenders(map, towns, targets, cfg)];
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
      defenders.push({ ...post, kind: "defender", hasDrop: false, network, home: i });
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
  const reached = reachableFrom(towns[0], map, blocked);
  if (!towns.every((t) => reached.has(cellKey(map, t.x, t.y)))) return false;
  return buildings.every((b) => OFFSETS.some(([dx, dy]) => reached.has(cellKey(map, b.col + dx, b.row + dy)) && isPassable(map, b.col + dx, b.row + dy, blocked)));
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
