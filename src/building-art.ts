import type { TargetKind } from "./local-map";

/**
 * Line art for buildings, as data. Every building is drawn in a box x -1..1 and
 * y -1..0, with the base at y = 0 and the top at y = -1. The same strokes serve
 * the terminal view (full detail) and the mini map (simplified).
 */

export type Point = readonly [number, number];
export type Stroke = readonly Point[];

export interface BuildingArt {
  full: Record<string, Stroke>;
  simple: Record<string, Stroke>;
}

function arc(cx: number, cy: number, rx: number, ry: number, a0: number, a1: number, steps: number): Stroke {
  return Array.from({ length: steps + 1 }, (_, i) => {
    const a = a0 + ((a1 - a0) * i) / steps;
    return [cx + rx * Math.cos(a), cy + ry * Math.sin(a)] as const;
  });
}

const BASE: Stroke = [
  [-1.15, 0],
  [1.15, 0],
];

// Dome: a wide, low half-dome with ribs and a door.
const DOME_OUTLINE = arc(0, 0, 1, 1, Math.PI, 2 * Math.PI, 28);

const DOME: BuildingArt = {
  full: {
    outline: DOME_OUTLINE,
    base: BASE,
    ribs: arc(0, 0, 0.5, 1, Math.PI, 2 * Math.PI, 16),
    centre: [
      [0, 0],
      [0, -1],
    ],
    ring: [
      [-0.866, -0.5],
      [0.866, -0.5],
    ],
    door: [
      [-0.18, 0],
      [-0.18, -0.32],
      [0.18, -0.32],
      [0.18, 0],
    ],
  },
  simple: {
    outline: DOME_OUTLINE,
    base: BASE,
  },
};

// Power plant: two stacks rising from a lower hall.
const STACK_LEFT: Stroke = [
  [-0.75, 0],
  [-0.75, -1],
  [-0.5, -1],
  [-0.5, 0],
];
const STACK_RIGHT: Stroke = [
  [0.2, 0],
  [0.2, -0.75],
  [0.5, -0.75],
  [0.5, 0],
];

const POWER: BuildingArt = {
  full: {
    leftStack: STACK_LEFT,
    rightStack: STACK_RIGHT,
    hall: [
      [-0.5, 0],
      [-0.5, -0.4],
      [0.2, -0.4],
      [0.2, 0],
    ],
    base: BASE,
  },
  simple: {
    leftStack: STACK_LEFT,
    rightStack: STACK_RIGHT,
    base: BASE,
  },
};

// Mine: an open headframe with a wheel on top, not a solid shape that could read as a mountain.
const MINE: BuildingArt = {
  full: {
    legL: [
      [-0.45, 0],
      [-0.3, -0.95],
    ],
    legR: [
      [0.45, 0],
      [0.3, -0.95],
    ],
    top: [
      [-0.3, -0.95],
      [0.3, -0.95],
    ],
    brace: [
      [-0.4, -0.5],
      [0.4, -0.5],
    ],
    wheel: arc(0, -0.88, 0.12, 0.12, 0, 2 * Math.PI, 16),
    base: BASE,
  },
  simple: {
    legL: [
      [-0.45, 0],
      [-0.3, -0.95],
    ],
    legR: [
      [0.45, 0],
      [0.3, -0.95],
    ],
    top: [
      [-0.3, -0.95],
      [0.3, -0.95],
    ],
    base: BASE,
  },
};

// Comms centre: the mast from the original beacon's place in the design (design-notes 4.4),
// kept as drawn: a mast with a light, side rays, and a tripod base.
const MAST: Stroke = [
  [0, 0],
  [0, -0.8],
];
const LIGHT = arc(0, -0.85, 0.12, 0.12, 0, 2 * Math.PI, 16);

const COMMS_CENTRE: BuildingArt = {
  full: {
    mast: MAST,
    light: LIGHT,
    rayL: [
      [-0.28, -0.85],
      [-0.5, -0.85],
    ],
    rayR: [
      [0.28, -0.85],
      [0.5, -0.85],
    ],
    tripod: [
      [-0.3, 0],
      [0, -0.8],
      [0.3, 0],
    ],
  },
  simple: {
    mast: MAST,
    light: LIGHT,
    base: BASE,
  },
};

/** Art for each building kind. Every target kind now has art. */
// The hunter has no art yet, so it is drawn with the placeholder marker.
export const BUILDING_ART: Partial<Record<TargetKind, BuildingArt>> = {
  dome: DOME,
  power: POWER,
  mine: MINE,
  commsCentre: COMMS_CENTRE,
};

export function hasArt(kind: TargetKind): boolean {
  return BUILDING_ART[kind] !== undefined;
}

/**
 * Strokes a building's art centred on cx, with its base at baseY, scaled so that the
 * box's half-width is `halfSize` pixels. Pure drawing: no state is read or changed.
 */
export function strokeArt(
  ctx: CanvasRenderingContext2D,
  strokes: Record<string, Stroke>,
  cx: number,
  baseY: number,
  halfSize: number,
  color: string,
  lineWidth: number,
  glow: number
): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineJoin = "round";
  ctx.shadowColor = color;
  ctx.shadowBlur = glow;
  for (const stroke of Object.values(strokes)) {
    ctx.beginPath();
    stroke.forEach(([x, y], i) => {
      const px = cx + x * halfSize;
      const py = baseY + y * halfSize;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.stroke();
  }
  ctx.restore();
}
