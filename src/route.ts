import type { LocalMap } from "./local-map";

export interface Cell {
  x: number;
  y: number;
}

/** High ground blocks the robot (and, later, enemies). Valleys and ground are passable. */
export function isPassable(map: LocalMap, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < map.cols && y < map.rows && map.tiers[y][x] !== 2;
}

/** Every passable cell reachable from `start` (its own cell counts even if high). Keys are y * cols + x. */
export function reachableFrom(start: Cell, map: LocalMap): Set<number> {
  const key = (x: number, y: number) => y * map.cols + x;
  const seen = new Set<number>([key(start.x, start.y)]);
  const queue: Cell[] = [start];
  for (let head = 0; head < queue.length; head++) {
    const cell = queue[head];
    for (const [dx, dy] of OFFSETS) {
      const nx = cell.x + dx;
      const ny = cell.y + dy;
      if (!isPassable(map, nx, ny) || seen.has(key(nx, ny))) continue;
      seen.add(key(nx, ny));
      queue.push({ x: nx, y: ny });
    }
  }
  return seen;
}

const OFFSETS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/**
 * Shortest walk across the cell grid (four directions), never entering high ground.
 * `from` may be a continuous position; it is rounded to its cell. Returns the cells to
 * step through after the start, ending at `to`, or [] if already there, or null if the
 * destination is high ground or cannot be reached.
 */
export function findRoute(from: Cell, to: Cell, map: LocalMap): Cell[] | null {
  const start = { x: Math.round(from.x), y: Math.round(from.y) };
  if (!isPassable(map, to.x, to.y)) return null;
  if (start.x === to.x && start.y === to.y) return [];

  const key = (x: number, y: number) => y * map.cols + x;
  const previous = new Map<number, number>();
  const startKey = key(start.x, start.y);
  previous.set(startKey, startKey);
  const queue: Cell[] = [start];

  for (let head = 0; head < queue.length; head++) {
    const cell = queue[head];
    if (cell.x === to.x && cell.y === to.y) break;
    for (const [dx, dy] of OFFSETS) {
      const nx = cell.x + dx;
      const ny = cell.y + dy;
      if (!isPassable(map, nx, ny)) continue;
      const nk = key(nx, ny);
      if (previous.has(nk)) continue;
      previous.set(nk, key(cell.x, cell.y));
      queue.push({ x: nx, y: ny });
    }
  }

  const goalKey = key(to.x, to.y);
  if (!previous.has(goalKey)) return null;

  const route: Cell[] = [];
  let k = goalKey;
  while (k !== startKey) {
    route.push({ x: k % map.cols, y: Math.floor(k / map.cols) });
    k = previous.get(k)!;
  }
  return route.reverse();
}
