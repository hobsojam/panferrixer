import type { Config } from "./config";

/** The four verbs from design-notes 4.6. Only "missile" does anything in this slice. */
export type Verb = "move" | "scan" | "missile" | "gridDisable";

export type Action = "up" | "down" | "left" | "right" | "activate";

/** The verbs as laid out on screen: a 2x2 grid. */
export const VERB_GRID: readonly (readonly Verb[])[] = [
  ["move", "scan"],
  ["missile", "gridDisable"],
];

export const AVAILABLE_VERBS: readonly Verb[] = ["missile"];

export interface DashboardState {
  row: number;
  col: number;
  energyCells: number;
  shieldPlates: number;
  time: number; // seconds on the dashboard; drives the state-of-mind trace
}

export interface DashboardStep {
  state: DashboardState;
  launchMissile: boolean;
}

export function createDashboardState(cfg: Config): DashboardState {
  return {
    row: 0,
    col: 0,
    energyCells: cfg.dashboard.energyCells,
    shieldPlates: cfg.dashboard.shieldPlates,
    time: 0,
  };
}

export function selectedVerb(state: DashboardState): Verb {
  return VERB_GRID[state.row][state.col];
}

/** Pure: moves the selection within the grid and reports whether a missile was requested. */
export function stepDashboard(state: DashboardState, actions: readonly Action[], dt: number): DashboardStep {
  let { row, col } = state;
  let launchMissile = false;

  for (const action of actions) {
    if (action === "up") row = Math.max(0, row - 1);
    if (action === "down") row = Math.min(VERB_GRID.length - 1, row + 1);
    if (action === "left") col = Math.max(0, col - 1);
    if (action === "right") col = Math.min(VERB_GRID[row].length - 1, col + 1);
    if (action === "activate" && VERB_GRID[row][col] === "missile") launchMissile = true;
  }

  return {
    state: { ...state, row, col, time: state.time + dt },
    launchMissile,
  };
}

/** A bar is low when at or below the threshold: the last cell or plate flashes and the trace agitates. */
export function isLow(count: number, cfg: Config): boolean {
  return count <= cfg.dashboard.lowThreshold;
}
