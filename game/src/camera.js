// The chase camera: it hovers behind and above the aircraft, eases after its
// heading and pitch so the turn feels flown rather than snapped, and owns
// the one world-to-screen projection every other drawing module uses.
import { VIEW } from './config.js';
import { angleDelta, clamp, lerp } from './random.js';
import { terrainHeight } from './terrain.js';

export function createCamera() {
  const focal = (VIEW.height / 2) / Math.tan((VIEW.fovDeg * Math.PI / 180) / 2);
  const cam = {
    pos: { x: 0, y: 220, z: -40 },
    heading: 0,
    pitch: -0.05,
    focal,
    right: { x: 1, y: 0, z: 0 },
    up: { x: 0, y: 1, z: 0 },
    forward: { x: 0, y: 0, z: 1 },
  };

  function rebuildBasis() {
    const cp = Math.cos(cam.pitch);
    cam.forward = {
      x: Math.sin(cam.heading) * cp,
      y: Math.sin(cam.pitch),
      z: Math.cos(cam.heading) * cp,
    };
    // right = forward x world-up, normalised; up completes the frame.
    const rx = cam.forward.z;
    const rz = -cam.forward.x;
    const rl = Math.hypot(rx, rz) || 1;
    cam.right = { x: rx / rl, y: 0, z: rz / rl };
    // up = forward x right (right x forward would point it at the ground).
    cam.up = {
      x: cam.forward.y * cam.right.z - cam.forward.z * cam.right.y,
      y: cam.forward.z * cam.right.x - cam.forward.x * cam.right.z,
      z: cam.forward.x * cam.right.y - cam.forward.y * cam.right.x,
    };
  }

  /** Snap straight behind the aircraft (mission start, no swooping in). */
  function reset(flight) {
    cam.heading = flight.heading;
    cam.pitch = flight.pitch * 0.55 - 0.05;
    const back = 30;
    cam.pos.x = flight.pos.x - Math.sin(flight.heading) * back;
    cam.pos.z = flight.pos.z - Math.cos(flight.heading) * back;
    cam.pos.y = flight.pos.y + 10.5;
    rebuildBasis();
  }

  function update(dt, flight) {
    const headingStep = 1 - Math.pow(0.002, dt);
    cam.heading += angleDelta(cam.heading, flight.heading) * headingStep;
    const targetPitch = flight.onGround ? -0.02 : flight.pitch * 0.55 - 0.055;
    cam.pitch = lerp(cam.pitch, targetPitch, 1 - Math.pow(0.004, dt));
    const back = flight.onGround ? 27 : 31;
    const rise = flight.onGround ? 8.5 : 10.5;
    const want = {
      x: flight.pos.x - Math.sin(cam.heading) * back,
      z: flight.pos.z - Math.cos(cam.heading) * back,
      y: flight.pos.y + rise,
    };
    const posStep = 1 - Math.pow(0.00005, dt);
    cam.pos.x = lerp(cam.pos.x, want.x, posStep);
    cam.pos.z = lerp(cam.pos.z, want.z, posStep);
    cam.pos.y = lerp(cam.pos.y, want.y, 1 - Math.pow(0.0005, dt));
    // Never let the camera sink into a hillside it is chasing over.
    const floor = terrainHeight(cam.pos.x, cam.pos.z) + 3.4;
    if (cam.pos.y < floor) cam.pos.y = floor;
    rebuildBasis();
  }

  /** World point to screen point, or null when it sits behind the camera. */
  function project(p) {
    const dx = p.x - cam.pos.x;
    const dy = p.y - cam.pos.y;
    const dz = p.z - cam.pos.z;
    const cz = dx * cam.forward.x + dy * cam.forward.y + dz * cam.forward.z;
    if (cz < VIEW.near) return null;
    const cx = dx * cam.right.x + dy * cam.right.y + dz * cam.right.z;
    const cy = dx * cam.up.x + dy * cam.up.y + dz * cam.up.z;
    const s = cam.focal / cz;
    return { x: VIEW.width / 2 + cx * s, y: VIEW.height / 2 - cy * s, depth: cz, scale: s };
  }

  /** Screen Y of the eye-level horizon line. */
  function horizonY() {
    const far = {
      x: cam.pos.x + Math.sin(cam.heading) * 2400,
      y: cam.pos.y,
      z: cam.pos.z + Math.cos(cam.heading) * 2400,
    };
    const p = project(far);
    return p ? p.y : VIEW.height * 0.42;
  }

  /** 0 at the camera, 1 at the far plane: how much fog a depth takes. */
  function fogFactor(depth) {
    const t = clamp((depth - 260) / (VIEW.far - 260), 0, 1);
    return t * t * (3 - 2 * t);
  }

  return { state: cam, reset, update, project, horizonY, fogFactor };
}
