import type { Config } from "./config";
import { isWarning, missileDistance, shotDistance, type DefenceState } from "./defence";
import { drawGlow } from "./render";

/**
 * The hunter's attack, seen from the robot (design-notes 2.9a and 4.8): two blue walls
 * flanking a central gap that swing as the view turns, incoming missiles as blue
 * wireframe pyramids that grow as they close, and the two guns' rounds as yellow stars
 * converging on the aim point at the centre. Pure drawing: reads state, never changes it.
 */
export function renderDefence(ctx: CanvasRenderingContext2D, s: DefenceState, shieldPlates: number, cfg: Config): void {
  const { width: w, height: h } = cfg.canvas;
  const c = cfg.colors;
  const pxPerDegree = w / 2 / cfg.defence.viewYawDegrees;
  // Screen position of a bearing, for the current view direction.
  const project = (yaw: number, pitch: number): [number, number] => [
    w / 2 + (yaw - s.yaw) * pxPerDegree,
    h / 2 - (pitch - s.pitch) * pxPerDegree,
  ];

  ctx.fillStyle = c.background;
  ctx.fillRect(0, 0, w, h);
  ctx.save();
  ctx.beginPath();
  ctx.rect(4, 4, w - 8, h - 8);
  ctx.clip();

  drawWalls(ctx, project(0, 0), w, h, cfg);

  // Incoming missiles, nearest drawn last so it overlaps the far ones.
  const flying = s.missiles
    .filter((m) => m.state === "flying" && m.spawn <= s.elapsed)
    .sort((a, b) => missileDistance(b, s.elapsed) - missileDistance(a, s.elapsed));
  for (const m of flying) {
    const [x, y] = project(m.yaw, m.pitch);
    const size = 8 / (0.15 + missileDistance(m, s.elapsed));
    if (x < -size || x > w + size || y < -size || y > h + size) {
      drawEdgeMarker(ctx, x, y, w, h, c.alert);
    } else {
      drawPyramid(ctx, x, y, size, c.shield);
    }
  }

  // A missile shot down bursts where it was.
  for (const m of s.missiles) {
    if (m.state !== "shot" || m.resolvedAt === null) continue;
    const age = s.elapsed - m.resolvedAt;
    if (age > 0.35) continue;
    const [x, y] = project(m.yaw, m.pitch);
    const size = 8 / (0.15 + missileDistance(m, m.resolvedAt));
    ctx.globalAlpha = 1 - age / 0.35;
    drawStar(ctx, x, y, size * (0.6 + age * 3), c.marker);
    ctx.globalAlpha = 1;
  }

  // The two guns' rounds: a star from each side, converging on the bearing it was fired at.
  const guns: [number, number][] = [
    [w * 0.08, h * 0.8],
    [w * 0.92, h * 0.8],
  ];
  for (const shot of s.shots) {
    if (shot.state !== "flying") continue;
    const f = Math.min(1, shotDistance(shot, s.elapsed, cfg));
    const ease = (1 - 1 / (1 + 6 * f)) / (1 - 1 / 7); // fast out of the barrel, slowing into the distance
    const [tx, ty] = project(shot.yaw, shot.pitch);
    for (const [gx, gy] of guns) {
      drawStar(ctx, gx + (tx - gx) * ease, gy + (ty - gy) * ease, 7 * (1 - 0.75 * f), c.marker);
    }
  }

  // The aim point: where the two streams meet.
  ctx.globalAlpha = 0.5;
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

/**
 * Two walls angled in toward a central gap, anchored straight ahead. The outer edges
 * move a little more than the inner ones as the view turns, so the walls swing.
 */
function drawWalls(ctx: CanvasRenderingContext2D, ahead: [number, number], w: number, h: number, cfg: Config): void {
  const c = cfg.colors;
  const [ax, ay] = ahead;
  const shiftX = ax - w / 2;
  const shiftY = ay - h / 2;
  const outerX = w / 2 + shiftX * 1.3;
  const outerY = h / 2 + shiftY * 1.3;
  for (const side of [-1, 1]) {
    const points: [number, number][] = [
      [outerX + side * w * 0.62, outerY - h * 0.34],
      [ax + side * w * 0.11, ay - h * 0.08],
      [ax + side * w * 0.11, ay + h * 0.08],
      [outerX + side * w * 0.62, outerY + h * 0.34],
    ];
    drawGlow(ctx, c.mountain, 6, () => {
      ctx.beginPath();
      ctx.moveTo(points[0][0], points[0][1]);
      for (const [x, y] of points.slice(1)) ctx.lineTo(x, y);
      ctx.closePath();
      ctx.fillStyle = c.mountainFill;
      ctx.fill();
      ctx.strokeStyle = c.mountain;
      ctx.lineWidth = 2;
      ctx.stroke();
    });
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

/** A missile beyond the edge of the view: an arrow on the edge, pointing toward it. */
function drawEdgeMarker(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string): void {
  const inset = 18;
  const ex = Math.max(inset, Math.min(w - inset, x));
  const ey = Math.max(inset, Math.min(h - inset, y));
  const angle = Math.atan2(y - ey, x - ex);
  ctx.save();
  ctx.translate(ex, ey);
  ctx.rotate(angle);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(9, 0);
  ctx.lineTo(-5, -7);
  ctx.lineTo(-5, 7);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}
