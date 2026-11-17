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
