import { latestEvent } from "./events";
import { cracksOn, plateToMend, standing } from "./armour";
import { ART, fittingStrokes, hasArt, strokeArt } from "./building-art";
import type { Config } from "./config";
import { AVAILABLE_VERBS, VERB_GRID, blipStrength, buildingCells, gridDisableReady, isHidden, isInsideBuilding, isLow, isPaused, isResting, isSuppressed, networkMarkers, positionOf, ringReach, routeTo, selectedVerb, worldFor, type DashboardState, type World, type Verb } from "./dashboard";
import type { Target } from "./local-map";
import { drawCracks, tracePlate } from "./plates";
import { drawGlow } from "./render";
import { cellKey } from "./route";

const VERB_LABELS: Record<Verb, string> = {
  move: "MOVE",
  scan: "SCAN",
  missile: "MISSILE",
  gridDisable: "GRID DISABLE",
};

/** How long the map shows that a comms centre has reported the robot. */
const REPORT_WARNING_SECONDS = 4;

const TARGET_LABELS: Record<Target["kind"], string> = {
  power: "POWER",
  hunter: "HUNTER",
  defender: "DEFENDER",
  patroller: "PATROLLER",
  hauler: "HAULER",
  listener: "LISTENER",
  assessor: "ASSESSOR",
  mine: "MINE",
  commsCentre: "COMMS CENTRE",
  dome: "DOME",
};

/** Pure drawing: reads state and config, never mutates either. */
export function renderDashboard(ctx: CanvasRenderingContext2D, state: DashboardState, cfg: Config, soundOn: boolean = true): void {
  const { width: w, height: h } = cfg.canvas;
  const c = cfg.colors;
  const world = worldFor(cfg);

  ctx.fillStyle = c.background;
  ctx.fillRect(0, 0, w, h);

  drawNameBar(ctx, cfg);
  drawTracePanel(ctx, state, cfg);
  drawVerbGrid(ctx, state, cfg);
  drawSidePanel(ctx, state, world, cfg);
  drawGauge(ctx, "ENERGY", energyUnits(state.energyCells, cfg.dashboard.energyCells, cfg), 330, cfg, "cell", state.time);
  const rest = isResting(state, world);
  drawGauge(ctx, "SHIELDS", plateUnits(state.plates, rest ? state.mendProgress : null, cfg), 384, cfg, "plate", state.time);
  drawGauge(ctx, "MISSILES", rackUnits(state.missiles, cfg), 438, cfg, "round", state.time);
  if (isLow(state.energyCells, cfg)) drawLowPower(ctx, state.time, cfg);
  else if (rest) drawText(ctx, "RECHARGING", cfg.canvas.width / 2, 316, 15, cfg.colors.shield, 1, "monospace");

  drawText(ctx, hintFor(state, soundOn), w / 2, h - 28, 14, c.text, 0.8, "monospace");

  ctx.strokeStyle = c.frame;
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, w - 4, h - 4);
}

function hintFor(state: DashboardState, soundOn: boolean): string {
  if (state.mode === "targeting") {
    return state.purpose === "gridDisable" ? "ARROWS MOVE CROSS     SPACE CUT POWER     ESC CANCEL" : "ARROWS MOVE CROSS     SPACE FIRE     ESC CANCEL";
  }
  if (state.mode === "moving") return "ARROWS MOVE POINT     SPACE WALK HERE     ESC CANCEL";
  return `ARROWS SELECT     SPACE ACTIVATE     M SOUND ${soundOn ? "ON" : "OFF"}`;
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

  const low = isLow(state.energyCells, cfg) || isLow(standing(state.plates), cfg);
  // Resting calms the trace (#82); low power or armour agitates it.
  const calm = !low && isResting(state, worldFor(cfg));
  const agitation = low ? 1.8 : calm ? 0.5 : 1;
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
      const wobble = Math.sin(i * 0.23 + t * 2.3) * 0.6 + Math.sin(i * 0.91 - t * (low ? 6 : calm ? 0.5 : 1.1)) * 0.4;
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
      const selected = !state.mapSelected && selectedVerb(state) === verb;
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

  drawPanelFrame(ctx, x, PANEL_TOP, width, height, state.mapSelected ? c.panelSelected : c.panelDim);
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
  } else if (state.mapSelected) {
    drawMapReadout(ctx, state, cfg, x);
  } else {
    drawSelectedReadout(ctx, state, cfg, x);
  }
}

function drawMapReadout(ctx: CanvasRenderingContext2D, state: DashboardState, cfg: Config, x: number): void {
  const c = cfg.colors;
  drawText(ctx, "MAP", x + 14, PANEL_TOP + 158, 12, c.text, 0.7, "monospace", "left");
  drawText(ctx, state.zoom === "local" ? "LOCAL VIEW" : "FULL MAP", x + 14, PANEL_TOP + 180, 18, c.panelSelected, 1, "monospace", "left");
  drawText(ctx, "SPACE TO CHANGE ZOOM", x + 14, PANEL_TOP + 204, 12, c.text, 0.7, "monospace", "left");
  drawText(ctx, "LEFT TO RETURN TO VERBS", x + 14, PANEL_TOP + 222, 11, c.text, 0.7, "monospace", "left");
}

function drawSelectedReadout(ctx: CanvasRenderingContext2D, state: DashboardState, cfg: Config, x: number): void {
  const c = cfg.colors;
  const verb = selectedVerb(state);
  if (verb === "scan") {
    drawScanReadout(ctx, state, cfg, x);
    return;
  }
  if (verb === "gridDisable") {
    drawGridReadout(ctx, state, cfg, x);
    return;
  }
  const available = AVAILABLE_VERBS.includes(verb);
  const empty = verb === "missile" && state.missiles <= 0;
  drawText(ctx, "SELECTED", x + 14, PANEL_TOP + 158, 12, c.text, 0.7, "monospace", "left");
  drawText(ctx, VERB_LABELS[verb], x + 14, PANEL_TOP + 180, 18, c.panelSelected, 1, "monospace", "left");
  drawText(
    ctx,
    empty ? "RACK EMPTY" : !available ? "NOT YET BUILT" : verb === "missile" ? `READY  ${state.missiles} IN RACK` : "READY",
    x + 14,
    PANEL_TOP + 204,
    13,
    available && !empty ? c.energy : c.panelDim,
    1,
    "monospace",
    "left"
  );
  if (available && !empty) {
    const prompt = verb === "move" ? "SPACE TO CHOOSE A POINT" : "SPACE TO FIRE";
    drawText(ctx, prompt, x + 14, PANEL_TOP + 222, 12, c.text, 0.7, "monospace", "left");
  }
}

/** Grid disable: whether it is ready, how long until it is, and whether this network's shields are down. */
function drawGridReadout(ctx: CanvasRenderingContext2D, state: DashboardState, cfg: Config, x: number): void {
  const c = cfg.colors;
  const ready = gridDisableReady(state);
  const charging = Math.ceil(state.gridReadyAt - state.time);
  drawText(ctx, "SELECTED", x + 14, PANEL_TOP + 158, 12, c.text, 0.7, "monospace", "left");
  drawText(ctx, VERB_LABELS.gridDisable, x + 14, PANEL_TOP + 180, 18, c.panelSelected, 1, "monospace", "left");
  drawText(ctx, ready ? "READY" : `CHARGING ${charging}`, x + 14, PANEL_TOP + 204, 13, ready ? c.energy : c.panelDim, 1, "monospace", "left");
  if (isSuppressed(state, state.location)) {
    const down = Math.ceil((state.suppressedUntil[state.location] ?? 0) - state.time);
    drawText(ctx, `NETWORK POWER DOWN ${down}`, x + 14, PANEL_TOP + 222, 12, c.shield, 1, "monospace", "left");
  } else if (ready) {
    drawText(ctx, "SPACE TO CHOOSE A POWER STATION", x + 14, PANEL_TOP + 222, 12, c.text, 0.7, "monospace", "left");
  }
}

function drawMovingReadout(ctx: CanvasRenderingContext2D, state: DashboardState, world: World, cfg: Config, x: number): void {
  const c = cfg.colors;
  const reachable = routeTo(state, state.cross, world) !== null;
  const onBuilding = buildingCells(state, world).has(cellKey(world.map, state.cross.col, state.cross.row));
  drawText(ctx, "WALK TO", x + 14, PANEL_TOP + 158, 12, c.text, 0.7, "monospace", "left");
  if (reachable) {
    drawText(ctx, "CHOOSE A POINT", x + 14, PANEL_TOP + 180, 16, c.panelSelected, 1, "monospace", "left");
    drawText(ctx, onBuilding ? "SPACE TO WALK BESIDE IT" : "SPACE TO WALK THERE", x + 14, PANEL_TOP + 204, 12, c.energy, 1, "monospace", "left");
  } else {
    drawText(ctx, "NO ROUTE THERE", x + 14, PANEL_TOP + 180, 16, c.panelDim, 1, "monospace", "left");
    drawText(ctx, "THE WAY IS BLOCKED", x + 14, PANEL_TOP + 204, 11, c.text, 0.7, "monospace", "left");
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
    // What the target will do to the missile (#112).
    const warns = [target.defences?.pointDefence ? "GUNS" : null, target.defences?.jammer ? "JAMS" : null].filter(Boolean).join(" ");
    if (warns) drawText(ctx, warns, x + 100, PANEL_TOP + 204, 13, c.tracer, 1, "monospace", "left");
    drawText(ctx, state.purpose === "gridDisable" ? "SPACE TO CUT POWER" : "SPACE TO FIRE", x + 14, PANEL_TOP + 222, 12, c.text, 0.7, "monospace", "left");
  } else {
    drawText(ctx, state.purpose === "gridDisable" ? "NO POWER STATION IN RANGE" : "NO TARGET IN RANGE", x + 14, PANEL_TOP + 180, 13, c.panelDim, 1, "monospace", "left");
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
  if (state.zoom === "full") {
    drawFullMap(ctx, state, world, cfg, x, y, w, h);
    return;
  }
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
    if (isHidden(state, index, world)) return; // a defender asleep in its dome is not shown
    const at = positionOf(state, index, world);
    const [tx, ty] = toScreen(at.x, at.y);
    if (state.ruins.includes(index)) {
      drawRuin(ctx, tx, ty, c.panelDim);
      drawBlip(ctx, tx, ty, 4, blipStrength(state, index, world), c.energy);
      return;
    }
    const inRange = targeting && state.target === index;
    // A hardened enemy is drawn in the warning colour (#112): its fittings are too small to read alone.
    const color = inRange ? c.panelSelected : t.defences ? c.tracer : c.text;
    const iconWidth = cfg.dashboard.targetIconWidth;
    // An enemy passing through a building is drawn faint, so it reads as inside, not a glitch.
    ctx.globalAlpha = isInsideBuilding(state, index, world) ? 0.3 : targeting && !inRange ? 0.6 : 1;
    if (hasArt(t.kind)) {
      strokeArt(ctx, ART[t.kind].simple, tx, ty + iconWidth / 4, iconWidth / 2, color, 1.2, inRange ? 6 : 0);
      // A hardened enemy shows its turret or mast (#112), so a defended region is seen before it is entered.
      if (t.defences) strokeArt(ctx, fittingStrokes(ART[t.kind].simple, t.defences), tx, ty + iconWidth / 4, iconWidth / 2, color, 1.2, 0);
    } else {
      drawPlaceholderMarker(ctx, tx, ty, color, inRange);
    }
    ctx.globalAlpha = 1;
  });

  if (isPaused(state)) drawTimeStopped(ctx, x, y, w, h, cfg);

  if (state.mode !== "browse") {
    const [cx, cy] = toScreen(state.cross.col, state.cross.row);
    drawCross(ctx, cx, cy, c.panelSelected);
  }

  if (state.route.length > 0) {
    const destination = state.route[state.route.length - 1];
    const [wx, wy] = toScreen(destination.x, destination.y);
    drawGlow(ctx, c.panelSelected, 0, () => {
      ctx.strokeStyle = c.panelSelected;
      ctx.lineWidth = 1;
      ctx.strokeRect(wx - 3, wy - 3, 6, 6);
    });
  }

  // The ring is centred where the robot stood when it scanned.
  drawPulse(ctx, state, world, cfg, toScreen, world.scanRadius * cellW, world.scanRadius * cellH, [x, y, w, h]);
  drawRobot(ctx, x + w / 2, y + h / 2, state.time, c.panelSelected);
  ctx.restore();

  drawText(ctx, "LOCAL", x + 6, y + 8, 11, c.text, 0.7, "monospace", "left");
  // A comms centre has just reported the robot (#71).
  const report = latestEvent(state.events, "robotReported");
  if (report !== null && state.time - report.time < REPORT_WARNING_SECONDS) {
    drawText(ctx, "REPORTED BY COMMS", x + w - 6, y + 8, 11, c.alert, 1, "monospace", "right");
  }
}

/**
 * The ring from a scan: it grows out from where the robot scanned to the scan's reach and fades
 * as it goes. Clipped to the panel, so in the local view it is cut off at the edge.
 */
function drawPulse(
  ctx: CanvasRenderingContext2D,
  state: DashboardState,
  world: World,
  cfg: Config,
  toScreen: (col: number, row: number) => [number, number],
  rx: number,
  ry: number,
  rect: [number, number, number, number]
): void {
  if (state.pulseStarted === null || state.scan === null) return;
  const t = state.time - state.pulseStarted;
  if (t < 0 || t >= world.scanPulseSeconds) return;
  const k = t / world.scanPulseSeconds;
  const grown = ringReach(t, world);
  const [cx, cy] = toScreen(state.scan.origin.x, state.scan.origin.y);
  ctx.save();
  ctx.beginPath();
  ctx.rect(rect[0], rect[1], rect[2], rect[3]);
  ctx.clip();
  ctx.globalAlpha = 1 - k;
  ctx.strokeStyle = cfg.colors.panelSelected;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx * grown, ry * grown, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/**
 * Full zoom: the whole world scaled into the panel, for planning and travel. Only high ground is
 * drawn, so the barriers read clearly (#90). Each network is marked by its power station, which
 * shows whether its power is cut; other buildings and enemies are not drawn (only the local map
 * shows them). Salvage blips stay, so the player can remember where to go. The robot is a dot at
 * its real position. Nothing is centred or scrolled.
 */
function drawFullMap(
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
  const map = world.map;
  const cellW = w / map.cols;
  const cellH = h / map.rows;
  const toScreen = (col: number, row: number): [number, number] => [x + (col + 0.5) * cellW, y + (row + 0.5) * cellH];

  for (let row = 0; row < map.rows; row++) {
    for (let col = 0; col < map.cols; col++) {
      // Valleys and ground are left blank: at a few pixels a cell they were noise over the high ground.
      if (map.tiers[row][col] !== 2) continue;
      ctx.globalAlpha = FULL_MAP_HIGH_GROUND_ALPHA;
      ctx.fillStyle = c.panelDim;
      ctx.fillRect(x + col * cellW, y + row * cellH, cellW, cellH);
    }
  }
  ctx.globalAlpha = 1;

  // Each network is marked by its power station (#90): a real place, never destroyed. While its
  // power is cut the station is drawn in the shield colour inside a dashed ring, until it comes back.
  const iconHalf = FULL_MAP_STATION_HALF_SIZE;
  for (const m of networkMarkers(state, world)) {
    const [mx, my] = toScreen(m.col, m.row);
    const color = m.down ? c.shield : c.text;
    strokeArt(ctx, ART.power.simple, mx, my + iconHalf / 2, iconHalf, color, 1, 0);
    if (!m.down) continue;
    ctx.strokeStyle = c.shield;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.arc(mx, my, iconHalf * 2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  if (isPaused(state)) drawTimeStopped(ctx, x, y, w, h, cfg);

  if (state.mode !== "browse") {
    const [cx, cy] = toScreen(state.cross.col, state.cross.row);
    drawCross(ctx, cx, cy, c.panelSelected);
  }

  if (state.route.length > 0) {
    const destination = state.route[state.route.length - 1];
    const [dx, dy] = toScreen(destination.x, destination.y);
    ctx.strokeStyle = c.panelSelected;
    ctx.lineWidth = 1;
    ctx.strokeRect(dx - 2.5, dy - 2.5, 5, 5);
  }

  for (const index of state.scan?.blips ?? []) {
    const at = positionOf(state, index, world);
    const [bx, by] = toScreen(at.x, at.y);
    drawBlip(ctx, bx, by, 2.5, blipStrength(state, index, world), c.energy);
  }

  const [rx, ry] = toScreen(state.pos.x, state.pos.y);
  drawPulse(ctx, state, world, cfg, toScreen, world.scanRadius * cellW, world.scanRadius * cellH, [x, y, w, h]);
  drawRobot(ctx, rx, ry, state.time, c.panelSelected, FULL_MAP_ROBOT_SCALE);

  drawText(ctx, "FULL", x + 6, y + 8, 11, c.text, 0.7, "monospace", "left");
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

/** High ground on the full map: strong enough to read as the barrier, under the markers. */
const FULL_MAP_HIGH_GROUND_ALPHA = 0.6;

/** Half the width of a power-station marker on the full map, in pixels: a cell or two across. */
const FULL_MAP_STATION_HALF_SIZE = 5;

/**
 * The robot's marker on the full map, as a fraction of its local-view size. A full-map cell is
 * about 3 pixels, so at local size the marker covered five cells and outsized the town rings.
 */
const FULL_MAP_ROBOT_SCALE = 0.5;

/** The robot: a pulsing ring round a pointer. `scale` shrinks it for the full map. */
function drawRobot(ctx: CanvasRenderingContext2D, mx: number, my: number, time: number, color: string, scale = 1): void {
  const pulse = 1.2 * scale * Math.sin(time * 4);
  drawGlow(ctx, color, 6 * scale, () => {
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 1.5 * Math.max(scale, 0.75);
    ctx.beginPath();
    ctx.arc(mx, my, 7 * scale + pulse, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(mx, my - 4 * scale);
    ctx.lineTo(mx + 3 * scale, my + 3 * scale);
    ctx.lineTo(mx - 3 * scale, my + 3 * scale);
    ctx.closePath();
    ctx.fill();
  });
}

/** Plain square for a building kind whose art is not designed yet. */
function drawScanReadout(ctx: CanvasRenderingContext2D, state: DashboardState, cfg: Config, x: number): void {
  const c = cfg.colors;
  drawText(ctx, "SCAN", x + 14, PANEL_TOP + 158, 12, c.text, 0.7, "monospace", "left");
  const result = state.scan;
  if (result === null) {
    drawText(ctx, "SPACE TO SCAN", x + 14, PANEL_TOP + 180, 16, c.panelSelected, 1, "monospace", "left");
  } else if (result.blips.length === 0) {
    drawText(ctx, "NOTHING DETECTED", x + 14, PANEL_TOP + 180, 16, c.panelDim, 1, "monospace", "left");
  } else {
    const n = result.blips.length;
    drawText(ctx, `SALVAGE AT ${n} SITE${n === 1 ? "" : "S"}`, x + 14, PANEL_TOP + 180, 16, c.energy, 1, "monospace", "left");
  }
  drawText(ctx, `SALVAGE ${state.found.length}  PARTS ${state.parts.length}/${cfg.localMap.partCount}`, x + 14, PANEL_TOP + 222, 12, c.text, 0.7, "monospace", "left");
}

/** A scan's mark on a ruin that still holds a drop: a glowing dot that fades with strength. */
function drawBlip(ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number, strength: number, color: string): void {
  if (strength <= 0) return;
  ctx.save();
  ctx.globalAlpha = strength;
  drawGlow(ctx, color, 8 * strength, () => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.restore();
}

/** A destroyed building: two crossed lines, dim. */
function drawRuin(ctx: CanvasRenderingContext2D, cx: number, cy: number, color: string): void {
  ctx.globalAlpha = 0.6;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(cx - 4, cy - 2);
  ctx.lineTo(cx + 4, cy + 2);
  ctx.moveTo(cx + 4, cy - 2);
  ctx.lineTo(cx - 4, cy + 2);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function drawPlaceholderMarker(ctx: CanvasRenderingContext2D, cx: number, cy: number, color: string, glow: boolean): void {
  drawGlow(ctx, color, glow ? 6 : 0, () => {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.2;
    ctx.strokeRect(cx - 3, cy - 3, 6, 6);
  });
}

/**
 * The low-power warning (#15): flashing over the energy gauge, so an empty bank is never a
 * surprise.
 */
function drawLowPower(ctx: CanvasRenderingContext2D, time: number, cfg: Config): void {
  if (Math.sin(time * 6) < -0.2) return;
  drawText(ctx, "LOW POWER", cfg.canvas.width / 2, 316, 15, cfg.colors.alert, 1, "monospace");
}

/**
 * One unit of a gauge: how full it is (0..1), cracks to draw on it, and whether it flashes.
 * `healing` is how far recharge is through mending its last crack, which fades as it mends.
 */
interface GaugeUnit {
  part: number;
  cracks: number;
  flash: boolean;
  healing?: number;
}

/**
 * Energy as rectangular cells. It is fractional, so the current cell shows how much of it is
 * left. The last cell flashes when the bank is low.
 */
function energyUnits(count: number, max: number, cfg: Config): GaugeUnit[] {
  const low = isLow(count, cfg);
  const top = Math.ceil(count) - 1;
  return Array.from({ length: max }, (_, i) => ({ part: Math.max(0, Math.min(1, count - i)), cracks: 0, flash: low && i === top }));
}

/**
 * Armour as trapezoid plates across the front arc, left to right (armour.ts): each standing
 * plate shows its own cracks. When few stand, every standing plate flashes. While resting,
 * `mending` is the recharge's progress on the plate it is mending.
 */
function plateUnits(plates: readonly number[], mending: number | null, cfg: Config): GaugeUnit[] {
  const low = isLow(standing(plates), cfg);
  const hpp = cfg.dashboard.hitsPerPlate;
  const mended = mending === null ? -1 : plateToMend(plates, hpp);
  return plates.map((p, i) => ({ part: p > 0 ? 1 : 0, cracks: cracksOn(p, hpp), flash: low && p > 0, healing: i === mended ? (mending ?? 0) : undefined }));
}

/** The rack as upright rounds, one per missile; empty slots show dim. Nothing flashes: an empty rack is not a danger in itself. */
function rackUnits(missiles: number, cfg: Config): GaugeUnit[] {
  return Array.from({ length: cfg.dashboard.missileRack }, (_, i) => ({ part: i < missiles ? 1 : 0, cracks: 0, flash: false }));
}

type GaugeShape = "cell" | "plate" | "round";

/** A row of gauge units with its label. */
function drawGauge(ctx: CanvasRenderingContext2D, label: string, units: readonly GaugeUnit[], y: number, cfg: Config, shape: GaugeShape, time: number): void {
  const c = cfg.colors;
  const color = shape === "cell" ? c.energy : shape === "plate" ? c.shield : c.missile;
  const left = 150;
  const right = cfg.canvas.width - 20;
  const gap = 8;
  const height = 34;
  const max = units.length;
  const unitW = (right - left - gap * (max - 1)) / max;

  drawText(ctx, label, 20, y + height / 2, 14, c.text, 1, "monospace", "left");

  units.forEach((u, i) => {
    const x = left + i * (unitW + gap);
    const filled = u.part > 0;
    ctx.globalAlpha = !filled ? 0.18 : u.flash ? 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(time * 9)) : 1;
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    traceUnit(ctx, shape, x, y, unitW, height);
    if (filled && u.part < 1 && shape === "cell") ctx.fillRect(x, y, unitW * u.part, height);
    else if (filled) ctx.fill();
    ctx.stroke();
    if (u.healing !== undefined && u.cracks > 0) {
      // The crack being mended fades out as the recharge closes it.
      drawCracks(ctx, x, y, unitW, height, u.cracks - 1, c.background);
      ctx.globalAlpha = 1 - u.healing;
      drawCracks(ctx, x, y, unitW, height, u.cracks, c.background);
    } else if (u.cracks > 0) {
      drawCracks(ctx, x, y, unitW, height, u.cracks, c.background);
    }
  });
  ctx.globalAlpha = 1;
}

function traceUnit(ctx: CanvasRenderingContext2D, shape: GaugeShape, x: number, y: number, w: number, h: number): void {
  if (shape === "cell") {
    ctx.beginPath();
    ctx.rect(x, y, w, h);
  } else if (shape === "plate") {
    tracePlate(ctx, x, y, w, h);
  } else {
    traceRound(ctx, x, y, w, h);
  }
}

/** A missile standing upright in its slot: a slim body with a pointed nose and small fins, so it reads apart from cells and plates. */
function traceRound(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  const cx = x + w / 2;
  const half = Math.min(w, h) * 0.18;
  const nose = y + h * 0.3;
  const fins = y + h * 0.75;
  ctx.beginPath();
  ctx.moveTo(cx, y);
  ctx.lineTo(cx + half, nose);
  ctx.lineTo(cx + half, fins);
  ctx.lineTo(cx + half * 2, y + h);
  ctx.lineTo(cx - half * 2, y + h);
  ctx.lineTo(cx - half, fins);
  ctx.lineTo(cx - half, nose);
  ctx.closePath();
}

/**
 * Time stops while a chooser is open (design-notes 4.10): the map dims under the cross and
 * says so, so the stillness reads as deliberate rather than a freeze.
 */
function drawTimeStopped(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, cfg: Config): void {
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = cfg.colors.background;
  ctx.fillRect(x, y, w, h);
  ctx.globalAlpha = 1;
  drawText(ctx, "TIME STOPPED", x + w - 6, y + 8, 11, cfg.colors.panelSelected, 0.9, "monospace", "right");
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
