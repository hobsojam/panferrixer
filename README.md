# Panferrixer

A missile-guidance mini-game: steer a cruise missile through terrain to its target, in a
forward-looking wireframe view. TypeScript and the 2D canvas, no game engine.

This is the first slice of a larger exploration game described in `design-notes.md`. Working
title only.

## Running

```sh
npm install
npm run dev
```

Then open the URL it prints.

## Controls

Arrow keys move the selection on the dashboard. Space or Enter activates it. Left and right steer during a flight. After a flight ends, Space returns to the dashboard.

## How it works

The missile flies straight and level at a fixed speed; you only steer laterally. The ground
is a filled plane whose top edge is the horizon, and that edge marks your flight altitude:
**terrain standing above it can kill you, terrain below it is scenery you fly over.** Collision
samples the drawn silhouette at your lateral position, so what you see is exactly what you hit.

Terrain is generated from a seed and validated before use: a flyable path must exist, with a
clear corridor ahead of the launch heading so the opening is never unfair.

## Layout

| Path | Purpose |
|---|---|
| `src/config.ts` | Every tuning value |
| `src/flight.ts` | Simulation core, fixed timestep, no drawing |
| `src/terrain.ts` | Seeded generation, silhouette and passability rules |
| `src/render.ts` | Canvas drawing, a pure function of state |
| `src/input.ts` | Keyboard to steering axis |
| `test/` | Rules under test, including terrain fairness |

Simulation is kept separate from rendering, so the rules can be tested without a browser.

## Checks

```sh
npm test
npm run typecheck
```
