import type { Config } from "./config";
import { drawExplosion, EXPLOSION_LIFETIME } from "./explosion";

/**
 * Death (design-notes 3, item 17): the robot blows apart, then "ROBOT DESTROYED" fades in.
 * Once the wreck has shown for death.restartAfterSeconds, a prompt offers a new game.
 * Pure drawing: reads its arguments, changes nothing.
 */
export function renderDestroyed(ctx: CanvasRenderingContext2D, elapsed: number, seed: number, cfg: Config): void {
  const { width: w, height: h } = cfg.canvas;
  const c = cfg.colors;
  ctx.fillStyle = c.background;
  ctx.fillRect(0, 0, w, h);

  // Seen from the robot: the blast fills the view, then a second, smaller one as it breaks up.
  drawExplosion(ctx, w / 2, h / 2, h * 0.45, elapsed, c.crash, c.text, seed);
  drawExplosion(ctx, w / 2 + w * 0.12, h / 2 + h * 0.08, h * 0.25, elapsed - 0.35, c.crash, c.text, seed + 1);

  const textIn = clamp((elapsed - EXPLOSION_LIFETIME * 0.6) / 0.6, 0, 1);
  drawText(ctx, "ROBOT DESTROYED", w / 2, h * 0.42, 48, c.alert, textIn);
  drawText(ctx, "SHIELDS GONE", w / 2, h * 0.42 + 46, 18, c.text, textIn);
  if (elapsed >= cfg.death.restartAfterSeconds) {
    drawText(ctx, "PRESS SPACE TO START AGAIN", w / 2, h - 36, 18, c.text, 1);
  }

  ctx.strokeStyle = c.frame;
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, w - 4, h - 4);
}

function drawText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, color: string, alpha: number): void {
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.font = `${size}px monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x, y);
  ctx.restore();
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
