import type { LocalMap } from "./local-map";
import { cellKey, findRoute, reachableFrom, walkPoint, type Cell } from "./route";

/**
 * Where a ground enemy heads for a goal: the goal itself when it can be walked to, or else
 * the cell nearest it on the enemy's own side of the high ground. Enemies route over the
 * terrain alone: they may pass through buildings (design-notes 4.7) but never high ground.
 * Ties go to the lowest cell key, so the choice is deterministic. Returns null only if the
 * enemy stands on high ground with no passable cell beside it, which placement rules out.
 */
export function reachableGoal(from: Cell, goal: Cell, map: LocalMap): Cell | null {
  const start = { x: Math.round(from.x), y: Math.round(from.y) };
  if (findRoute(start, goal, map) !== null) return goal;
  let best: Cell | null = null;
  let bestDistance = Infinity;
  const reached = [...reachableFrom(start, map)].sort((a, b) => a - b);
  for (const k of reached) {
    const cell = { x: k % map.cols, y: Math.floor(k / map.cols) };
    if (map.tiers[cell.y][cell.x] === 2) continue; // the start cell is listed even if impassable
    const d = Math.hypot(cell.x - goal.x, cell.y - goal.y);
    if (d < bestDistance) {
      best = cell;
      bestDistance = d;
    }
  }
  return best;
}

/** True if a ground enemy at `from` can walk to `to` without crossing high ground. */
export function canWalk(from: Cell, to: Cell, map: LocalMap): boolean {
  const start = { x: Math.round(from.x), y: Math.round(from.y) };
  return reachableFrom(start, map).has(cellKey(map, to.x, to.y)) && map.tiers[to.y][to.x] !== 2;
}

/**
 * Moves a ground enemy up to `distance` cells toward `goal` along the terrain (four
 * directions, never onto high ground). An unreachable goal is swapped for the nearest
 * cell the enemy can reach, so it waits at the edge rather than tunnelling, and tries
 * again on the next step. Arrival is exact: the enemy ends on the cell, not a rounding
 * error short of it.
 */
export function stepToward(here: Cell, goal: Cell, map: LocalMap, distance: number): Cell {
  const end = reachableGoal(here, goal, map);
  if (end === null) return here;
  const route = findRoute(here, end, map) ?? [];
  // An enemy already in its end cell still walks the last fraction of a cell to its centre.
  const walked = walkPoint(here, route.length > 0 ? route : [end], distance);
  return walked.route.length === 0 ? { x: end.x, y: end.y } : walked.pos;
}
