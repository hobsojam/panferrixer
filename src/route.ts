import type { LocalMap } from "./local-map";

export interface Cell {
  x: number;
  y: number;
}

/** Extra cells that block on top of the terrain, such as intact buildings. Keys are y * cols + x (see `cellKey`). */
export type Blocked = ReadonlySet<number>;

const NONE: Blocked = new Set<number>();

/** The key a cell has in a `Blocked` set. */
export function cellKey(map: LocalMap, x: number, y: number): number {
  return y * map.cols + x;
}

/**
 * High ground blocks the robot, and so does any cell in `blocked`. Valleys and ground
 * are passable. Enemies route with no `blocked` set: they may pass through buildings.
 */
export function isPassable(map: LocalMap, x: number, y: number, blocked: Blocked = NONE): boolean {
  return x >= 0 && y >= 0 && x < map.cols && y < map.rows && map.tiers[y][x] !== 2 && !blocked.has(cellKey(map, x, y));
}

/**
 * Every passable cell reachable from `start` (its own cell counts even if blocked). Keys are
 * y * cols + x, in the order the search reached them, nearest first.
 */
export function reachableFrom(start: Cell, map: LocalMap, blocked: Blocked = NONE): Set<number> {
  const { order, count } = flood(start, map, blocked);
  const seen = new Set<number>();
  for (let i = 0; i < count; i++) seen.add(order[i]);
  return seen;
}

/**
 * The same cells as reachableFrom, as a mask indexed by cell key: 1 where reachable. Cheaper
 * when only membership is needed, such as when every building placement is checked.
 */
export function reachableMask(start: Cell, map: LocalMap, blocked: Blocked = NONE): Uint8Array {
  return flood(start, map, blocked).seen;
}

export const OFFSETS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

// OFFSETS as two arrays, for the searches below. The order matters: it settles ties between
// equally short routes, so it must stay the same as OFFSETS.
const DX = OFFSETS.map(([dx]) => dx);
const DY = OFFSETS.map(([, dy]) => dy);

/** The blocked cells as a mask indexed by cell key, or null when nothing is blocked. */
function blockedMask(map: LocalMap, blocked: Blocked): Uint8Array | null {
  if (blocked.size === 0) return null;
  const mask = new Uint8Array(map.cols * map.rows);
  for (const k of blocked) if (k >= 0 && k < mask.length) mask[k] = 1;
  return mask;
}

/**
 * Breadth-first search over the passable cells from a start cell. Visited cells are kept in a
 * byte mask and the queue as cell keys, not in a Set of objects: this search sits under all
 * the routing and world generation, which runs it thousands of times per world.
 */
function flood(start: Cell, map: LocalMap, blocked: Blocked): { seen: Uint8Array; order: Int32Array; count: number } {
  const { cols, rows, tiers } = map;
  const n = cols * rows;
  const stop = blockedMask(map, blocked);
  const seen = new Uint8Array(n);
  const order = new Int32Array(n + 1); // every cell at most once, plus a start that is not itself passable
  const startKey = cellKey(map, start.x, start.y);
  order[0] = startKey;
  if (startKey >= 0 && startKey < n) seen[startKey] = 1;
  let count = 1;
  for (let head = 0; head < count; head++) {
    const k = order[head];
    const x = head === 0 ? start.x : k % cols;
    const y = head === 0 ? start.y : (k - x) / cols;
    for (let d = 0; d < 4; d++) {
      const nx = x + DX[d];
      const ny = y + DY[d];
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || tiers[ny][nx] === 2) continue;
      const nk = ny * cols + nx;
      if (seen[nk] || (stop !== null && stop[nk])) continue;
      seen[nk] = 1;
      order[count++] = nk;
    }
  }
  return { seen, order, count };
}

/**
 * Shortest walk across the cell grid (four directions), never entering high ground or a
 * blocked cell. `from` may be a continuous position; it is rounded to its cell. Returns
 * the cells to step through after the start, ending at `to`, or [] if already there,
 * or null if the destination is impassable or cannot be reached.
 */
export function findRoute(from: Cell, to: Cell, map: LocalMap, blocked: Blocked = NONE): Cell[] | null {
  return findRouteToAny(from, [to], map, blocked);
}

/**
 * Shortest walk to whichever of `goals` is nearest by route. Impassable goals are
 * ignored. Returns null if no goal can be reached, or [] if the start is a goal.
 */
export function findRouteToAny(from: Cell, goals: readonly Cell[], map: LocalMap, blocked: Blocked = NONE): Cell[] | null {
  const { cols, rows, tiers } = map;
  const n = cols * rows;
  const start = { x: Math.round(from.x), y: Math.round(from.y) };
  const goal = new Uint8Array(n);
  let anyGoal = false;
  for (const g of goals) {
    if (!isPassable(map, g.x, g.y, blocked)) continue;
    goal[cellKey(map, g.x, g.y)] = 1;
    anyGoal = true;
  }
  if (!anyGoal) return null;

  const startKey = cellKey(map, start.x, start.y);
  if (goal[startKey] === 1) return [];
  const stop = blockedMask(map, blocked);
  // The cell each was first reached from: -1 for none yet. The start points at itself.
  const previous = new Int32Array(n).fill(-1);
  if (startKey >= 0 && startKey < n) previous[startKey] = startKey;
  const queue = new Int32Array(n + 1);
  queue[0] = startKey;
  let count = 1;
  let reached = -1;

  for (let head = 0; head < count && reached === -1; head++) {
    const k = queue[head];
    const x = head === 0 ? start.x : k % cols;
    const y = head === 0 ? start.y : (k - x) / cols;
    for (let d = 0; d < 4; d++) {
      const nx = x + DX[d];
      const ny = y + DY[d];
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || tiers[ny][nx] === 2) continue;
      const nk = ny * cols + nx;
      if (previous[nk] !== -1 || (stop !== null && stop[nk])) continue;
      previous[nk] = k;
      if (goal[nk] === 1) {
        reached = nk;
        break;
      }
      queue[count++] = nk;
    }
  }

  if (reached === -1) return null;
  const route: Cell[] = [];
  let k = reached;
  while (k !== startKey) {
    route.push({ x: k % cols, y: Math.floor(k / cols) });
    k = previous[k];
  }
  return route.reverse();
}

/** Walks along a route for up to `distance` cells. Returns where it ends up and the route still to go. */
export function walkPoint(pos: Cell, route: readonly Cell[], distance: number): { pos: Cell; route: Cell[] } {
  let p = { ...pos };
  let r = [...route];
  let budget = distance;
  while (budget > 0 && r.length > 0) {
    const next = r[0];
    const dx = next.x - p.x;
    const dy = next.y - p.y;
    const d = Math.hypot(dx, dy);
    if (d <= budget) {
      p = { ...next };
      r = r.slice(1);
      budget -= d;
    } else {
      p = { x: p.x + (dx / d) * budget, y: p.y + (dy / d) * budget };
      budget = 0;
    }
  }
  return { pos: p, route: r };
}
