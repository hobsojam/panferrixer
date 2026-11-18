import type { Config } from "./config";
import { BUILDING_ART, hasArt, strokeArt } from "./building-art";
import { drawDust, drawExplosion } from "./explosion";
import type { TargetKind } from "./local-map";
import { terminalStart } from "./terrain";
import type { FlightState } from "./types";

// Horizontal lines run past the canvas so banking never exposes a bare corner.
const OVERSCAN = 0.35;

/** Pure drawing: reads state and config, never mutates either. */
export function render(
  ctx: CanvasRenderingContext2D,
  state: FlightState,
  cfg: Config,
  targetKind: TargetKind | null = null,
  shielded: boolean = false
): void {
  const { width: w, height: h } = cfg.canvas;
  const horizonY = h * 0.55;

  ctx.fillStyle = cfg.colors.background;
  ctx.fillRect(0, 0, w, h);

  ctx.save();
  ctx.translate(w / 2, horizonY);
  // state.roll is the missile's bank. The camera rides inside it, so the world
  // counter-rotates: bank right and the horizon's right side rises.
  ctx.rotate(-state.roll);
  ctx.translate(-w / 2, -horizonY);

  // The ground is a filled plane and its top edge is the horizon, which is the
  // flight altitude: terrain standing above that edge is what can kill you.
  ctx.fillStyle = cfg.colors.ground;
  ctx.fillRect(-w * OVERSCAN, horizonY, w * (1 + 2 * OVERSCAN), h * (1 + OVERSCAN));

  if (state.phase !== "hit" && state.phase !== "miss") {
    if (cfg.floor.enabled) drawFloor(ctx, state, cfg, horizonY);
    drawMountains(ctx, state, cfg, horizonY);
  }

  if (state.phase === "terminal" || state.phase === "hit") {
    drawTarget(ctx, state, cfg, horizonY, targetKind, shielded);
  }

  if (state.phase === "hit") {
    drawHitBurst(ctx, state, cfg, horizonY, shielded);
  }

  if (state.phase === "crash") {
    drawCrash(ctx, state, cfg);
  }

  ctx.restore();

  if (state.phase === "miss") {
    drawText(ctx, "MISSED", w / 2, h / 2, 48, cfg.colors.text, Math.min(1, state.resultElapsed * 2));
  }

  if (state.phase === "hit" && shielded) {
    drawText(ctx, "DEFLECTED", w / 2, h / 2, 48, cfg.colors.shield, Math.min(1, state.resultElapsed * 2));
  }

  drawMarker(ctx, state, cfg);
  drawFrame(ctx, cfg);

  if (state.phase === "hit" || state.phase === "crash" || state.phase === "miss") {
    drawText(ctx, "PRESS SPACE TO RETURN TO DASHBOARD", w / 2, h - 36, 18, cfg.colors.text, 1);
  }
}

function drawFrame(ctx: CanvasRenderingContext2D, cfg: Config): void {
  const { width: w, height: h } = cfg.canvas;
  ctx.strokeStyle = cfg.colors.frame;
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, w - 4, h - 4);
}

function visibleWindow(cfg: Config): number {
  return cfg.terrain.bandSpacing * 8;
}

/** Ground lines at fixed world depths, so they sweep toward the viewer as the missile flies. */
function drawFloor(ctx: CanvasRenderingContext2D, state: FlightState, cfg: Config, horizonY: number): void {
  const { width: w, height: h } = cfg.canvas;
  const { lineSpacing, lineCount, nearAlpha, farAlpha } = cfg.floor;
  const cam = cfg.camera;
  const firstDepth = Math.ceil(state.depth / lineSpacing) * lineSpacing;

  ctx.strokeStyle = cfg.colors.floor;
  ctx.lineWidth = 1;

  for (let i = 0; i < lineCount; i++) {
    const ahead = firstDepth + i * lineSpacing - state.depth;
    const y = horizonY + (cam.height * cam.focalLength) / Math.max(ahead, cam.minDepth);
    if (y > h) continue;

    ctx.globalAlpha = lerp(nearAlpha, farAlpha, i / lineCount);
    ctx.beginPath();
    ctx.moveTo(-w * OVERSCAN, y);
    ctx.lineTo(w + w * OVERSCAN, y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function drawMountains(ctx: CanvasRenderingContext2D, state: FlightState, cfg: Config, horizonY: number): void {
  const { width: w } = cfg.canvas;
  const cam = cfg.camera;
  const cue = cfg.depthCue;
  const window = visibleWindow(cfg);

  const visibleBands = state.terrain.bands
    .filter((b) => b.depth >= state.depth && b.depth - state.depth <= window)
    .sort((a, b) => b.depth - a.depth); // draw far-to-near so near mountains occlude far ones

  for (const band of visibleBands) {
    const ahead = band.depth - state.depth;
    const scale = cam.focalLength / Math.max(ahead, cam.minDepth);
    const fade = clamp(ahead / window, 0, 1);
    const baseY = horizonY + cam.height * scale; // the ground plane rises to the horizon with distance

    for (const peak of band.peaks) {
      const centerX = w / 2 + (peak.center - state.x) * cam.trackHalfWidth * scale;
      const halfWidthPx = peak.halfWidth * cam.trackHalfWidth * scale;

      const heightPx = peak.height * scale;
      ctx.beginPath();
      ctx.moveTo(centerX - halfWidthPx, baseY);
      for (const point of peak.profile) {
        ctx.lineTo(centerX + point.nx * halfWidthPx, baseY - point.ny * heightPx);
      }
      ctx.lineTo(centerX + halfWidthPx, baseY);
      ctx.closePath();
      ctx.fillStyle = cfg.colors.mountainFill;
      ctx.fill();

      drawGlow(ctx, cfg.colors.mountain, 4, () => {
        ctx.globalAlpha = lerp(cue.nearAlpha, cue.farAlpha, fade);
        ctx.strokeStyle = cfg.colors.mountain;
        ctx.lineWidth = lerp(cue.nearLineWidth, cue.farLineWidth, fade);
        ctx.stroke();
      });
    }
  }
}

/** The target sits on the launch heading, so both its art and the hit burst share this anchor. */
function targetAnchor(state: FlightState, cfg: Config, horizonY: number): { centerX: number; centerY: number; size: number } {
  const { totalDistance } = state;
  const approachStart = terminalStart(totalDistance, cfg);
  const progress = clamp((state.depth - approachStart) / (totalDistance - approachStart), 0, 1);
  const size = 30 + 230 * progress;

  return {
    centerX: cfg.canvas.width / 2 - state.x * (cfg.canvas.width / 2) * 0.9,
    centerY: horizonY - size * 0.4,
    size,
  };
}

/** A faint ring over a shielded building. On a deflected hit it flashes and fades out. */
function drawShieldRing(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, color: string, alpha: number): void {
  if (alpha <= 0) return;
  drawGlow(ctx, color, 6, () => {
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(cx, cy, size * 0.6, size * 0.5, 0, 0, Math.PI * 2);
    ctx.stroke();
  });
  ctx.globalAlpha = 1;
}

function drawTarget(
  ctx: CanvasRenderingContext2D,
  state: FlightState,
  cfg: Config,
  horizonY: number,
  kind: TargetKind | null,
  shielded: boolean
): void {
  const { centerX, centerY, size } = targetAnchor(state, cfg, horizonY);
  // A deflected hit leaves the building standing, so only an unshielded hit makes it collapse.
  const collapsing = state.phase === "hit" && !shielded;
  if (shielded) {
    const ringAlpha = state.phase === "hit" ? clamp(1 - state.resultElapsed / 0.6, 0, 0.5) : 0.35;
    drawShieldRing(ctx, centerX, centerY, size, cfg.colors.shield, ringAlpha);
  }

  if (kind && hasArt(kind)) {
    // Terminal phase: the chosen building is drawn in full detail, standing on the ground (base at the horizon).
    // On an unshielded hit it shakes and fades while the blast runs, so it reads as collapsing.
    const hit = collapsing ? state.resultElapsed : null;
    const fade = hit === null ? 1 : clamp(1 - hit / 0.8, 0, 1);
    const shake = hit === null || hit > 0.3 ? 0 : Math.sin(hit * 80) * size * 0.02;
    ctx.save();
    ctx.globalAlpha = fade;
    strokeArt(ctx, BUILDING_ART[kind]!.full, centerX + shake, horizonY, size / 2, cfg.colors.target, 2, 8);
    ctx.restore();
    return;
  }

  drawGlow(ctx, cfg.colors.target, 8, () => {
    ctx.strokeStyle = cfg.colors.target;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(centerX, centerY - size / 2);
    ctx.lineTo(centerX + size / 2, centerY);
    ctx.lineTo(centerX, centerY + size / 2);
    ctx.lineTo(centerX - size / 2, centerY);
    ctx.closePath();
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(centerX - size / 3, centerY);
    ctx.lineTo(centerX + size / 3, centerY);
    ctx.moveTo(centerX, centerY - size / 3);
    ctx.lineTo(centerX, centerY + size / 3);
    ctx.stroke();
  });
}

/** A missile hit on the building: the blast is centred on it, sized to it. */
function drawHitBurst(ctx: CanvasRenderingContext2D, state: FlightState, cfg: Config, horizonY: number, shielded: boolean): void {
  const { centerX, centerY, size } = targetAnchor(state, cfg, horizonY);
  // A deflected missile bursts on the shield, in the shield's colour, rather than on the building.
  const color = shielded ? cfg.colors.shield : cfg.colors.hit;
  drawExplosion(ctx, centerX, centerY, size * 0.6, state.resultElapsed, color, cfg.colors.text, state.seed);
}

/** A missile crash into terrain: a blast with dust, centred on the view. */
function drawCrash(ctx: CanvasRenderingContext2D, state: FlightState, cfg: Config): void {
  const { width: w, height: h } = cfg.canvas;
  const centerX = w / 2;
  const centerY = h * 0.5;
  const radius = 110;
  drawDust(ctx, centerX, centerY, radius, state.resultElapsed, cfg.colors.mountain, state.seed);
  drawExplosion(ctx, centerX, centerY, radius, state.resultElapsed, cfg.colors.crash, cfg.colors.text, state.seed);
}

function drawMarker(ctx: CanvasRenderingContext2D, state: FlightState, cfg: Config): void {
  const { width: w } = cfg.canvas;
  // Bearing to the target, not the missile's own offset: drift right and the
  // target sits off to the left, so the player steers toward the marker.
  const markerX = w / 2 - clamp(state.x, -1, 1) * (w / 2 - 20);
  const y = 16;

  drawGlow(ctx, cfg.colors.marker, 8, () => {
    ctx.fillStyle = cfg.colors.marker;
    ctx.beginPath();
    ctx.moveTo(markerX - 8, y);
    ctx.lineTo(markerX + 8, y);
    ctx.lineTo(markerX, y + 14);
    ctx.closePath();
    ctx.fill();
  });
}

function drawText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  size: number,
  color: string,
  alpha: number
): void {
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.font = `${size}px monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x, y);
  ctx.globalAlpha = 1;
}

export function drawGlow(ctx: CanvasRenderingContext2D, color: string, blur: number, draw: () => void): void {
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = blur;
  draw();
  ctx.restore();
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
