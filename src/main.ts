import { createAppState, updateApp, type AppState } from "./app";
import { config } from "./config";
import type { Action } from "./dashboard";
import { renderDashboard } from "./dashboard-render";
import { InputController } from "./input";
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

const fixedDt = config.simulation.fixedDtSeconds;
let accumulator = 0;
let lastTime = performance.now();
// Presses wait here until a fixed step consumes them, so none are lost between frames.
let pending: Action[] = [];

function frame(now: number): void {
  accumulator += (now - lastTime) / 1000;
  lastTime = now;
  pending.push(...input.consumeActions());
  if (input.consumeMute()) sound.toggleMute();

  while (accumulator >= fixedDt) {
    const before = state;
    state = updateApp(state, { actions: pending, steering: input.getSteering() }, fixedDt, config, newSeed);
    for (const event of eventsBetween(before, state, config)) sound.play(event);
    pending = [];
    accumulator -= fixedDt;
  }

  if (state.screen === "dashboard") {
    renderDashboard(ctx!, state.dashboard, config, !sound.isMuted());
  } else {
    render(ctx!, state.flight, config, state.target.kind);
  }
  requestAnimationFrame(frame);
}

requestAnimationFrame((now) => {
  lastTime = now;
  frame(now);
});
