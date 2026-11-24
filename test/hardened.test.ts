import { describe, expect, it } from "vitest";
import { updateApp } from "../src/app";
import { config } from "../src/config";
import { createDashboardState, worldFor } from "../src/dashboard";
import { generateWorld, isBossKind, type World } from "../src/local-map";

// Difficulty by distance (design-notes 4.5): further from the start, hunters jam and defenders
// carry point defence. Nothing is upgraded in place: it is decided when the world is made.
const cfg = config.localMap;
const worlds: World[] = [1, 2, 3, 4, 5, 6, 7, 8].map((worldSeed) => generateWorld({ ...cfg, worldSeed }));

describe("bands", () => {
  it("the start town is near, and the shares hold", () => {
    for (const w of worlds) {
      expect(w.bands[cfg.startTown]).toBe("near");
      const count = (b: string) => w.bands.filter((x) => x === b).length;
      expect(count("near")).toBe(Math.round(w.towns.length * cfg.bandShares.near));
      expect(count("middle")).toBe(Math.round(w.towns.length * cfg.bandShares.middle));
      expect(count("far")).toBeGreaterThan(0);
    }
  });
});

describe("hardened machines", () => {
  it("none in near towns; every hunter and defender in far towns", () => {
    for (const w of worlds) {
      for (const t of w.targets) {
        if (t.kind !== "hunter" && t.kind !== "defender") continue;
        if (w.bands[t.network] === "near") expect(t.defences).toBeUndefined();
        if (w.bands[t.network] === "far") expect(t.defences).toBeDefined();
      }
    }
  });

  it("hunters jam, defenders carry point defence, and only far defenders may also jam", () => {
    for (const w of worlds) {
      for (const t of w.targets.filter((x) => x.defences && !isBossKind(x.kind))) {
        if (t.kind === "hunter") expect(t.defences).toEqual({ jammer: true });
        else {
          expect(t.kind).toBe("defender");
          expect(t.defences!.pointDefence).toBe(true);
          if (w.bands[t.network] !== "far") expect(t.defences!.jammer).toBe(false);
        }
      }
    }
  });

  it("patrollers are never hardened", () => {
    for (const w of worlds) for (const t of w.targets) if (t.kind === "patroller") expect(t.defences).toBeUndefined();
  });

  it("the middle band is a mix", () => {
    const middle = worlds.flatMap((w) => w.targets.filter((t) => (t.kind === "hunter" || t.kind === "defender") && w.bands[t.network] === "middle"));
    const hardened = middle.filter((t) => t.defences).length;
    expect(hardened).toBeGreaterThan(0);
    expect(hardened).toBeLessThan(middle.length);
  });

  it("hardened machines are more likely to carry missiles", () => {
    const share = (hard: boolean) => {
      const xs = worlds.flatMap((w) => w.targets.filter((t) => t.kind === "hunter" && !!t.defences === hard));
      return xs.reduce((n, t) => n + t.supplies.filter((s) => s === "missiles").length, 0) / xs.length;
    };
    expect(share(true)).toBeGreaterThan(share(false));
  });
});

describe("parts", () => {
  it("at least the set number lie in far towns", () => {
    for (const w of worlds) {
      expect(w.targets.filter((t) => t.part !== undefined && w.bands[t.network] === "far").length).toBeGreaterThanOrEqual(cfg.partsFarMin);
    }
  });
});

describe("flying at a hardened machine", () => {
  const world = worldFor(config);
  const fireAt = (index: number) => {
    const t = world.targets[index];
    const dashboard = { ...createDashboardState(config), pos: { x: t.col, y: t.row }, mode: "targeting" as const, purpose: "missile" as const, cross: { col: t.col, row: t.row }, target: index };
    const out = updateApp({ screen: "dashboard", dashboard }, { actions: ["activate"], steering: 0 }, 1 / 60, config, () => 1);
    if (out.screen !== "flight") throw new Error("expected a flight");
    return out.flight;
  };

  it("a jamming hunter jams the flight; a point-defence defender defends it; a standard one neither", () => {
    const jammer = world.targets.findIndex((t) => t.kind === "hunter" && t.defences?.jammer);
    const guard = world.targets.findIndex((t) => t.kind === "defender" && t.defences?.pointDefence && !t.defences.jammer);
    const plain = world.targets.findIndex((t) => t.kind === "hunter" && !t.defences);
    expect(fireAt(jammer).jams.length).toBeGreaterThan(0);
    expect(fireAt(jammer).defended).toBe(false);
    expect(fireAt(guard).defended).toBe(true);
    expect(fireAt(guard).jams).toEqual([]);
    expect(fireAt(plain).defended).toBe(false);
    expect(fireAt(plain).jams).toEqual([]);
  });
});
