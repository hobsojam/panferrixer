import type { Action } from "./dashboard";

const ACTION_KEYS: Record<string, Action> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  Enter: "activate",
  Space: "activate",
  Escape: "cancel",
};

/**
 * Keyboard only. Two kinds of input:
 * - held left/right, the steering axis used in flight
 * - discrete presses, queued as actions for the dashboard and result screens
 */
export class InputController {
  private leftDown = false;
  private rightDown = false;
  private queued: Action[] = [];

  constructor() {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
  }

  getSteering(): number {
    return (this.rightDown ? 1 : 0) - (this.leftDown ? 1 : 0);
  }

  /** Returns and clears the presses made since the last call, in order. */
  consumeActions(): Action[] {
    const actions = this.queued;
    this.queued = [];
    return actions;
  }

  dispose(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.code === "ArrowLeft") this.leftDown = true;
    if (e.code === "ArrowRight") this.rightDown = true;

    const action = ACTION_KEYS[e.code];
    // Holding a key should not spam the dashboard; only fresh presses count.
    if (action && !e.repeat) this.queued.push(action);
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    if (e.code === "ArrowLeft") this.leftDown = false;
    if (e.code === "ArrowRight") this.rightDown = false;
  };
}
