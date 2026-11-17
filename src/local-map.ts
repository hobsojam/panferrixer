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
  return { cols: cfg.cols, rows: cfg.rows, tiers };
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

/** Placeholder target kinds named in design-notes 2.8. Their art is not designed yet. */
export type TargetKind = "power" | "mine" | "beacon" | "dome";

export interface Target {
  col: number;
  row: number;
  kind: TargetKind;
}

const TARGET_KINDS: readonly TargetKind[] = ["power", "mine", "beacon", "dome"];

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
