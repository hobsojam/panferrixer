// All tuning values for the missile-flight slice live here (design-notes.md, section 4.12 and 5.1).

export type DistanceIndicatorMode = "none" | "markerChange" | "audioPing";

/** The network where the robot begins: the dashboard starts there, and patrollers keep clear of it. */
const START_NODE = 0;

export const config = {
  seed: 1,

  canvas: {
    width: 960,
    height: 600,
  },

  simulation: {
    fixedDtSeconds: 1 / 60,
  },

  // Input between screens (design-notes 4.8): after a screen changes, presses are ignored
  // this long, and a key held through the change counts only once released and pressed again.
  input: {
    screenChangeQuietSeconds: 0.5,
  },

  flight: {
    durationSeconds: 30, // the longest flight; a nearer target is quicker (design-notes 4.10)
    totalDistance: 3000, // the longest course; forwardSpeed = totalDistance / durationSeconds
    baseSeconds: 10, // a flight takes this long plus secondsPerCell for each map cell to the target
    secondsPerCell: 3,
  },

  steering: {
    lateralSpeed: 1.6, // units of x (-1..1) per second at full deflection
  },

  // Pinhole projection. Screen scale is focalLength / depth, so mountains creep
  // when distant and rush past late, and bases drop below the horizon as they near.
  camera: {
    focalLength: 360,
    height: 18, // flight height above the ground plane, in world units
    trackHalfWidth: 150, // world units spanned by one unit of lateral position
    minDepth: 4, // floor on the perspective divide; small, so nothing freezes in frame as it passes
  },

  // Cosmetic bank into the turn. The world and horizon roll together, so a
  // summit standing above the horizon still reads as one; the HUD stays level.
  banking: {
    maxRollDegrees: 9,
    smoothingPerSecond: 7, // how quickly roll eases toward the steering input
  },

  // Ground lines sweeping toward the viewer, for a sense of speed over a surface.
  floor: {
    enabled: true,
    lineSpacing: 25, // world units between ground lines
    lineCount: 20,
    nearAlpha: 0.6,
    farAlpha: 0.04,
  },

  // Depth cues: distant peaks fade and thin so the near silhouette dominates.
  depthCue: {
    nearAlpha: 1,
    farAlpha: 0.22,
    nearLineWidth: 3.2,
    farLineWidth: 0.7,
  },

  terrain: {
    bandSpacing: 120, // distance between mountain bands

    // Open ground with occasional mountains, in alternating calm and busy
    // stretches. Centres are drawn past -1..1 so the edges are no safer than
    // the middle, which is what stops a player picking a lane and coasting.
    calmPeaksMin: 0,
    calmPeaksMax: 1,
    busyPeaksMin: 2,
    busyPeaksMax: 4,
    stretchBandsMin: 3, // bands per calm or busy run
    stretchBandsMax: 6,
    placementOverhang: 0.4,
    ridgeOverlap: 0.6, // how tightly consecutive ridge peaks are packed

    peakHalfWidthMin: 0.12,
    peakHalfWidthMax: 0.32,
    peakHeightMin: 34, // world units; must clear camera.height to be a hazard at all
    peakHeightMax: 95,
    hillsPerBandMax: 2, // low ground detail
    hillHeightMin: 5, // below camera.height, so hills are scenery you fly over
    hillHeightMax: 14,
    peakSkewMax: 0.55, // how far the main summit sits off-centre, for lopsided ridges
    peakExtraSummitsMax: 2, // additional lower summits, giving jagged multi-headed masses
    peakShoulderMin: 0.3, // height of those extra summits, as a fraction of the peak's own
    peakShoulderMax: 0.8,
    launchClearBands: 2, // opening bands kept clear so the player can read the scene before steering
    launchCorridorHalfWidth: 0.25, // half-width of the clear corridor ahead of the launch heading
    pathCellCount: 41, // lateral resolution used by the passable-path check
    maxLateralStepPerBand: 0.5, // how far x may move between adjacent bands and still be flyable
    maxGenerationAttempts: 50,
  },

  // Death (design-notes 3, items 17 and 18): zero shields or zero energy ends the robot, and the
  // game starts again. Each has its own ending, so the player knows which one it was.
  death: {
    restartAfterSeconds: 2, // the wreck shows this long before a press can start a new game
    powerDownSeconds: 2.5, // flat batteries: the screen flickers, then fades to black over this long
  },

  // The energy economy (#15). Placeholders, tuned by playtest. Energy is a slow clock that keeps
  // the robot moving; drops in ruins refill it. Scanning, missiles and grid disable cost nothing.
  energy: {
    drainPerSecond: 1 / 90, // a cell every 90 seconds of running time: 15 minutes from full, standing still
    perCellWalked: 0.02, // walking the width of the map costs about one and a half cells more
    // Recharge (#82, design-notes 4.9): standing still and not threatened mends cracks, never broken plates.
    rechargeSecondsPerCrack: 1.5, // quick, so the choice is about cost, not patience: a twice-cracked plate mends in three seconds
    rechargeCellsPerCrack: 0.25, // the cost bites: mending one attack's spread cracks (six) costs a cell and a half
    // Recharge stops at the low-power line, so resting can never be what flattens the batteries.
    // The low-power line is dashboard.lowThreshold.
  },

  // Missile defence (design-notes 2.9a, 4.8, 4.9). Placeholders, tuned by playtest.
  defence: {
    warningSeconds: 1.5, // a short warning before the first volley
    volleyMin: 3, // missiles per volley, from design-notes 4.9
    volleyMax: 5,
    volleys: 3,
    volleyGapSeconds: 2.8, // time between volley starts
    missileSpacingSeconds: 0.15, // between missiles in one volley
    missileTravelSeconds: 2.6, // from launch to arrival, from the edge of the hunter's engagement range
    missileTravelNearSeconds: 1.6, // from point blank: closer attacks leave less time (design-notes 4.10)
    // The turret (design-notes 4.8): the view turns within a limited forward arc. Widen the
    // arc toward free aiming, narrow it toward fixed. The view starts facing the launcher.
    arcYawDegrees: 45, // the view can turn this far left or right of the launcher
    arcPitchUpDegrees: 25, // this far up
    arcPitchDownDegrees: 5, // and only this far below the horizon: nothing comes from the ground
    viewYawDegrees: 28, // half the visible field across; missiles beyond it are off screen
    // A strike from a single enemy: every missile leaves one launcher on the horizon, straight
    // ahead, and fans out as it closes, arriving from somewhere across the sky.
    launcherPitchDegrees: 0.5, // the launcher sits just on the horizon
    launchDistance: 1.5, // where missiles start; beyond the guns' range, so the launcher cannot be camped
    gunRange: 1, // a round with no hit is spent at this distance
    fanYawDegrees: 34, // how far left or right of the launcher a missile can arrive
    fanPitchMinDegrees: 3, // arrival height range above the horizon: missiles come from the sky
    fanPitchMaxDegrees: 16,
    turnRateDegreesPerSecond: 80, // the difficulty dial: caps keys and mouse alike
    shotSpeed: 1.6, // distance per second, in the same units as gunRange and launchDistance
    fireIntervalSeconds: 0.12, // rate of fire while fire is held
    summarySeconds: 2, // how long "ATTACK OVER" shows before the dashboard returns by itself
    hitToleranceDegrees: 3.5, // how close to a missile's bearing a round must pass to destroy it
    mouseDegreesPerPixel: 0.12, // mouse sensitivity while the pointer is captured; still capped by the turn rate
  },

  terminalPhase: {
    startFraction: 0.85, // fraction of totalDistance where mountains stop and the target appears
    targetHalfWidth: 0.18, // lateral tolerance counted as a hit
    approachCorridorHalfWidth: 0.25, // clear lane straight to the target through the surrounding mountains
  },

  // Point defence (design-notes 4.11): a defended target's turret fires aimed bursts at the missile
  // in the terminal phase. Never a dice roll: every burst is announced and can be dodged. Placeholders.
  pointDefence: {
    firstBurstSeconds: 0.5, // after the terminal phase starts, before the first warning
    burstIntervalSeconds: 1.1, // between one burst's warning and the next
    warningSeconds: 0.35, // the muzzle flash: the aim is fixed here, so moving after it dodges
    roundsPerBurst: 4,
    roundSpacingSeconds: 0.07,
    roundSpeed: 250, // world units per second toward the missile, on top of the missile's own speed
    hitHalfWidth: 0.09, // a round this close laterally as it passes destroys the missile
    leadSeconds: 0.25, // the aim leads a steadily drifting missile by this much of its lateral speed
    ceaseDistance: 160, // no new warning this close to the target, so the last burst can still be dodged
  },

  // Jamming (design-notes 4.1): a jammed target takes the direction marker away for short spells
  // during the cruise, flickering in and out, and breaks up the view. Never in the terminal phase.
  // The spells are drawn from the flight's seed. Placeholders.
  jammer: {
    firstAfterSeconds: 3, // calm at launch
    spellSecondsMin: 1.2,
    spellSecondsMax: 2.2,
    gapSecondsMin: 2.5, // between one spell's end and the next one's start
    gapSecondsMax: 4.5,
    flickerSeconds: 0.3, // at each end of a spell the marker flickers rather than vanishing outright
    clearBeforeTerminalSeconds: 1, // the last spell ends this long before the target comes into view
  },

  feelTestToggles: {
    distanceIndicatorMode: "none" as DistanceIndicatorMode,
    altitudeBandsEnabled: false,
    pointDefenceEverywhere: false, // every target is defended, to tune the feel before escalation decides who is
    jammingEverywhere: false, // every target jams, likewise
  },

  // The dashboard between missiles (design-notes 4.6). Counts are starting and full values;
  // drain and refill are in the energy block above.
  dashboard: {
    energyCells: 10, // a full bank
    shieldPlates: 8, // design-notes 4.8: starting armour is eight plates
    // The missile rack (#86, design-notes 4.4). Placeholders. Every launch uses one, hit, miss or
    // deflected. Missiles come only from ruins; an empty rack has no floor (author).
    missileRack: 8, // full and starting: enough for a town's worthwhile targets, not to flatten it
    lowThreshold: 2, // at or below this many cells or plates, the last one flashes and the trace agitates
    tracePoints: 120,
    formName: "PROTOTYPE", // placeholder for the robot form shown in the name bar
    startNode: START_NODE, // index into the network map where the robot begins
    targetRange: 2, // in map cells, Chebyshev distance from the cross: a target is only selected this close
    pickupRadius: 1, // a drop within this many cells is picked up automatically
    closeRadius: 6, // a hunter this close to a scan always wakes (design-notes 4.10)
    scanRadius: 12, // how far a scan's ring reaches: drops in ruins within it show as blips
    walkSpeed: 3, // cells per second the robot walks across its local patch
    // Placeholders, not from the original. The window is the author's guess: play-test it.
    suppressionSeconds: 45, // how long a network's shields stay down after a power station is hit or grid disable is used
    gridDisableCooldownSeconds: 60, // time before grid disable can be used again
    scanPulseSeconds: 1.2, // how long a scan's ring takes to reach its full radius on the mini map
    blipSeconds: 5, // how long a blip stays on the mini map after the ring lights it, fading as it goes
    hitsPerPlate: 3, // design-notes 4.9: each shield plate absorbs three missile hits
    hunterEngageRange: 6, // in map cells: an alerted hunter opens fire when the robot is this close
    // Placeholders for hunter behaviour (design-notes 4.10 and 4.14). Tuned by playtest.
    // Speeds fit the stances (#117, design-notes 4.10). The robot walks faster than all but a patroller running for help.
    hunterSpeed: 2.5, // cells per second when it moves: aggressive, it closes in faster than the others
    // Attack pacing and turn-taking (design-notes 4.10): the player must always have time to strike back.
    attackBreatherSeconds: 3, // after any incoming attack, no enemy may start one: time to open Missile, which stops time
    hunterMagazineAttacks: 2, // attacks a hunter makes before withdrawing to rearm
    hunterRearmSeconds: 30, // how long it rearms at a dome before going home
    hunterFirstAttackDelayMin: 1, // after an alert, a hunter waits this long before its first attack
    hunterFirstAttackDelayMax: 3,
    // Hunters are always looking (design-notes 4.10): coming this close to one alerts it.
    hunterSightCells: 5, // just inside the engagement range
    hunterHoldCells: 4, // an alerted hunter closes to this range, then holds while it attacks: the aggression dial
    // Defenders (design-notes 4.4 and 4.10): woken out of their dome, they guard it. Placeholders.
    defenderSpeed: 1.5, // cells per second: heavy and built to guard, so it does not chase far
    defenderGuardCells: 12, // the guard area: an awake defender sees and chases the robot only this close to its post. Covers the missile's reach across the local view, so a dome cannot be opened from outside it
    // Patrollers (#66, design-notes 4.10): they walk a wide beat, come to look at disturbances, and
    // on seeing the robot run to the nearest armed enemy for help. Lightly armed. Placeholders.
    patrollerSpeed: 2, // cells per second on its beat, investigating, or fighting
    patrollerRunSpeed: 3.5, // cells per second while running for help: "sent at speed"
    patrollerSightCells: 5, // like a hunter, it is always looking
    patrollerHearingCells: 15, // a missile hit or a power cut this close draws it in to look
    patrollerSearchSeconds: 6, // how long it looks round a disturbance before going back to its beat
    patrollerHelpReachCells: 1.5, // this close to the enemy it fetches, help is raised
    patrollerLeashCells: 15, // once fighting, how far it follows the robot from where it started
    patrollerMagazineAttacks: 2, // attacks before it withdraws to rearm
    patrollerVolleys: 1, // lightly armed: one volley per attack, against a hunter's three
    // Haulers (#67, design-notes 4.10): defensive. They keep to their route, and flee a threat,
    // taking their cargo with them, so chasing one is a choice. Unarmed for now. Placeholders.
    haulerSpeed: 1.5, // cells per second on its route: laden
    haulerFleeSpeed: 2.5, // cells per second while fleeing: slower than the robot's walk, so it can be run down
    haulerSightCells: 5, // like every enemy, it is always looking
    haulerHearingCells: 15, // a missile hit this close scares it, as it draws a patroller
    haulerFleeCells: 10, // how far, in steps over the terrain, it looks for somewhere away from the threat
    haulerFleeSeconds: 8, // how long it keeps away after it last saw or heard the threat, before going back to its route
    // Replacement (#70, design-notes 2.6): working domes build destroyed patrollers, haulers and
    // defenders again, from supplies the haulers deliver. Placeholders until playtested.
    startingStock: 2, // supplies each network holds at the start
    stockMax: 4, // the most a network holds
    replacementSeconds: 60, // powered time to build one: long enough to salvage the wreck first
    replacementsPerNetworkMax: 3, // the most one network builds in a game
    replacementsMax: 12, // the most built over the whole world in a game
    // Bosses (#71, design-notes 4.15): the listener follows signals, the assessor pursues for good.
    // Neither is ever replaced. Placeholders until playtested.
    listenerSpeed: 2, // cells per second
    listenerHearingCells: 24, // a scan this close draws it in: twice the ring's own reach
    listenerSearchSeconds: 8, // how long it searches where the signal came from
    listenerPauseSeconds: 6, // how long it listens at each town on its wander
    listenerLoseCells: 12, // once fighting, it loses the robot beyond this, and searches where it last was
    assessorSpeed: 1.4, // cells per second: slow, but it never stops coming
    bossEmergeCells: 15, // once every part is found, a boss appears only with the robot this far off: outside the local view
    bossSightCells: 5, // like every enemy, both are always looking
    bossAttackIntervalSeconds: 20, // neither has a magazine: each waits this long after an attack before its next
    commsNoticeSeconds: 5, // the robot is in a network this long before its comms centre first reports it
    commsReportSeconds: 30, // while it stays, the centre reports it this often
    assessorVolleys: 4, // volleys per attack, against a hunter's three
    startClearanceCells: 2, // the robot starts at least this far outside a town and beyond any hunter's sight
    targetIconWidth: 16, // on-screen width of a target icon, in pixels
  },

  // The whole map: one terrain grid with a town at each network node (design-notes 4.6).
  // The mini map shows a window of it centred on the robot (design-notes 2.7).
  localMap: {
    worldSeed: 7,
    cols: 75, // about the size of the reference map: towns are near each other but distinct
    rows: 45,
    townRadiusCols: 7,
    townRadiusRows: 4,
    smoothingPasses: 2,
    // Town walls (#89): most towns get a mountain arc round them with 1 or 2 gaps. Placeholders.
    wallReach: 1.3, // the ring runs out to 1.3 times the town's radii: more than one step of a walk can cross
    wallShare: 0.67, // about two thirds of the ring is wall
    openTownShare: 0.2, // two of the ten towns stay open
    twoGapChance: 0.5, // one gap makes a fortress; two give a back door
    valleyBelow: 0.46,
    highAbove: 0.54,
    domesPerTown: 4, // #62: enough for a full garrison of four
    otherBuildingsPerTown: 1, // a mine or a comms centre
    defendersMax: 4, // design-notes 4.4: each network draws 0 to 4 defenders
    // Supplies (design-notes 4.4): for each kind, up to `max` units of each supply, each unit there
    // with `chance`, rolled independently. A unit is one cell, one plate fully mended (the weakest,
    // broken first) or one missile. Placeholders, tuned by playtest.
    // Buildings: domes are the enemy's arsenal, where its machines rearm, so they are the main
    // missile source: opening one usually pays for its missile (#86). Every dome holds at least one,
    // so a hit on a dome with the last missile never leaves the rack empty. A mine's ore leans to armour;
    // a comms centre's electronics lean to energy.
    // Wrecks follow the machine's role: the hunter is aggressive, carrying ammunition and burning
    // energy on the chase; the defender is defensive, built heavy. The patroller holds nothing: its
    // guns are not salvage, and it is killed to stop it fetching help, not for what it carries.
    supplyChances: {
      dome: { energy: { max: 2, chance: 0.25 }, armour: { max: 2, chance: 0.15 }, missiles: { min: 1, max: 3, chance: 0.4 } },
      mine: { energy: { max: 2, chance: 0.3 }, armour: { max: 2, chance: 0.6 }, missiles: { max: 2, chance: 0.3 } },
      commsCentre: { energy: { max: 3, chance: 0.7 }, armour: { max: 2, chance: 0.1 }, missiles: { max: 2, chance: 0.1 } },
      hunter: { energy: { max: 2, chance: 0.5 }, armour: { max: 1, chance: 0.25 }, missiles: { max: 2, chance: 0.6 } },
      defender: { energy: { max: 1, chance: 0.2 }, armour: { max: 2, chance: 0.55 }, missiles: { max: 1, chance: 0.4 } },
      // The hauler's cargo (#67, design-notes 4.4): power pods are energy, raw material mends armour.
      // Always worth something: it is the reason to run one down. It carries no weapons, so no missiles.
      hauler: { energy: { min: 1, max: 3, chance: 0.5 }, armour: { max: 2, chance: 0.4 } },
      // Bosses (#71): always some of everything, the assessor most.
      listener: { energy: { min: 1, max: 3, chance: 0.5 }, armour: { min: 1, max: 2, chance: 0.5 }, missiles: { min: 1, max: 3, chance: 0.5 } },
      assessor: { energy: { min: 2, max: 4, chance: 0.5 }, armour: { min: 1, max: 3, chance: 0.5 }, missiles: { min: 2, max: 4, chance: 0.5 } },
    },
    // Parts (design-notes 4.4): a fixed set placed over the world, not rolled. Placeholders.
    partCount: 6, // placeholder: one per upgrade, to be decided
    partWeights: { dome: 3, commsCentre: 1 }, // domes are the haystack; electronics may hold a part too
    partsPerNetworkMax: 2, // some networks hold none and a few hold two
    // Difficulty by distance (design-notes 4.5). Placeholders.
    bandShares: { near: 0.4, middle: 0.35 }, // the rest, about a quarter, are far
    middleHardenChance: 0.5,
    farBothChance: 0.5,
    // Hardened machines are more likely to carry missiles (author: "we need to use more"); their
    // other supplies roll as for their kind.
    hardenedSupplyChances: {
      hunter: { missiles: { max: 3, chance: 0.75 } },
      defender: { missiles: { max: 2, chance: 0.7 } },
    },
    partsFarMin: 2,
    // Patrollers (#66): wide beats between the towns, a few in each segment of the map. Placeholders.
    patrolSegmentsAcross: 3,
    patrolSegmentsDown: 2,
    patrollersPerSegment: 2,
    patrolBeatPoints: 4, // waypoints on each patroller's loop
    patrolBeatSpacing: 8, // waypoints on one loop are at least this many cells apart
    startTown: START_NODE, // patrollers keep clear of the town where the robot begins
    haulersPerTown: 1, // #67: placeholder
    patrolStartClearCells: 16, // no beat comes this close to that town's centre, so the game cannot open with a patroller walking past
    viewCols: 25, // the mini map's local window, in cells
    viewRows: 11,
  },

  colors: {
    background: "#000000", // sky
    frame: "#ffe066",
    ground: "#0b1426", // the edge of this fill is the horizon, and so the altitude reference
    mountain: "#3b6eff",
    mountainFill: "#05080f", // darker than the ground, so peaks read against it
    floor: "#2a4a9c",
    marker: "#ffe066",
    target: "#ffe066",
    hit: "#ffe066",
    crash: "#ff6a3b",
    text: "#ffe066",
    panel: "#0b1426",
    panelSelected: "#ffe066",
    panelDim: "#2a4a9c",
    energy: "#3bff8a", // battery cells: rectangles
    missile: "#ff9a3b", // the rack: upright pointed rounds
    tracer: "#ff7b54", // point-defence fire: apart from the yellow target art and the blue terrain
    shield: "#3b9dff", // armour plates: trapezoids, so the two are never confused by colour alone
    alert: "#ff6a3b",
    trace: "#3bff8a",
  },
};

export type Config = typeof config;
