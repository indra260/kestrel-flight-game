// Every tuning number and colour for Sky Courier — Valley Circuit, in one
// place. The playfield is a fixed 1280x720 logical area; the renderer scales
// it to the window, so no rule below depends on the screen size. World units
// are metres: X east, Y up, Z north, and the course runs toward +Z.

export const VIEW = { width: 1280, height: 720, fovDeg: 70, near: 2, far: 2600 };

/** The simulation's fixed step, in seconds: 60 updates a second whatever the display's rate. */
export const STEP = 1 / 60;

export const WORLD = {
  courseLength: 12400, // playable Z range, from the south fields to past the airfield
  waterLevel: 1.5,
  seaLevel: 1.5,
};

/** The airfield's runway: a flat strip at the valley's south end, so a takeoff rolls north into the whole course. */
export const RUNWAY = {
  x: 180,
  zStart: 900,
  zEnd: 2100,
  width: 46,
  altitude: 6,
  // Landings are graded on this stretch of the strip.
  touchdownStart: 1020,
  touchdownEnd: 1420,
};

/** The flat meadow the cargo target is painted on. */
export const CARGO_FIELD = { x: -650, z: 7600, radius: 300, altitude: 15 };

export const AIRCRAFT = {
  name: 'Kestrel-9',
  minSpeed: 30, // m/s, below this the wing gives up entirely
  stallSpeed: 41, // m/s, lift fades and the nose drops under this
  maxSpeed: 132, // m/s at full throttle, level
  startSpeed: 64,
  throttleRate: 0.45, // throttle travel per second at the keys
  dragBase: 0.0016,
  bankRate: 1.9, // rad/s of roll toward the steered bank
  maxBank: 1.02, // rad, about 58 degrees
  pitchRate: 0.85, // rad/s of pitch toward the steered pitch
  maxPitchUp: 0.42,
  maxPitchDown: -0.5,
  turnPerBank: 0.62, // heading rad/s at full bank and cruise speed
  fuelCapacity: 100,
  fuelBurnCruise: 0.34, // tank units per second at 65% throttle
  fuelBurnClimb: 0.65, // extra burn while climbing hard
  hull: 100,
};

export const SCORING = {
  ringPoints: 250,
  ringTimeBonusMax: 150,
  cargoBullseye: 1000,
  cargoPerMetre: 6, // points lost per metre from the target centre
  landingPerfect: 1000,
  landingGood: 650,
  landingFirm: 300,
};

export const PALETTE = {
  skyTop: [46, 92, 168],
  skyHorizon: [178, 216, 240],
  fog: [178, 216, 240],
  sun: [255, 226, 150],
  sea: [38, 102, 158],
  river: [52, 118, 168],
  sand: [216, 198, 152],
  rock: [128, 122, 116],
  runway: [74, 76, 82],
  runwayLine: [238, 240, 244],
  meadow: [106, 168, 84],
  meadowLight: [134, 190, 104],
  forest: [52, 104, 58],
  crops: [
    [196, 172, 92], // wheat
    [164, 186, 84], // young barley
    [122, 158, 74], // pasture green
    [148, 116, 76], // ploughed earth
    [206, 196, 128], // ripe oats
  ],
  panel: 'rgba(10, 18, 30, 0.66)',
  panelEdge: 'rgba(160, 210, 255, 0.5)',
  instrument: '#cfe8ff',
  instrumentDim: '#7fa6c9',
  good: '#7ee787',
  warn: '#ffd76e',
  bad: '#ff8a7a',
  accent: '#ffb454',
};

export const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';
export const FONT_MONO = 'ui-monospace, "SF Mono", "Cascadia Mono", Consolas, monospace';

/** Where the best scores are kept between visits (this browser only). */
export const BEST_KEY = 'sky-courier-valley.best';
