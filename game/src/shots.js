// Deterministic screenshot scenes for the submission captures. With
// ?shot=<name> in the URL, the game skips its interactive loop, places the
// aircraft, flies a small autopilot script with the real simulation and
// mission logic, freezes on a composed frame — chase view, lit HUD, a gate
// or the runway ahead — paints it, and sets window.__shotReady. The scenes
// are the actual game; nothing here draws anything the game cannot draw.
import { CARGO_FIELD, RUNWAY, STEP } from './config.js';
import { angleDelta, clamp } from './random.js';
import { F_GROUND_CONTACT } from './flight.js';
import { MISSION_CARGO, MISSION_LANDING, MISSION_RINGS, createMission } from './missions.js';

function steerToward(state, target, cruiseSpeed) {
  const wanted = Math.atan2(target.x - state.pos.x, target.z - state.pos.z);
  const delta = angleDelta(state.heading, wanted);
  return {
    bank: clamp(delta * 1.5, -1, 1),
    pitch: clamp((target.y - state.pos.y) * 0.02 - state.verticalSpeed * 0.012, -0.6, 0.7),
    throttleDelta: clamp((cruiseSpeed - state.speed) * 0.03, -1, 1),
  };
}

const SCENES = {
  // Rolling down Runway 36 at rotation speed, gates waiting up the valley.
  takeoff: {
    kind: MISSION_RINGS,
    setup(flight) { /* the Ring Run start pose is the runway itself */ },
    controls(state) {
      return {
        bank: 0,
        pitch: state.speed < 52 ? 0 : 0.62,
        throttleDelta: 1,
      };
    },
    ready(state) { return state.airborne && state.pos.y > RUNWAY.altitude + 30; },
  },
  // Through the first gate, lining up the second over the river.
  rings: {
    kind: MISSION_RINGS,
    setup(flight, mission) {
      const ring = mission.rings[0];
      flight.place({ x: ring.x - 30, y: ring.y + 4, z: ring.z - 640, heading: 0, speed: 92, throttle: 0.8, onGround: false });
    },
    controls(state, mission) {
      const ring = mission.rings.find((r) => r.state === 'next') || mission.rings[mission.rings.length - 1];
      return steerToward(state, ring, 96);
    },
    ready(state, mission) {
      const passed = mission.rings.some((r) => r.state === 'passed');
      if (!passed) return false;
      // The current target is the first unresolved gate; on the exact step a
      // gate is passed, the next one has not been flagged 'next' yet.
      const next = mission.rings.find((r) => r.state === 'next' || r.state === 'waiting');
      if (!next) return true;
      const dist = Math.hypot(next.x - state.pos.x, next.z - state.pos.z);
      return dist < 360;
    },
  },
  // Parcel away over the drop zone, parachute open, target rings below.
  cargo: {
    kind: MISSION_CARGO,
    setup(flight) {
      flight.place({ x: -300, y: 240, z: 6050, heading: 0, speed: 70, throttle: 0.6, onGround: false });
    },
    controls(state, mission, ctx) {
      const target = { x: CARGO_FIELD.x, y: 232, z: CARGO_FIELD.z };
      const controls = steerToward(state, target, 70);
      const dist = Math.hypot(CARGO_FIELD.x - state.pos.x, CARGO_FIELD.z - state.pos.z);
      if (!ctx.dropped && dist < 470) { ctx.drop = true; ctx.dropped = true; }
      return controls;
    },
    ready(state, mission) {
      // The parcel falls out of the bottom of the chase frame within a
      // second — it sheds speed and drops almost straight down relative to
      // the camera. At ~0.5 s it hangs just below the tail, canopy open,
      // with the drop zone still ahead in frame.
      return mission.parcel.state === 'falling' && mission.parcel.age > 0.45;
    },
  },
  // On final for Runway 36: threshold, PAPI lights and touchdown zone ahead.
  landing: {
    kind: MISSION_LANDING,
    setup(flight) { /* the Landing Challenge start pose is the approach itself */ },
    controls(state) {
      const aimZ = RUNWAY.touchdownStart + 120;
      const yTarget = RUNWAY.altitude + 2.2 + Math.max(0, aimZ - state.pos.z) * 0.088;
      return {
        bank: clamp((RUNWAY.x - state.pos.x) * 0.004 - state.bank * 0.4, -0.5, 0.5),
        pitch: clamp((yTarget - state.pos.y) * 0.03 - state.verticalSpeed * 0.01, -0.5, 0.5),
        throttleDelta: clamp((57 - state.speed) * 0.03, -1, 1),
      };
    },
    ready(state) { return state.pos.z > RUNWAY.zStart - 300; },
  },
};

export function setupShotMode({ flight, renderer, hud }) {
  const params = new URLSearchParams(window.location.search);
  const name = params.get('shot');
  if (!name || !SCENES[name]) return false;
  const scene = SCENES[name];
  const mission = createMission(scene.kind);
  flight.place(mission.startPose());
  scene.setup(flight, mission);
  renderer.camera.reset(flight.state);

  const ctx = { drop: false, dropped: false };
  let simTime = 0;
  let readyAt = -1;
  const maxSteps = 60 * 45;
  for (let i = 0; i < maxSteps; i += 1) {
    const controls = scene.controls(flight.state, mission, ctx);
    const prevZ = flight.state.pos.z;
    const fevents = flight.step(STEP, controls);
    // The camera must fly the sortie too: update it every step, exactly as
    // the real loop does, or the captures are taken from hundreds of metres
    // behind the aircraft where the reset() left it.
    renderer.camera.update(STEP, flight.state);
    if (ctx.drop) { mission.dropParcel(flight.state); ctx.drop = false; }
    const contact = (fevents & F_GROUND_CONTACT) ? flight.state.lastContact : null;
    mission.step(STEP, flight.state, prevZ, contact);
    simTime += STEP;
    if (readyAt < 0 && scene.ready(flight.state, mission, simTime)) readyAt = simTime;
    if (readyAt > 0 && simTime > readyAt + 0.35) break;
    if (flight.state.crashed) break;
  }

  const view = { flight: flight.state, mission, steer: { bank: flight.state.bank, pitch: 0 }, time: simTime };
  renderer.draw(view, STEP);
  renderer.draw(view, STEP);
  renderer.draw(view, STEP);
  const objective = mission.objective(flight.state);
  // The captures show the HUD as a player sees it mid-sortie: the progress
  // line filled in, and the event banner the last moment earned.
  let progressText = '';
  let shotMessage = null;
  if (scene.kind === MISSION_RINGS) {
    const passedCount = mission.rings.filter((r) => r.state === 'passed').length;
    progressText = `GATES ${passedCount}/${mission.rings.length}`;
    if (passedCount > 0) {
      shotMessage = { text: `GATE ${passedCount} CLEAN`, color: '#7ee787', until: simTime + 2, dur: 2.2 };
    }
  } else if (scene.kind === MISSION_CARGO) {
    progressText = mission.parcel.state === 'carried' ? 'PARCEL ABOARD · SPACE = DROP' : 'PARCEL FALLING…';
    if (mission.parcel.state === 'falling') {
      shotMessage = { text: 'PARCEL AWAY!', color: '#ffb054', until: simTime + 2, dur: 2.2 };
    }
  } else if (scene.kind === MISSION_LANDING) {
    progressText = 'TOUCHDOWN ZONE COUNTS';
  }
  hud.draw({
    screen: 'playing',
    time: simTime,
    flight: flight.state,
    mission,
    camera: renderer.camera,
    score: mission.score,
    combo: mission.combo,
    best: 0,
    bests: {},
    objectiveText: objective.label,
    progressText,
    target: objective,
    message: shotMessage,
    selected: 0,
    circuit: false,
    hasNext: false,
    resultsOk: false,
    resultsTitle: '',
    resultsSub: '',
    resultsLines: [],
    isNewBest: false,
    muted: false,
  });
  window.__shotReady = true;
  return true;
}
