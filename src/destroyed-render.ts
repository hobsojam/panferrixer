import { restartAfter } from "./app";
import type { Config } from "./config";
import { drawExplosion, EXPLOSION_LIFETIME } from "./explosion";
import { createRng } from "./rng";

/**
 * Death by shields (design-notes 3, item 17): the robot blows apart, then "ROBOT DESTROYED"
 * fades in with the cause under it. Once the wreck has shown for death.restartAfterSeconds, a
 * prompt offers a new game. Pure drawing: reads its arguments, changes nothing.
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
  drawText(ctx, "SHIELDS DOWN, HULL BREACHED", w / 2, h * 0.42 + 46, 18, c.text, textIn);
  if (elapsed >= cfg.death.restartAfterSeconds) {
    drawText(ctx, "PRESS SPACE TO START AGAIN", w / 2, h - 36, 18, c.text, 1);
  }

  ctx.strokeStyle = c.frame;
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, w - 4, h - 4);
}

/**
 * Death by energy (design-notes 3, item 18): no explosion. Drawn over the frozen screen the
 * robot was on: it flickers as the power fails, fades to black, and collapses to a line, the
 * way a screen switches off. Only then does the cause appear, quietly, and after it the prompt.
 * Pure drawing: reads its arguments, changes nothing.
 */
export function renderPowerDown(ctx: CanvasRenderingContext2D, elapsed: number, seed: number, cfg: Config): void {
  const { width: w, height: h } = cfg.canvas;
  const c = cfg.colors;
  const total = cfg.death.powerDownSeconds;
  const k = clamp(elapsed / total, 0, 1);

  // Flicker: blackouts that come more often as the power fails, over a steady fade.
  const frame = Math.floor(elapsed * 24);
  const roll = createRng(seed + frame * 977)();
  const blackout = k < 0.85 && roll < 0.15 + 0.6 * k ? 0.55 + 0.45 * roll : 0;
  const fade = clamp((k - 0.35) / 0.5, 0, 1);
  ctx.fillStyle = c.background;
  ctx.globalAlpha = Math.max(blackout, fade);
  ctx.fillRect(0, 0, w, h);
  ctx.globalAlpha = 1;

  // The last moment: a bright line across the middle that shrinks to nothing.
  if (k >= 0.85 && k < 1) {
    const shrink = (k - 0.85) / 0.15;
    const half = (w / 2) * (1 - shrink);
    ctx.fillStyle = c.text;
    ctx.globalAlpha = 1 - shrink * 0.5;
    ctx.fillRect(w / 2 - half, h / 2 - 1, half * 2, 2);
    ctx.globalAlpha = 1;
  }

  const textIn = clamp((elapsed - total - 0.3) / 0.8, 0, 1);
  drawText(ctx, "POWER EXHAUSTED", w / 2, h * 0.44, 32, c.panelDim, textIn);
  drawText(ctx, "ALL SYSTEMS OFFLINE", w / 2, h * 0.44 + 36, 16, c.panelDim, textIn);
  if (elapsed >= restartAfter("energy", cfg)) {
    drawText(ctx, "PRESS SPACE TO START AGAIN", w / 2, h - 36, 18, c.text, 1);
  }
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
