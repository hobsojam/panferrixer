import { describe, expect, it } from "vitest";
import { config } from "../src/config";
import { blipStrength, createDashboardState, stepDashboard, worldFor, type DashboardState, type World } from "../src/dashboard";
import { generateWorld, isEnemyKind, type LocalMapConfig, type Target } from "../src/local-map";
import { cellKey, findRoute, OFFSETS } from "../src/route";
import { eventsBetween } from "../src/sound";
import { MANY_WORLDS_TIMEOUT_MS } from "./helpers";

// Parts (design-notes 4.4): a fixed set placed over the world, not rolled per building.
const DT = 1 / 60;
const cfg: LocalMapConfig = config.localMap;

function partsOf(targets: readonly Target[]): Target[] {
  return targets.filter((t) => t.part !== undefined);
}

describe("placing the parts", () => {
  function check(seed: number) {
    const { map, towns, targets } = generateWorld({ ...cfg, worldSeed: seed });
    const parts = partsOf(targets);
    expect(parts.length, `seed ${seed} holds the whole set`).toBe(cfg.partCount);
    // Each part once, so the set is complete and nothing is duplicated.
    expect(parts.map((t) => t.part).sort((a, b) => a! - b!)).toEqual([...Array(cfg.partCount).keys()]);
    const blocked = new Set(targets.filter((t) => !isEnemyKind(t.kind)).map((t) => cellKey(map, t.col, t.row)));
    const perNetwork = new Map<number, number>();
    for (const t of parts) {
      expect(cfg.partWeights[t.kind] ?? 0, `seed ${seed}: a part in a ${t.kind}`).toBeGreaterThan(0);
      expect(t.network, `seed ${seed}: a part in the starting town`).not.toBe(cfg.startTown);
      perNetwork.set(t.network, (perNetwork.get(t.network) ?? 0) + 1);
      // Its ruin can be walked to from the starting town with every other building still standing.
      const reachable = OFFSETS.some(([dx, dy]) => {
        const x = t.col + dx;
        const y = t.row + dy;
        if (x < 0 || y < 0 || x >= map.cols || y >= map.rows || blocked.has(cellKey(map, x, y))) return false;
        return findRoute(towns[cfg.startTown], { x, y }, map, blocked) !== null;
      });
      expect(reachable, `seed ${seed}: a part that cannot be reached`).toBe(true);
    }
    for (const count of perNetwork.values()) expect(count).toBeLessThanOrEqual(cfg.partsPerNetworkMax);
  }

  it("the default world holds the whole set, by the rules", () => {
    check(cfg.worldSeed);
  });

  it("holds across many worlds", () => {
    for (let seed = 1; seed <= 25; seed++) check(seed);
  }, MANY_WORLDS_TIMEOUT_MS);

  it("is the same every time the world is made", () => {
    expect(partsOf(generateWorld(cfg).targets)).toEqual(partsOf(generateWorld(cfg).targets));
  });
});

describe("collecting a part", () => {
  const base = worldFor(config);
  const dome: Target = { col: 5, row: 5, kind: "dome", supplies: [], part: 2, network: 1 };
  const world: World = { ...base, targets: [dome] };
  const onRuin = (over: Partial<DashboardState> = {}): DashboardState => ({ ...createDashboardState(config), pos: { x: 5, y: 5 }, ruins: [0], ...over });

  it("is automatic on reaching its ruin, even with full gauges", () => {
    const next = stepDashboard(onRuin(), [], DT, world).state;
    expect(next.parts).toEqual([2]);
    expect(eventsBetween({ screen: "dashboard", dashboard: onRuin() }, { screen: "dashboard", dashboard: next }, config)).toContain("pickup");
  });

  it("is taken once", () => {
    const once = stepDashboard(onRuin(), [], DT, world).state;
    expect(stepDashboard(once, [], DT, world).state.parts).toEqual([2]);
  });

  it("is not taken while its building stands", () => {
    expect(stepDashboard(onRuin({ ruins: [] }), [], DT, world).state.parts).toEqual([]);
  });

  it("a scan marks its ruin until it is collected", () => {
    const away = onRuin({ pos: { x: 8, y: 5 } });
    const scanned = stepDashboard({ ...away, col: 1, row: 0 }, ["activate"], DT, world).state;
    expect(scanned.scan?.blips).toEqual([0]);
    const lit = { ...scanned, time: scanned.pulseStarted! + world.scanPulseSeconds };
    expect(blipStrength(lit, 0, world)).toBeGreaterThan(0);
    expect(blipStrength({ ...lit, parts: [2] }, 0, world)).toBe(0);
  });
});
