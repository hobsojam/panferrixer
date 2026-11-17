# Mind-Merged Robot Game: Design Notes

Working notes for a possible reimplementation of a 1985 home-computer game (Martech's tie-in game, played by the author on the Amstrad CPC), with all licensed branding removed. Target: a modern Windows laptop.

Status: research and design discussion. Nothing built yet.

**How to read this document.** Every statement is tagged by where it comes from:
- **[Manual]** the original instruction manual (Spectrum and Amstrad, 1985), supplied by the author.
- **[Author-observed]** what the author saw or remembers from playing the Amstrad version.
- **[Reviews]** period magazine reviews (mostly Spectrum and C64 versions).
- **[Author-direction]** something the author has said they want.
- **[Proposal]** a suggestion from the design discussion that has not been confirmed.

Original names (robots, places, enemies) are not used here; role names are used instead. Our game needs its own names.

---

## 1. Goal and constraints

- Re-create the *feel and structure* of the original as a standalone game with its own name, world, art and audio. [Author-direction]
- Must be good enough to be worth playing in its own right; the author has already finished the original recently, so this is not nostalgia-only. [Author-direction]
- Legal posture (not legal advice): reuse ideas and mechanics; do not reuse names, robot designs, original art or code, music, map artwork, or exact UI layouts. Pick a new name and setting.

## 2. The original, as established

### 2.1 Versions and sources
- Released 1985-86 for Spectrum, Amstrad CPC, C64 and MSX. The manual covers Spectrum and Amstrad together, so those two are treated as the same design.
- **The C64 version is a different game in several ways** [Reviews]: eight networks and eight pieces, music by Rob Hubbard, and extra subsystems (rail gun, jamming, rotating shields, missile fuel loading, a manipulate icon). This explains why the author does not remember jamming or shields from the Amstrad version: **they were C64 features, not Amstrad ones.** Earlier notes in this document that mixed them in have been corrected.

### 2.2 Premise [Manual]
The player is a human who has merged minds with a small, fast robot and sees nothing of the outside world. Everything the player sees is "projected" by the robot as images, like thoughts popping into the mind. The robot's primary drive is survival: if it feels threatened, its own feelings affect the decisions it takes. The top display (the "thought" trace) shows the robot's state of mind and can be interpreted with experience; this is probably the spiky trace at the top left of the dashboard.

### 2.3 Goal and progression [Manual]
- Recover six pieces of a supreme combat robot, rebuild it, merge with it, then find and destroy the enemy leader.
- The pieces are buried under six different city domes, with at most one piece per network. Four networks therefore have no piece at all. **Which domes hold pieces may be different every time the game is played.**
- To find a piece: destroy the dome, move into the destroyed city, and use the scanner to see whether a piece is there. Pieces are too large to carry, so the player calls a spacecraft by radio to collect each one. Every collection upgrades the player's robot, which becomes larger and more powerful.
- Six robot forms are listed in ascending order of power, from the small fast starting form up to the final supreme robot.

### 2.4 The world [Manual, plus Author-observed drawn map]
- Ten numbered city networks, each in its own valley. Mountain ranges separate the networks, which are connected by relatively passable valleys. The player starts in a valley between two impassable ranges.
- Each network has **eight city domes, one power plant, one mine and one beacon** (so about 80 domes in total, of which only six hold anything).
- Terrain tiers (valleys, higher ground, hills) exist on the map. [Author-observed] They do nothing except block movement; they do not even block missiles (possibly a bug).
- The map is effectively a graph: ten nodes joined by narrow passes. This makes reachability easy to validate in a generator.

### 2.5 Buildings [Manual]
- **City domes** are construction plants where the androids build new enemy robots. Each dome has a force field that protects it from missile attack.
- **Power plant**: supplies the power the enemy robots need, and is connected to every dome, powering the force fields. It has no protective field of its own, but when attacked it switches its power to an extremely strong deflector shield. That temporarily drains the network's power (so the dome force fields go down), but **the power plant itself survives.** [Author-observed] The window in which domes are vulnerable lasts roughly 45 seconds.
- **Mine**: provides the raw materials for enemy robot production.
- **Beacon**: sends a continuous signal that alerts the two boss robots to any intruder in that network. [Author-observed] In practice it only alerted the two bosses, which mostly made them easier to find in the endgame.
- Each type has its own map icon and its own line art in the missile terminal phase. [Author-observed]
- What each type drops when destroyed is not described in the manual. [Author-observed] Upgrades are always under buildings, but not every building holds one. Nothing is "just there" on the map. Drops come only from destroyed enemies and buildings.

### 2.6 Enemies [Manual, plus Author-observed]
Six enemy types in ascending order of power, described by role:
| Role | Behaviour | Replaced when destroyed? |
|---|---|---|
| Fast patroller | Patrols important locations; defensive guns only, no missiles; when its location is attacked it is sent at speed to bring help, usually the defenders | Yes, by a working dome |
| Hauler | Travels between mines, power plants and domes carrying raw material and power pods; if destroyed, the cargo is not damaged and can be picked up with the scanner | Yes, by a working dome |
| Defender | Kept on stand-by inside domes; attacks intruders without mercy when alerted | Yes, by a working dome |
| Hunter | One per network; set patrols looking for intruders; guns and missiles | No |
| Boss 1 | Defected renegade; heavily armoured; has radar that detects beacon signals; roams between networks | No |
| Boss 2 | The enemy leader; roams between networks; heads straight for the player when a beacon alerts him | No |
- **Replacement is a supply chain:** destroyed patrollers, haulers and defenders are replaced by *correctly functioning domes*, meaning domes with enough power and raw material. This is already a built-in limiter on enemy numbers. [Manual]
- [Author-observed] Enemies are roughly two kinds: scripted patrols, or very simple (non-AI) attack-the-player and defend-the-buildings behaviour. They are separate targets; the only pressure to engage them is that they attack the player.

### 2.7 The interface: eight icons [Manual, with Author-observed usage]
| Icon | What the manual says | Author's experience |
|---|---|---|
| Robot ID | Identifies enemies detected on the short-range map | "Totally pointless", never used |
| Scanner | Scans the immediate vicinity for objects on or just under the ground; shows power pods or raw material (triangle) and a piece of the supreme robot (circle); anything shown is picked up automatically | Range effectively zero (only the current pixel); used after destroying a building to find the drop. Regarded as a bug |
| Status | Shows power pods, missiles, guns, damage, and the number of pieces collected | Normally not needed, theoretically useful |
| Guns | Defensive: if an enemy fires a missile and the robot can counter its tracking, the guns can shoot down incoming missiles, aided by a 3D perspective overlay on the image of the missile; missiles not hit strike and damage or destroy the robot | The defence mini-game starts automatically when an inbound missile is detected, so the icon is pointless (differs from the manual) |
| Move | Trace a route on the long-range map and fire; the robot follows it if able, but may override the player's decision if it feels threatened or is in combat | Obvious and needed |
| Info | Identifies features on the long-range map | Never used; an in-game help and catalogue of enemies |
| Radio | Two requests (see 2.9) | Used to call in support |
| Missiles | Short-range offence (see 2.8) | Attack enemies |
- The map has two modes: a long-range map (not magnified, from the robot's computer banks and intelligence reports) and a short-range map (magnified, own position at the centre, from the short-range detector). [Manual]
- Windows pop up over a persistent dashboard. [Author-observed screenshot] The dashboard is a framed grid of icon panels, a name bar for the current robot form, and the pop-up drawn over the middle.
- Controls: direction keys or joystick, fire, deselect, **hold** (freezes the game), abandon, release, and **save** (to tape; not possible while the robot feels threatened). [Manual]

### 2.8 The missile mini-game [Manual, Author-observed]
- Targets can be enemies, power plants, mines, beacons or city domes, chosen by placing a cross on the short-range map. Only targets within the missile's range can be chosen. [Manual, Author-observed] There is **no fuel mechanic** on the Amstrad. [Author-observed]
- The missile carries a camera. The player must guide it through hills and mountain ranges to the target, with very quick reactions needed. [Manual]
- **View** [Author-observed]: forward-looking wireframe: black background, yellow frame, red horizon line, blue jagged mountain silhouettes, and a yellow marker at the top showing the direction of the target (it starts centred).
- **Controls**: left and right only. No speed or altitude control; the missile flies straight and level. Mountains are the only real obstacle; all the mountains are identical and randomly placed.
- **Terminal phase**: close to the target, a line-art image of the target appears and the player must fly into it.
- **Duration**: about 30 seconds, varying with distance but not linearly.
- **Failure**: hitting a mountain explodes the missile (mushroom-cloud animation and sound) and returns the player to the dashboard. Failing to fly into the target gives a "missed" popup. Either way the player spends the seconds and one missile from a limited stock, and can fire again.
- Only the targeted object exists in the flight view, even if other enemies or a building stand behind it.
- When a building is destroyed, the item it drops lands on the exact pixel the missile hit, even though the building is much bigger, so the player must remember exactly where they fired. [Author-observed; the main tedium]

### 2.9 The radio [Manual, Author-observed]
1. **Long-range missile strike**: choose a power plant, mine, beacon or dome on the long-range map. The missile homes in on its own and takes about 30 seconds to arrive. [Manual]
2. **Spacecraft pick-up**: dispatches a spacecraft to collect a piece found in the field, which upgrades the player's robot. [Manual]
- In practice the strike is used on the power plant to open the shield window; any missile attack on the plant triggers the deflector, so the player's own missile could also open it. The strike is the hands-off version. [Manual, Author-observed]
- Call-ins are unlimited, only a cooldown applies. [Author-observed]
- The author sees this as an awkward mechanic that probably tried to add skill and timing: if a strike can be called in, why are the player's own missiles needed? The shield window (about 45 seconds) against a flight (about 30 seconds) allows one shot, or two if the target is close.

### 2.9a The missile-defence mini-game [Author-observed, from two screenshots]
- It **starts automatically** when incoming missiles are detected. There is no real in-flight "incoming missile" with a time of flight; the attack instantly starts the mini-game. (The manual describes selecting the Guns icon; the Amstrad version does not need it.)
- View: a tunnel drawn as two blue walls (the author's reading: an abstract representation of orientation, not a real thing). Incoming missiles are drawn as pyramid-like wireframes flying towards the player; they grow as they approach (far: a small triangle near the centre; close: several large overlapping pyramids).
- The player fires guns to destroy the incoming missiles. Outbound fire is shown as yellow stars.
- A missile that is not destroyed hits the robot and damages or destroys it. [Manual]
- Which enemies trigger it: those with missiles (the manual lists missile systems on haulers, defenders, hunters and the bosses; patrollers have guns only).

### 2.10 Energy [Manual, Author-observed]
- The status panel lists power pods, and the scanner picks up power pods dropped by haulers. The batteries at the bottom of the dashboard are probably these pods. [Author-observed] There is only **one bank**, drawn left to right across the bottom; the apparent two banks in the screenshot are just an awkward layout, with the rightmost cells used first. It ticks down slowly. The author's reading is that energy is a mild pressure to stop the player standing around without making progress. What drains it, and what happens at empty, is left open for now.

### 2.11 Reception [Reviews]
Very high scores (for example 96% in one Spectrum review). Praise: depth, the windowing and icon system, the missile sequence, and simple individual mini-games that interlock. Criticism: a steep first hour (hard to recover even the first piece), weak sound on Spectrum, wobbly scrolling on C64.

## 3. Author-direction (what the author has said they want)

1. Start with a small proof of concept (a couple of buildings, minimal enemies) and build up to a full map.
2. The missile mini-game is the core and the most memorable part; the drive of the game is exploring and the excitement of finding an upgrade.
3. **Design principle:** the missile flight is a mini-game inside the exploration game. It must not become a flight simulator with another game as a wrapper; balance "abstract guidance of a cruise missile" against flight-sim detail.
4. The finding is not the challenge in the flight (the marker gives the direction); the fun is the dodge, then the hit as the dopamine payoff.
5. Fix the drop-location annoyance (item lands on the exact pixel hit).
6. Fix the scanner (range of zero is a bug); redesign it at least a little.
7. Add variety to the mountains and terrain in the missile flight.
8. Treat the radio call-in as a second weapon (for example a graphite bomb or EMP), not as fire support; no usage limit, only a cooldown; maybe an energy cost.
9. Buildings should have logical drops: mines are ore mines (so armour or energy), electronic buildings give energy or electronic parts; suggested a comms centre and a barracks in place of the beacon.
10. Escalation must not ramp up too quickly (avoid being dogpiled).
11. Jamming and other countermeasures should only appear on later, more powerful enemies; a standard enemy is just a standard enemy.
12. The missile is a cruise missile: it never turns a full circle, so the direction marker does not wrap; in fiction it is launched vertically and settles into flight toward the target.
13. The enemy attack and missile-defence mini-game was parked for later; it has since been discussed (sections 2.9a and 4.8).
14. Controls: arrow keys, or possibly the mouse. The original used a joystick, which is rare on Windows laptops.
15. Inbound attacks cannot occur during an outbound missile flight. There is no in-game reason and the design should not try to handwave one; it simply does not happen.
16. Attack length and damage per missile depend on the enemy. A standard enemy is about 10 seconds with fairly low damage. No attack should last more than about a minute, because longer gets boring or frustrating. A damage model has not been discussed in full yet.
17. Zero shields is death. Without a real failure state it is not a game but a walking simulator.
18. Zero energy is also death, or at least immobilisation (death unless energy can be picked up nearby).
19. Saving (agreed): death means reloading the last save. The player can save at any time the robot is not threatened (as in the original), plus an autosave whenever a piece is collected, so a death never costs more than the stretch since the last upgrade. No saving while threatened.
20. Shields recharge while the robot stands still and is not threatened, paid for in energy. Only damaged plates recharge; lost plates need an armour pickup (agreed, section 4.9).
21. Engagement range can scale with enemy level: harder enemies may have longer range or open fire earlier.
22. Enemy aggression is tunable and should fit the role: a hauler is predominantly defensive, a patrol does its job and investigates (section 4.10).
23. Tougher enemies and perhaps military installations could have point defences against the player's missile, mirroring the player's own defensive gun. Preferred form: a hazard in the missile's terminal phase. No dashboard counter for now (section 4.11).

## 4. Proposals (from the discussion, not yet confirmed)

### 4.1 Missile flight
**Principles and tests for any new control** (derived from the author's principle above):
1. Does it create a decision (such as a route choice), or just more hand-work? If removing it would not change what the player chooses, drop it.
2. Can the whole state be read at a glance, with no instruments to learn?
3. Does it fit within roughly 30 seconds, with no ramp-up or settling in?
4. Does it raise the skill ceiling without raising the floor?

**Pacing:** keep tuning flight time so a shot is always worth the tension regardless of distance.

**Heading model:** the missile launches already aimed at the target, so the marker starts centred (confirmed on the Amstrad). It only moves off-centre when the player steers to dodge, and it shows how far off course the player is. When far off course it clamps to the edge of the strip. Optionally cap lateral drift, which also gives terrain a natural width. Steering inertia would fit naturally. A short vertical launch and pitch-over could play before the player gets control.

**Control variants to prototype against the classic baseline (left and right only):**
- Altitude: if tried, prefer discrete bands (low and high) over continuous altitude, so mountains have heights and routes become a choice.
- Throttle: speed against reaction time.
- Steering inertia.
- Interference from enemy countermeasures.
- Open question: was the fun in the dodging or in the finding? The author's answer so far: the dodge, then the hit.

**Distance indicator:** undecided whether it adds or removes fun. If tried, keep it implicit (marker grows, brightens or pulses, or a sonar-style ping that speeds up) and prototype it as a toggle (none, marker change, audio ping).

**Polish where the payoff is:** target line art filling the screen, explosion, building collapse, drop. Keep the miss low-key; consider distinguishing a near miss from a wide one.

**Terrain variety:**
- Shape types that ask different questions: narrow spikes, wide ridges, gaps and passes, and mixed density for a rhythm of tense and calm stretches.
- The visible silhouette is the hitbox, so what the player sees is exactly what kills them.
- Fairness: generated terrain must always leave a passable path.
- Readability: avoid the tangle of overlapping lines seen in dense clusters in the original; use depth fading or line-weight variation.
- Region themes (ice, desert, canyon) cosmetic first, mechanical later.
- Let the terrain between launcher and target shape the flight (hills in the way give denser mountains), which makes terrain matter and links the map to the mini-game. Terrain difficulty could also scale with stronghold depth.

**Radar and countermeasures (later):**
- Evolve the direction marker into a single radar-style element on the top edge: position shows bearing, size or pulse shows range; interference effects sit on the same element. Do not add a second display.
- Interference degrades information and never removes it: wobbling or lagging bearing, short dropouts, false contacts.
- The missile has no compass, so a dropout needs a "ghost marker": it freezes in a dimmer colour and the game moves it as the player steers, with error building up over time.
- Keep dropouts short; the terminal phase appears at close range regardless of radar state.
- Countermeasures (jammers, chaff and so on) only on later enemies, so the early game stays as simple as the original. Enemy countermeasures are something the player flies through (a wobbling marker, decoys), with no dashboard step. **Deferred by the author:** player jamming as a pre-launch counter on the dashboard. The author is uncertain about jamming a jammer at all, as it sounds like an arms race.
- Prototype: keep the simple marker and make the bearing source swappable.

**One target per flight:** keep the flight abstract. Fiction fix: the missile is a seeker locked to one designated signature, and a miss means overshoot and loss of lock. Rejected for now: showing several objects in the terminal phase (readability, tuning cost, flight-sim creep). Optional later: splash damage, and near-miss feedback.

### 4.2 Scanner redesign
Manual and author agree on how the original works: the scanner is used after destroying a dome, standing in the ruins, and anything it shows is picked up automatically.

**Under discussion [Author]:** nothing about a building's contents can be found before it is destroyed, so the unknown contents are part of the loot-box pull. Drops and parts are only findable after the building is gone, either lying where the missile hit or uncovered when the building falls. The rest of this section is the earlier proposal, which assumed some pre-fire scanning and needs revising once this is settled.

The proposal gives it a different job:
- A ping with a radius, shown on the map, with the radius as an upgrade stat.
- Graded information, with fixed ranges (not tied to the size of a town, so the experience is the same everywhere): within 1 cell the drop is picked up; within 6 cells a blip shows with no direction; within 12 cells the direction shows. The numbers are placeholders in config. The player already knows roughly where to scan, since a drop lands where the missile hit, so the scan is a search around that spot.
- A pacing cost: a cooldown or a small drain on the batteries.
- Pickup by proximity once drops land at the building's centre.
- Role: with about 80 domes and six pieces, blind-firing is hopeless. Scan should tell the player which buildings are worth a missile (a shot at an empty building is wasted), which also removes the "each town has one thing" predictability.
- Risk: scan could make finding upgrades too easy. Keep it a puzzle with **triangulation** (signal strength grows as you get closer to the building with the upgrade, so scanning from two or three spots narrows it down), or a partial reveal (a cluster or area, with only close range pinning down the building).

- **Question from the author (not a request): replace Scan with a constantly scanning radar screen? How would that differ from the mini map?** Answer: it would not differ, so no separate radar screen; two always-on top-down views of the same space are redundant, and the mini map already shows enemies in time for first strike. The real choice is passive versus active sensing of building contents, with the result shown as a layer on the mini map either way:
  - Passive: contents of nearby buildings appear once within sensor range (extended by upgrades); no Scan verb; exploration becomes a routing question (getting close costs energy and exposes the player to defenders). Simpler; risk of a drive-past-every-dome checklist.
  - Active: the ping with an energy or cooldown cost and triangulation. Keeps a small puzzle and a spending decision; risk of spam if cheap.
  - Lean: keep the active ping for now (the only detective work in the game, and tied to the energy economy), but carry both in the PoC behind a toggle. If players just hammer the ping, switch to passive and drop the Scan verb.
- **Author's idea for the active form: the Scan button adds a radar pulse to the mini map** (a green sweeping arm, or a concentric ring expanding outward) that shows blips for items. Recommended form: the expanding ring. One press is one pulse (a sweeping arm reads as an always-on radar); the ring travels out and stops at the sensor limit, showing range without a number, and upgrades visibly extend it; blips light up as the ring passes. Refinements: blips are fuzzy at a distance (a soft blob covering a few buildings) and sharpen up close (triangulation without numbers); blips fade after a few seconds, so the player remembers or pulses again, and each pulse costs energy.

- **Author's idea: going active on radar gives the player away** (the game is not really a stealth game), waking up any enemies that pick up the spike. Proposal:
  - Model: a pulse is a noise event at the player's position with the ring's radius. Only enemies inside the ring react. No visibility meters or sneaking.
  - Reactions follow the role stances (section 4.10): a patroller comes to investigate; a hauler moves away (pinging near one scares off the energy supply); a defender goes on alert if its dome is inside the ring; a hunter heads for the source.
  - Scan becomes risk against reward: information about buildings in exchange for some of the first-strike advantage. This answers the "click me" worry better than an energy price.
  - Exposure can replace the energy cost: keep a short cooldown, charge little or no energy, so fewer things drain the batteries.
  - Deliberate use: enemies that come to investigate arrive on the mini map on the player's terms, so pinging to draw a patroller in and striking first is a legitimate tactic (as with the beacon as a boss lure).
  - Anti-snowball: the response is "come and look", not "attack at once"; the cap on simultaneous attackers still applies.

### 4.3 Power plant, shield window and the second weapon
- The original power plant cannot be destroyed (it survives by switching to a deflector shield), so the open question "can a missile destroy it?" is answered: **no**. Keep it indestructible; this keeps the window mechanic clean.
- Reframe the radio strike as a **utility weapon that disables power** (for example a graphite bomb, which shorts out a grid with conductive filaments, or an EMP) and not as firepower. Only the player's missiles damage anything. Different interaction from the missile: pick a spot on the long-range map, no flight.
- **Missiles on shielded domes (author's decision):** the missile is used up and does not kill the target. Firing again is not blocked. Without the power being disabled first, the next shot fails too, so the cost is a missile, not a lockout.
- PoC: cooldown only (as in the original) plus the alert side-effect. Add energy only if it feels too free in play, and only as a general resource shared by several systems. Upgrades could extend the window, add charges or widen the area. Later enemies could have hardened power plants.
- **Piece collection is automatic, not a verb** (author's decision). The original radio's second function was calling a spacecraft to collect a piece; since it would always be used, it carries no decision. When the player reaches a piece, the pick-up happens by itself with a short upgrade sequence (the craft arrives, the robot grows, cells and plates extend), followed by the autosave. Optional, to try in play: the pick-up waits until the robot is not threatened, so a piece found mid-fight means dealing with the fight first; drop it if it only feels like a delay.
- A building protected by shields means using a window on the comms centre (if added) means not using it on a dome that might hold a piece: a real trade-off with no special rules.

### 4.4 Building types and drops
The original already has four types (dome, power plant, mine, beacon), each with its own icon and line art. What is undefined is the drops. Proposal, following the author's logic:
| Building | Drops (proposal) | Notes |
|---|---|---|
| Dome | Mostly nothing; occasionally supplies; the six pieces | The haystack |
| Power plant | None (indestructible) | Shield switch; energy comes from hauler cargo instead |
| Mine | Armour or repair material, or energy | Ore |
| Comms centre (replaces beacon) | Electronics: minor boosts | Alerts the two bosses (as the original beacon); who builds a "beacon"? |
| Barracks (author's suggestion) | Missiles and ammo | Possibly redundant: domes already make replacement enemies |
| Haulers (enemy) | Cargo: power pods and raw material (as the original) | Gives energy resupply without a destructible power plant |
- Electronic parts: treat as direct minor boosts (a little scan radius, some resistance to enemy countermeasures), not a parts currency, unless the PoC shows one is needed.
- Missile restock: unknown in the original (see open questions). The barracks or hauler cargo are candidates.
- Optional later: a radar building that detects the player and feeds the comms centre; the grid-disable could silence comms during the window.

### 4.5 Escalation and pacing
- The original is gentle: the beacon only alerts the two bosses, and enemy replacement is limited by the dome supply chain (power and raw material). PoC: start with exactly this.
- Idea: because the alert is a boss-finder, the player can use it deliberately: a risk early, a lure to trigger when ready in the endgame.
- If more is added (a barracks spawning defenders, reinforcement calls), apply these guardrails:
  - Finite garrisons: a limited pool and slow spawn rate; destroying the source stops spawns.
  - Hard cap on active attackers (about 2-3 at once), extras queue; important for the missile-defence mini-game.
  - Reinforcements take time to arrive along the passes, so they can be seen coming.
  - A visible alert dial with stages (calm, suspicious, alarmed, full alert); bosses at the top stage.
  - Recovery: the alert decays if the player leaves or goes quiet; it stays local to a network.
  - Comms cooldown: one call per period.
  - "Dogpile check" in the PoC: log the maximum number of simultaneous attackers and the time from alert to first arrival.
- Principle: escalation should be pressure the player can read and manage, not a trap they cannot recover from.

### 4.6 Dashboard and verbs
- Verb set: **Move, Scan, Missile and Grid-disable**. Extract was dropped (author: any opportunity to use it would always be taken, so it is just a button labelled "click me"); collection is automatic (section 4.3). Status is folded into an ambient display (batteries, damage, the state-of-mind trace). Cut the robot ID icon and the info icon (replace with contextual information on selected targets, and optionally a catalogue that fills in as enemies are met). Guns become a reactive mini-game, not an icon.
- Energy and shields display: the original swapped one or the other into the same bar across the bottom of the dashboard (author). With modern resolution, show both at once (author). **Agreed by the author:** segmented cells for each, battery cells for energy and armour plates for shields, rather than plain bars. Reasons: segments are tunable units (a standard missile costs one plate, a cargo pickup restores two cells); hits and pickups are visible events; upgrades visibly add cells and plates; it fits the robot projecting its own state. Use different shapes as well as colours so they are never confused. Energy drains gradually within the current cell; shields drop in whole plates. Low state: flash the last cell or plate and agitate the state-of-mind trace.
- Segmented battery cells are glanceable and diegetic. If energy stays as a pacing clock, define what happens when it runs low (reduced range, slower recovery, shakier systems) and not a sudden end.
- Use our own dashboard arrangement, icon art and branding; the panel-grid-with-overlapping-windows idea is fine, the specific layout, icons and logo are the original's expression.

### 4.7 Map and generation
- Concerns [Author-direction]: every area must be reachable and the game winnable; drops must be spaced to reward exploring everywhere without a predictable "each town has one thing" pattern.
- The original already randomises which domes hold pieces each game, and only six of ten networks hold any.
- Reachability: generate then validate on the graph; hybrid option: hand-designed network layouts placed on a generated graph (a network is a blob of eight domes plus the support buildings).
- Winnable progression: dependency-aware placement, so each key upgrade is somewhere reachable given what the player already has.
- Minor drops come from enemies and so spread out on their own.
- Later decision: fixed map per playthrough or seeded generation so layouts can be replayed and shared.

### 4.8 Missile defence
- Symmetry: offence is steering a missile through obstacles, defence is shooting missiles at the player. Keep that contrast; both are short, abstract and readable at a glance.
- Automatic start is diegetic: the manual's premise is that the robot's survival drive takes over when threatened, so the reflex takes the screen. This also explains why the Guns icon is redundant. Keep it.
- Cost of the instant start: no warning and no chance to move. Add a short warning beat of one to two seconds (a sensor sound, a spike in the state-of-mind trace) so it does not feel like a random yank. Attack frequency and missiles per attack become the difficulty dials, which fits the hard cap on simultaneous attackers (section 4.5).
- Keep the tunnel walls as a depth cue and use size for distance; make the player's tracer rounds clearly distinct from the missiles.
- Stakes: a missed missile damages the robot; success costs nothing. Keep it simple unless the PoC shows it is too free.
- Interaction to decide: attacks can land during the 45-second shield window. If the window keeps running, a defence engagement costs the player shots and creates real tension; if it pauses, attacks are a free interruption. Lean: let the window run, with short engagements so an attack costs seconds, not the whole window. Feel-test.
- Decided (author): an attack cannot start during an outbound missile flight; no fiction is offered for it. Implementation note: defer an attack that comes due during a flight until the flight ends, so the rule delays attacks and does not cancel them. Missiles are limited, so chaining flights to dodge attacks is not an exploit worth worrying about.
- Controls (author): arrow keys or the mouse. Support both: the missile flight needs only left and right (arrow keys, or mouse horizontal movement), and the defence mini-game suits mouse aiming as well as arrow keys. A gamepad could come later.
- Length and damage depend on the enemy (author): a standard enemy is about 10 seconds with fairly low damage; stronger enemies run longer and hit harder; hard cap of about one minute. Tune length through the number and spacing of missiles in a wave.

### 4.9 Armour arithmetic (starting values for the PoC config)
Author's brief: assume half the missiles are shot down; the player should survive a couple of attacks from a standard enemy.
- Correction (author): a single missile every few seconds is trivial to defend. The original sent a small volley of 3 to 5 missiles every few seconds. The pressure comes from more targets than can be handled at once, and choosing which to shoot first.
- Standard attack: about 10 seconds, 3 volleys of 3-5 missiles (4 on average), so 12 missiles. At half shot down: 6 hits per attack.
- Starting armour: 8 plates, each absorbing 3 hits (intact, cracked, badly damaged, gone), so 24 hits in total. This keeps the dashboard readable instead of showing two dozen plates.
  | Player skill | Shot down | Hits per attack | Attacks survived |
  |---|---|---|---|
  | Struggling | 3 of 12 | 9 | 2 (dies in the 3rd) |
  | Average | 6 of 12 | 6 | 3 (dies in the 4th) |
  | Good | 9 of 12 | 3 | 7 (dies in the 8th) |
  | Perfect | 12 of 12 | 0 | Unlimited |
- Tighter option: 2 hits per plate (16 hits), where the average player survives two attacks and dies in the third.
- Repair: an armour drop (for example from a mine) restores about 2 plates (6 hits), so one drop undoes one average attack.
- Stronger enemies scale by larger or faster volleys and heavier missiles (more hits each), up to the one-minute cap. Upgrades are meant to add plates before the player faces a boss.
- **Attrition concern (author):** if each enemy gets off an average of one attack before being killed, the player needs an armour pickup for every enemy met, which is too harsh. Either the chance of the player striking first must be quite high, or armour pickups must be much better.
- Proposal: use both levers, leaning on first strike.
  - First strike is half-built into the rules: attacks cannot happen during a missile flight, so spotting an enemy and firing first means a hit kills it before it attacks. Chance of no damage is roughly (chance of seeing it first) x (chance the missile hits). Make the player's detection range on the short-range map comfortably larger than the range at which enemies engage, so an attentive player usually shoots first and damage is mostly the price of a miss or inattention.
  - Confirmed for the original (author): enemies are normally visible on the map before they fire, so first strike was usually available.
  - Engagement range as a third difficulty dial (author): standard enemies engage well inside the player's detection range; harder enemies have longer range or open fire earlier, shrinking or removing the first-strike window. Detection range can grow with upgrades, so the two race each other. A boss that out-ranges the starting robot guarantees an attack, which is fair for the endgame. Boss-tier countermeasures could also shorten the player's detection.
  - Expected cost per enemy at 2 plates per attack: 0% first-strike kills = 2 plates (4 enemies per 8 plates); 50% = 1 plate (8 enemies); 75% = 0.5 plate (16 enemies).
  - Better pickups: 3-4 plates each, covering roughly four to eight enemies at those rates.
  - Free softeners: patrollers have no missiles (manual), so not every enemy attacks; destroyed attackers could sometimes drop armour, making fights partly self-funding.
  - **Shield recharge (author finds this interesting: wait to get health back at the cost of energy, or the risk of being ganked?).** Agreed by the author, including the rule that only damaged plates recharge and lost plates need a pickup:
    - Resting is standing still while not threatened (the same "threatened" state used for saving), so no new icon.
    - Energy is the price: recharging drains the batteries at a visible rate. Damage therefore ultimately costs energy, and hauler cargo becomes the master resource.
    - The gank risk needs no extra rules: enemies patrol, so a stationary robot can be found, and an attack interrupts the rest.
    - Guards against turtling: only damaged plates recharge, lost plates do not (a cracked plate heals, a destroyed one needs an armour pickup), which keeps pickups valuable and caps resting; make it quick (a few seconds per plate) so the choice is about cost, not patience; make the energy cost bite so topping up after every scratch is not worth it.
    - Fits the energy pressure: standing around normally just wastes energy; now it buys something.
  - Tuning target: an average player loses about 1 plate per enemy encounter.

### 4.10 Enemy behaviour and aggression
Author-direction: aggression (storming in guns blazing, standing off, or running away) is tunable and should fit the role. A hauler should be predominantly defensive; a patrol should do its job and investigate.
| Role | Stance | Behaviour |
|---|---|---|
| Hauler | Defensive | Keeps to its route and flees if threatened; fires only if cornered or attacked. Fleeing takes its cargo away, so chasing is a choice |
| Patroller | Investigates | Follows its beat; comes to look when something is wrong; has no missiles (manual), so on confirming an intruder it runs for help |
| Defender | Guards | Stays home until alerted, then attacks intruders near its dome; does not chase far |
| Hunter | Aggressive | Actively seeks the player within its network and closes in, firing |
| Bosses | Relentless | Roam until alerted, then head straight for the player |
- Parameters (all in config), each stance being a small state machine: approach (charge, hold at range, retreat); leash (how far from home or route); persistence (how long it chases or searches); break point (whether it flees when damaged).
- **One hit, one kill.** In the original every enemy dies to a single missile hit (author; unusual in games, perhaps part of the charm). Recommendation: keep it. A shot already costs about 30 seconds of skilled flying and a missile; the hit is the payoff and should not merely wound; a tougher enemy should be harder to reach (denser terrain, countermeasures, a smaller terminal target) and more dangerous (attacks, engagement range), not a bigger health bar; and it keeps first strike clean, since multi-hit enemies would always get an attack in. Possible exception, to decide later: the final boss as a duel of two or three hits with attack waves between, or one hit with the hardest flight in the game.
- Four enemy difficulty dials in total: volley size and pace, damage per missile, engagement range, and aggression.
- Link to first strike: a charging enemy shrinks the player's window, one that stands off gives time. Killing a patroller before it gets away to fetch help prevents the defenders coming: a first-strike reward that involves no damage.

### 4.11 Enemy point defence
Author's idea: the player has a defensive gun (working name: CIWS, as on ships); tougher enemies, perhaps enemy military installations, could have defences too.
- Fits one hit, one kill: tough targets are harder to reach, not tougher to kill. It also mirrors the player's own gun.
- Rule: never a dice roll. A random shoot-down after 30 seconds of good flying would feel terrible; the defence must be something the player plays against.
- Terminal-phase hazard: on a defended target the last few seconds add tracer fire sweeping across the view, which the player weaves through with the same left and right controls. Same skill, more intense finish, no new instrument.
- **Author's decision:** the terminal-phase hazard is the preferred form. The dashboard counter below is **not to be implemented for now; consider later.** Reasons: the author does not like switching from missile to cockpit and back, and if a boss must be hit with the EMP before firing, the game has to signal that somehow.
- Deferred: counterable from the dashboard: a powered defence is knocked out by the grid-disabler for the window, giving the EMP a second use and making "disable first, then strike" a plan. (The pre-launch jamming counter in section 4.1 is deferred for the same reasons.)
- Later option: arcs of fire, so the approach direction (where the player fires from) matters.
- Tiering, as with countermeasures: none on standard enemies; present on tougher enemies and military installations; heaviest on bosses. With jamming on the direction marker, a late target can be hard at both ends of the flight while still dying to one hit.
- Passes the four tests: creates decisions (dodge, or disable first); readable if tracers are distinct; fits in 30 seconds; appears only after the basic flight is learned.

### 4.12 Technology (agreed by the author as a starting point; it could be reimplemented in different tech later)
- **TypeScript with the browser's 2D canvas, no game engine.** Wrap as a Windows desktop app later if wanted.
- Reasons: the game is lines, panels and state machines and needs no physics, 3D or asset pipeline; everything is code and text, which suits building with Claude Code; rules can be tested automatically and visuals checked with headless-browser screenshots; instant reload for feel-testing; canvas line drawing with a little glow gives the vector-display look.
- Structure: a simulation core with a fixed timestep and a seeded random generator (reproducible runs, maps shareable by seed); all tuning values in config files; three screens as a state machine (dashboard, missile flight, missile defence); an input layer mapping keyboard and mouse to the same actions; logic kept separate from rendering so a later port is easier.
- Alternatives considered: Godot 4 (conventional engine, built-in export and controller support, more than this game needs); C++ with raylib (native, good fit for the graphics, slower to iterate and harder to verify automatically).
- Trade-off: it runs in a browser first; on Windows that means opening a local page until it is wrapped.

### 4.13 Setting
**Concept [Author-direction]:** an installation found on another planet. It is not clear what it is, perhaps something like one of the closed "atomic cities" of the USSR, but we do not really know. We were sent to investigate.

**What that gives us:**
- No justification needed for the hardware. A sealed, self-sufficient, heavily guarded installation that is on no map can have weapons, factories, a power grid and guard machines without the player ever being told why. This answers the author's question of why the machine would have cruise missiles.
- The mystery is the reason to explore: the player was sent to find out what the place is, which is the same drive as finding the next upgrade, with a question behind it.
- The installation is still running: mines dig, haulers carry, domes build machines, machines guard the mines. An economy working flat out with nobody visibly in charge.

**Proposals that follow from it [Proposal]:**
- Names are the investigator's field labels. Nobody knows what the machines are called, so they are named by what they do (runner, hauler, guard, hunter), and buildings likewise (power source; structure, purpose unknown). These are the role names already used in this document.
- The catalogue is the investigator's field notes. It fills in as things are encountered and is how the story is told, with no cutscenes. (This replaces the original's Info icon.)
- The player's robot could be one of the installation's own machines, found on site and merged with, not brought along. That would explain why it has a will of its own and sometimes overrules the player, why it is armed, and why its upgrades are buried under the installation's buildings.
- Tone: deliberate, sealed-off, a little melancholy; not the original's war between two factions. Avoid the original's red-versus-blue colour identity.

**Open:**
- Who built it? People, in a lost or secret programme (closest to the atomic-city idea); unknown builders (stranger, and the machines need not make human sense); or never answered. Lean: never fully answered, perhaps a hint when the last piece is recovered.
- Who the player is, beyond "sent to investigate".
- What the six pieces add up to in this setting, and what the ending is.

**Alternatives considered:** a dead or unfinished mining colony (close to the setting of the 1985 game Tau Ceti; the premise is common ground and fine to reuse, but it leaves the weapons unexplained unless they are repurposed tools such as blasting drones); a colony security force; an openly military outpost.

**Title:** not chosen. Checked so far: "Terminal Phase" is already an existing space shooter (dropped); "Carapace" is used by several itch.io projects (crowded); "Blue Moon" is a place name in the original's backstory (avoid); "Nap of the Earth" turned up no game of that name in one search (candidate, not cleared). Choose the title once the setting is firmer, and check any candidate against Steam, itch.io and the trademark registers before publishing.

## 5. Proof of concept plan
- One network's worth: a handful of domes plus a power plant, one enemy type (a patroller), and the full missile loop (select, launch, guide, hit, drop, pick up). [Author-direction]
- Verbs: Move, Scan, Missile first; add the grid-disabler when shielded domes arrive. Piece collection is automatic.
- Hand-built map, so missile feel can be tuned without a generator moving the goalposts.
- Data-driven: buildings, drops and enemy placement in config, so generation can be added later without a rewrite.
- Prototype toggles for feel-testing: classic controls versus altitude bands; distance indicator off, marker change or audio ping; the scanner radius and cooldown.
- Grow in steps: more buildings, more enemy behaviours, more networks, then the full map.

### 5.1 First slice to build: the missile flight on its own
A single playable page, no dashboard or map yet. Done when all of this works:
- Forward-looking wireframe view: horizon line, mountain silhouettes, a direction marker along the top edge. Our own art; nothing copied from the original.
- Controls: left and right only, via arrow keys and via horizontal mouse movement.
- The marker starts centred, moves off-centre only as the player steers, and clamps at the edge when far off course. No wrap-around.
- Mountains: the visible silhouette is the hitbox. Generated from a seed, with a check that a passable path always exists.
- Flight lasts about 30 seconds (in config). Near the end, line art of the target appears and the player must fly into it.
- Three outcomes: hit (give this the polish), crash into a mountain (explosion), and miss ("missed" message). A key restarts with a new seed.
- Engineering: fixed timestep, seeded random generator, all tuning values in one config file, logic separate from drawing, and an automated test for the passable-path rule.
- Stub the feel-test toggles so they can be added next: distance indicator (none, marker change, audio ping) and altitude bands (off).

## 6. Open questions
1. **Scope:** a compact game or the full original structure (ten networks, six pieces)? [Author: start small, grow]
2. Fixed map per game, or generated? Deferred; the PoC uses a hand-built map.
3. **Missile restock:** how are missiles replenished in the original (the manual does not say in the pages that cover the icons)? Candidates: upgrades, cargo drops, somewhere else.
4. Energy (one slowly ticking-down bank of cells): empty means death or immobilisation (author, section 3). Still open: what exactly drains it, and which of the two. Proposal: immobilisation, since it is cheap to build and death then follows naturally from enemy attacks, with a reprieve if energy is within pickup reach. It needs a guard against a soft-lock when nothing is nearby (a short timer to death, or the original's "abandon" control), a clear low-energy warning, and reliable refill sources (hauler cargo), or it will feel unfair.
5. What does destroying a beacon actually do in the original? The manual lists it as a valid missile target.
6. How large is the scanner's real range (the manual says "immediate vicinity", the author observes zero)?
7. Missile defence: starts automatically (section 2.9a); controls, enemy-dependent length (about 10 seconds for a standard enemy, never over about a minute) and the no-interrupt-during-flight rule are settled (section 3). Still open: how many missiles per attack, and whether the shield window and cooldowns keep running during an engagement.
8. Margin for error around mountains, and the length of a full playthrough.
9. Altitude bands: yes or no? Distance indicator: yes or no? (Both decided by feel-testing.)
10. Setting: concept chosen (section 4.13); still open are who built the installation, who the player is, what the pieces add up to, and the title and visual identity. (Engine and language are settled: section 4.12.)
11. Power station drops: stays indestructible with energy from haulers, or changes?
12. **Damage model** (partly decided): zero shields is death (author). Shields are shown as armour plates alongside battery cells for energy (agreed, section 4.6). Still open: how much damage each enemy's missile does, how repair works (armour from mines, restoration on upgrade), and whether damage degrades systems or only counts down. What death costs is settled (section 3, item 19). The original manual says a missile that strikes "damages or destroys" the robot, and saving was not possible while the robot felt threatened.

## 7. Deferred topics
- **Cluster overlap at mini-map scale** [Author-raised]: tested with four domes packed into about three local-map cells at 16 pixels. The icons merge into a blob, and the selected one is lost inside a cluster. Options: spread overlapping icons within their cells; show one icon with a count, and let the cross pick among the members; or enlarge the local view around the cross. Decide once clusters are placed by the generator, and check it with mixed building kinds too.
- Enemy attacks and the missile-defence mini-game: the author asked to return to this later. It has since been described (sections 2.9a and 4.8); remaining detail to settle: the damage model, missiles per attack, and timer interactions. A hard cap on simultaneous attackers protects this mini-game from overload.

- Dashboard counters to enemy defences, both deferred by the author: using the grid-disabler to knock out point defences before firing (section 4.11), and player jamming against enemy countermeasures (section 4.1). Reasons: no switching from missile to cockpit and back; any pre-firing requirement would need signalling; jamming a jammer sounds like an arms race.

## 8. Next steps
- [ ] Answer the remaining open questions (above), especially 1, 3 and 4
- [x] Choose a new setting: an unexplained installation on another planet (section 4.13)
- [ ] Choose a title and visual identity (no overlap with the original's)
- [ ] Build the PoC: one network, the missile loop, one enemy type
- [x] Pick an engine and language: TypeScript with the 2D canvas (section 4.12)
- [ ] Start prototyping, with this document as the starting spec; first slice is the missile flight

## 9. Remaining playtest checks (Amstrad emulator)
Most of the earlier checklist is now answered by the manual and the author's notes. Still worth checking in about 10-20 minutes of play:
- [ ] How many missiles are carried, and how are they replenished?
- [ ] What drains the batteries (they tick down slowly), and what happens when they run low?
- [ ] How much margin there is when passing mountains in the missile flight.
- [ ] Missile defence: how many missiles come per attack, and whether the shield window keeps running during it.
- [ ] What destroying a beacon does.
- [ ] What each building type drops, if anything besides pieces.
- [ ] How long it takes to find the first upgrade, and a full playthrough.
- [ ] The most frustrating and the most satisfying moment.

## 10. Sources
- Instruction manual, "The Battle Begins" (Spectrum 48K and Amstrad), Software Communications Ltd, 1985. Supplied by the author; used as a reference for mechanics and paraphrased, not copied.
- CRASH #25 review (Spectrum): https://crashonline.org.uk/25/zoids.htm
- ZZAP!64 #12 review (C64), via Gamebase64: https://gb64.com/oldsite/gameofweek/12/gotw_zoids.htm
- Computer Gamer #13 (C64): https://everygamegoing.com/larticle/Zoids-000/34614
- Commodore User #30 (C64): https://everygamegoing.com/larticle/zoids-000/53046
- Wikipedia: https://en.wikipedia.org/wiki/Zoids:_The_Battle_Begins
- The author's own screenshots and drawn map of the Amstrad version.
