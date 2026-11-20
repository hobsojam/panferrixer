import type { AppState } from "../src/app";
import type { DashboardState } from "../src/dashboard";
import type { LocalMap, Tier } from "../src/local-map";

/**
 * The time allowed a test that generates many whole worlds in a loop. Each takes a few
 * seconds on its own, but in a full run every test file has its own worker competing for
 * the CPU, so the default 5 seconds is too little and they failed only under load. Kept to
 * these tests so that any other test that hangs still fails fast.
 */
export const MANY_WORLDS_TIMEOUT_MS = 30_000;

/** A map from rows of tier digits: 0 valley, 1 ground, 2 high ground. */
export function mapOf(rows: string[]): LocalMap {
  const tiers = rows.map((r) => [...r].map((ch) => Number(ch) as Tier));
  return { cols: tiers[0].length, rows: tiers.length, tiers };
}

/** The dashboard behind any screen but death, which has none: a test that reaches death fails here. */
export function dashboardOf(s: AppState): DashboardState {
  if (s.screen === "destroyed") throw new Error("expected a screen with a dashboard, got destroyed");
  return s.dashboard;
}

/**
 * A row of armour plates with `whole` plates standing and the rest broken. Standing plates
 * fill the middle of the arc, so nothing about a test hangs on which side is broken.
 */
export function platesWith(whole: number, count = 8, hitsPerPlate = 3): number[] {
  const start = Math.floor((count - whole) / 2);
  return Array.from({ length: count }, (_, i) => (i >= start && i < start + whole ? hitsPerPlate : 0));
}
