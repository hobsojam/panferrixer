import { describe, expect, it } from "vitest";
import { config } from "../src/config";
import { startPosition, worldFor, type World } from "../src/dashboard";
import { generateWorld } from "../src/local-map";
import { cellKey, OFFSETS, reachableFrom } from "../src/route";
import { MANY_WORLDS_TIMEOUT_MS } from "./helpers";

/**
 * The game can only be finished if every network can be reached (design-notes 4.7). This checks
 * the real terrain, from where the robot really starts. Power stations can never be destroyed,
 * so they count as walls; every other building can be blasted into passable rubble, so it does not.
 */
function worldWithSeed(seed: number): { world: World; cfg: typeof config } {
  const cfg = { ...config, localMap: { ...config.localMap, worldSeed: seed } };
  const { map, towns, targets } = generateWorld(cfg.localMap);
  return { world: { ...worldFor(config), map, towns, targets }, cfg };
}

/** The targets the robot cannot get to: neither its cell nor any cell beside it can be walked to. */
function unreachableTargets(seed: number): number[] {
  const { world, cfg } = worldWithSeed(seed);
  return unreachableIn(world, cfg);
}

function unreachableIn(world: World, cfg: typeof config): number[] {
  const walls = new Set<number>();
  for (const t of world.targets) if (t.kind === "power") walls.add(cellKey(world.map, t.col, t.row));
  const start = startPosition(world, cfg);
  const reached = reachableFrom({ x: Math.round(start.x), y: Math.round(start.y) }, world.map, walls);
  const cut: number[] = [];
  world.targets.forEach((t, index) => {
    const cells = [[0, 0], ...OFFSETS].map(([dx, dy]) => cellKey(world.map, t.col + dx, t.row + dy));
    if (!cells.some((k) => reached.has(k))) cut.push(index);
  });
  return cut;
}

describe("every network can be reached", () => {
  it("on the configured world", () => {
    expect(unreachableTargets(config.localMap.worldSeed)).toEqual([]);
  });

  it("across many worlds", () => {
    for (let seed = 1; seed <= 50; seed++) {
      expect(unreachableTargets(seed), `world seed ${seed}`).toEqual([]);
    }
  }, MANY_WORLDS_TIMEOUT_MS);

  it("detects a town walled off by high ground", () => {
    const { world, cfg } = worldWithSeed(config.localMap.worldSeed);
    // Ring the last town with high ground, just outside its area, so it can never be walked into.
    const town = world.towns[world.towns.length - 1];
    const rx = world.townRadiusCols + 1;
    const ry = world.townRadiusRows + 1;
    const tiers = world.map.tiers.map((row, y) =>
      row.map((tier, x) => {
        const d = ((x - town.x) / rx) ** 2 + ((y - town.y) / ry) ** 2;
        return d > 1 && d <= 1.6 ? 2 : tier;
      })
    );
    const walled = { ...world, map: { ...world.map, tiers } };
    // Patrollers belong to no network (their network is only the nearest town), so they are left out.
    const roaming = (i: number) => world.targets[i].kind === "patroller";
    const cut = unreachableIn(walled, cfg).filter((i) => !roaming(i));
    const inLastTown = world.targets.map((t, i) => ({ t, i })).filter(({ t, i }) => t.network === world.towns.length - 1 && !roaming(i)).map(({ i }) => i);
    expect(cut).toEqual(inLastTown);
  });
});
