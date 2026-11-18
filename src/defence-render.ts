import type { Config } from "./config";
import { HILL_SPAN, HILL_STEP, isWarning, missileBearing, missileDistance, shotDistance, type DefenceState } from "./defence";
import { drawGlow } from "./render";

const EYE_HEIGHT = 1; // the robot's eye above the ground, in the ground grid's units
const GRID_LINES_ACROSS = [-12, -8, -5, -3, -1.5, 0, 1.5, 3, 5, 8, 12]; // lines running toward the horizon
const GRID_LINES_DEEP = [1.6, 2.5, 4, 6.5, 10, 16, 26, 42]; // lines parallel to the horizon

type Project = (yaw: number, pitch: number) => [number, number];

/**
 * The hunter's attack, seen from the robot (design-notes 4.8): a horizon and ground that
 * slide as the view turns, a hill silhouette with the launcher on it, incoming missiles as
 * blue wireframe pyramids fanning out from the launcher, and the two guns' rounds as yellow
 * stars converging on the aim point. A heading strip along the top shows the arc, the
 * launcher and every missile. Pure drawing: reads state, never changes it.
 */
export function renderDefence(ctx: CanvasRenderingContext2D, s: DefenceState, shieldPlates: number, cfg: Config): void {
  const { width: w, height: h } = cfg.canvas;
  const c = cfg.colors;
  const pxPerDegree = w / 2 / cfg.defence.viewYawDegrees;
  // Screen position of a bearing, for the current view direction.
  const project: Project = (yaw, pitch) => [w / 2 + (yaw - s.yaw) * pxPerDegree, h / 2 - (pitch - s.pitch) * pxPerDegree];

  ctx.fillStyle = c.background;
  ctx.fillRect(0, 0, w, h);
  ctx.save();
  ctx.beginPath();
  ctx.rect(4, 4, w - 8, h - 8);
  ctx.clip();

  drawGround(ctx, project, w, h, cfg);
  drawHills(ctx, s, project, cfg);
  drawLauncher(ctx, s, project, cfg);

  // Incoming missiles, nearest drawn last so it overlaps the far ones.
  const flying = s.missiles
    .filter((m) => m.state === "flying" && m.spawn <= s.elapsed)
    .sort((a, b) => missileDistance(b, s.elapsed) - missileDistance(a, s.elapsed));
  for (const m of flying) {
    const b = missileBearing(m, s.elapsed);
    const [x, y] = project(b.yaw, b.pitch);
    drawPyramid(ctx, x, y, missileSize(missileDistance(m, s.elapsed)), c.shield);
  }

  // A missile shot down bursts where it was.
  for (const m of s.missiles) {
    if (m.state !== "shot" || m.resolvedAt === null) continue;
    const age = s.elapsed - m.resolvedAt;
    if (age > 0.35) continue;
    const b = missileBearing(m, m.resolvedAt);
    const [x, y] = project(b.yaw, b.pitch);
    ctx.globalAlpha = 1 - age / 0.35;
    drawStar(ctx, x, y, missileSize(missileDistance(m, m.resolvedAt)) * (0.6 + age * 3), c.marker);
    ctx.globalAlpha = 1;
  }

  // The two guns' rounds: a star from each side, converging on the bearing it was fired at.
  const guns: [number, number][] = [
    [w * 0.08, h * 0.8],
    [w * 0.92, h * 0.8],
  ];
  for (const shot of s.shots) {
    if (shot.state !== "flying") continue;
    const f = Math.min(1, shotDistance(shot, s.elapsed, cfg) / cfg.defence.gunRange);
    const ease = (1 - 1 / (1 + 6 * f)) / (1 - 1 / 7); // fast out of the barrel, slowing into the distance
    const [tx, ty] = project(shot.yaw, shot.pitch);
    for (const [gx, gy] of guns) {
      drawStar(ctx, gx + (tx - gx) * ease, gy + (ty - gy) * ease, 7 * (1 - 0.75 * f), c.marker);
    }
  }

  // The aim point: where the two streams meet.
  ctx.globalAlpha = 0.6;
  ctx.strokeStyle = c.marker;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    ctx.moveTo(w / 2 + dx * 5, h / 2 + dy * 5);
    ctx.lineTo(w / 2 + dx * 11, h / 2 + dy * 11);
  }
  ctx.stroke();
  ctx.globalAlpha = 1;

  // A missile that got through flashes the whole view.
  for (const m of s.missiles) {
    if (m.state !== "hit" || m.resolvedAt === null) continue;
    const age = s.elapsed - m.resolvedAt;
    if (age > 0.3) continue;
    ctx.globalAlpha = 0.35 * (1 - age / 0.3);
    ctx.fillStyle = c.crash;
    ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 1;
  }
  ctx.restore();

  drawHeadingStrip(ctx, s, w, cfg);

  if (isWarning(s, cfg) && Math.floor(s.elapsed * 4) % 2 === 0) {
    ctx.fillStyle = c.alert;
    ctx.font = "bold 28px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("INCOMING", w / 2, h * 0.3);
  }

  ctx.fillStyle = c.text;
  ctx.font = "16px monospace";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText("HUNTER ATTACK", 20, 18);
  ctx.textAlign = "right";
  ctx.fillText(`SHIELDS ${shieldPlates} PLATES`, w - 20, 18);
  ctx.textAlign = "center";
  ctx.fillText("ARROWS AIM     HOLD SPACE FIRE", w / 2, h - 28);

  ctx.strokeStyle = c.frame;
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, w - 4, h - 4);
}

/** A missile's size on screen: small on the launcher, filling the view as it arrives. */
function missileSize(distance: number): number {
  return 8 / (0.15 + distance);
}

/** Bearing of a point on the ground, seen from the robot's eye. */
function groundBearing(x: number, z: number): [number, number] {
  const deg = 180 / Math.PI;
  return [Math.atan2(x, z) * deg, -Math.atan2(EYE_HEIGHT, Math.hypot(x, z)) * deg];
}

/**
 * The ground below the horizon, with a sparse grid fixed to the world: lines running
 * toward the horizon slide as the view turns, and lines across it close up with distance.
 */
function drawGround(ctx: CanvasRenderingContext2D, project: Project, w: number, h: number, cfg: Config): void {
  const c = cfg.colors;
  const [, horizonY] = project(0, 0);
  ctx.fillStyle = c.ground;
  ctx.fillRect(0, horizonY, w, h - horizonY);

  ctx.strokeStyle = c.floor;
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.55;
  ctx.beginPath();
  for (const x of GRID_LINES_ACROSS) {
    for (let i = 0, z = 0.6; i < 40; i++, z *= 1.18) {
      const [px, py] = project(...groundBearing(x, z));
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
  }
  for (const z of GRID_LINES_DEEP) {
    for (let a = -80; a <= 80; a += 4) {
      const [px, py] = project(...groundBearing(z * Math.tan((a * Math.PI) / 180), z));
      if (a === -80) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
  }
  ctx.stroke();
  ctx.globalAlpha = 1;

  ctx.strokeStyle = c.mountain;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, horizonY);
  ctx.lineTo(w, horizonY);
  ctx.stroke();
}

/** A low hill silhouette along the horizon, from the attack's seed. */
function drawHills(ctx: CanvasRenderingContext2D, s: DefenceState, project: Project, cfg: Config): void {
  const c = cfg.colors;
  const points = s.hills.map((height, i) => project(-HILL_SPAN + i * HILL_STEP, height));
  const [, horizonY] = project(0, 0);
  drawGlow(ctx, c.mountain, 4, () => {
    ctx.beginPath();
    ctx.moveTo(points[0][0], horizonY);
    for (const [x, y] of points) ctx.lineTo(x, y);
    ctx.lineTo(points[points.length - 1][0], horizonY);
    ctx.closePath();
    ctx.fillStyle = c.mountainFill;
    ctx.fill();
    ctx.strokeStyle = c.mountain;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  });
}

/** The hunter's launcher on the horizon: a placeholder marker, with a flash as each missile leaves. */
function drawLauncher(ctx: CanvasRenderingContext2D, s: DefenceState, project: Project, cfg: Config): void {
  const c = cfg.colors;
  const [x, y] = project(s.launcher.yaw, s.launcher.pitch);
  drawGlow(ctx, c.alert, 6, () => {
    ctx.strokeStyle = c.alert;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x - 7, y + 3);
    ctx.lineTo(x, y - 6);
    ctx.lineTo(x + 7, y + 3);
    ctx.closePath();
    ctx.stroke();
  });
  if (s.missiles.some((m) => s.elapsed >= m.spawn && s.elapsed - m.spawn < 0.12)) {
    drawGlow(ctx, c.marker, 12, () => {
      ctx.fillStyle = c.marker;
      ctx.beginPath();
      ctx.arc(x, y - 7, 5, 0, Math.PI * 2);
      ctx.fill();
    });
  }
}

/**
 * Along the top: the turret's arc with its edges marked, the part of it in view, the
 * launcher, and a tick for every missile in the air, including those off screen.
 */
function drawHeadingStrip(ctx: CanvasRenderingContext2D, s: DefenceState, w: number, cfg: Config): void {
  const c = cfg.colors;
  const d = cfg.defence;
  const span = d.arcYawDegrees + d.viewYawDegrees; // everything that can be in view at full turn
  const left = w * 0.22;
  const right = w * 0.78;
  const y = 52;
  const at = (yaw: number) => left + ((yaw - s.launcher.yaw + span) / (2 * span)) * (right - left);

  ctx.strokeStyle = c.panelDim;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(left, y);
  ctx.lineTo(right, y);
  for (let deg = -Math.floor(span / 10) * 10; deg <= span; deg += 10) {
    ctx.moveTo(at(deg), y - 3);
    ctx.lineTo(at(deg), y + 3);
  }
  ctx.stroke();

  // The arc's edges: the view centre can turn no further.
  ctx.strokeStyle = c.text;
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (const edge of [-d.arcYawDegrees, d.arcYawDegrees]) {
    ctx.moveTo(at(edge), y - 8);
    ctx.lineTo(at(edge), y + 8);
  }
  ctx.stroke();

  // The part of the world in view.
  ctx.globalAlpha = 0.7;
  ctx.strokeStyle = c.marker;
  ctx.lineWidth = 1;
  ctx.strokeRect(at(s.yaw - d.viewYawDegrees), y - 6, at(s.yaw + d.viewYawDegrees) - at(s.yaw - d.viewYawDegrees), 12);
  ctx.globalAlpha = 1;

  // The launcher, below the line.
  const lx = at(s.launcher.yaw);
  ctx.fillStyle = c.alert;
  ctx.beginPath();
  ctx.moveTo(lx, y + 4);
  ctx.lineTo(lx - 5, y + 11);
  ctx.lineTo(lx + 5, y + 11);
  ctx.closePath();
  ctx.fill();

  // Every missile in the air, above the line.
  ctx.fillStyle = c.shield;
  for (const m of s.missiles) {
    if (m.state !== "flying" || m.spawn > s.elapsed) continue;
    const mx = at(missileBearing(m, s.elapsed).yaw);
    ctx.beginPath();
    ctx.moveTo(mx, y - 4);
    ctx.lineTo(mx - 4, y - 11);
    ctx.lineTo(mx + 4, y - 11);
    ctx.closePath();
    ctx.fill();
  }
}

/** A wireframe pyramid seen nose-on: a triangular base with edges running to the tip. */
function drawPyramid(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string): void {
  const corners = [-90, 30, 150].map((a) => [x + Math.cos((a * Math.PI) / 180) * size, y + Math.sin((a * Math.PI) / 180) * size * 0.8]);
  const tip = [x, y - size * 0.15];
  drawGlow(ctx, color, 6, () => {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(corners[0][0], corners[0][1]);
    ctx.lineTo(corners[1][0], corners[1][1]);
    ctx.lineTo(corners[2][0], corners[2][1]);
    ctx.closePath();
    for (const [cx, cy] of corners) {
      ctx.moveTo(tip[0], tip[1]);
      ctx.lineTo(cx, cy);
    }
    ctx.stroke();
  });
}

/** A small star: the guns' rounds, and the burst of a missile shot down. */
function drawStar(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string): void {
  drawGlow(ctx, color, 6, () => {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 4;
      ctx.moveTo(x - Math.cos(a) * size, y - Math.sin(a) * size);
      ctx.lineTo(x + Math.cos(a) * size, y + Math.sin(a) * size);
    }
    ctx.stroke();
  });
}
