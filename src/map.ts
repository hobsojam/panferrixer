/**
 * Where the ten networks sit on the world map (design-notes 2.4). Hand-placed, so the
 * layout is ours rather than the original's. Each network is a self-contained town;
 * there are no links between them. Every town is reachable over the real terrain,
 * which the world generator guarantees and test/reachability.test.ts checks.
 */
export interface MapNode {
  x: number; // 0..1 across the map panel
  y: number; // 0..1 down the map panel
}

export interface NetworkMap {
  nodes: readonly MapNode[];
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
};
