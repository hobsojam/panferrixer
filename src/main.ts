import { createAppState, updateApp, type AppState } from "./app";
import { config } from "./config";
import type { Action } from "./dashboard";
import { renderDashboard } from "./dashboard-render";
import { combineAim, mouseAim } from "./defence";
import { renderDefence } from "./defence-render";
import { InputController } from "./input";
import { createInputGate, gateInput } from "./input-gate";
import { render } from "./render";
import { SoundPlayer, eventsBetween } from "./sound";

const canvas = document.getElementById("flight-canvas") as HTMLCanvasElement;
canvas.width = config.canvas.width;
canvas.height = config.canvas.height;
const ctx = canvas.getContext("2d");
if (!ctx) throw new Error("2D canvas context unavailable");

const input = new InputController();
const sound = new SoundPlayer();

function newSeed(): number {
  return Math.floor(Math.random() * 0xffffffff);
}

let state: AppState = createAppState(config);

// The mouse aims the defence turret once captured, which a browser only allows from a click.
canvas.addEventListener("click", () => {
  if (state.screen === "defence") input.lockPointer(canvas);
});

const fixedDt = config.simulation.fixedDtSeconds;
let accumulator = 0;
let lastTime = performance.now();
// Presses wait here until a fixed step consumes them, so none are lost between frames.
let pending: Action[] = [];
let gate = createInputGate(state.screen);

function frame(now: number): void {
  accumulator += (now - lastTime) / 1000;
  lastTime = now;
  pending.push(...input.consumeActions());
  if (input.consumeMute()) sound.toggleMute();

  // This frame's mouse movement is shared across its fixed steps, so turning is smooth.
  const steps = Math.floor(accumulator / fixedDt);
  // On a fast display some frames run no step; their movement waits for the next one.
  const mouse = steps > 0 ? input.consumeMouse() : { dx: 0, dy: 0 };
  while (accumulator >= fixedDt) {
    const before = state;
    const aim = combineAim(input.getAim(), mouseAim(mouse.dx / steps, mouse.dy / steps, fixedDt, config));
    const raw = { actions: pending, steering: input.getSteering(), aim, fire: input.isFireHeld() };
    // Presses made on one screen must not spill onto the next.
    const gated = gateInput(gate, state.screen, raw, fixedDt, config);
    gate = gated.gate;
    state = updateApp(state, gated.input, fixedDt, config, newSeed);
    for (const event of eventsBetween(before, state, config)) sound.play(event);
    pending = [];
    accumulator -= fixedDt;
  }
  // The pointer is only captured during an attack: hand it back when the attack ends.
  if (state.screen !== "defence") input.releasePointer();

  if (state.screen === "dashboard") {
    renderDashboard(ctx!, state.dashboard, config, !sound.isMuted());
  } else if (state.screen === "defence") {
    renderDefence(ctx!, state.defence, state.dashboard.shieldPlates, config, input.isPointerLocked());
  } else {
    render(ctx!, state.flight, config, state.target.kind, state.shielded);
  }
  requestAnimationFrame(frame);
}

requestAnimationFrame((now) => {
  lastTime = now;
  frame(now);
});
