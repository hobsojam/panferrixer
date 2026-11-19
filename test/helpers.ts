import type { AppState } from "../src/app";
import type { DashboardState } from "../src/dashboard";
import type { LocalMap, Tier } from "../src/local-map";

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
