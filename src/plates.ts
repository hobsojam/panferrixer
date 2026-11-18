/**
 * Armour plates, shared by the dashboard and the defence view so both show the shields
 * the same way (design-notes 4.6 and 4.9). Each plate absorbs several hits before it
 * breaks; the top plate shows the hits it has taken as cracks.
 */

/** The plate outline: a slanted trapezoid, so plates are never confused with battery cells. */
export function tracePlate(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  const slant = w * 0.12;
  ctx.beginPath();
  ctx.moveTo(x + slant, y);
  ctx.lineTo(x + w, y);
  ctx.lineTo(x + w - slant, y + h);
  ctx.lineTo(x, y + h);
  ctx.closePath();
}

/**
 * Cracks across a damaged plate: one jagged line per hit taken. Drawn in the background
 * colour, so they read as breaks in the filled plate.
 */
export function drawCracks(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, hits: number, color: string): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1.5, h * 0.08);
  for (let i = 0; i < hits; i++) {
    // Each crack starts a little further along the plate and zigzags down it.
    const start = x + w * (0.3 + 0.3 * i);
    ctx.beginPath();
    ctx.moveTo(start, y);
    ctx.lineTo(start - w * 0.1, y + h * 0.35);
    ctx.lineTo(start + w * 0.06, y + h * 0.6);
    ctx.lineTo(start - w * 0.08, y + h);
    ctx.stroke();
  }
  ctx.restore();
}
