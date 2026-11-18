// All tuning values for the missile-flight slice live here (design-notes.md, section 4.12 and 5.1).

export type DistanceIndicatorMode = "none" | "markerChange" | "audioPing";

export const config = {
  seed: 1,

  canvas: {
    width: 960,
    height: 600,
  },

  simulation: {
    fixedDtSeconds: 1 / 60,
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
    hitToleranceDegrees: 3.5, // how close to a missile's bearing a round must pass to destroy it
    mouseDegreesPerPixel: 0.12, // mouse sensitivity while the pointer is captured; still capped by the turn rate
  },

  terminalPhase: {
    startFraction: 0.85, // fraction of totalDistance where mountains stop and the target appears
    targetHalfWidth: 0.18, // lateral tolerance counted as a hit
    approachCorridorHalfWidth: 0.25, // clear lane straight to the target through the surrounding mountains
  },

  feelTestToggles: {
    distanceIndicatorMode: "none" as DistanceIndicatorMode,
    altitudeBandsEnabled: false,
  },

  // The dashboard between missiles (design-notes 4.6). Counts are starting values;
  // drain and refill rules come in a later slice.
  dashboard: {
    energyCells: 10, // placeholder: the energy economy is not designed yet
    shieldPlates: 8, // design-notes 4.8: starting armour is eight plates
    lowThreshold: 2, // at or below this many cells or plates, the last one flashes and the trace agitates
    tracePoints: 120,
    formName: "PROTOTYPE", // placeholder for the robot form shown in the name bar
    startNode: 0, // index into the network map where the robot begins
    targetRange: 2, // in map cells, Chebyshev distance from the cross: a target is only selected this close
    pickupRadius: 1, // a drop within this many cells is picked up automatically
    blipRadius: 6, // a scan within this many cells is marked close
    directionRadius: 12, // a scan within this many cells gives a bearing
    walkSpeed: 3, // cells per second the robot walks across its local patch
    // Placeholders, not from the original. The window is the author's guess: play-test it.
    suppressionSeconds: 45, // how long a network's shields stay down after a power station is hit or grid disable is used
    gridDisableCooldownSeconds: 60, // time before grid disable can be used again
    scanPulseSeconds: 1.2, // how long a scan's ring takes to reach its full radius on the mini map
    hitsPerPlate: 3, // design-notes 4.9: each shield plate absorbs three missile hits
    hunterEngageRange: 6, // in map cells: an alerted hunter opens fire when the robot is this close
    // Placeholders for hunter behaviour (design-notes 4.10 and 4.14). Tuned by playtest.
    hunterSpeed: 2, // cells per second when it moves
    hunterLeashCells: 30, // how far from its post an alerted hunter will chase before it gives up (about two towns)
    // Attack pacing (design-notes 4.10): the player must always have time to strike back.
    hunterCooldownSeconds: 12, // guaranteed quiet after an attack ends, enough to launch a strike
    hunterCooldownRandomSeconds: 6, // plus up to this much more, so attacks are not a metronome
    hunterFirstAttackDelayMin: 1, // after an alert, a hunter waits this long before its first attack
    hunterFirstAttackDelayMax: 3,
    // Hunters are always looking (design-notes 4.10): coming this close to one alerts it.
    hunterSightCells: 5, // just inside the engagement range, and well inside what the player can see
    hunterInvestigateSeconds: 10, // how long a hunter searches a cut power station before going home
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
    valleyBelow: 0.46,
    highAbove: 0.54,
    targetsPerTown: 3,
    dropChance: 0.5, // placeholder: not every building holds a drop (design-notes 2.6)
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
    shield: "#3b9dff", // armour plates: trapezoids, so the two are never confused by colour alone
    alert: "#ff6a3b",
    trace: "#3bff8a",
  },
};

export type Config = typeof config;
