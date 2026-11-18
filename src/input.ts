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
 * Keyboard, plus the mouse for the defence turret. Three kinds of input:
 * - held keys: left/right steer in flight; all four arrows turn the defence turret, and Space fires its guns
 * - discrete presses, queued as actions for the dashboard and result screens
 * - while the pointer is captured: mouse movement turns the turret and the left button fires
 */
export class InputController {
  private leftDown = false;
  private rightDown = false;
  private upDown = false;
  private downDown = false;
  private fireDown = false;
  private mouseFireDown = false;
  private mouseDx = 0;
  private mouseDy = 0;
  private queued: Action[] = [];
  private muteQueued = false;

  constructor() {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("mousemove", this.onMouseMove);
    window.addEventListener("mousedown", this.onMouseDown);
    window.addEventListener("mouseup", this.onMouseUp);
  }

  /** True while the pointer is captured, so the mouse is aiming the turret. */
  isPointerLocked(): boolean {
    return document.pointerLockElement !== null;
  }

  /**
   * Captures the mouse for aiming. Browsers only allow this from a click; Esc releases it.
   * A refused request (some embedded or automated browsers) leaves the keys working as before.
   */
  lockPointer(element: HTMLElement): void {
    if (this.isPointerLocked()) return;
    try {
      Promise.resolve(element.requestPointerLock()).catch(() => undefined);
    } catch {
      // Older browsers throw instead of returning a promise; the keys still work.
    }
  }

  releasePointer(): void {
    if (this.isPointerLocked()) document.exitPointerLock();
  }

  /** Returns and clears the mouse movement, in pixels, since the last call. Zero unless captured. */
  consumeMouse(): { dx: number; dy: number } {
    const moved = { dx: this.mouseDx, dy: this.mouseDy };
    this.mouseDx = 0;
    this.mouseDy = 0;
    return moved;
  }

  getSteering(): number {
    return (this.rightDown ? 1 : 0) - (this.leftDown ? 1 : 0);
  }

  /** The defence turret's turning: right and up are positive. */
  getAim(): { yaw: number; pitch: number } {
    return { yaw: this.getSteering(), pitch: (this.upDown ? 1 : 0) - (this.downDown ? 1 : 0) };
  }

  /** True while the fire key, or the left button with the pointer captured, is held. */
  isFireHeld(): boolean {
    return this.fireDown || (this.mouseFireDown && this.isPointerLocked());
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
    window.removeEventListener("mousemove", this.onMouseMove);
    window.removeEventListener("mousedown", this.onMouseDown);
    window.removeEventListener("mouseup", this.onMouseUp);
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

  private onMouseMove = (e: MouseEvent): void => {
    if (!this.isPointerLocked()) return;
    this.mouseDx += e.movementX;
    this.mouseDy += e.movementY;
  };

  // The click that captures the pointer happens before capture, so it never fires.
  private onMouseDown = (e: MouseEvent): void => {
    if (e.button === 0 && this.isPointerLocked()) this.mouseFireDown = true;
  };

  private onMouseUp = (e: MouseEvent): void => {
    if (e.button === 0) this.mouseFireDown = false;
  };
}
