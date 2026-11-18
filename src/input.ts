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
 * - held keys: left/right steer in flight; all four arrows turn the defence turret, and Space fires its guns
 * - discrete presses, queued as actions for the dashboard and result screens
 */
export class InputController {
  private leftDown = false;
  private rightDown = false;
  private upDown = false;
  private downDown = false;
  private fireDown = false;
  private queued: Action[] = [];
  private muteQueued = false;

  constructor() {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
  }

  getSteering(): number {
    return (this.rightDown ? 1 : 0) - (this.leftDown ? 1 : 0);
  }

  /** The defence turret's turning: right and up are positive. */
  getAim(): { yaw: number; pitch: number } {
    return { yaw: this.getSteering(), pitch: (this.upDown ? 1 : 0) - (this.downDown ? 1 : 0) };
  }

  /** True while the fire key is held: the defence guns fire at their rate of fire. */
  isFireHeld(): boolean {
    return this.fireDown;
  }

  /** Returns and clears the presses made since the last call, in order. */
  consumeActions(): Action[] {
    const actions = this.queued;
    this.queued = [];
    return actions;
  }

  /** True once for each fresh press of M: the sound toggle, which is not a game action. */
  consumeMute(): boolean {
    const pressed = this.muteQueued;
    this.muteQueued = false;
    return pressed;
  }

  dispose(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.code === "ArrowLeft") this.leftDown = true;
    if (e.code === "ArrowRight") this.rightDown = true;
    if (e.code === "ArrowUp") this.upDown = true;
    if (e.code === "ArrowDown") this.downDown = true;
    if (e.code === "Space") this.fireDown = true;

    // Holding a key should not spam the dashboard; only fresh presses count.
    if (e.code === "KeyM" && !e.repeat) this.muteQueued = true;
    const action = ACTION_KEYS[e.code];
    if (action && !e.repeat) this.queued.push(action);
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    if (e.code === "ArrowLeft") this.leftDown = false;
    if (e.code === "ArrowRight") this.rightDown = false;
    if (e.code === "ArrowUp") this.upDown = false;
    if (e.code === "ArrowDown") this.downDown = false;
    if (e.code === "Space") this.fireDown = false;
  };
}
