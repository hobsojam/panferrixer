import type { Config } from "./config";
import type { DefenceState } from "./defence";
import { drawGlow } from "./render";

/**
 * The hunter's attack. Missiles come down their lanes toward the robot, which is at the
 * bottom of the view. Tracers go up from the robot. Pure drawing: reads state, never changes it.
 */
export function renderDefence(ctx: CanvasRenderingContext2D, s: DefenceState, shieldPlates: number, cfg: Config): void {
  const { width: w, height: h } = cfg.canvas;
  const c = cfg.colors;
  const horizonY = h * 0.3;
  const baseY = h * 0.85;
  const spread = w * 0.4;
  const robotX = w / 2 + s.x * spread;

  ctx.fillStyle = c.background;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = c.ground;
  ctx.fillRect(0, horizonY, w, h - horizonY);

  // Incoming missiles: each one grows as it comes down its lane.
  for (const m of s.missiles) {
    if (m.state !== "flying" || m.spawn > s.elapsed) continue;
    const p = Math.min(1, (s.elapsed - m.spawn) / (m.arrive - m.spawn));
    const x = w / 2 + m.lane * spread * p;
    const y = horizonY + (baseY - horizonY) * p;
    const size = 4 + 14 * p;
    drawGlow(ctx, c.hit, 6, () => {
      ctx.fillStyle = c.hit;
      ctx.beginPath();
      ctx.moveTo(x - size / 2, y - size);
      ctx.lineTo(x + size / 2, y - size);
      ctx.lineTo(x, y);
      ctx.closePath();
      ctx.fill();
    });
  }

  // Missiles that reached the robot flash briefly.
  for (const m of s.missiles) {
    if (m.state !== "hit" || s.elapsed - m.arrive > 0.3) continue;
    const alpha = 1 - (s.elapsed - m.arrive) / 0.3;
    ctx.globalAlpha = alpha;
    drawGlow(ctx, c.crash, 10, () => {
      ctx.fillStyle = c.crash;
      ctx.beginPath();
      ctx.arc(robotX, baseY, 22, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
  }

  // Tracers: a short line up from the robot, fading as it goes.
  for (const t of s.tracers) {
    const age = s.elapsed - t;
    if (age < 0 || age > 0.2) continue;
    ctx.globalAlpha = 1 - age / 0.2;
    ctx.strokeStyle = c.marker;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(robotX, baseY);
    ctx.lineTo(robotX, horizonY);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // The robot: a chevron at the bottom of the view.
  drawGlow(ctx, c.target, 6, () => {
    ctx.strokeStyle = c.target;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(robotX - 18, baseY + 10);
    ctx.lineTo(robotX, baseY - 6);
    ctx.lineTo(robotX + 18, baseY + 10);
    ctx.stroke();
  });

  ctx.fillStyle = c.text;
  ctx.font = "16px monospace";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText("HUNTER ATTACK", 20, 18);
  ctx.textAlign = "right";
  ctx.fillText(`SHIELDS ${shieldPlates} PLATES`, w - 20, 18);
  ctx.textAlign = "center";
  ctx.fillText("ARROWS STEER     SPACE FIRE", w / 2, h - 28);

  ctx.strokeStyle = c.frame;
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, w - 4, h - 4);
}
