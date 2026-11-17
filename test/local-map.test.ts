import { describe, expect, it } from "vitest";
import { config } from "../src/config";
import { generateLocalMap } from "../src/local-map";

const cfg = config.localMap;

describe("local map", () => {
  it("is the configured size", () => {
    const map = generateLocalMap(0, cfg);
    expect(map.tiers).toHaveLength(cfg.rows);
    map.tiers.forEach((row) => expect(row).toHaveLength(cfg.cols));
  });

  it("is deterministic for a given node", () => {
    expect(generateLocalMap(3, cfg)).toEqual(generateLocalMap(3, cfg));
  });

  it("differs between nodes, so moving changes the view", () => {
    expect(generateLocalMap(0, cfg)).not.toEqual(generateLocalMap(1, cfg));
  });

  it("uses all three tiers across the nodes, so the view has contrast", () => {
    const seen = new Set<number>();
    for (let node = 0; node < 10; node++) {
      generateLocalMap(node, cfg).tiers.forEach((row) => row.forEach((t) => seen.add(t)));
    }
    expect([...seen].sort()).toEqual([0, 1, 2]);
  });
});
