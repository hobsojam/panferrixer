import { config } from "./config";
import { createInitialState, updateFlight } from "./flight";
import { InputController } from "./input";
import { render } from "./render";
import type { FlightState } from "./types";

const canvas = document.getElementById("flight-canvas") as HTMLCanvasElement;
canvas.width = config.canvas.width;
canvas.height = config.canvas.height;
const ctx = canvas.getContext("2d");
if (!ctx) throw new Error("2D canvas context unavailable");

const input = new InputController();

function newSeed(): number {
  return Math.floor(Math.random() * 0xffffffff);
}

let state: FlightState = createInitialState(newSeed(), config);

const fixedDt = config.simulation.fixedDtSeconds;
let accumulator = 0;
let lastTime = performance.now();

function frame(now: number): void {
  accumulator += (now - lastTime) / 1000;
  lastTime = now;

  if (input.consumeRestart() && (state.phase === "hit" || state.phase === "crash" || state.phase === "miss")) {
    state = createInitialState(newSeed(), config);
    accumulator = 0;
  }

  while (accumulator >= fixedDt) {
    state = updateFlight(state, input.getSteering(), fixedDt, config);
    accumulator -= fixedDt;
  }

  render(ctx!, state, config);
  requestAnimationFrame(frame);
}

requestAnimationFrame((now) => {
  lastTime = now;
  frame(now);
});
