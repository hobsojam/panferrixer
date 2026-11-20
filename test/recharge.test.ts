import { describe, expect, it } from "vitest";
import { plateToMend } from "../src/armour";
import { config } from "../src/config";
import { createDashboardState, isResting, isThreatened, stepDashboard, worldFor, type DashboardState } from "../src/dashboard";

// Shield recharge (#82, design-notes 4.9): standing still and not threatened mends cracks,
// one at a time, paid for in energy. Broken plates need armour.
const DT = 1 / 60;
const world = worldFor(config);
const PER_CRACK = config.energy.rechargeSecondsPerCrack;

function resting(over: Partial<DashboardState>): DashboardState {
  return { ...createDashboardState(config), ...over };
}

function rest(s: DashboardState, seconds: number): DashboardState {
  let state = s;
  for (let i = 0; i < Math.round(seconds / DT); i++) state = stepDashboard(state, [], DT, world).state;
  return state;
}

const hunter = world.targets.findIndex((t) => t.kind === "hunter");

/** The robot's state with an alerted hunter standing `cells` to its east. */
function huntedFrom(cells: number, over: Partial<DashboardState> = {}): DashboardState {
  const s = resting({ plates: [3, 2, 3, 3, 3, 3, 3, 3], ...over });
  return { ...s, alerted: [hunter], hunterPos: { [hunter]: { x: s.pos.x + cells, y: s.pos.y } } };
}

describe("which plate mends", () => {
  it("the most cracked standing plate, the left one on a tie", () => {
    expect(plateToMend([3, 2, 1, 3, 1], 3)).toBe(2);
    expect(plateToMend([3, 2, 3, 2], 3)).toBe(1);
  });

  it("never a broken plate, and none when nothing standing is cracked", () => {
    expect(plateToMend([0, 3, 2], 3)).toBe(2);
    expect(plateToMend([0, 3, 3], 3)).toBe(-1);
  });
});

describe("resting mends cracks", () => {
  it("one crack per rechargeSecondsPerCrack, most cracked plate first", () => {
    const start = resting({ plates: [3, 2, 1, 3, 3, 3, 3, 3] });
    expect(rest(start, PER_CRACK + 0.05).plates).toEqual([3, 2, 2, 3, 3, 3, 3, 3]);
    expect(rest(start, 3 * PER_CRACK + 0.1).plates).toEqual([3, 3, 3, 3, 3, 3, 3, 3]);
  });

  it("each crack costs energy, on top of the running drain", () => {
    const start = resting({ plates: [3, 2, 3, 3, 3, 3, 3, 3] });
    const after = rest(start, PER_CRACK + 0.05);
    const drain = (PER_CRACK + 0.05) * config.energy.drainPerSecond;
    expect(start.energyCells - after.energyCells).toBeCloseTo(drain + config.energy.rechargeCellsPerCrack, 2);
  });

  it("with nothing cracked, resting costs nothing extra", () => {
    const start = resting({ plates: [3, 0, 3, 3, 3, 3, 3, 3] });
    const after = rest(start, 2);
    expect(after.plates).toEqual(start.plates);
    expect(start.energyCells - after.energyCells).toBeCloseTo(2 * config.energy.drainPerSecond, 5);
  });

  it("stops at the low-power line, so resting never flattens the batteries", () => {
    const line = config.dashboard.lowThreshold;
    // Eight cracks would cost two cells; only the running drain may take it below the line.
    const seconds = 8 * PER_CRACK + 1;
    const after = rest(resting({ plates: [1, 1, 1, 1, 3, 3, 3, 3], energyCells: line + 0.3 }), seconds);
    expect(after.energyCells).toBeGreaterThan(line - seconds * config.energy.drainPerSecond - 0.01);
    expect(isResting(after, world)).toBe(false);
    expect(after.plates).not.toEqual([3, 3, 3, 3, 3, 3, 3, 3]);
  });
});

describe("what interrupts a rest", () => {
  it("walking: no mending while the robot moves, and the crack in progress starts over", () => {
    const start = resting({ plates: [3, 2, 3, 3, 3, 3, 3, 3] });
    const half = rest(start, PER_CRACK / 2);
    expect(half.mendProgress).toBeGreaterThan(0);
    const walking = stepDashboard({ ...half, route: [{ x: half.pos.x + 1, y: half.pos.y }] }, [], DT, world).state;
    expect(walking.mendProgress).toBe(0);
    expect(walking.plates).toEqual(start.plates);
  });

  it("a chooser stops time, and with it the rest", () => {
    const after = rest(resting({ plates: [3, 2, 3, 3, 3, 3, 3, 3], mode: "targeting" }), PER_CRACK * 2);
    expect(after.plates).toEqual([3, 2, 3, 3, 3, 3, 3, 3]);
  });

  it("the breather after an attack", () => {
    const s = resting({ plates: [3, 2, 3, 3, 3, 3, 3, 3], breatherUntil: 2 });
    expect(isThreatened(s, world)).toBe(true);
    expect(rest(s, 1.9).plates[1]).toBe(2);
    expect(rest(s, 2 + PER_CRACK + 0.1).plates[1]).toBe(3);
  });

  it("an alerted enemy within scan range", () => {
    expect(hunter).toBeGreaterThanOrEqual(0);
    const near = huntedFrom(config.dashboard.scanRadius - 1);
    expect(isThreatened(near, world)).toBe(true);
    expect(rest(near, PER_CRACK + 0.1).plates[1]).toBe(2);
  });

  it("but not one beyond scan range, nor a destroyed one", () => {
    expect(isThreatened(huntedFrom(config.dashboard.scanRadius + 1), world)).toBe(false);
    const ruined = huntedFrom(1, { ruins: [hunter] });
    expect(isThreatened(ruined, world)).toBe(false);
  });

  it("an enemy that has not seen the robot is no threat, however close", () => {
    const s = huntedFrom(1);
    expect(isThreatened({ ...s, alerted: [] }, world)).toBe(false);
  });
});
