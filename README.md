# Panferrixer

Panferrixer is the working title for an exploration game about a human mind merged with a
small robot. The intended game combines travelling through a hostile mountain world,
searching ruined installations for upgrades, and manually guiding cruise missiles to the
targets that stand in the way.

The project is a browser-based proof of concept built with TypeScript and the 2D canvas,
without a game engine. The detailed vision, research, and open design questions live in
[`design-notes.md`](design-notes.md); that document is aspirational and includes systems that
have not been implemented yet.

## Current prototype

The playable prototype currently includes:

- A persistent dashboard with the robot's state-of-mind trace, energy and shield displays,
  action panels, and a map.
- One generated world containing connected towns, buildings, valleys, and impassable high
  ground.
- Local and full-map views, plus pathfinding that walks the robot to a chosen reachable cell.
- Missile targeting against nearby buildings.
- A forward-looking wireframe missile flight with generated terrain, terminal target art,
  collisions, misses, and explosion effects.
- Persistent destruction: a successful strike leaves a ruin on the map.
- Scanning for drops beneath destroyed buildings and automatic collection when the robot
  reaches one.

Enemies, combat against the robot, resource depletion, upgrades, saving, and the complete
game objective are still planned rather than playable.

## Running

```sh
npm install
npm run dev
```

Open the local URL printed by Vite.

## Controls

The prototype is keyboard-only.

| Context | Controls |
|---|---|
| Dashboard | Arrow keys move between actions. Space or Enter activates the selection. |
| Map panel | Move right from the action grid to select the map. Space or Enter toggles the local and full-map views; Left returns to the actions. |
| Move | Use the arrow keys to position the cross. Space or Enter sets a walking route; Escape cancels. |
| Scan | Select **SCAN**, then press Space or Enter. The result reports the nearest eligible drop when it is in range. |
| Missile targeting | Use the arrow keys to position the cross near a building. Space or Enter fires at the selected target; Escape cancels. |
| Missile flight | Hold Left or Right to steer. The missile flies forward at a fixed speed and altitude. |
| Flight result | Press Space or Enter to return to the dashboard. |

## How the prototype works

The dashboard and missile flight are two screens in one state machine. Dashboard state is
kept across flights, so movement, destroyed buildings, and collected drops persist when a
flight ends.

The world is generated deterministically as a single terrain grid. Towns and their buildings
are placed across the grid, routes connect passable cells, and movement refuses destinations
that cannot be reached without crossing high ground. The map can show either a local window
centred on the robot or the full world.

During a missile flight, the missile moves straight and level while the player steers
laterally. The top of the filled ground plane is the flight altitude: terrain above that edge
can be hit, while terrain below it is scenery the missile passes over. Collision samples the
same silhouette that is drawn on screen. Terrain is generated from a seed and validated so a
flyable route exists before it is used.

A hit turns the chosen building into a ruin. Drops remain hidden until their building has
been destroyed; scanning then gives progressively better information at closer ranges, and
walking close enough collects the drop automatically.

## Project layout

| Path | Purpose |
|---|---|
| `src/app.ts` | Top-level dashboard/flight state machine |
| `src/dashboard.ts` | Dashboard actions, movement, scanning, ruins, and drops |
| `src/dashboard-render.ts` | Dashboard, maps, routes, and status rendering |
| `src/local-map.ts` | Deterministic world, towns, terrain tiers, and buildings |
| `src/route.ts` | Passability and route finding |
| `src/flight.ts` | Fixed-timestep missile simulation |
| `src/terrain.ts` | Seeded flight terrain and flyability validation |
| `src/render.ts` | Missile-flight rendering |
| `src/building-art.ts` | Shared line art for building targets |
| `src/explosion.ts` | Hit and crash effects |
| `src/input.ts` | Keyboard actions and steering input |
| `src/config.ts` | Tuning values and display configuration |
| `test/` | Unit tests for the game rules and generated terrain |

Game rules are kept separate from canvas rendering so they can be tested without a browser.

## Checks

```sh
npm test
npm run typecheck
npm run build
```
