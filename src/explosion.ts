import { createRng } from "./rng";

/** Seconds from the blast to when nothing of it is left on screen. */
export const EXPLOSION_LIFETIME = 1.2;

const DEBRIS_COUNT = 14;

interface Debris {
  angle: number; // initial direction, radians
  speed: number; // 0..1 of the blast radius per second
  spin: number; // how fast the piece turns, radians per second
  length: number; // half-length of the piece, as a fraction of the radius
}

/**
 * The debris for one blast. Derived from the seed, so the same blast is the same
 * on every frame and the drawing stays a pure function of time.
 */
export function debrisFor(seed: number, count: number = DEBRIS_COUNT): Debris[] {
  const rng = createRng(seed);
  return Array.from({ length: count }, () => ({
    angle: rng() * Math.PI * 2,
    speed: 0.5 + rng() * 0.9,
    spin: (rng() * 2 - 1) * 14,
    length: 0.08 + rng() * 0.09,
  }));
}

/**
 * One blast centred at (cx, cy) with radius r, t seconds after it started. Four parts:
 * a white flash that is gone in a third of a second, a shock ring that expands and
 * slows, a fireball that grows and fades, and debris that flies out and falls.
 * Nothing is drawn once the blast is over.
 */
export function drawExplosion(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  t: number,
  color: string,
  flashColor: string,
  seed: number
): void {
  if (t < 0 || t >= EXPLOSION_LIFETIME) return;
  ctx.save();

  // Flash: a bright core that shrinks away quickly.
  const flash = clamp(1 - t / 0.35, 0, 1);
  if (flash > 0) {
    ctx.globalAlpha = flash;
    ctx.fillStyle = flashColor;
    ctx.beginPath();
    ctx.arc(cx, cy, r * (0.35 + 0.35 * flash), 0, Math.PI * 2);
    ctx.fill();
  }

  // Shock ring: fast at first, then slowing as it fades.
  const ringT = clamp(t / 0.7, 0, 1);
  const ringR = r * (0.2 + 1.1 * (1 - (1 - ringT) ** 3));
  ctx.globalAlpha = 1 - ringT;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5 * (1 - ringT) + 0.5;
  ctx.shadowColor = color;
  ctx.shadowBlur = 10;
  ctx.beginPath();
  ctx.arc(cx, cy, ringR, 0, Math.PI * 2);
  ctx.stroke();

  // Fireball: grows and fades in the blast colour.
  const fireT = clamp(t / 0.9, 0, 1);
  ctx.globalAlpha = (1 - fireT) * 0.45;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(cx, cy, r * (0.4 + 0.5 * fireT), 0, Math.PI * 2);
  ctx.fill();

  // Debris: pieces leave the centre, slow down, and fall under a little gravity.
  const debrisAlpha = clamp(1 - t / 1.1, 0, 1);
  ctx.globalAlpha = debrisAlpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.shadowBlur = 0;
  for (const d of debrisFor(seed)) {
    const spread = r * d.speed * 1.4 * (1 - (1 - clamp(t / 1.0, 0, 1)) ** 2);
    const fall = 0.5 * r * 1.6 * t * t;
    const px = cx + Math.cos(d.angle) * spread;
    const py = cy + Math.sin(d.angle) * spread + fall;
    const a = d.angle + d.spin * t;
    const half = r * d.length;
    ctx.beginPath();
    ctx.moveTo(px - Math.cos(a) * half, py - Math.sin(a) * half);
    ctx.lineTo(px + Math.cos(a) * half, py + Math.sin(a) * half);
    ctx.stroke();
  }

  ctx.restore();
}

/** Dust: a few grey-brown puffs that rise and spread slowly. Used when a missile hits terrain. */
export function drawDust(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  t: number,
  color: string,
  seed: number
): void {
  if (t < 0 || t >= EXPLOSION_LIFETIME * 1.6) return;
  const life = EXPLOSION_LIFETIME * 1.6;
  const rng = createRng(seed + 17);
  ctx.save();
  ctx.fillStyle = color;
  for (let i = 0; i < 7; i++) {
    const ox = (rng() * 2 - 1) * r * 0.9;
    const oy = -rng() * r * 0.4 - r * 0.3 * (t / life);
    const grow = r * (0.25 + 0.5 * (t / life) + rng() * 0.15);
    ctx.globalAlpha = (1 - t / life) * 0.22;
    ctx.beginPath();
    ctx.arc(cx + ox, cy + oy, grow, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
