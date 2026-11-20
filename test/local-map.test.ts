import { describe, expect, it } from "vitest";
import { config } from "../src/config";
import { generateWorld, inTown, townCentres } from "../src/local-map";

const cfg = config.localMap;

describe("world map", () => {
  it("is the configured size", () => {
    const { map } = generateWorld(cfg);
    expect(map.tiers).toHaveLength(cfg.rows);
    map.tiers.forEach((row) => expect(row).toHaveLength(cfg.cols));
  });

  it("is deterministic", () => {
    expect(generateWorld(cfg)).toEqual(generateWorld(cfg));
  });

  it("has one town per network node, all inside the map", () => {
    const towns = townCentres(cfg);
    expect(towns).toHaveLength(10);
    for (const t of towns) {
      expect(t.x).toBeGreaterThanOrEqual(cfg.townRadiusCols);
      expect(t.x).toBeLessThan(cfg.cols - cfg.townRadiusCols);
      expect(t.y).toBeGreaterThanOrEqual(cfg.townRadiusRows);
      expect(t.y).toBeLessThan(cfg.rows - cfg.townRadiusRows);
    }
  });

  it("keeps high ground out of every town", () => {
    const { map, towns } = generateWorld(cfg);
    for (const t of towns) {
      for (let y = 0; y < cfg.rows; y++) {
        for (let x = 0; x < cfg.cols; x++) {
          if (inTown(t, cfg.townRadiusCols, cfg.townRadiusRows, x, y)) {
            expect(map.tiers[y][x]).not.toBe(2);
          }
        }
      }
    }
  });

  it("places targets inside towns and never in valleys", () => {
    const { map, towns, targets } = generateWorld(cfg);
    // Defenders stand beside their dome, which may be just outside the town: see the garrison tests.
    const placed = targets.filter((t) => t.kind !== "defender" && t.kind !== "patroller");
    expect(placed).toHaveLength(towns.length * (2 + cfg.domesPerTown + cfg.otherBuildingsPerTown));
    for (const target of placed) {
      expect(towns.some((t) => inTown(t, cfg.townRadiusCols, cfg.townRadiusRows, target.col, target.row))).toBe(true);
      expect(map.tiers[target.row][target.col]).not.toBe(0);
    }
  });

  it("uses all three tiers across the map, so the view has contrast", () => {
    const seen = new Set<number>();
    generateWorld(cfg).map.tiers.forEach((row) => row.forEach((t) => seen.add(t)));
    expect([...seen].sort()).toEqual([0, 1, 2]);
  });
});
