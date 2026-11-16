/** Maps the keyboard to the single steering axis the flight uses. Keyboard only. */
export class InputController {
  private leftDown = false;
  private rightDown = false;
  private restartRequested = false;

  constructor() {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
  }

  getSteering(): number {
    return (this.rightDown ? 1 : 0) - (this.leftDown ? 1 : 0);
  }

  consumeRestart(): boolean {
    if (this.restartRequested) {
      this.restartRequested = false;
      return true;
    }
    return false;
  }

  dispose(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.code === "ArrowLeft") this.leftDown = true;
    if (e.code === "ArrowRight") this.rightDown = true;
    if (e.code === "Enter" || e.code === "Space") this.restartRequested = true;
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    if (e.code === "ArrowLeft") this.leftDown = false;
    if (e.code === "ArrowRight") this.rightDown = false;
  };
}
