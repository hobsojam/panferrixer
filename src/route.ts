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

/** Every passable cell reachable from `start` (its own cell counts even if blocked). Keys are y * cols + x. */
export function reachableFrom(start: Cell, map: LocalMap, blocked: Blocked = NONE): Set<number> {
  const key = (x: number, y: number) => cellKey(map, x, y);
  const seen = new Set<number>([key(start.x, start.y)]);
  const queue: Cell[] = [start];
  for (let head = 0; head < queue.length; head++) {
    const cell = queue[head];
    for (const [dx, dy] of OFFSETS) {
      const nx = cell.x + dx;
      const ny = cell.y + dy;
      if (!isPassable(map, nx, ny, blocked) || seen.has(key(nx, ny))) continue;
      seen.add(key(nx, ny));
      queue.push({ x: nx, y: ny });
    }
  }
  return seen;
}

export const OFFSETS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

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
  const start = { x: Math.round(from.x), y: Math.round(from.y) };
  const key = (x: number, y: number) => cellKey(map, x, y);
  const goalKeys = new Set(goals.filter((g) => isPassable(map, g.x, g.y, blocked)).map((g) => key(g.x, g.y)));
  if (goalKeys.size === 0) return null;

  const startKey = key(start.x, start.y);
  if (goalKeys.has(startKey)) return [];
  const previous = new Map<number, number>([[startKey, startKey]]);
  const queue: Cell[] = [start];
  let reached: number | null = null;

  for (let head = 0; head < queue.length && reached === null; head++) {
    const cell = queue[head];
    for (const [dx, dy] of OFFSETS) {
      const nx = cell.x + dx;
      const ny = cell.y + dy;
      if (!isPassable(map, nx, ny, blocked)) continue;
      const nk = key(nx, ny);
      if (previous.has(nk)) continue;
      previous.set(nk, key(cell.x, cell.y));
      if (goalKeys.has(nk)) {
        reached = nk;
        break;
      }
      queue.push({ x: nx, y: ny });
    }
  }

  if (reached === null) return null;
  const route: Cell[] = [];
  let k = reached;
  while (k !== startKey) {
    route.push({ x: k % map.cols, y: Math.floor(k / map.cols) });
    k = previous.get(k)!;
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
