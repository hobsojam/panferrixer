/**
 * The robot's armour plates, as an arc (design-notes 4.9, #82). The plates stand in a row
 * across the robot's front, left to right, and each one covers a slice of the bearings an
 * incoming missile can arrive from. A hit cracks the plate facing it; a plate breaks after
 * hitsPerPlate hits. A hit on a slice whose plate is gone spills to the nearest standing
 * plate, so the robot can take as many hits in all as before, and zero standing plates is
 * still death. Spread hits leave cracks, which recharge can mend; focused hits break plates,
 * which only armour can replace.
 *
 * A plate is its integrity: hitsPerPlate when whole, 0 when broken. Pure functions only.
 */

export type Plates = readonly number[];

/** Every plate whole. */
export function fullPlates(count: number, hitsPerPlate: number): number[] {
  return Array.from({ length: count }, () => hitsPerPlate);
}

/** How many plates still stand. */
export function standing(plates: Plates): number {
  return plates.filter((p) => p > 0).length;
}

/** Hits a standing plate has taken, shown as cracks. A broken plate shows none. */
export function cracksOn(integrity: number, hitsPerPlate: number): number {
  return integrity > 0 ? hitsPerPlate - integrity : 0;
}

/** True when every plate is whole: there is nothing for armour to mend. */
export function allWhole(plates: Plates, hitsPerPlate: number): boolean {
  return plates.every((p) => p >= hitsPerPlate);
}

/**
 * The plate facing a bearing. `halfArc` is how far left or right of straight ahead a missile
 * can arrive; the row of plates spans that arc evenly, leftmost plate on the left.
 */
export function plateFacing(yaw: number, count: number, halfArc: number): number {
  if (count <= 0) return -1;
  const k = (yaw + halfArc) / (2 * halfArc);
  return Math.max(0, Math.min(count - 1, Math.floor(k * count)));
}

/**
 * The plate that takes a hit aimed at `facing`: that plate if it stands, otherwise the nearest
 * standing one. On a tie, the stronger plate takes it, then the one on the left. -1 when none
 * stand.
 */
export function plateTaking(plates: Plates, facing: number): number {
  if (plates[facing] > 0) return facing;
  let best = -1;
  for (let i = 0; i < plates.length; i++) {
    if (plates[i] <= 0) continue;
    if (best === -1) {
      best = i;
      continue;
    }
    const d = Math.abs(i - facing);
    const bd = Math.abs(best - facing);
    if (d < bd || (d === bd && plates[i] > plates[best])) best = i;
  }
  return best;
}

/** One hit aimed at a plate. Returns the plates after it, and which plate took it (-1 if none stood). */
export function hitPlate(plates: Plates, facing: number): { plates: number[]; took: number } {
  const took = plateTaking(plates, facing);
  const next = [...plates];
  if (took >= 0) next[took] -= 1;
  return { plates: next, took };
}

/** Fully mends the `count` weakest plates: broken ones first, then the most cracked. */
export function mendWeakest(plates: Plates, count: number, hitsPerPlate: number): number[] {
  const order = plates
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => p < hitsPerPlate)
    .sort((a, b) => a.p - b.p || a.i - b.i)
    .slice(0, count);
  const next = [...plates];
  for (const { i } of order) next[i] = hitsPerPlate;
  return next;
}
