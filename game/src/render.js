// The chase-view renderer: a software-projected valley drawn on canvas 2D —
// patchwork fields, the river and the sea as a terrain mesh, then runway
// markings, landmarks, gates and the parcel as projected shapes, and the
// Kestrel-9 herself drawn from behind, banking with the pilot's hand. The
// camera's basis does the projecting; this file only decides what things
// look like.
import { CARGO_FIELD, PALETTE, RUNWAY, VIEW } from './config.js';
import { createCamera } from './camera.js';
import { clamp, createRandom, lerp } from './random.js';
import { LANDMARK, landmarksBetween, surfaceAt, terrainHeight } from './terrain.js';
import { MISSION_CARGO, MISSION_RINGS } from './missions.js';

function mixColor(a, b, t) {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}
function rgb(color, alpha = 1) {
  return `rgba(${color[0] | 0},${color[1] | 0},${color[2] | 0},${alpha})`;
}
function shade(color, f) {
  return [clamp(color[0] * f, 0, 255), clamp(color[1] * f, 0, 255), clamp(color[2] * f, 0, 255)];
}

const TERRAIN_ROWS = 42;
const TERRAIN_COLS = 26;

export function createRenderer(canvas) {
  const ctx2d = canvas.getContext('2d');
  canvas.width = VIEW.width;
  canvas.height = VIEW.height;
  const camera = createCamera();
  const particles = [];
  let emitAccumulator = 0;

  // Far clouds hang over the valley at fixed spots, the same every visit.
  const cloudRandom = createRandom(4242);
  const clouds = [];
  for (let i = 0; i < 44; i += 1) {
    clouds.push({
      x: -2800 + cloudRandom() * 5600,
      y: 400 + cloudRandom() * 280,
      z: -600 + cloudRandom() * 13800,
      s: 130 + cloudRandom() * 210,
      a: 0.35 + cloudRandom() * 0.35,
      sprite: i % 3,
    });
  }

  // Cloud sprites, painted once: overlapping radial-gradient puffs with
  // soft edges and a shaded belly. Drawn flat ellipses read as hard blobs
  // and leave sky-coloured wedges where they overlap; a gradient sprite
  // melts into the sky instead, and drawImage is cheaper than the paths.
  const cloudSprites = [11, 47, 83].map((seed) => {
    const sprite = document.createElement('canvas');
    sprite.width = 256; sprite.height = 128;
    const g = sprite.getContext('2d');
    const rnd = createRandom(seed);
    for (let i = 0; i < 10; i += 1) {
      const px = 38 + rnd() * 180;
      const py = 50 + rnd() * 26;
      const r = 20 + rnd() * 30;
      const grad = g.createRadialGradient(px, py - r * 0.3, r * 0.08, px, py, r);
      grad.addColorStop(0, 'rgba(255,255,255,0.5)');
      grad.addColorStop(0.65, 'rgba(250,252,255,0.26)');
      grad.addColorStop(1, 'rgba(248,250,255,0)');
      g.fillStyle = grad;
      g.beginPath(); g.arc(px, py, r, 0, Math.PI * 2); g.fill();
    }
    // Belly shading, kept inside the puffs by source-atop.
    g.globalCompositeOperation = 'source-atop';
    const belly = g.createLinearGradient(0, 58, 0, 128);
    belly.addColorStop(0, 'rgba(138,158,188,0)');
    belly.addColorStop(1, 'rgba(138,158,188,0.22)');
    g.fillStyle = belly;
    g.fillRect(0, 0, 256, 128);
    g.globalCompositeOperation = 'source-over';
    return sprite;
  });

  function spawnParticle(p) {
    if (particles.length < 420) particles.push(p);
  }

  /** A burst of sparks or debris at a world position (gate passes, crashes). */
  function burst(pos, color, count = 16, speed = 16, life = 0.8, size = 3) {
    for (let i = 0; i < count; i += 1) {
      const a = Math.random() * Math.PI * 2;
      const up = Math.random() * 0.9 + 0.2;
      spawnParticle({
        x: pos.x, y: pos.y, z: pos.z,
        vx: Math.cos(a) * speed * Math.random(), vy: up * speed * 0.6, vz: Math.sin(a) * speed * Math.random(),
        life: 0, maxLife: life * (0.6 + Math.random() * 0.7), size: size * (0.6 + Math.random() * 0.8),
        color, gravity: -6, drag: 1.6,
      });
    }
  }

  // ---- Sky -----------------------------------------------------------------
  function drawSky(flight, time) {
    const hy = camera.horizonY();
    const grad = ctx2d.createLinearGradient(0, hy - 620, 0, hy + 120);
    grad.addColorStop(0, rgb(PALETTE.skyTop));
    grad.addColorStop(0.75, rgb(mixColor(PALETTE.skyTop, PALETTE.skyHorizon, 0.72)));
    grad.addColorStop(1, rgb(PALETTE.skyHorizon));
    ctx2d.fillStyle = grad;
    // Oversized on purpose: the frame rolls with the aircraft's bank, and the
    // corners must never show through to the page behind.
    ctx2d.fillRect(-600, -600, VIEW.width + 1200, VIEW.height + 1200);
    // Ground haze below the horizon, for any gap the mesh leaves.
    ctx2d.fillStyle = rgb(mixColor(PALETTE.fog, PALETTE.meadow, 0.35));
    ctx2d.fillRect(-600, hy, VIEW.width + 1200, VIEW.height - hy + 600);
    // The sun, placed by azimuth and elevation through the same projection.
    const az = -0.65;
    const el = 0.38;
    const sunDir = { x: Math.sin(az) * Math.cos(el), y: Math.sin(el), z: Math.cos(az) * Math.cos(el) };
    const cam = camera.state;
    const sunPoint = camera.project({
      x: cam.pos.x + sunDir.x * 2350, y: cam.pos.y + sunDir.y * 2350, z: cam.pos.z + sunDir.z * 2350,
    });
    if (sunPoint) {
      const glow = ctx2d.createRadialGradient(sunPoint.x, sunPoint.y, 4, sunPoint.x, sunPoint.y, 190);
      glow.addColorStop(0, 'rgba(255,236,170,0.8)');
      glow.addColorStop(0.3, 'rgba(255,224,138,0.28)');
      glow.addColorStop(1, 'rgba(255,224,138,0)');
      ctx2d.fillStyle = glow;
      ctx2d.fillRect(sunPoint.x - 200, sunPoint.y - 200, 400, 400);
      ctx2d.fillStyle = rgb(PALETTE.sun);
      ctx2d.beginPath(); ctx2d.arc(sunPoint.x, sunPoint.y, 26, 0, Math.PI * 2); ctx2d.fill();
    }
    // A silhouette ridge along the horizon that turns with the heading.
    ctx2d.fillStyle = rgb(mixColor(PALETTE.fog, [88, 108, 142], 0.5));
    ctx2d.beginPath();
    ctx2d.moveTo(0, hy + 2);
    for (let sx = 0; sx <= VIEW.width; sx += 16) {
      const azAt = cam.heading + (sx - VIEW.width / 2) / cam.focal;
      const ridge = (Math.sin(azAt * 3.1) * 0.5 + Math.sin(azAt * 7.7 + 1.3) * 0.3 + 0.85) * 44;
      ctx2d.lineTo(sx, hy - ridge + 4);
    }
    ctx2d.lineTo(VIEW.width, hy + 2);
    ctx2d.closePath();
    ctx2d.fill();
  }

  // ---- Terrain mesh ----------------------------------------------------------
  const rowDistances = [];
  for (let i = 0; i <= TERRAIN_ROWS; i += 1) {
    rowDistances.push(14 * Math.pow(2500 / 14, i / TERRAIN_ROWS));
  }
  const vertexX = new Float32Array((TERRAIN_ROWS + 1) * (TERRAIN_COLS + 1));
  const vertexY = new Float32Array((TERRAIN_ROWS + 1) * (TERRAIN_COLS + 1));
  const vertexH = new Float32Array((TERRAIN_ROWS + 1) * (TERRAIN_COLS + 1));
  const vertexOk = new Uint8Array((TERRAIN_ROWS + 1) * (TERRAIN_COLS + 1));

  function drawTerrain(time) {
    const cam = camera.state;
    const fwdX = Math.sin(cam.heading);
    const fwdZ = Math.cos(cam.heading);
    const rightX = Math.cos(cam.heading);
    const rightZ = -Math.sin(cam.heading);
    const originX = Math.round(cam.pos.x / 8) * 8;
    const originZ = Math.round(cam.pos.z / 8) * 8;
    // Project the whole grid first.
    for (let i = 0; i <= TERRAIN_ROWS; i += 1) {
      const d = rowDistances[i];
      const halfSpan = 60 + d * 1.78;
      for (let j = 0; j <= TERRAIN_COLS; j += 1) {
        const off = (j / TERRAIN_COLS * 2 - 1) * halfSpan;
        const wx = originX + fwdX * d + rightX * off;
        const wz = originZ + fwdZ * d + rightZ * off;
        const wy = terrainHeight(wx, wz);
        const idx = i * (TERRAIN_COLS + 1) + j;
        vertexH[idx] = wy;
        const p = camera.project({ x: wx, y: wy, z: wz });
        if (p) { vertexX[idx] = p.x; vertexY[idx] = p.y; vertexOk[idx] = 1; }
        else vertexOk[idx] = 0;
      }
    }
    // Then fill the quads, far rows first so near ground paints over seams.
    for (let i = TERRAIN_ROWS - 1; i >= 0; i -= 1) {
      const dMid = (rowDistances[i] + rowDistances[i + 1]) / 2;
      const fog = camera.fogFactor(dMid);
      const halfSpanNear = 60 + rowDistances[i] * 1.78;
      const halfSpanFar = 60 + rowDistances[i + 1] * 1.78;
      for (let j = 0; j < TERRAIN_COLS; j += 1) {
        const a = i * (TERRAIN_COLS + 1) + j;
        const b = a + 1;
        const c = a + TERRAIN_COLS + 1;
        const dIdx = c + 1;
        if (!(vertexOk[a] && vertexOk[b] && vertexOk[c] && vertexOk[dIdx])) continue;
        // Centre of the quad in world space, for its surface and shading.
        const midOff = ((j + 0.5) / TERRAIN_COLS * 2 - 1) * (halfSpanNear + halfSpanFar) / 2;
        const wx = originX + fwdX * dMid + rightX * midOff;
        const wz = originZ + fwdZ * dMid + rightZ * midOff;
        const surface = surfaceAt(wx, wz, PALETTE);
        const hNear = (vertexH[a] + vertexH[b]) / 2;
        const hFar = (vertexH[c] + vertexH[dIdx]) / 2;
        // Relief from two slopes: the view-axis tilt the mesh already knows,
        // plus a sun term from the world-space gradient, so a hillside facing
        // the sun (azimuth -0.65, as drawSky places it) stays lit whichever
        // way the aircraft is heading, instead of banding with the view.
        const gradStep = 16;
        const slopeX = (terrainHeight(wx + gradStep, wz) - terrainHeight(wx - gradStep, wz)) / (2 * gradStep);
        const slopeZ = (terrainHeight(wx, wz + gradStep) - terrainHeight(wx, wz - gradStep)) / (2 * gradStep);
        const sunFacing = -(slopeX * -0.6 + slopeZ * 0.8);
        let shadeF = clamp(0.92 + (hNear - hFar) * 0.006 + sunFacing * 0.34, 0.72, 1.13);
        if (surface.kind === 'sea' || surface.kind === 'river') {
          shadeF += Math.sin(time * 1.6 + wz * 0.02 + wx * 0.013) * 0.045;
        }
        const color = mixColor(shade(surface.color, shadeF), PALETTE.fog, fog);
        ctx2d.fillStyle = rgb(color);
        ctx2d.beginPath();
        ctx2d.moveTo(vertexX[a], vertexY[a]);
        ctx2d.lineTo(vertexX[b], vertexY[b]);
        ctx2d.lineTo(vertexX[dIdx], vertexY[dIdx]);
        ctx2d.lineTo(vertexX[c], vertexY[c]);
        ctx2d.closePath();
        ctx2d.fill();
      }
    }
  }

  // ---- Painted ground: runway markings, cargo target, shadows ----------------
  function groundQuad(x1, z1, x2, z2, y, color, alpha = 1) {
    const p1 = camera.project({ x: x1, y, z: z1 });
    const p2 = camera.project({ x: x2, y, z: z1 });
    const p3 = camera.project({ x: x2, y, z: z2 });
    const p4 = camera.project({ x: x1, y, z: z2 });
    if (!p1 || !p2 || !p3 || !p4) return;
    ctx2d.fillStyle = rgb(color, alpha);
    ctx2d.beginPath();
    ctx2d.moveTo(p1.x, p1.y); ctx2d.lineTo(p2.x, p2.y); ctx2d.lineTo(p3.x, p3.y); ctx2d.lineTo(p4.x, p4.y);
    ctx2d.closePath(); ctx2d.fill();
  }

  function drawRunwayMarkings() {
    const cam = camera.state;
    if (cam.pos.z < RUNWAY.zStart - 3000 || cam.pos.z > RUNWAY.zEnd + 1200) return;
    const y = RUNWAY.altitude + 0.3;
    const left = RUNWAY.x - RUNWAY.width / 2;
    const right = RUNWAY.x + RUNWAY.width / 2;
    // The asphalt itself, drawn as one projected ribbon: the terrain mesh is
    // too coarse far away to hold a 46 m strip, and an approach lives or dies
    // on seeing the runway from a kilometre out.
    groundQuad(left, RUNWAY.zStart, right, RUNWAY.zEnd, RUNWAY.altitude + 0.15, PALETTE.runway, 1);
    groundQuad(left + 1.2, RUNWAY.zStart, left + 2.8, RUNWAY.zEnd, y, PALETTE.runwayLine, 0.75);
    groundQuad(right - 2.8, RUNWAY.zStart, right - 1.2, RUNWAY.zEnd, y, PALETTE.runwayLine, 0.75);
    // Threshold piano keys.
    for (let i = 0; i < 6; i += 1) {
      const bx = left + 4.4 + i * 6.6;
      groundQuad(bx, RUNWAY.zStart + 10, bx + 3.4, RUNWAY.zStart + 40, y, PALETTE.runwayLine, 0.92);
    }
    // Centreline dashes.
    for (let z = RUNWAY.zStart + 80; z < RUNWAY.zEnd - 60; z += 92) {
      groundQuad(RUNWAY.x - 1.1, z, RUNWAY.x + 1.1, z + 34, y, PALETTE.runwayLine, 0.85);
    }
    // Touchdown zone pairs.
    for (const z of [RUNWAY.touchdownStart + 16, RUNWAY.touchdownStart + 96]) {
      groundQuad(RUNWAY.x - 10.5, z, RUNWAY.x - 6.5, z + 24, y, PALETTE.runwayLine, 0.92);
      groundQuad(RUNWAY.x + 6.5, z, RUNWAY.x + 10.5, z + 24, y, PALETTE.runwayLine, 0.92);
    }
    // PAPI lights beside the threshold: two white, two red, as flown.
    const papiZ = RUNWAY.zStart + 26;
    for (let i = 0; i < 4; i += 1) {
      const p = camera.project({ x: left - 8 - i * 4.5, y: RUNWAY.altitude + 1.1, z: papiZ });
      if (!p) continue;
      ctx2d.fillStyle = i < 2 ? 'rgba(255,255,255,0.95)' : 'rgba(255,70,50,0.95)';
      ctx2d.beginPath(); ctx2d.arc(p.x, p.y, Math.max(1.6, 1.5 * p.scale), 0, Math.PI * 2); ctx2d.fill();
    }
    // Approach light row on the centreline, short of the threshold.
    for (let i = 0; i < 5; i += 1) {
      const p = camera.project({ x: RUNWAY.x, y: RUNWAY.altitude + 0.6, z: RUNWAY.zStart - 150 + i * 32 });
      if (!p) continue;
      ctx2d.fillStyle = 'rgba(255,244,200,0.9)';
      ctx2d.beginPath(); ctx2d.arc(p.x, p.y, Math.max(1.4, 1.3 * p.scale), 0, Math.PI * 2); ctx2d.fill();
    }
  }

  function drawCargoTarget(time) {
    const centre = { x: CARGO_FIELD.x, z: CARGO_FIELD.z };
    for (const [radius, color, alpha, width] of [
      [62, [240, 244, 248], 0.75, 2.6],
      [32, [226, 84, 66], 0.85, 2.6],
      [13, [255, 190, 70], 0.95, 3],
    ]) {
      ctx2d.strokeStyle = rgb(color, alpha);
      ctx2d.beginPath();
      let started = false;
      for (let i = 0; i <= 36; i += 1) {
        const a = (i / 36) * Math.PI * 2;
        const wx = centre.x + Math.cos(a) * radius;
        const wz = centre.z + Math.sin(a) * radius;
        const p = camera.project({ x: wx, y: terrainHeight(wx, wz) + 0.4, z: wz });
        if (!p) { started = false; continue; }
        ctx2d.lineWidth = Math.max(1.2, width * p.scale * 0.14);
        if (!started) { ctx2d.moveTo(p.x, p.y); started = true; } else ctx2d.lineTo(p.x, p.y);
      }
      ctx2d.stroke();
    }
    // Corner flags so the zone reads from altitude.
    for (let i = 0; i < 4; i += 1) {
      const a = i * Math.PI / 2 + Math.PI / 4;
      const fx = centre.x + Math.cos(a) * 74;
      const fz = centre.z + Math.sin(a) * 74;
      const base = camera.project({ x: fx, y: terrainHeight(fx, fz), z: fz });
      const top = camera.project({ x: fx, y: terrainHeight(fx, fz) + 6, z: fz });
      if (!base || !top) continue;
      ctx2d.strokeStyle = 'rgba(40,44,52,0.9)';
      ctx2d.lineWidth = Math.max(1, 0.5 * top.scale);
      ctx2d.beginPath(); ctx2d.moveTo(base.x, base.y); ctx2d.lineTo(top.x, top.y); ctx2d.stroke();
      const wave = Math.sin(time * 6 + i * 1.7) * 1.4 * top.scale;
      ctx2d.fillStyle = rgb([255, 120, 60], 0.95);
      ctx2d.beginPath();
      ctx2d.moveTo(top.x, top.y);
      ctx2d.lineTo(top.x + 5.5 * top.scale, top.y + 1.2 * top.scale + wave * 0.2);
      ctx2d.lineTo(top.x, top.y + 2.6 * top.scale);
      ctx2d.closePath(); ctx2d.fill();
    }
  }

  function drawAircraftShadow(flight) {
    const ground = terrainHeight(flight.pos.x, flight.pos.z);
    const agl = flight.pos.y - ground;
    if (agl > 320) return;
    const p = camera.project({ x: flight.pos.x, y: ground + 0.5, z: flight.pos.z });
    if (!p) return;
    // Up close the shadow hides behind the aircraft herself; fade it in with
    // distance and never let it swell into a blob that fills the frame.
    const nearFade = clamp((p.depth - 24) / 70, 0, 1);
    if (nearFade <= 0) return;
    const rx = Math.min(120, 15 * p.scale * (1 + agl / 240));
    ctx2d.fillStyle = `rgba(12, 20, 16, ${clamp(0.4 - agl / 800, 0.04, 0.38) * nearFade})`;
    ctx2d.beginPath(); ctx2d.ellipse(p.x, p.y, rx, rx * 0.32, 0, 0, Math.PI * 2); ctx2d.fill();
  }

  // ---- Clouds ----------------------------------------------------------------
  function drawClouds() {
    for (const cloud of clouds) {
      const p = camera.project(cloud);
      if (!p || p.depth > 4300) continue;
      const w = cloud.s * p.scale * 4.1;
      const h = w * 0.5;
      ctx2d.save();
      ctx2d.globalAlpha = cloud.a * (1 - camera.fogFactor(p.depth) * 0.65);
      ctx2d.drawImage(cloudSprites[cloud.sprite], p.x - w / 2, p.y - h / 2, w, h);
      ctx2d.restore();
    }
  }

  // ---- Landmarks ---------------------------------------------------------------
  function drawTree(mark, p) {
    const u = p.scale * mark.scale;
    const h = 11 * u;
    const tone = 0.85 + mark.tone * 0.35;
    ctx2d.strokeStyle = rgb(mixColor([90, 66, 48], PALETTE.fog, camera.fogFactor(p.depth)));
    ctx2d.lineWidth = Math.max(1, 0.55 * u);
    ctx2d.beginPath(); ctx2d.moveTo(p.x, p.y); ctx2d.lineTo(p.x, p.y - h * 0.36); ctx2d.stroke();
    ctx2d.fillStyle = rgb(mixColor(shade(PALETTE.forest, tone), PALETTE.fog, camera.fogFactor(p.depth)));
    ctx2d.beginPath();
    ctx2d.moveTo(p.x, p.y - h);
    ctx2d.lineTo(p.x - 3.6 * u, p.y - h * 0.3);
    ctx2d.lineTo(p.x + 3.6 * u, p.y - h * 0.3);
    ctx2d.closePath(); ctx2d.fill();
    ctx2d.beginPath();
    ctx2d.moveTo(p.x, p.y - h * 0.82);
    ctx2d.lineTo(p.x - 2.7 * u, p.y - h * 0.18);
    ctx2d.lineTo(p.x + 2.7 * u, p.y - h * 0.18);
    ctx2d.closePath(); ctx2d.fill();
  }

  function boxFaces(cx, cz, y0, w, d, h, heading, wallA, wallB, roof) {
    const fx = { x: Math.sin(heading), z: Math.cos(heading) };
    const rx = { x: Math.cos(heading), z: -Math.sin(heading) };
    const corner = (sx, sz, y) => camera.project({
      x: cx + rx.x * sx * w / 2 + fx.x * sz * d / 2,
      y,
      z: cz + rx.z * sx * w / 2 + fx.z * sz * d / 2,
    });
    const b1 = corner(-1, -1, y0); const b2 = corner(1, -1, y0);
    const b3 = corner(1, 1, y0); const b4 = corner(-1, 1, y0);
    const t1 = corner(-1, -1, y0 + h); const t2 = corner(1, -1, y0 + h);
    const t3 = corner(1, 1, y0 + h); const t4 = corner(-1, 1, y0 + h);
    if (!b1 || !b2 || !b3 || !b4 || !t1 || !t2 || !t3 || !t4) return;
    const ridge1 = camera.project({ x: cx - fx.x * d / 2, y: y0 + h + h * 0.42, z: cz - fx.z * d / 2 });
    const ridge2 = camera.project({ x: cx + fx.x * d / 2, y: y0 + h + h * 0.42, z: cz + fx.z * d / 2 });
    const quad = (pts, color) => {
      ctx2d.fillStyle = color;
      ctx2d.beginPath();
      ctx2d.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i += 1) ctx2d.lineTo(pts[i].x, pts[i].y);
      ctx2d.closePath(); ctx2d.fill();
    };
    quad([b2, b3, t3, t2], wallA);
    quad([b4, b1, t1, t4], wallB);
    if (ridge1 && ridge2) {
      quad([t1, t2, ridge2, ridge1], roof);
      quad([t4, t3, ridge2, ridge1], roof);
    } else {
      quad([t1, t2, t3, t4], roof);
    }
  }

  function drawHouse(mark, p) {
    const fog = camera.fogFactor(p.depth);
    const walls = [[232, 220, 196], [206, 170, 140], [220, 226, 230]][Math.floor(mark.tone * 3) % 3];
    // Sunk a little into the slope so the downhill corner never floats.
    const y0 = terrainHeight(mark.x, mark.z) - 1.2;
    boxFaces(mark.x, mark.z, y0, 13 * mark.scale, 10 * mark.scale, 6 * mark.scale, mark.heading,
      rgb(mixColor(shade(walls, 0.92), PALETTE.fog, fog)),
      rgb(mixColor(shade(walls, 0.78), PALETTE.fog, fog)),
      rgb(mixColor([164, 74, 52], PALETTE.fog, fog)));
  }

  function drawHangar(mark, p) {
    const fog = camera.fogFactor(p.depth);
    const y0 = terrainHeight(mark.x, mark.z) - 1.2;
    boxFaces(mark.x, mark.z, y0, 26, 18, 9, mark.heading,
      rgb(mixColor([148, 162, 176], PALETTE.fog, fog)),
      rgb(mixColor([128, 142, 158], PALETTE.fog, fog)),
      rgb(mixColor([104, 116, 132], PALETTE.fog, fog)));
  }

  function drawTurbine(mark, p, time) {
    const y0 = terrainHeight(mark.x, mark.z);
    const hub = camera.project({ x: mark.x, y: y0 + 38, z: mark.z });
    if (!hub) return;
    const fog = camera.fogFactor(p.depth);
    const color = rgb(mixColor([228, 232, 236], PALETTE.fog, fog));
    ctx2d.strokeStyle = color;
    ctx2d.lineWidth = Math.max(1, 0.8 * p.scale);
    ctx2d.beginPath(); ctx2d.moveTo(p.x, p.y); ctx2d.lineTo(hub.x, hub.y); ctx2d.stroke();
    const blade = 13 * hub.scale;
    const a0 = time * 0.9 + mark.tone * 7;
    ctx2d.lineWidth = Math.max(1, 0.55 * hub.scale);
    ctx2d.beginPath();
    for (let k = 0; k < 3; k += 1) {
      const a = a0 + k * (Math.PI * 2 / 3);
      ctx2d.moveTo(hub.x, hub.y);
      ctx2d.lineTo(hub.x + Math.cos(a) * blade, hub.y + Math.sin(a) * blade);
    }
    ctx2d.stroke();
    ctx2d.fillStyle = color;
    ctx2d.beginPath(); ctx2d.arc(hub.x, hub.y, Math.max(1.2, 0.8 * hub.scale), 0, Math.PI * 2); ctx2d.fill();
  }

  function drawLighthouse(mark, p, time) {
    const y0 = terrainHeight(mark.x, mark.z);
    const fog = camera.fogFactor(p.depth);
    for (let i = 0; i < 5; i += 1) {
      const yA = y0 + i * 4.8;
      const wA = (5.6 - i * 0.5) / 2;
      const left = camera.project({ x: mark.x - wA, y: yA, z: mark.z });
      const right = camera.project({ x: mark.x + wA, y: yA + 4.8, z: mark.z });
      const rightB = camera.project({ x: mark.x + wA, y: yA, z: mark.z });
      const leftT = camera.project({ x: mark.x - (5.6 - (i + 1) * 0.5) / 2, y: yA + 4.8, z: mark.z });
      if (!left || !right || !rightB || !leftT) continue;
      ctx2d.fillStyle = rgb(mixColor(i % 2 ? [214, 64, 48] : [240, 240, 238], PALETTE.fog, fog));
      ctx2d.beginPath();
      ctx2d.moveTo(left.x, left.y); ctx2d.lineTo(rightB.x, rightB.y); ctx2d.lineTo(right.x, right.y); ctx2d.lineTo(leftT.x, leftT.y);
      ctx2d.closePath(); ctx2d.fill();
    }
    const lamp = camera.project({ x: mark.x, y: y0 + 26, z: mark.z });
    if (lamp) {
      const pulse = 0.55 + 0.45 * Math.sin(time * 2.2);
      ctx2d.fillStyle = `rgba(255, 240, 180, ${0.75 * pulse})`;
      ctx2d.beginPath(); ctx2d.arc(lamp.x, lamp.y, Math.max(2, 2.2 * lamp.scale), 0, Math.PI * 2); ctx2d.fill();
    }
  }

  // ---- Gates, parcel, birds -----------------------------------------------------
  function drawRing(ring, time) {
    const centre = camera.project(ring);
    if (!centre || centre.depth > 2900) return;
    const right = camera.project({ x: ring.x + ring.radius, y: ring.y, z: ring.z });
    const top = camera.project({ x: ring.x, y: ring.y + ring.radius, z: ring.z });
    if (!right || !top) return;
    const rx = Math.abs(right.x - centre.x);
    const ry = Math.abs(top.y - centre.y);
    let color = [170, 220, 235];
    let alpha = 0.62;
    if (ring.state === 'next') { color = [255, 180, 84]; alpha = 0.8 + 0.2 * Math.sin(time * 5); }
    else if (ring.state === 'passed') { color = [126, 231, 135]; alpha = 0.85; }
    else if (ring.state === 'missed') { color = [200, 90, 80]; alpha = 0.45; }
    // A gate the camera is inside of fades out instead of ringing the frame.
    alpha *= clamp((centre.depth - 16) / 34, 0, 1);
    if (alpha <= 0.01) return;
    color = mixColor(color, PALETTE.fog, camera.fogFactor(centre.depth));
    // A soft dark under-stroke first, so the pale ring still reads where it
    // crosses bright sky, cloud or sunlit grass.
    ctx2d.strokeStyle = `rgba(18, 28, 44, ${alpha * 0.32})`;
    ctx2d.lineWidth = clamp(0.85 * centre.scale, 2, 9) * 2.1;
    ctx2d.beginPath(); ctx2d.ellipse(centre.x, centre.y, rx, ry, 0, 0, Math.PI * 2); ctx2d.stroke();
    ctx2d.strokeStyle = rgb(color, alpha);
    ctx2d.lineWidth = clamp(0.85 * centre.scale, 2, 9);
    ctx2d.beginPath(); ctx2d.ellipse(centre.x, centre.y, rx, ry, 0, 0, Math.PI * 2); ctx2d.stroke();
    ctx2d.fillStyle = rgb(color, alpha * 0.08);
    ctx2d.beginPath(); ctx2d.ellipse(centre.x, centre.y, rx, ry, 0, 0, Math.PI * 2); ctx2d.fill();
    // Rim beacons.
    ctx2d.fillStyle = rgb(color, Math.min(1, alpha + 0.2));
    for (const [bx, by] of [[rx, 0], [-rx, 0], [0, ry], [0, -ry]]) {
      ctx2d.beginPath(); ctx2d.arc(centre.x + bx, centre.y + by, clamp(0.4 * centre.scale, 1.4, 4), 0, Math.PI * 2); ctx2d.fill();
    }
    // The next gate gets a light pillar down to the ground, a guide in the sky.
    if (ring.state === 'next') {
      const ground = camera.project({ x: ring.x, y: terrainHeight(ring.x, ring.z), z: ring.z });
      if (ground) {
        ctx2d.strokeStyle = rgb(color, 0.16);
        ctx2d.lineWidth = clamp(0.5 * centre.scale, 1, 4);
        ctx2d.beginPath(); ctx2d.moveTo(centre.x, centre.y + ry); ctx2d.lineTo(ground.x, ground.y); ctx2d.stroke();
      }
    }
  }

  function drawParcel(mission, time) {
    const parcel = mission.parcel;
    if (parcel.state === 'carried') return;
    const p = camera.project(parcel);
    if (!p) return;
    const u = p.scale;
    // Shadow first, so the eye can judge the fall.
    const ground = terrainHeight(parcel.x, parcel.z);
    const sp = camera.project({ x: parcel.x, y: ground + 0.4, z: parcel.z });
    if (sp) {
      ctx2d.fillStyle = 'rgba(12,20,16,0.3)';
      ctx2d.beginPath(); ctx2d.ellipse(sp.x, sp.y, 2.4 * sp.scale, 0.8 * sp.scale, 0, 0, Math.PI * 2); ctx2d.fill();
    }
    if (parcel.state === 'falling' && parcel.age > 0.35) {
      // Parachute canopy and its lines.
      ctx2d.strokeStyle = 'rgba(240,240,240,0.85)';
      ctx2d.lineWidth = Math.max(1, 0.22 * u);
      ctx2d.beginPath();
      ctx2d.moveTo(p.x - 3.4 * u, p.y - 4.6 * u); ctx2d.lineTo(p.x, p.y);
      ctx2d.moveTo(p.x + 3.4 * u, p.y - 4.6 * u); ctx2d.lineTo(p.x, p.y);
      ctx2d.stroke();
      ctx2d.fillStyle = rgb([255, 122, 60]);
      ctx2d.beginPath(); ctx2d.ellipse(p.x, p.y - 4.8 * u, 3.6 * u, 1.7 * u, 0, Math.PI, Math.PI * 2); ctx2d.fill();
    }
    ctx2d.save();
    ctx2d.translate(p.x, p.y);
    ctx2d.rotate(parcel.state === 'falling' ? Math.sin(time * 3) * 0.2 : 0.3);
    ctx2d.fillStyle = rgb([146, 104, 58]);
    ctx2d.fillRect(-1.3 * u, -1.1 * u, 2.6 * u, 2.2 * u);
    ctx2d.fillStyle = rgb([110, 78, 40]);
    ctx2d.fillRect(-1.3 * u, -0.25 * u, 2.6 * u, 0.5 * u);
    ctx2d.restore();
  }

  const FLOCKS = [
    { x: 240, z: 6000, y: 215, r: 90 },
    { x: -900, z: 8800, y: 265, r: 120 },
  ];
  function drawBirds(time) {
    for (const flock of FLOCKS) {
      for (let i = 0; i < 5; i += 1) {
        const a = time * 0.13 + i * 1.256;
        const pos = {
          x: flock.x + Math.cos(a) * flock.r,
          y: flock.y + Math.sin(time * 0.6 + i * 2.1) * 9,
          z: flock.z + Math.sin(a) * flock.r,
        };
        const p = camera.project(pos);
        if (!p || p.depth > 2100) continue;
        const w = 2.6 * p.scale;
        const flap = Math.sin(time * 9 + i * 2.3) * 0.55;
        ctx2d.strokeStyle = 'rgba(30, 38, 48, 0.75)';
        ctx2d.lineWidth = Math.max(1, 0.22 * p.scale);
        ctx2d.beginPath();
        ctx2d.moveTo(p.x - w, p.y - flap * w * 0.5);
        ctx2d.lineTo(p.x, p.y + w * 0.18);
        ctx2d.lineTo(p.x + w, p.y - flap * w * 0.5);
        ctx2d.stroke();
      }
    }
  }

  // ---- Particles ------------------------------------------------------------------
  function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i -= 1) {
      const p = particles[i];
      p.life += dt;
      if (p.life >= p.maxLife) { particles.splice(i, 1); continue; }
      const dragF = Math.max(0, 1 - p.drag * dt);
      p.vx *= dragF; p.vz *= dragF;
      p.vy = p.vy * dragF + p.gravity * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
    }
  }
  function drawParticles() {
    for (const p of particles) {
      const sp = camera.project(p);
      if (!sp) continue;
      const fade = 1 - p.life / p.maxLife;
      ctx2d.fillStyle = rgb(p.color, fade * 0.85);
      ctx2d.beginPath();
      ctx2d.arc(sp.x, sp.y, Math.max(0.7, p.size * 0.2 * sp.scale), 0, Math.PI * 2);
      ctx2d.fill();
    }
  }
  function emitAmbient(flight, dt) {
    emitAccumulator += dt;
    const fwdX = Math.sin(flight.heading);
    const fwdZ = Math.cos(flight.heading);
    if (flight.onGround && flight.speed > 10 && !flight.crashed) {
      while (emitAccumulator > 1 / 22) {
        emitAccumulator -= 1 / 22;
        spawnParticle({
          x: flight.pos.x - fwdX * 9 + (Math.random() - 0.5) * 3,
          y: terrainHeight(flight.pos.x, flight.pos.z) + 1.2,
          z: flight.pos.z - fwdZ * 9 + (Math.random() - 0.5) * 3,
          vx: -fwdX * 3, vy: 1.6 + Math.random() * 1.6, vz: -fwdZ * 3,
          life: 0, maxLife: 0.9, size: 5.5, color: [198, 180, 142], gravity: 1.2, drag: 2.2,
        });
      }
    } else if (flight.airborne && flight.hull < 45 && !flight.crashed) {
      while (emitAccumulator > 1 / 16) {
        emitAccumulator -= 1 / 16;
        spawnParticle({
          x: flight.pos.x - fwdX * 6, y: flight.pos.y - 1, z: flight.pos.z - fwdZ * 6,
          vx: -fwdX * 7, vy: 2.2, vz: -fwdZ * 7,
          life: 0, maxLife: 1.15, size: 6.5, color: [58, 58, 62], gravity: 2.6, drag: 1.4,
        });
      }
    } else {
      emitAccumulator = Math.min(emitAccumulator, 0.05);
    }
  }

  // ---- The aircraft, from behind ---------------------------------------------------
  function drawAircraft(flight, steer, time) {
    const ax = VIEW.width / 2 - flight.bank * 16;
    const bob = flight.airborne ? Math.sin(time * 2.1) * 2.2 : 0;
    const stallShake = flight.warnings.stall ? Math.sin(time * 47) * 2.4 : 0;
    const ay = VIEW.height * 0.665 - flight.pitch * 30 + bob + stallShake;
    ctx2d.save();
    ctx2d.translate(ax, ay);
    ctx2d.rotate(flight.bank * 0.82);
    ctx2d.scale(1 + flight.pitch * 0.1, 1 + flight.pitch * 0.1);
    // Wings, with ailerons deflected by the pilot's hand.
    const ail = steer.bank * 7;
    for (const side of [-1, 1]) {
      ctx2d.fillStyle = '#e07b2a';
      ctx2d.beginPath();
      ctx2d.moveTo(side * 8, -4);
      ctx2d.lineTo(side * 152, 4);
      ctx2d.lineTo(side * 150, 17);
      ctx2d.lineTo(side * 10, 15);
      ctx2d.closePath(); ctx2d.fill();
      ctx2d.fillStyle = '#c9641d';
      const ailLift = side < 0 ? -ail : ail;
      ctx2d.beginPath();
      ctx2d.moveTo(side * 96, 10.5);
      ctx2d.lineTo(side * 150, 13.5 + ailLift);
      ctx2d.lineTo(side * 150, 17 + ailLift);
      ctx2d.lineTo(side * 96, 14);
      ctx2d.closePath(); ctx2d.fill();
    }
    // Tailplane.
    ctx2d.fillStyle = '#d96c1e';
    ctx2d.beginPath();
    ctx2d.moveTo(-46, 26); ctx2d.lineTo(46, 26); ctx2d.lineTo(42, 35); ctx2d.lineTo(-42, 35);
    ctx2d.closePath(); ctx2d.fill();
    // Fuselage: a rounded body, near end wide, far end tapered, shaded round.
    const bodyGrad = ctx2d.createLinearGradient(-30, 0, 30, 0);
    bodyGrad.addColorStop(0, '#b5501f');
    bodyGrad.addColorStop(0.3, '#f28c28');
    bodyGrad.addColorStop(0.55, '#ffb85c');
    bodyGrad.addColorStop(0.78, '#f28c28');
    bodyGrad.addColorStop(1, '#a34a1c');
    ctx2d.fillStyle = bodyGrad;
    ctx2d.beginPath();
    ctx2d.moveTo(-13, -62);
    ctx2d.quadraticCurveTo(-30, -20, -27, 34);
    ctx2d.quadraticCurveTo(-26, 44, 0, 44);
    ctx2d.quadraticCurveTo(26, 44, 27, 34);
    ctx2d.quadraticCurveTo(30, -20, 13, -62);
    ctx2d.quadraticCurveTo(0, -68, -13, -62);
    ctx2d.closePath(); ctx2d.fill();
    // Fin and rudder above the far end.
    ctx2d.fillStyle = '#d64533';
    ctx2d.beginPath();
    ctx2d.moveTo(steer.bank * 3 - 2, -92);
    ctx2d.lineTo(steer.bank * 3 + 5, -58);
    ctx2d.lineTo(-6, -56);
    ctx2d.closePath(); ctx2d.fill();
    // Canopy, glossy.
    ctx2d.fillStyle = '#a8dcf5';
    ctx2d.beginPath(); ctx2d.ellipse(0, -42, 14.5, 10, 0, 0, Math.PI * 2); ctx2d.fill();
    ctx2d.fillStyle = 'rgba(255,255,255,0.8)';
    ctx2d.beginPath(); ctx2d.ellipse(-4.5, -45.5, 5, 3.2, -0.4, 0, Math.PI * 2); ctx2d.fill();
    // Propeller: an edge-on shimmer disc at the far nose.
    ctx2d.fillStyle = 'rgba(32,38,46,0.4)';
    ctx2d.beginPath(); ctx2d.ellipse(0, -64 + Math.sin(flight.propPhase) * 1.6, 33, 3.4, 0, 0, Math.PI * 2); ctx2d.fill();
    ctx2d.fillStyle = '#26303a';
    ctx2d.beginPath(); ctx2d.arc(0, -64, 3.4, 0, Math.PI * 2); ctx2d.fill();
    // Courier pods slung under the wings.
    for (const side of [-1, 1]) {
      ctx2d.fillStyle = '#8a5a30';
      ctx2d.beginPath(); ctx2d.roundRect(side * 66 - 14, 15, 28, 13, 4); ctx2d.fill();
      ctx2d.fillStyle = '#6f4525';
      ctx2d.fillRect(side * 66 - 2, 15, 4, 13);
    }
    // Gear: struts and wheels, always down on a Kestrel.
    ctx2d.strokeStyle = '#3a4550'; ctx2d.lineWidth = 3.4;
    ctx2d.beginPath();
    ctx2d.moveTo(-13, 38); ctx2d.lineTo(-18, 50);
    ctx2d.moveTo(13, 38); ctx2d.lineTo(18, 50);
    ctx2d.stroke();
    ctx2d.fillStyle = '#222a33';
    ctx2d.beginPath(); ctx2d.arc(-18, 53, 7.4, 0, Math.PI * 2); ctx2d.arc(18, 53, 7.4, 0, Math.PI * 2); ctx2d.fill();
    ctx2d.fillStyle = '#8b98a5';
    ctx2d.beginPath(); ctx2d.arc(-18, 53, 2.8, 0, Math.PI * 2); ctx2d.arc(18, 53, 2.8, 0, Math.PI * 2); ctx2d.fill();
    // Wingtip lights and the tail strobe.
    ctx2d.fillStyle = '#ff4b3e';
    ctx2d.beginPath(); ctx2d.arc(-150, 11, 3.6, 0, Math.PI * 2); ctx2d.fill();
    ctx2d.fillStyle = '#3eff7a';
    ctx2d.beginPath(); ctx2d.arc(150, 11, 3.6, 0, Math.PI * 2); ctx2d.fill();
    const strobe = (time * 0.9) % 1 < 0.07 ? 0.95 : 0.1;
    ctx2d.fillStyle = `rgba(255,255,255,${strobe})`;
    ctx2d.beginPath(); ctx2d.arc(0, 44, 3.2, 0, Math.PI * 2); ctx2d.fill();
    // Exhaust flicker at high throttle.
    if (flight.throttle > 0.68 && !flight.crashed) {
      const flick = 0.35 + 0.3 * Math.sin(time * 41);
      ctx2d.fillStyle = `rgba(255,150,60,${flick * (flight.throttle - 0.6)})`;
      ctx2d.beginPath(); ctx2d.ellipse(-9, 40, 3.4, 5.5, 0, 0, Math.PI * 2); ctx2d.fill();
      ctx2d.beginPath(); ctx2d.ellipse(9, 40, 3.4, 5.5, 0, 0, Math.PI * 2); ctx2d.fill();
    }
    // Scorch from a hurting engine.
    if (flight.hull < 55) {
      ctx2d.fillStyle = `rgba(30,26,24,${(55 - flight.hull) / 130})`;
      ctx2d.beginPath(); ctx2d.ellipse(14, 6, 12, 22, 0.2, 0, Math.PI * 2); ctx2d.fill();
    }
    ctx2d.restore();
  }

  function drawSpeedStreaks(flight, time) {
    if (!flight.airborne || flight.speed < 80) return;
    const alpha = clamp((flight.speed - 80) / 45, 0, 0.4);
    ctx2d.strokeStyle = `rgba(255,255,255,${alpha})`;
    ctx2d.lineWidth = 2;
    ctx2d.beginPath();
    const tick = Math.floor(time * 11);
    for (let i = 0; i < 9; i += 1) {
      const seedA = Math.sin(i * 91.7 + tick * 13.3) * 43758.5;
      const fx = (seedA - Math.floor(seedA)) * VIEW.width;
      const seedB = Math.sin(i * 47.3 + tick * 7.9) * 24634.6;
      const fy = (seedB - Math.floor(seedB)) * VIEW.height;
      if (Math.abs(fx - VIEW.width / 2) < 190 && Math.abs(fy - VIEW.height * 0.66) < 130) continue;
      ctx2d.moveTo(fx, fy);
      ctx2d.lineTo(fx - (34 + flight.speed * 0.5), fy + flight.bank * 8);
    }
    ctx2d.stroke();
  }

  // ---- The whole frame --------------------------------------------------------------
  function draw(view, dt) {
    const { flight, mission, steer, time } = view;
    camera.update(dt, flight);
    ctx2d.save();
    ctx2d.translate(VIEW.width / 2, VIEW.height / 2);
    ctx2d.rotate(-flight.bank * 0.42);
    ctx2d.translate(-VIEW.width / 2, -VIEW.height / 2);
    drawSky(flight, time);
    drawTerrain(time);
    drawRunwayMarkings();
    if (mission && mission.kind === MISSION_CARGO) drawCargoTarget(time);
    drawAircraftShadow(flight);
    drawClouds();
    // Depth-sorted world objects: landmarks, gates, the parcel, birds.
    const items = [];
    const camZ = camera.state.pos.z;
    for (const mark of landmarksBetween(camZ - 350, camZ + 2950, PALETTE)) {
      const ground = terrainHeight(mark.x, mark.z);
      const p = camera.project({ x: mark.x, y: ground, z: mark.z });
      if (!p) continue;
      if (mark.kind === LANDMARK.TREE && p.depth > 1450) continue;
      if (p.depth > 2650) continue;
      items.push({ depth: p.depth, draw: () => {
        if (mark.kind === LANDMARK.TREE) drawTree(mark, p);
        else if (mark.kind === LANDMARK.HOUSE) drawHouse(mark, p);
        else if (mark.kind === LANDMARK.HANGAR) drawHangar(mark, p);
        else if (mark.kind === LANDMARK.TURBINE) drawTurbine(mark, p, time);
        else if (mark.kind === LANDMARK.LIGHTHOUSE) drawLighthouse(mark, p, time);
      } });
    }
    if (mission && mission.kind === MISSION_RINGS) {
      for (const ring of mission.rings) {
        const p = camera.project(ring);
        if (p) items.push({ depth: p.depth, draw: () => drawRing(ring, time) });
      }
    }
    if (mission && mission.kind === MISSION_CARGO && mission.parcel.state !== 'carried') {
      const p = camera.project(mission.parcel);
      if (p) items.push({ depth: p.depth, draw: () => drawParcel(mission, time) });
    }
    items.sort((a, b) => b.depth - a.depth);
    for (const item of items) item.draw();
    drawBirds(time);
    emitAmbient(flight, dt);
    updateParticles(dt);
    drawParticles();
    drawSpeedStreaks(flight, time);
    drawAircraft(flight, steer, time);
    ctx2d.restore();
  }

  return { draw, burst, camera };
}
