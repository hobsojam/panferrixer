import { reachableFrom } from "./route";
import { createRng } from "./rng";

/** 0 = valley, 1 = ground, 2 = high ground. */
export type Tier = 0 | 1 | 2;

export interface LocalMapConfig {
  worldSeed: number;
  cols: number;
  rows: number;
  smoothingPasses: number;
  valleyBelow: number; // raw height below this is a valley
  highAbove: number; // raw height above this is high ground
  targetsPerNode: number;
}

export interface LocalMap {
  cols: number;
  rows: number;
  tiers: Tier[][];
}

/**
 * A local patch of ground around one network node. Deterministic: the same world
 * seed and node always give the same patch, so it can be reproduced in tests.
 */
export function generateLocalMap(node: number, cfg: LocalMapConfig): LocalMap {
  const rng = createRng(cfg.worldSeed * 7919 + node * 104729);
  let heights: number[][] = Array.from({ length: cfg.rows }, () =>
    Array.from({ length: cfg.cols }, () => rng())
  );
  for (let pass = 0; pass < cfg.smoothingPasses; pass++) {
    heights = smooth(heights);
  }

  const tiers = heights.map((row) =>
    row.map((h): Tier => (h < cfg.valleyBelow ? 0 : h > cfg.highAbove ? 2 : 1))
  );
  const map: LocalMap = { cols: cfg.cols, rows: cfg.rows, tiers };

  // The robot starts in the middle and must be able to walk out to either side.
  const start = { x: Math.floor(cfg.cols / 2), y: Math.floor(cfg.rows / 2) };
  tiers[start.y][start.x] = tiers[start.y][start.x] === 2 ? 1 : tiers[start.y][start.x];
  openPassage(map, start, 0);
  openPassage(map, start, cfg.cols - 1);
  return map;
}

/**
 * Turns the fewest high-ground cells needed into ground so that the start can reach
 * the given edge column. Each step opens the high cell next to the reachable area
 * that is nearest the edge, and nearest the start row when tied.
 */
function openPassage(map: LocalMap, start: { x: number; y: number }, edgeX: number): void {
  for (;;) {
    const reached = reachableFrom(start, map);
    for (const key of reached) {
      if (key % map.cols === edgeX) return;
    }

    let best: { x: number; y: number } | null = null;
    let bestScore = Infinity;
    for (const key of reached) {
      const x = key % map.cols;
      const y = Math.floor(key / map.cols);
      for (const [nx, ny] of [
        [x + 1, y],
        [x - 1, y],
        [x, y + 1],
        [x, y - 1],
      ]) {
        if (nx < 0 || ny < 0 || nx >= map.cols || ny >= map.rows) continue;
        if (map.tiers[ny][nx] !== 2) continue;
        const score = Math.abs(nx - edgeX) * 1000 + Math.abs(ny - start.y);
        if (score < bestScore) {
          bestScore = score;
          best = { x: nx, y: ny };
        }
      }
    }
    if (best === null) return;
    map.tiers[best.y][best.x] = 1;
  }
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

/** Placeholder target kinds: the comms centre replaces the original beacon (design-notes 4.4). Art is not designed yet. */
export type TargetKind = "power" | "mine" | "commsCentre" | "dome";

export interface Target {
  col: number;
  row: number;
  kind: TargetKind;
}

const TARGET_KINDS: readonly TargetKind[] = ["power", "mine", "commsCentre", "dome"];

/**
 * Placeholder targets on a node's patch: on ground or high ground, never in a valley,
 * and distinct cells. Deterministic from the world seed and node.
 */
export function targetsFor(node: number, map: LocalMap, cfg: LocalMapConfig): Target[] {
  const rng = createRng(cfg.worldSeed * 6151 + node * 2111 + 1);
  const targets: Target[] = [];
  for (let attempt = 0; attempt < 500 && targets.length < cfg.targetsPerNode; attempt++) {
    const row = Math.floor(rng() * map.rows);
    const col = Math.floor(rng() * map.cols);
    if (map.tiers[row][col] === 0) continue;
    if (targets.some((t) => t.row === row && t.col === col)) continue;
    const kind = TARGET_KINDS[Math.floor(rng() * TARGET_KINDS.length)];
    targets.push({ col, row, kind });
  }
  return targets;
}
