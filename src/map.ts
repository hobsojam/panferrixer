/**
 * Where the ten networks sit on the world map (design-notes 2.4). Hand-placed, so the
 * layout is ours rather than the original's. Each network is a self-contained town;
 * there are no links between them. Spread so that no town, or the mountain wall round it,
 * reaches another's (#89): test/town-walls.test.ts checks this. Every town is reachable over the real terrain,
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
    { x: 0.06, y: 0.32 },
    { x: 0.26, y: 0.1 },
    { x: 0.48, y: 0.34 },
    { x: 0.62, y: 0.1 },
    { x: 0.82, y: 0.32 },
    { x: 0.06, y: 0.78 },
    { x: 0.3, y: 0.58 },
    { x: 0.6, y: 0.66 },
    { x: 0.82, y: 0.84 },
    { x: 0.98, y: 0.58 },
  ],
};
