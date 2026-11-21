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

- **The dashboard:** the robot's state-of-mind trace, energy and armour displays, action
  panels, a map, and synthesised sound effects.
- **One generated world:** ten towns, each the centre of a network with its power station,
  domes and other buildings, joined by valleys and cut up by impassable high ground.
- **Maps and movement:** local and full-map views, plus pathfinding that walks the robot to a
  chosen reachable cell. Intact buildings block the way; ruins do not.
- **Missile strikes:** targeting nearby buildings and enemies, then a forward-looking
  wireframe flight over generated terrain, with terminal target art, collisions, misses and
  explosions. A nearer target is a shorter flight.
- **Network shields:** suppressed for a timed window by striking a power station or using
  grid disable.
- **Persistent destruction:** a successful unshielded strike leaves a ruin on the map.
- **Salvage:** ruins and the wrecks of hunters and defenders can hold energy, armour and missile
  supplies, rolled unit by unit for each kind. A fixed set of six parts is also placed in
  buildings across the world. A visible scan pulse marks ruins and wrecks that still hold
  something, and walking close enough collects it. Parts are collectables for now; what they
  upgrade is still to come.
- **Enemies that move in real time:**
  - Each network's **hunter** guards its town. Coming within sight alerts it. It closes in
    over its own network's ground, fires across the edge when the robot is in range, and
    makes rounds of the domes while its network's power is cut.
  - **Defenders** wait hidden in domes until disturbed, then guard the area around their dome.
  - **Patrollers** walk wide loops between the towns, investigate scans, missile hits and
    power cuts, and run to the nearest armed enemy for help when they see the robot. They are
    lightly armed themselves.
  - Enemies carry a limited magazine and withdraw to a dome to rearm once it is empty.
- **Incoming attacks:** a first-person turret defence in which the player turns and fires
  at incoming missiles. Each missile that gets through cracks the armour plate facing it.
  Choosing a target or a walk point stops time, so there is always a chance to strike back.
- **Missile rack:** the robot carries eight missiles, and every launch uses one. Missile
  supplies in ruins refill it; an empty rack cannot fire.
- **Energy and armour:** energy drains with time and walking. Standing still out of danger
  mends cracked plates at an energy cost. Running out of energy, or losing every armour
  plate, destroys the robot and starts a new game.

Upgrades, saving, and the complete game objective are still planned
rather than playable.

## Playing

The latest `main` is published to GitHub Pages: <https://hobsojam.github.io/panferrixer/>.
It is deployed automatically after every merge, once typecheck, tests and the audit pass.

## Running

```sh
npm install
npm run dev
```

Open the local URL printed by Vite.

## Controls

The prototype is played with the keyboard. During an incoming attack, the mouse can also aim
the turret.

| Context | Controls |
|---|---|
| Dashboard | Arrow keys move between actions. Space or Enter activates the selection. M toggles sound. |
| Map panel | Move right from the action grid to select the map. Space or Enter toggles the local and full-map views; Left returns to the actions. |
| Move | Use the arrow keys to position the cross. Space or Enter sets a walking route; Escape cancels. |
| Scan | Select **SCAN**, then press Space or Enter. The result reports the nearest eligible drop when it is in range. |
| Grid disable | Select **GRID DISABLE**, choose a power station with the arrow keys, then press Space or Enter to suppress that station's network shields. Escape cancels. |
| Missile targeting | Use the arrow keys to position the cross near a building. Space or Enter fires at the selected target; Escape cancels. |
| Missile flight | Hold Left or Right to steer. The missile flies forward at a fixed speed and altitude. |
| Flight result | Press Space or Enter to return to the dashboard. |
| Incoming attack | Arrow keys turn the turret; hold Space to fire. Or click to capture the mouse, then move it to aim and hold the left button to fire; Escape releases it. The dashboard returns by itself when the attack is over. |
| Robot destroyed | Once the wreck has shown, press Space or Enter to start a new game. |

## How the prototype works

The dashboard, missile flight, incoming attack, and destroyed screens are one state machine,
updated at a fixed timestep. Dashboard state is kept across the other screens, so movement,
destroyed buildings, collected drops, energy and armour persist. Enemies, the shield clock
and the batteries keep running during flights and attacks; time stops only while choosing a
missile target or a walk point.

The world is generated deterministically as a single terrain grid. Towns and their buildings
are placed across the grid, routes connect passable cells, and movement refuses destinations
that cannot be reached without crossing high ground. The map can show either a local window
centred on the robot or the full world.

During a missile flight, the missile moves straight and level while the player steers
laterally. The top of the filled ground plane is the flight altitude: terrain above that edge
can be hit, while terrain below it is scenery the missile passes over. Collision samples the
same silhouette that is drawn on screen. Terrain is generated from a seed and validated so a
flyable route exists before it is used.

Most buildings are protected by their network's shields. Hitting the network's power station,
or selecting it with grid disable, opens a timed window in which other buildings can be
destroyed; the power station itself survives. A successful unshielded hit turns the chosen
building into a ruin. Drops remain hidden until their building has been destroyed; scanning
then sends a visible pulse across the map and gives progressively better information at
closer ranges. Walking close enough collects the drop automatically.

Enemies route over the terrain only: they cannot cross high ground but may pass through
buildings. Each one is a small state machine (posted, patrolling, alerted, rearming, and for
patrollers investigating and running for help). An alerted enemy in range opens an attack,
after which a short breather lets the player reply before anyone may attack again.

## Project layout

| Path | Purpose |
|---|---|
| `src/main.ts` | Browser entry point: canvas, game loop, and screen rendering |
| `src/app.ts` | Top-level state machine across the dashboard, flight, attack, and destroyed screens |
| `src/dashboard.ts` | Dashboard actions, movement, scanning, ruins, drops, energy, armour, and enemy behaviour |
| `src/dashboard-render.ts` | Dashboard, maps, routes, and status rendering |
| `src/local-map.ts` | Deterministic world, towns, terrain tiers, buildings, and enemy placement |
| `src/map.ts` | Where the ten networks sit on the world map |
| `src/route.ts` | Passability and route finding |
| `src/enemy-move.ts` | Enemy movement over the terrain, with remembered routes |
| `src/defence.ts` | Incoming-attack turret simulation |
| `src/defence-render.ts` | Incoming-attack rendering |
| `src/armour.ts` | Armour plates: which plate a hit cracks, mending, and replacement |
| `src/plates.ts` | Armour plate drawing shared by the dashboard and the attack view |
| `src/destroyed-render.ts` | The robot-destroyed screen |
| `src/flight.ts` | Fixed-timestep missile simulation |
| `src/terrain.ts` | Seeded flight terrain and flyability validation |
| `src/render.ts` | Missile-flight rendering |
| `src/building-art.ts` | Shared line art for building targets |
| `src/explosion.ts` | Hit and crash effects |
| `src/sound.ts` | Synthesised dashboard and missile-flight sound effects |
| `src/input.ts` | Keyboard and mouse input |
| `src/input-gate.ts` | Keeps a press on one screen from carrying over to the next |
| `src/rng.ts` | Seeded random numbers |
| `src/types.ts` | Shared flight-terrain types |
| `src/config.ts` | Tuning values and display configuration |
| `test/` | Unit tests for the game rules and generated terrain |

Game rules are kept separate from canvas rendering so they can be tested without a browser.

## Checks

```sh
npm test
npm run typecheck
npm run build
```
