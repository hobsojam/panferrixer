import type { TargetKind } from "./local-map";

/**
 * Line art for buildings and enemies, as data. Everything is drawn in a box x -1..1 and
 * y -1..0, with the ground at y = 0 and the top at y = -1. The same strokes serve the
 * terminal view (full detail) and the mini map (simplified). Buildings sit on a wide base
 * line; enemies stand on legs, wheels or tracks and have none, so the two read apart.
 */

export type Point = readonly [number, number];
export type Stroke = readonly Point[];

export interface LineArt {
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

const DOME: LineArt = {
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

const POWER: LineArt = {
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
const MINE: LineArt = {
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

const COMMS_CENTRE: LineArt = {
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

function closed(points: Point[]): Stroke {
  return [...points, points[0]];
}

// Hunter: a two-legged walker with an arrowhead hull leaning forward and a missile rack
// on its back. The one enemy that hunts, so the most aggressive silhouette.
const HUNTER_HULL = closed([
  [-0.7, -0.4],
  [-0.45, -0.72],
  [0.35, -0.72],
  [0.8, -0.5],
  [0.35, -0.36],
  [-0.7, -0.36],
]);
const HUNTER_LEGS: Stroke = [
  [-0.55, 0],
  [-0.35, -0.18],
  [-0.4, -0.36],
];
const HUNTER_LEG_FRONT: Stroke = [
  [0.4, 0],
  [0.2, -0.18],
  [0.25, -0.36],
];
const HUNTER_RACK = closed([
  [-0.35, -0.72],
  [-0.35, -0.95],
  [0.15, -0.95],
  [0.15, -0.72],
]);

const HUNTER: LineArt = {
  full: {
    hull: HUNTER_HULL,
    legBack: HUNTER_LEGS,
    legFront: HUNTER_LEG_FRONT,
    rack: HUNTER_RACK,
    tubes: [
      [-0.18, -0.72],
      [-0.18, -0.95],
    ],
    tubes2: [
      [-0.02, -0.72],
      [-0.02, -0.95],
    ],
    sensor: [
      [0.4, -0.55],
      [0.6, -0.52],
    ],
  },
  simple: {
    hull: HUNTER_HULL,
    legBack: HUNTER_LEGS,
    legFront: HUNTER_LEG_FRONT,
    rack: HUNTER_RACK,
  },
};

// Patroller: a fast, low wedge on two wheels with a tall whip antenna. Guns only, no
// missiles, so the gun is short and there is no rack.
const PATROLLER_BODY = closed([
  [-0.85, -0.28],
  [-0.6, -0.5],
  [0.3, -0.5],
  [0.9, -0.28],
]);
const PATROLLER_WHEEL_L = arc(-0.5, -0.15, 0.15, 0.15, 0, 2 * Math.PI, 14);
const PATROLLER_WHEEL_R = arc(0.5, -0.15, 0.15, 0.15, 0, 2 * Math.PI, 14);
const PATROLLER_ANTENNA: Stroke = [
  [-0.45, -0.5],
  [-0.7, -1],
];

const PATROLLER: LineArt = {
  full: {
    body: PATROLLER_BODY,
    wheelL: PATROLLER_WHEEL_L,
    wheelR: PATROLLER_WHEEL_R,
    hubL: arc(-0.5, -0.15, 0.04, 0.04, 0, 2 * Math.PI, 8),
    hubR: arc(0.5, -0.15, 0.04, 0.04, 0, 2 * Math.PI, 8),
    antenna: PATROLLER_ANTENNA,
    gun: [
      [0.05, -0.5],
      [0.05, -0.6],
      [0.55, -0.6],
    ],
    window: [
      [-0.35, -0.42],
      [0.15, -0.42],
    ],
  },
  simple: {
    body: PATROLLER_BODY,
    wheelL: PATROLLER_WHEEL_L,
    wheelR: PATROLLER_WHEEL_R,
    antenna: PATROLLER_ANTENNA,
  },
};

// Hauler: a long cargo box ahead of a small cab, on a track. Built to carry, not to fight.
const HAULER_BOX = closed([
  [-1, -0.3],
  [-1, -0.8],
  [0.3, -0.8],
  [0.3, -0.3],
]);
const HAULER_CAB: Stroke = [
  [0.3, -0.3],
  [0.3, -0.6],
  [0.65, -0.6],
  [0.95, -0.4],
  [0.95, -0.3],
];
const HAULER_TRACK = closed([
  [-0.95, -0.3],
  [-1.05, -0.15],
  [-0.9, 0],
  [0.85, 0],
  [1, -0.15],
  [0.95, -0.3],
]);

const HAULER: LineArt = {
  full: {
    box: HAULER_BOX,
    cab: HAULER_CAB,
    track: HAULER_TRACK,
    podL: arc(-0.65, -0.55, 0.15, 0.15, 0, 2 * Math.PI, 14),
    podR: arc(-0.15, -0.55, 0.15, 0.15, 0, 2 * Math.PI, 14),
    cabWindow: [
      [0.62, -0.52],
      [0.85, -0.4],
    ],
    treads: [
      [-0.7, -0.15],
      [0.7, -0.15],
    ],
  },
  simple: {
    box: HAULER_BOX,
    cab: HAULER_CAB,
    track: HAULER_TRACK,
  },
};

// Defender: a squat armoured shell on four stubby legs with a heavy twin cannon raised high.
const DEFENDER_SHELL = closed([
  [-0.7, -0.25],
  [-0.85, -0.5],
  [-0.5, -0.78],
  [0.45, -0.78],
  [0.8, -0.5],
  [0.7, -0.25],
]);
const DEFENDER_CANNON: Stroke = [
  [0.3, -0.72],
  [1.05, -1],
];
const DEFENDER_LEG_L: Stroke = [
  [-0.55, -0.25],
  [-0.75, 0],
];
const DEFENDER_LEG_R: Stroke = [
  [0.55, -0.25],
  [0.75, 0],
];

const DEFENDER: LineArt = {
  full: {
    shell: DEFENDER_SHELL,
    cannon: DEFENDER_CANNON,
    cannon2: [
      [0.38, -0.62],
      [1.1, -0.9],
    ],
    legL: DEFENDER_LEG_L,
    legInL: [
      [-0.2, -0.25],
      [-0.25, 0],
    ],
    legInR: [
      [0.2, -0.25],
      [0.25, 0],
    ],
    legR: DEFENDER_LEG_R,
    slit: [
      [-0.45, -0.5],
      [0.15, -0.5],
    ],
  },
  simple: {
    shell: DEFENDER_SHELL,
    cannon: DEFENDER_CANNON,
    legL: DEFENDER_LEG_L,
    legR: DEFENDER_LEG_R,
  },
};

// Listener: a wide horn and a ring of wire on a tall tripod, with a small drum at the middle.
const LISTENER_HORN = closed([
  [-0.1, -0.62],
  [0.55, -1],
  [0.8, -0.5],
]);
const LISTENER_DRUM = closed([
  [-0.45, -0.62],
  [-0.1, -0.72],
  [0.2, -0.45],
  [-0.3, -0.4],
]);
const LISTENER_LEGS: Stroke = [
  [-0.8, 0],
  [-0.1, -0.42],
  [0.75, 0],
];
const LISTENER_MIDLEG: Stroke = [
  [-0.1, -0.42],
  [-0.05, 0],
];

const LISTENER: LineArt = {
  full: {
    horn: LISTENER_HORN,
    drum: LISTENER_DRUM,
    legs: LISTENER_LEGS,
    midLeg: LISTENER_MIDLEG,
    loop: arc(-0.62, -0.72, 0.22, 0.22, 0, 2 * Math.PI, 16),
    throat: [
      [0.1, -0.6],
      [0.66, -0.76],
    ],
    brace: [
      [-0.45, -0.2],
      [0.33, -0.2],
    ],
  },
  simple: {
    horn: LISTENER_HORN,
    drum: LISTENER_DRUM,
    legs: LISTENER_LEGS,
    midLeg: LISTENER_MIDLEG,
  },
};

// Assessor: a tall gantry striding on two splayed frames, with a slab of a head hung between them.
const ASSESSOR_BEAM = closed([
  [-0.9, -0.85],
  [-0.9, -1],
  [0.9, -1],
  [0.9, -0.85],
]);
const ASSESSOR_FRAME_L = closed([
  [-0.75, -0.85],
  [-1.1, 0],
  [-0.65, 0],
]);
const ASSESSOR_FRAME_R = closed([
  [0.75, -0.85],
  [0.65, 0],
  [1.1, 0],
]);
const ASSESSOR_HEAD = closed([
  [-0.4, -0.85],
  [-0.4, -0.4],
  [0, -0.25],
  [0.4, -0.4],
  [0.4, -0.85],
]);

const ASSESSOR: LineArt = {
  full: {
    beam: ASSESSOR_BEAM,
    frameL: ASSESSOR_FRAME_L,
    frameR: ASSESSOR_FRAME_R,
    head: ASSESSOR_HEAD,
    lens: arc(0, -0.58, 0.14, 0.14, 0, 2 * Math.PI, 14),
    tubeL: [
      [-0.28, -0.78],
      [-0.28, -0.48],
    ],
    tubeR: [
      [0.28, -0.78],
      [0.28, -0.48],
    ],
  },
  simple: {
    beam: ASSESSOR_BEAM,
    frameL: ASSESSOR_FRAME_L,
    frameR: ASSESSOR_FRAME_R,
    head: ASSESSOR_HEAD,
  },
};

/**
 * The enemy roles. A new one is added by giving it a role and an entry in ART.
 */
export type EnemyRole = "hunter" | "patroller" | "hauler" | "defender" | "listener" | "assessor";

export const ENEMY_ROLES: readonly EnemyRole[] = ["hunter", "patroller", "hauler", "defender", "listener", "assessor"];

/** Art for everything that can be drawn as a target: each building kind and each enemy role. */
export const ART: Record<TargetKind | EnemyRole, LineArt> = {
  dome: DOME,
  power: POWER,
  mine: MINE,
  commsCentre: COMMS_CENTRE,
  hunter: HUNTER,
  patroller: PATROLLER,
  hauler: HAULER,
  defender: DEFENDER,
  listener: LISTENER,
  assessor: ASSESSOR,
};

export function hasArt(kind: string): kind is TargetKind | EnemyRole {
  return Object.prototype.hasOwnProperty.call(ART, kind);
}

/**
 * Strokes a piece of art centred on cx, with its base at baseY, scaled so that the
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

/** What a hardened enemy carries (design-notes 4.5): either or both. */
export interface Fittings {
  pointDefence?: boolean;
  jammer?: boolean;
}

/** The highest point of the art near `x`, where a fitting is mounted. */
function topNear(strokes: Record<string, Stroke>, x: number): number {
  let top = 0;
  for (const stroke of Object.values(strokes)) for (const [px, py] of stroke) if (Math.abs(px - x) <= 0.25) top = Math.min(top, py);
  return top < 0 ? top : -1;
}

/**
 * The fittings that mark a hardened enemy (#112), added on top of its art so a defended machine
 * reads as one on the map and in the flight. Point defence is a turret with twin barrels, on the
 * left and pointing outward; a jammer is a mast with signal arcs, in the middle. In the same box as the art, rising
 * above it.
 */
export function fittingStrokes(strokes: Record<string, Stroke>, fittings: Fittings): Record<string, Stroke> {
  const out: Record<string, Stroke> = {};
  if (fittings.pointDefence) {
    const x = -0.45;
    const y = topNear(strokes, x);
    out.turret = closed([
      [x - 0.2, y],
      [x - 0.16, y - 0.18],
      [x + 0.16, y - 0.18],
      [x + 0.2, y],
    ]);
    out.barrel1 = [
      [x + 0.02, y - 0.16],
      [x - 0.32, y - 0.48],
    ];
    out.barrel2 = [
      [x - 0.1, y - 0.14],
      [x - 0.44, y - 0.46],
    ];
  }
  if (fittings.jammer) {
    const x = 0.1;
    const y = topNear(strokes, x);
    const tip = y - 0.55;
    out.mast = [
      [x, y],
      [x, tip],
    ];
    out.mastFoot = [
      [x - 0.12, y],
      [x, y - 0.2],
      [x + 0.12, y],
    ];
    for (const [i, r] of [0.14, 0.26].entries()) {
      out[`waveL${i}`] = arc(x, tip, r, r, Math.PI * 0.75, Math.PI * 1.25, 4);
      out[`waveR${i}`] = arc(x, tip, r, r, -Math.PI * 0.25, Math.PI * 0.25, 4);
    }
  }
  return out;
}
