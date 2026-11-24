import type { Cell } from "./route";

/**
 * What happened in the world (#127), recorded as data. The rules always record; whoever shows or
 * plays events (the signal decoder, #126, and later sound) decides what to do with them. Each is
 * recorded once, when something changes, never on every step it stays true.
 */
export type GameEventBody =
  | { kind: "enemyAlerted"; enemy: number } // it has noticed the robot, or been told where it is
  | { kind: "helpCalled"; enemy: number; helper: number } // a patroller reached the armed enemy it ran to
  | { kind: "underFire"; enemy: number } // a missile has been launched at it
  | { kind: "enemyDestroyed"; enemy: number }
  | { kind: "buildStarted"; enemy: number; dome: number } // a dome has begun building a destroyed enemy again
  | { kind: "robotReported" } // the network's comms centre has called for support; `at` is the robot
  | { kind: "bossOut"; enemy: number }
  | { kind: "townReached"; enemy: number }; // the assessor, on its tour; `network` is the town

/** `network` is the one it concerns: an enemy's own, even when it has roamed. `at` is where it happened. */
export type GameEvent = GameEventBody & { seq: number; time: number; network: number; at: Cell };

export type EventKind = GameEvent["kind"];
export type EventOf<K extends EventKind> = Extract<GameEvent, { kind: K }>;

/** The log, oldest first, and the number the next event gets. */
export interface EventLog {
  entries: readonly GameEvent[];
  next: number;
}

/** Only the latest are kept. Far more than can happen between two reads. */
export const EVENT_LOG_LIMIT = 256;

export const EMPTY_LOG: EventLog = { entries: [], next: 0 };

export function record(log: EventLog, event: GameEventBody & { time: number; network: number; at: Cell }): EventLog {
  const entry: GameEvent = { ...event, at: { x: event.at.x, y: event.at.y }, seq: log.next };
  return { entries: [...log.entries, entry].slice(-EVENT_LOG_LIMIT), next: log.next + 1 };
}

/**
 * The events from number `seq` on, oldest first. A consumer keeps `log.next` after reading and
 * passes it back, so events from a flight or an attack wait for it.
 */
export function eventsSince(log: EventLog, seq: number): GameEvent[] {
  return log.entries.filter((e) => e.seq >= seq);
}

/** Every remembered event of one kind, oldest first. */
export function eventsOf<K extends EventKind>(log: EventLog, kind: K): EventOf<K>[] {
  return log.entries.filter((e): e is EventOf<K> => e.kind === kind);
}

/** The latest event of one kind, or null. */
export function latestEvent<K extends EventKind>(log: EventLog, kind: K): EventOf<K> | null {
  return eventsOf(log, kind).at(-1) ?? null;
}
