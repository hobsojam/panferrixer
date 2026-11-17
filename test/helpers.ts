import type { LocalMap, Tier } from "../src/local-map";

/** A map from rows of tier digits: 0 valley, 1 ground, 2 high ground. */
export function mapOf(rows: string[]): LocalMap {
  const tiers = rows.map((r) => [...r].map((ch) => Number(ch) as Tier));
  return { cols: tiers[0].length, rows: tiers.length, tiers };
}
