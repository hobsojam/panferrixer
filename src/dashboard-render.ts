import { BUILDING_ART, hasArt, strokeArt } from "./building-art";
import type { Config } from "./config";
import { AVAILABLE_VERBS, VERB_GRID, isLow, selectedVerb, worldFor, type DashboardState, type World, type Verb } from "./dashboard";
import type { Target } from "./local-map";
import { drawGlow } from "./render";
import { findRoute } from "./route";

const VERB_LABELS: Record<Verb, string> = {
  move: "MOVE",
  scan: "SCAN",
  missile: "MISSILE",
  gridDisable: "GRID DISABLE",
};

const TARGET_LABELS: Record<Target["kind"], string> = {
  power: "POWER",
  mine: "MINE",
  commsCentre: "COMMS CENTRE",
  dome: "DOME",
};

/** Pure drawing: reads state and config, never mutates either. */
export function renderDashboard(ctx: CanvasRenderingContext2D, state: DashboardState, cfg: Config): void {
  const { width: w, height: h } = cfg.canvas;
  const c = cfg.colors;
  const world = worldFor(cfg);

  ctx.fillStyle = c.background;
  ctx.fillRect(0, 0, w, h);

  drawNameBar(ctx, cfg);
  drawTracePanel(ctx, state, cfg);
  drawVerbGrid(ctx, state, cfg);
  drawSidePanel(ctx, state, world, cfg);
  drawGauge(ctx, "ENERGY", state.energyCells, cfg.dashboard.energyCells, 330, cfg, "cell", state.time);
  drawGauge(ctx, "SHIELDS", state.shieldPlates, cfg.dashboard.shieldPlates, 384, cfg, "plate", state.time);

  drawText(ctx, hintFor(state), w / 2, h - 28, 14, c.text, 0.8, "monospace");

  ctx.strokeStyle = c.frame;
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, w - 4, h - 4);
}

function hintFor(state: DashboardState): string {
  if (state.mode === "targeting") return "ARROWS MOVE CROSS     SPACE FIRE     ESC CANCEL";
  if (state.mode === "moving") return "ARROWS MOVE POINT     SPACE WALK HERE     ESC CANCEL";
  return "ARROWS SELECT     SPACE ACTIVATE";
}

const PANEL_TOP = 70;
const PANEL_BOTTOM = 300;

function drawNameBar(ctx: CanvasRenderingContext2D, cfg: Config): void {
  const { width: w } = cfg.canvas;
  ctx.strokeStyle = cfg.colors.panelDim;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(20, 16, w - 40, 36);
  drawText(ctx, `FORM  ${cfg.dashboard.formName}`, 36, 34, 16, cfg.colors.text, 1, "monospace", "left");
}

function drawTracePanel(ctx: CanvasRenderingContext2D, state: DashboardState, cfg: Config): void {
  const c = cfg.colors;
  const x = 20;
  const width = 240;
  const height = PANEL_BOTTOM - PANEL_TOP;

  drawPanelFrame(ctx, x, PANEL_TOP, width, height, c.panelDim);
  drawText(ctx, "STATE", x + 10, PANEL_TOP + 14, 12, c.text, 0.7, "monospace", "left");

  const low = isLow(state.energyCells, cfg) || isLow(state.shieldPlates, cfg);
  const agitation = low ? 1.8 : 1;
  const points = cfg.dashboard.tracePoints;
  const midY = PANEL_TOP + height * 0.6;
  const amplitude = height * 0.22;
  const t = state.time;

  ctx.save();
  ctx.beginPath();
  ctx.rect(x + 4, PANEL_TOP + 24, width - 8, height - 28);
  ctx.clip();

  drawGlow(ctx, c.trace, 6, () => {
    ctx.strokeStyle = c.trace;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    for (let i = 0; i < points; i++) {
      const px = x + 8 + (i / (points - 1)) * (width - 16);
      const wobble = Math.sin(i * 0.23 + t * 2.3) * 0.6 + Math.sin(i * 0.91 - t * (low ? 6 : 1.1)) * 0.4;
      const py = midY - wobble * agitation * amplitude;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
  });

  ctx.restore();
}

function drawVerbGrid(ctx: CanvasRenderingContext2D, state: DashboardState, cfg: Config): void {
  const c = cfg.colors;
  const cellW = 190;
  const cellH = 110;
  const gap = 10;
  const originX = 280;

  VERB_GRID.forEach((row, rowIndex) => {
    row.forEach((verb, colIndex) => {
      const x = originX + colIndex * (cellW + gap);
      const y = PANEL_TOP + rowIndex * (cellH + gap);
      const selected = selectedVerb(state) === verb;
      const color = selected ? c.panelSelected : c.panelDim;

      drawPanelFrame(ctx, x, y, cellW, cellH, color);
      drawVerbIcon(ctx, verb, x + cellW / 2, y + 44, 44, color);
      drawText(ctx, VERB_LABELS[verb], x + cellW / 2, y + cellH - 16, 13, color, 1, "monospace");
    });
  });
}

/** The right-hand panel: the local view on top, and a readout beneath it that depends on what the robot is doing. */
function drawSidePanel(ctx: CanvasRenderingContext2D, state: DashboardState, world: World, cfg: Config): void {
  const c = cfg.colors;
  const x = 700;
  const width = 240;
  const height = PANEL_BOTTOM - PANEL_TOP;

  drawPanelFrame(ctx, x, PANEL_TOP, width, height, c.panelDim);
  drawLocalMap(ctx, state, world, cfg, x + 8, PANEL_TOP + 8, width - 16, 118);

  ctx.strokeStyle = c.panelDim;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x + 8, PANEL_TOP + 140);
  ctx.lineTo(x + width - 8, PANEL_TOP + 140);
  ctx.stroke();

  if (state.mode === "targeting") {
    drawTargetingReadout(ctx, state, world, cfg, x);
  } else if (state.mode === "moving") {
    drawMovingReadout(ctx, state, world, cfg, x);
  } else if (state.route.length > 0) {
    drawWalkingReadout(ctx, state, cfg, x);
  } else {
    drawSelectedReadout(ctx, state, cfg, x);
  }
}

function drawSelectedReadout(ctx: CanvasRenderingContext2D, state: DashboardState, cfg: Config, x: number): void {
  const c = cfg.colors;
  const verb = selectedVerb(state);
  const available = AVAILABLE_VERBS.includes(verb);
  drawText(ctx, "SELECTED", x + 14, PANEL_TOP + 158, 12, c.text, 0.7, "monospace", "left");
  drawText(ctx, VERB_LABELS[verb], x + 14, PANEL_TOP + 180, 18, c.panelSelected, 1, "monospace", "left");
  drawText(
    ctx,
    available ? "READY" : "NOT YET BUILT",
    x + 14,
    PANEL_TOP + 204,
    13,
    available ? c.energy : c.panelDim,
    1,
    "monospace",
    "left"
  );
  if (available) {
    const prompt = verb === "move" ? "SPACE TO CHOOSE A POINT" : "SPACE TO FIRE";
    drawText(ctx, prompt, x + 14, PANEL_TOP + 222, 12, c.text, 0.7, "monospace", "left");
  }
}

function drawMovingReadout(ctx: CanvasRenderingContext2D, state: DashboardState, world: World, cfg: Config, x: number): void {
  const c = cfg.colors;
  const reachable = findRoute(state.pos, { x: state.cross.col, y: state.cross.row }, world.map) !== null;
  drawText(ctx, "WALK TO", x + 14, PANEL_TOP + 158, 12, c.text, 0.7, "monospace", "left");
  if (reachable) {
    drawText(ctx, "CHOOSE A POINT", x + 14, PANEL_TOP + 180, 16, c.panelSelected, 1, "monospace", "left");
    drawText(ctx, "SPACE TO WALK THERE", x + 14, PANEL_TOP + 204, 12, c.energy, 1, "monospace", "left");
  } else {
    drawText(ctx, "NO ROUTE THERE", x + 14, PANEL_TOP + 180, 16, c.panelDim, 1, "monospace", "left");
    drawText(ctx, "HIGH GROUND BLOCKS THE WAY", x + 14, PANEL_TOP + 204, 11, c.text, 0.7, "monospace", "left");
  }
}

function drawWalkingReadout(ctx: CanvasRenderingContext2D, state: DashboardState, cfg: Config, x: number): void {
  const c = cfg.colors;
  drawText(ctx, "WALKING", x + 14, PANEL_TOP + 158, 12, c.text, 0.7, "monospace", "left");
  drawText(ctx, `${state.route.length} CELLS TO GO`, x + 14, PANEL_TOP + 180, 16, c.panelSelected, 1, "monospace", "left");
  drawText(ctx, "CHOOSE ANOTHER POINT TO REDIRECT", x + 14, PANEL_TOP + 204, 11, c.text, 0.7, "monospace", "left");
}

function drawTargetingReadout(ctx: CanvasRenderingContext2D, state: DashboardState, world: World, cfg: Config, x: number): void {
  const c = cfg.colors;
  const target = state.target === null ? null : world.targets[state.target];

  drawText(ctx, "TARGETING", x + 14, PANEL_TOP + 158, 12, c.text, 0.7, "monospace", "left");
  if (target) {
    drawText(ctx, TARGET_LABELS[target.kind], x + 14, PANEL_TOP + 180, 18, c.panelSelected, 1, "monospace", "left");
    drawText(ctx, "IN RANGE", x + 14, PANEL_TOP + 204, 13, c.energy, 1, "monospace", "left");
    drawText(ctx, "SPACE TO FIRE", x + 14, PANEL_TOP + 222, 12, c.text, 0.7, "monospace", "left");
  } else {
    drawText(ctx, "NO TARGET IN RANGE", x + 14, PANEL_TOP + 180, 13, c.panelDim, 1, "monospace", "left");
    drawText(ctx, "MOVE THE CROSS", x + 14, PANEL_TOP + 204, 12, c.text, 0.7, "monospace", "left");
  }
}

/**
 * Local view: a window of the whole map, centred on the robot, so the ground moves
 * past it as the robot walks. Valleys are faint dots, ground is dots, high ground is
 * filled. Buildings are always shown. While targeting or choosing a walk point, the
 * cross shows the pointer, and while walking the route and its destination are marked.
 */
function drawLocalMap(
  ctx: CanvasRenderingContext2D,
  state: DashboardState,
  world: World,
  cfg: Config,
  x: number,
  y: number,
  w: number,
  h: number
): void {
  const c = cfg.colors;
  const { viewCols, viewRows } = cfg.localMap;
  const cellW = w / viewCols;
  const cellH = h / viewRows;
  // Screen centre of a map cell. The robot's own cell lands in the middle of the view.
  const toScreen = (col: number, row: number): [number, number] => [
    x + (col - state.pos.x + viewCols / 2) * cellW,
    y + (row - state.pos.y + viewRows / 2) * cellH,
  ];

  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();

  const map = world.map;
  const firstCol = Math.max(0, Math.floor(state.pos.x - viewCols / 2) - 1);
  const lastCol = Math.min(map.cols - 1, Math.ceil(state.pos.x + viewCols / 2) + 1);
  const firstRow = Math.max(0, Math.floor(state.pos.y - viewRows / 2) - 1);
  const lastRow = Math.min(map.rows - 1, Math.ceil(state.pos.y + viewRows / 2) + 1);
  for (let row = firstRow; row <= lastRow; row++) {
    for (let col = firstCol; col <= lastCol; col++) {
      const tier = map.tiers[row][col];
      const [cx, cy] = toScreen(col, row);
      if (tier === 2) {
        ctx.globalAlpha = 0.45;
        ctx.fillStyle = c.panelDim;
        ctx.fillRect(cx - cellW / 2 + 1, cy - cellH / 2 + 1, cellW - 2, cellH - 2);
      } else {
        ctx.globalAlpha = tier === 1 ? 0.3 : 0.12;
        ctx.fillStyle = c.panelDim;
        ctx.beginPath();
        ctx.arc(cx, cy, 1, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  ctx.globalAlpha = 1;

  const targeting = state.mode === "targeting";
  world.targets.forEach((t, index) => {
    const [tx, ty] = toScreen(t.col, t.row);
    const inRange = targeting && state.target === index;
    const color = inRange ? c.panelSelected : c.text;
    const iconWidth = cfg.dashboard.targetIconWidth;
    ctx.globalAlpha = targeting && !inRange ? 0.6 : 1;
    if (hasArt(t.kind)) {
      strokeArt(ctx, BUILDING_ART[t.kind].simple, tx, ty + iconWidth / 4, iconWidth / 2, color, 1.2, inRange ? 6 : 0);
    } else {
      drawPlaceholderMarker(ctx, tx, ty, color, inRange);
    }
    ctx.globalAlpha = 1;
  });

  if (state.mode !== "browse") {
    const [cx, cy] = toScreen(state.cross.col, state.cross.row);
    drawCross(ctx, cx, cy, c.panelSelected);
  }

  if (state.route.length > 0) {
    ctx.globalAlpha = 0.6;
    ctx.fillStyle = c.panelSelected;
    for (const cell of state.route) {
      const [rx, ry] = toScreen(cell.x, cell.y);
      ctx.beginPath();
      ctx.arc(rx, ry, 1.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    const destination = state.route[state.route.length - 1];
    const [wx, wy] = toScreen(destination.x, destination.y);
    drawGlow(ctx, c.panelSelected, 0, () => {
      ctx.strokeStyle = c.panelSelected;
      ctx.lineWidth = 1;
      ctx.strokeRect(wx - 3, wy - 3, 6, 6);
    });
  }

  drawRobot(ctx, x + w / 2, y + h / 2, state.time, c.panelSelected);
  ctx.restore();

  drawText(ctx, "LOCAL", x + 6, y + 8, 11, c.text, 0.7, "monospace", "left");
}

function drawCross(ctx: CanvasRenderingContext2D, cx: number, cy: number, color: string): void {
  drawGlow(ctx, color, 4, () => {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(cx - 5, cy);
    ctx.lineTo(cx + 5, cy);
    ctx.moveTo(cx, cy - 5);
    ctx.lineTo(cx, cy + 5);
    ctx.stroke();
  });
}

function drawRobot(ctx: CanvasRenderingContext2D, mx: number, my: number, time: number, color: string): void {
  const pulse = 1.2 * Math.sin(time * 4);
  drawGlow(ctx, color, 6, () => {
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(mx, my, 7 + pulse, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(mx, my - 4);
    ctx.lineTo(mx + 3, my + 3);
    ctx.lineTo(mx - 3, my + 3);
    ctx.closePath();
    ctx.fill();
  });
}

/** Plain square for a building kind whose art is not designed yet. */
function drawPlaceholderMarker(ctx: CanvasRenderingContext2D, cx: number, cy: number, color: string, glow: boolean): void {
  drawGlow(ctx, color, glow ? 6 : 0, () => {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.2;
    ctx.strokeRect(cx - 3, cy - 3, 6, 6);
  });
}

/**
 * A row of units: energy as rectangular cells, shields as trapezoid plates.
 * The last filled unit flashes when the row is low.
 */
function drawGauge(
  ctx: CanvasRenderingContext2D,
  label: string,
  count: number,
  max: number,
  y: number,
  cfg: Config,
  shape: "cell" | "plate",
  time: number
): void {
  const c = cfg.colors;
  const color = shape === "cell" ? c.energy : c.shield;
  const left = 150;
  const right = cfg.canvas.width - 20;
  const gap = 8;
  const height = 34;
  const unitW = (right - left - gap * (max - 1)) / max;
  const low = isLow(count, cfg);

  drawText(ctx, label, 20, y + height / 2, 14, c.text, 1, "monospace", "left");

  for (let i = 0; i < max; i++) {
    const x = left + i * (unitW + gap);
    const filled = i < count;
    const isLastFilled = filled && i === count - 1;
    let alpha = filled ? 1 : 0.18;
    if (isLastFilled && low) {
      alpha = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(time * 9));
    }

    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    traceUnit(ctx, shape, x, y, unitW, height);
    if (filled) ctx.fill();
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function traceUnit(ctx: CanvasRenderingContext2D, shape: "cell" | "plate", x: number, y: number, w: number, h: number): void {
  ctx.beginPath();
  if (shape === "cell") {
    ctx.rect(x, y, w, h);
  } else {
    const slant = w * 0.12;
    ctx.moveTo(x + slant, y);
    ctx.lineTo(x + w, y);
    ctx.lineTo(x + w - slant, y + h);
    ctx.lineTo(x, y + h);
    ctx.closePath();
  }
}

function drawPanelFrame(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x, y, w, h);
}

function drawVerbIcon(ctx: CanvasRenderingContext2D, verb: Verb, cx: number, cy: number, size: number, color: string): void {
  const half = size / 2;
  drawGlow(ctx, color, 6, () => {
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();

    if (verb === "move") {
      // A chevron on a stem: forward, deliberately plain.
      ctx.moveTo(cx, cy - half);
      ctx.lineTo(cx + half * 0.8, cy);
      ctx.moveTo(cx, cy - half);
      ctx.lineTo(cx - half * 0.8, cy);
      ctx.moveTo(cx, cy - half);
      ctx.lineTo(cx, cy + half);
    } else if (verb === "scan") {
      // Concentric upper arcs, as a sweep, with a centre dot.
      const start = -Math.PI * 0.75;
      const end = -Math.PI * 0.25;
      for (const r of [half * 0.35, half * 0.65, half]) {
        ctx.moveTo(cx + r * Math.cos(start), cy + r * Math.sin(start));
        ctx.arc(cx, cy, r, start, end);
      }
      ctx.moveTo(cx + 2.5, cy);
      ctx.arc(cx, cy, 2.5, 0, Math.PI * 2);
    } else if (verb === "missile") {
      // A pointed body with fins.
      ctx.moveTo(cx, cy - half);
      ctx.lineTo(cx + half * 0.22, cy + half * 0.6);
      ctx.lineTo(cx - half * 0.22, cy + half * 0.6);
      ctx.closePath();
      ctx.moveTo(cx - half * 0.22, cy + half * 0.2);
      ctx.lineTo(cx - half * 0.5, cy + half);
      ctx.moveTo(cx + half * 0.22, cy + half * 0.2);
      ctx.lineTo(cx + half * 0.5, cy + half);
    } else {
      // A lattice square with a slash through it.
      ctx.rect(cx - half, cy - half, size, size);
      for (const f of [-1 / 3, 1 / 3]) {
        ctx.moveTo(cx + f * size, cy - half);
        ctx.lineTo(cx + f * size, cy + half);
        ctx.moveTo(cx - half, cy + f * size);
        ctx.lineTo(cx + half, cy + f * size);
      }
      ctx.moveTo(cx - half, cy + half);
      ctx.lineTo(cx + half, cy - half);
    }

    ctx.stroke();
  });
}

function drawText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  size: number,
  color: string,
  alpha: number,
  font: string,
  align: CanvasTextAlign = "center"
): void {
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.font = `${size}px ${font}`;
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  ctx.fillText(text, x, y);
  ctx.globalAlpha = 1;
}
