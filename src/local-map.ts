import { NETWORK } from "./map";
import { reachableFrom, type Cell } from "./route";
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
  targetsPerTown: number;
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
export type TargetKind = "power" | "mine" | "commsCentre" | "dome";

export interface Target {
  col: number;
  row: number;
  kind: TargetKind;
}

export interface World {
  map: LocalMap;
  towns: Town[];
  targets: Target[];
}

const TARGET_KINDS: readonly TargetKind[] = ["power", "mine", "commsCentre", "dome"];

const OFFSETS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

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

/** Placeholder targets inside the towns: never in a valley, and distinct cells. */
function placeTargets(map: LocalMap, towns: Town[], cfg: LocalMapConfig): Target[] {
  const rng = createRng(cfg.worldSeed * 6151 + 1);
  const targets: Target[] = [];
  for (const town of towns) {
    let placed = 0;
    for (let attempt = 0; attempt < 500 && placed < cfg.targetsPerTown; attempt++) {
      const col = town.x + Math.round((rng() * 2 - 1) * cfg.townRadiusCols);
      const row = town.y + Math.round((rng() * 2 - 1) * cfg.townRadiusRows);
      if (!inTown(town, cfg.townRadiusCols, cfg.townRadiusRows, col, row)) continue;
      if (map.tiers[row][col] === 0) continue;
      if (targets.some((t) => t.col === col && t.row === row)) continue;
      const kind = TARGET_KINDS[Math.floor(rng() * TARGET_KINDS.length)];
      targets.push({ col, row, kind });
      placed += 1;
    }
  }
  return targets;
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
