// The valley's geography, as pure functions of world position: how high the
// ground is, what covers it, and where the landmarks stand. A winding river,
// a coastline to the east, patchwork fields, one village, a wind-turbine
// ridge, a lighthouse, and the flat airfield strip. Everything is derived
// from the deterministic cell hash, so the valley is identical every visit.
import { CARGO_FIELD, RUNWAY, WORLD } from './config.js';
import { cellHash, clamp, createRandom, lerp, smoothstep } from './random.js';

/** East-west centreline of the river at a given Z: it wanders as it flows north. */
export function riverCenterX(z) {
  return 300 * Math.sin(z * 0.00035) + 120 * Math.sin(z * 0.0011 + 0.7);
}

/** Where the land gives up to the sea at a given Z. */
export function coastX(z) {
  return 1500 + 260 * Math.sin(z * 0.0005 + 2.0);
}

function baseHills(x, z) {
  let h = 46
    + 30 * Math.sin(x * 0.0011 + 0.8) * Math.sin(z * 0.0009)
    + 20 * Math.sin(x * 0.0031) * Math.sin(z * 0.0027 + 1.9)
    + 9 * Math.sin(x * 0.008 + 2.2) * Math.sin(z * 0.0073);
  // Mountain walls far to either side, so the valley reads as a valley.
  const wall = smoothstep(1350, 2100, Math.abs(x));
  h += wall * (150 + 60 * Math.sin(z * 0.0016 + x * 0.0004));
  return h;
}

function flattenToward(h, target, influence) {
  return lerp(h, target, clamp(influence, 0, 1));
}

/** Ground height in metres at a world position. */
export function terrainHeight(x, z) {
  let h = baseHills(x, z);
  // The river cuts its bed down toward water level.
  const riverDist = Math.abs(x - riverCenterX(z));
  h = flattenToward(h, 2.5, smoothstep(150, 55, riverDist) * 0.94);
  // The coast shelves down to the beach and then the sea floor.
  const coast = coastX(z);
  if (x > coast - 320) {
    const t = smoothstep(coast - 320, coast + 320, x);
    h = flattenToward(h, -3, t * 0.97);
  }
  // The cargo meadow is a calm flat patch in the hills.
  const cargoDist = Math.hypot(x - CARGO_FIELD.x, z - CARGO_FIELD.z);
  h = flattenToward(h, CARGO_FIELD.altitude, smoothstep(CARGO_FIELD.radius, CARGO_FIELD.radius * 0.55, cargoDist));
  // A village plateau west of the river.
  const villageDist = Math.hypot(x + 500, z - 5200);
  h = flattenToward(h, 20, smoothstep(300, 170, villageDist) * 0.85);
  // The runway strip is dead flat, with a gentle apron around it.
  const dx = Math.abs(x - RUNWAY.x);
  const dz = z < RUNWAY.zStart ? RUNWAY.zStart - z : z > RUNWAY.zEnd ? z - RUNWAY.zEnd : 0;
  const stripDist = Math.hypot(Math.max(0, dx - RUNWAY.width / 2), dz);
  h = flattenToward(h, RUNWAY.altitude, smoothstep(150, 30, stripDist));
  return h;
}

export const SURFACE = {
  WATER_SEA: 'sea',
  WATER_RIVER: 'river',
  SAND: 'sand',
  RUNWAY: 'runway',
  ROCK: 'rock',
  FOREST: 'forest',
  MEADOW: 'meadow',
  CROP: 'crop',
};

/**
 * What covers the ground at a world position: a kind tag plus its base
 * colour as [r, g, b], before distance fog and slope shading.
 */
export function surfaceAt(x, z, palette) {
  const onStrip = Math.abs(x - RUNWAY.x) <= RUNWAY.width / 2 + 8
    && z >= RUNWAY.zStart - 24 && z <= RUNWAY.zEnd + 24;
  if (onStrip) return { kind: SURFACE.RUNWAY, color: palette.runway };
  const h = terrainHeight(x, z);
  if (h <= WORLD.waterLevel + 0.5) {
    return x > coastX(z) - 60
      ? { kind: SURFACE.WATER_SEA, color: palette.sea }
      : { kind: SURFACE.WATER_RIVER, color: palette.river };
  }
  if (x > coastX(z) - 200 && h < 7.5) return { kind: SURFACE.SAND, color: palette.sand };
  if (h > 94) return { kind: SURFACE.ROCK, color: palette.rock };
  const cellX = Math.floor(x / 220);
  const cellZ = Math.floor(z / 220);
  const r = cellHash(cellX, cellZ);
  const nearRiver = Math.abs(x - riverCenterX(z)) < 190;
  if (r < 0.16) return { kind: SURFACE.FOREST, color: palette.forest };
  if (nearRiver && r < 0.62) return { kind: SURFACE.MEADOW, color: palette.meadowLight };
  if (r < 0.44) {
    const crop = palette.crops[Math.floor(cellHash(cellZ, cellX * 3 + 11) * palette.crops.length)];
    return { kind: SURFACE.CROP, color: crop };
  }
  if (r < 0.72) return { kind: SURFACE.MEADOW, color: palette.meadow };
  if (r < 0.86) return { kind: SURFACE.FOREST, color: palette.forest };
  return { kind: SURFACE.MEADOW, color: palette.meadowLight };
}

// ---- Landmarks -------------------------------------------------------------
// Trees, houses, turbines, hangars and the lighthouse, generated once from a
// seeded generator and bucketed by Z so the renderer only touches the few
// hundred near the camera.

export const LANDMARK = { TREE: 0, HOUSE: 1, TURBINE: 2, HANGAR: 3, LIGHTHOUSE: 4 };
const BUCKET_METRES = 500;

function buildLandmarks(palette) {
  const random = createRandom(20261126);
  const buckets = new Map();
  const add = (mark) => {
    const key = Math.floor(mark.z / BUCKET_METRES);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(mark);
  };
  // Trees follow the surface: thick in forest cells, lone in meadows.
  for (let cellZ = 0; cellZ < WORLD.courseLength / 110; cellZ += 1) {
    for (let cellX = -14; cellX < 15; cellX += 1) {
      const cx = cellX * 110;
      const cz = cellZ * 110;
      const kind = surfaceAt(cx + 55, cz + 55, palette).kind;
      const density = kind === SURFACE.FOREST ? 3 : kind === SURFACE.MEADOW ? 0.35 : 0;
      if (random() < density) {
        add({
          kind: LANDMARK.TREE,
          x: cx + random() * 110, z: cz + random() * 110,
          scale: 0.8 + random() * 0.7, tone: random(),
        });
      }
    }
  }
  // The village west of the river: a ring of houses on its plateau.
  for (let i = 0; i < 11; i += 1) {
    const a = (i / 11) * Math.PI * 2;
    add({
      kind: LANDMARK.HOUSE,
      x: -500 + Math.cos(a) * (60 + random() * 90),
      z: 5200 + Math.sin(a) * (60 + random() * 90),
      scale: 0.9 + random() * 0.5, tone: random(), heading: a + Math.PI / 2,
    });
  }
  // Scattered farmsteads.
  for (let i = 0; i < 9; i += 1) {
    add({
      kind: LANDMARK.HOUSE,
      x: -1200 + random() * 2200, z: 600 + random() * 9200,
      scale: 0.85 + random() * 0.4, tone: random(), heading: random() * Math.PI,
    });
  }
  // Wind turbines along the western ridge.
  for (let i = 0; i < 8; i += 1) {
    add({ kind: LANDMARK.TURBINE, x: -1150, z: 1800 + i * 950, scale: 1, tone: i * 0.37, heading: 0 });
  }
  // Hangars beside the runway, and the lighthouse on the coast.
  for (let i = 0; i < 3; i += 1) {
    add({ kind: LANDMARK.HANGAR, x: RUNWAY.x - 95, z: RUNWAY.zStart + 180 + i * 130, scale: 1, tone: i / 3, heading: Math.PI / 2 });
  }
  add({ kind: LANDMARK.LIGHTHOUSE, x: coastX(9800) + 26, z: 9800, scale: 1, tone: 0, heading: 0 });
  return buckets;
}

let landmarkBuckets = null;

/** Landmarks with z in [zMin, zMax); builds the set on first use. */
export function landmarksBetween(zMin, zMax, palette) {
  if (landmarkBuckets === null) landmarkBuckets = buildLandmarks(palette);
  const out = [];
  const first = Math.floor(zMin / BUCKET_METRES);
  const last = Math.floor(zMax / BUCKET_METRES);
  for (let key = first; key <= last; key += 1) {
    const bucket = landmarkBuckets.get(key);
    if (bucket) for (const mark of bucket) if (mark.z >= zMin && mark.z < zMax) out.push(mark);
  }
  return out;
}
