import type { Config } from "./config";
import type { AppState } from "./app";
import { isLow, type DashboardState } from "./dashboard";
import type { DefenceState } from "./defence";
import type { FlightState } from "./types";

/** Every sound the game can make. Which ones play is decided by eventsBetween, which is pure. */
export type SoundEvent =
  | "select"
  | "confirm"
  | "cross"
  | "lock"
  | "scanNear"
  | "scanFar"
  | "scanNothing"
  | "pickup"
  | "launch"
  | "terminal"
  | "warning"
  | "hit"
  | "deflect"
  | "crash"
  | "miss"
  | "incoming"
  | "gun"
  | "missileDown"
  | "missileHit"
  | "missileLaunch"
  | "destroyed";

/** The sounds that a change between two app states should make. Pure, so it can be tested. */
export function eventsBetween(prev: AppState, next: AppState, cfg: Config): SoundEvent[] {
  if (prev.screen === "dashboard" && next.screen === "flight") return ["launch"];
  if (prev.screen === "dashboard" && next.screen === "dashboard") return dashboardEvents(prev.dashboard, next.dashboard, cfg);
  if (prev.screen === "flight" && next.screen === "flight") return flightEvents(prev.flight, next.flight, next.shielded);
  // The warning beat (design-notes 4.8): a sensor alarm as the attack takes the screen.
  if (prev.screen === "dashboard" && next.screen === "defence") return ["incoming"];
  if (prev.screen === "defence" && next.screen === "defence") return defenceEvents(prev.defence, next.defence);
  if (prev.screen !== "destroyed" && next.screen === "destroyed") return ["destroyed"];
  return [];
}

function dashboardEvents(prev: DashboardState, next: DashboardState, cfg: Config): SoundEvent[] {
  const events: SoundEvent[] = [];
  const crossMoved = prev.cross.col !== next.cross.col || prev.cross.row !== next.cross.row;

  if (prev.mode === "browse" && next.mode === "browse" && (prev.row !== next.row || prev.col !== next.col || prev.mapSelected !== next.mapSelected)) {
    events.push("select");
  }
  if (prev.zoom !== next.zoom) events.push("confirm");
  if (prev.mode !== next.mode && next.mode !== "browse") events.push("confirm");
  if (next.mode !== "browse" && crossMoved && prev.mode === next.mode) events.push("cross");
  if (next.mode === "targeting" && prev.mode === "targeting" && prev.target === null && next.target !== null) events.push("lock");
  if (prev.route.length === 0 && next.route.length > 0) events.push("confirm");
  if (next.scan !== prev.scan && next.scan !== null) {
    if (next.scan.blips.length === 0) events.push("scanNothing");
    else events.push(next.scan.close ? "scanNear" : "scanFar");
  }
  if (next.found.length > prev.found.length) events.push("pickup");

  const wasLow = isLow(prev.energyCells, cfg) || isLow(prev.shieldPlates, cfg);
  const low = isLow(next.energyCells, cfg) || isLow(next.shieldPlates, cfg);
  if (!wasLow && low) events.push("warning");

  return events;
}

function defenceEvents(prev: DefenceState, next: DefenceState): SoundEvent[] {
  const events: SoundEvent[] = [];
  // Each missile leaving the launcher thumps, so the player hears every volley ripple out.
  const launched = (s: DefenceState) => s.missiles.filter((m) => m.spawn <= s.elapsed).length;
  if (launched(next) > launched(prev)) events.push("missileLaunch");
  if (next.shots.length > prev.shots.length) events.push("gun");
  const count = (s: DefenceState, state: "shot" | "hit") => s.missiles.filter((m) => m.state === state).length;
  if (count(next, "shot") > count(prev, "shot")) events.push("missileDown");
  if (count(next, "hit") > count(prev, "hit")) events.push("missileHit");
  return events;
}

function flightEvents(prev: FlightState, next: FlightState, shielded: boolean): SoundEvent[] {
  if (prev.phase === next.phase) return [];
  switch (next.phase) {
    case "terminal":
      return ["terminal"];
    case "hit":
      return [shielded ? "deflect" : "hit"];
    case "crash":
      return ["crash"];
    case "miss":
      return ["miss"];
    default:
      return [];
  }
}

/**
 * Plays the sounds with the Web Audio API. Everything is synthesised, so there are no
 * sound files. The audio context is created on first use, which the browser only
 * allows after a key press; the first Space press in the game unlocks it.
 */
export class SoundPlayer {
  private context: AudioContext | null = null;
  private muted = false;

  /** Flips mute and returns the new state. */
  toggleMute(): boolean {
    this.muted = !this.muted;
    return this.muted;
  }

  isMuted(): boolean {
    return this.muted;
  }

  play(event: SoundEvent): void {
    if (this.muted) return;
    const ctx = this.audio();
    if (!ctx) return;
    PLAY[event](ctx, ctx.currentTime);
  }

  private audio(): AudioContext | null {
    if (!this.context) {
      try {
        this.context = new AudioContext();
      } catch {
        return null;
      }
    }
    if (this.context.state === "suspended") void this.context.resume();
    return this.context;
  }
}

type Player = (ctx: AudioContext, when: number) => void;

function tone(
  ctx: AudioContext,
  when: number,
  freq: number,
  dur: number,
  type: OscillatorType,
  gain: number,
  endFreq: number = freq
): void {
  const osc = ctx.createOscillator();
  const amp = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, when);
  osc.frequency.exponentialRampToValueAtTime(endFreq, when + dur);
  amp.gain.setValueAtTime(gain, when);
  amp.gain.exponentialRampToValueAtTime(0.0001, when + dur);
  osc.connect(amp).connect(ctx.destination);
  osc.start(when);
  osc.stop(when + dur + 0.02);
}

function noise(
  ctx: AudioContext,
  when: number,
  dur: number,
  gain: number,
  filter: BiquadFilterType,
  fromHz: number,
  toHz: number
): void {
  const length = Math.floor(ctx.sampleRate * dur);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const shape = ctx.createBiquadFilter();
  shape.type = filter;
  shape.frequency.setValueAtTime(fromHz, when);
  shape.frequency.exponentialRampToValueAtTime(toHz, when + dur);
  const amp = ctx.createGain();
  amp.gain.setValueAtTime(gain, when);
  amp.gain.exponentialRampToValueAtTime(0.0001, when + dur);
  src.connect(shape).connect(amp).connect(ctx.destination);
  src.start(when);
  src.stop(when + dur + 0.02);
}

const PLAY: Record<SoundEvent, Player> = {
  // A two-tone sensor alarm, repeated: the robot's survival reflex taking over.
  incoming: (c, t) => {
    for (let i = 0; i < 3; i++) {
      tone(c, t + i * 0.3, 1100, 0.12, "square", 0.08);
      tone(c, t + i * 0.3 + 0.13, 820, 0.12, "square", 0.08);
    }
  },
  // A distant launch: a low, muffled thump.
  missileLaunch: (c, t) => {
    noise(c, t, 0.18, 0.4, "lowpass", 500, 90);
    tone(c, t, 90, 0.2, "sine", 0.35, 45);
  },
  // Kept short and quiet: it plays at the guns' rate of fire.
  gun: (c, t) => noise(c, t, 0.04, 0.12, "highpass", 3000, 1500),
  missileDown: (c, t) => {
    noise(c, t, 0.25, 0.35, "bandpass", 1800, 300);
    tone(c, t, 700, 0.15, "triangle", 0.12, 200);
  },
  missileHit: (c, t) => {
    noise(c, t, 0.5, 0.6, "lowpass", 1200, 80);
    tone(c, t, 120, 0.4, "sine", 0.5, 40);
  },
  select: (c, t) => tone(c, t, 1400, 0.03, "square", 0.04),
  confirm: (c, t) => {
    tone(c, t, 660, 0.07, "sine", 0.2);
    tone(c, t + 0.06, 990, 0.1, "sine", 0.2);
  },
  cross: (c, t) => tone(c, t, 2000, 0.015, "triangle", 0.05),
  lock: (c, t) => {
    tone(c, t, 880, 0.08, "sine", 0.2);
    tone(c, t + 0.08, 1320, 0.14, "sine", 0.2);
  },
  scanNear: (c, t) => {
    tone(c, t, 1800, 0.16, "sine", 0.25);
    tone(c, t + 0.2, 1800, 0.16, "sine", 0.25);
  },
  scanFar: (c, t) => tone(c, t, 1200, 0.25, "sine", 0.2),
  scanNothing: (c, t) => tone(c, t, 300, 0.25, "sine", 0.12, 200),
  pickup: (c, t) => {
    tone(c, t, 660, 0.12, "sine", 0.2);
    tone(c, t + 0.06, 880, 0.12, "sine", 0.2);
    tone(c, t + 0.12, 1320, 0.2, "sine", 0.2);
  },
  launch: (c, t) => {
    noise(c, t, 0.9, 0.35, "lowpass", 300, 2000);
    tone(c, t, 110, 0.9, "sawtooth", 0.12, 220);
  },
  terminal: (c, t) => tone(c, t, 300, 0.6, "sawtooth", 0.1, 900),
  warning: (c, t) => {
    tone(c, t, 440, 0.15, "square", 0.1);
    tone(c, t + 0.2, 330, 0.15, "square", 0.1);
  },
  // An explosion is a sharp crack, then a long rumble that falls in pitch, with a sub-bass drop under it.
  hit: (c, t) => {
    noise(c, t, 0.08, 0.9, "highpass", 2500, 800);
    noise(c, t, 1.4, 0.8, "lowpass", 900, 60);
    tone(c, t, 150, 0.9, "sine", 0.8, 28);
  },
  // A crash into the ground is the same crack and rumble, with gravel and debris after it.
  // A shield ping: a bright metallic ring that fades, instead of a blast.
  deflect: (c, t) => {
    tone(c, t, 2600, 0.5, "sine", 0.3, 1900);
    tone(c, t, 3900, 0.3, "triangle", 0.1, 2800);
  },
  crash: (c, t) => {
    noise(c, t, 0.06, 0.8, "highpass", 3000, 1000);
    noise(c, t, 1.2, 0.8, "lowpass", 700, 50);
    noise(c, t + 0.05, 0.9, 0.5, "bandpass", 900, 150);
    tone(c, t, 110, 0.7, "sine", 0.7, 25);
  },
  // The robot's own death: the crash, heavier and longer, then a second blast as it breaks up.
  destroyed: (c, t) => {
    noise(c, t, 0.1, 1, "highpass", 2500, 700);
    noise(c, t, 2.2, 0.9, "lowpass", 800, 40);
    tone(c, t, 120, 1.6, "sine", 0.9, 20);
    noise(c, t + 0.35, 1.2, 0.6, "lowpass", 600, 50);
  },
  miss: (c, t) => {
    noise(c, t, 0.7, 0.25, "highpass", 2000, 400);
    tone(c, t, 400, 0.6, "sawtooth", 0.1, 120);
  },
};
