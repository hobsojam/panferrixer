/**
 * The network graph shown on the dashboard's mini map (design-notes 2.4: ten nodes
 * joined by narrow passes). Hand-placed for now, so reachability is easy to check
 * and the layout is ours rather than the original's.
 */
export interface MapNode {
  x: number; // 0..1 across the map panel
  y: number; // 0..1 down the map panel
}

export interface NetworkMap {
  nodes: readonly MapNode[];
  links: readonly (readonly [number, number])[];
}

export const NETWORK: NetworkMap = {
  nodes: [
    { x: 0.08, y: 0.3 },
    { x: 0.26, y: 0.14 },
    { x: 0.44, y: 0.34 },
    { x: 0.62, y: 0.12 },
    { x: 0.82, y: 0.3 },
    { x: 0.14, y: 0.78 },
    { x: 0.36, y: 0.62 },
    { x: 0.58, y: 0.7 },
    { x: 0.8, y: 0.82 },
    { x: 0.94, y: 0.58 },
  ],
  links: [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 4],
    [4, 9],
    [9, 7],
    [7, 8],
    [7, 6],
    [6, 5],
    [5, 0],
    [2, 6],
  ],
};

/** True when every node can be reached from node 0 by following links. */
export function isConnected(map: NetworkMap): boolean {
  const seen = new Set<number>([0]);
  const queue = [0];
  while (queue.length > 0) {
    const node = queue.shift()!;
    for (const [a, b] of map.links) {
      const other = a === node ? b : b === node ? a : -1;
      if (other >= 0 && !seen.has(other)) {
        seen.add(other);
        queue.push(other);
      }
    }
  }
  return seen.size === map.nodes.length;
}
