// The three sorties, their goals and their scoring. Each mission is a small
// state machine the main loop steps beside the flight model: it watches the
// aircraft, moves its own pieces (the parcel), and reports what happened as
// bit flags. Ring Run starts on the runway and threads eight gates down the
// valley; Cargo Drop carries one parcel to a painted target on the meadow;
// Landing Challenge is flown as a final approach and graded at touchdown.
import { AIRCRAFT, CARGO_FIELD, RUNWAY, SCORING } from './config.js';
import { angleDelta, clamp } from './random.js';
import { riverCenterX, terrainHeight } from './terrain.js';

export const M_RING_PASSED = 1;
export const M_RING_MISSED = 2;
export const M_RING_CLIPPED = 4;
export const M_PARCEL_DROPPED = 8;
export const M_PARCEL_LANDED = 16;
export const M_COMPLETE = 32;

export const MISSION_RINGS = 'rings';
export const MISSION_CARGO = 'cargo';
export const MISSION_LANDING = 'landing';

export const MISSION_LIST = [
  {
    kind: MISSION_RINGS,
    title: 'Ring Run',
    brief: 'Take off from the valley airfield and thread all eight gates down the valley. Clean gates in a row build your combo.',
  },
  {
    kind: MISSION_CARGO,
    title: 'Cargo Drop',
    brief: 'One parcel for the meadow camp west of the river. Fly the marked field, judge the wind, and drop with Space — closest to the centre wins.',
  },
  {
    kind: MISSION_LANDING,
    title: 'Landing Challenge',
    brief: 'You are on final for the valley airfield. Touch down in the marked zone, gentle, slow and straight, then roll to a stop.',
  },
];

// The ring course: each gate hangs over a recognisable piece of the valley —
// the river bends, the village, the cargo meadow, the turbine ridge, the coast.
function buildRings() {
  const gates = [
    { x: 120, z: 2900 }, { x: -260, z: 3900 }, { x: riverCenterX(4900), z: 4900 },
    { x: -480, z: 5900 }, { x: 240, z: 7000 }, { x: -650, z: 8300 },
    { x: -180, z: 9600 }, { x: 420, z: 10800 },
  ];
  return gates.map((g, i) => ({
    x: g.x, z: g.z,
    y: terrainHeight(g.x, g.z) + 95 + (i % 3) * 22,
    radius: 27, state: 'waiting', // waiting | next | passed | missed
  }));
}

export function createMission(kind) {
  const isRings = kind === MISSION_RINGS;
  const isCargo = kind === MISSION_CARGO;
  const rings = isRings ? buildRings() : [];
  let ringIndex = 0;
  let combo = 0;
  let bestCombo = 0;
  let score = 0;
  let done = false;
  let endReason = '';
  // Cargo parcel: carried, falling (with a parachute), or down.
  const parcel = { state: 'carried', x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, age: 0, scoreDist: -1 };
  // Landing: the grade is decided at the touchdown the flight model reports.
  let touchdownGrade = null;

  function startPose() {
    if (isRings) {
      return { x: RUNWAY.x, y: RUNWAY.altitude + 2.2, z: RUNWAY.zStart + 40, heading: 0, speed: 0, throttle: 0, onGround: true };
    }
    if (isCargo) {
      return { x: -80, y: 330, z: 4300, heading: 0, speed: 68, throttle: 0.62, onGround: false };
    }
    return { x: RUNWAY.x, y: 140, z: RUNWAY.zStart - 1500, heading: 0, speed: 60, throttle: 0.34, onGround: false };
  }

  /** The world position the HUD arrow and the camera should care about. */
  function objective(flight) {
    if (isRings) {
      const ring = rings[ringIndex];
      if (ring) return { x: ring.x, y: ring.y, z: ring.z, label: `GATE ${ringIndex + 1}/${rings.length}` };
      return { x: RUNWAY.x, y: RUNWAY.altitude, z: RUNWAY.zStart + 300, label: 'RETURN TO BASE' };
    }
    if (isCargo) {
      if (parcel.state === 'carried') return { x: CARGO_FIELD.x, y: CARGO_FIELD.altitude + 4, z: CARGO_FIELD.z, label: 'DROP ZONE' };
      if (parcel.state === 'falling') return { x: parcel.x, y: parcel.y, z: parcel.z, label: 'PARCEL AWAY' };
      return { x: RUNWAY.x, y: RUNWAY.altitude, z: RUNWAY.zStart + 300, label: 'RETURN TO BASE' };
    }
    return { x: RUNWAY.x, y: RUNWAY.altitude, z: (RUNWAY.touchdownStart + RUNWAY.touchdownEnd) / 2, label: 'RUNWAY 36' };
  }

  function dropParcel(flight) {
    if (!isCargo || parcel.state !== 'carried' || !flight.airborne) return 0;
    parcel.state = 'falling';
    parcel.x = flight.pos.x; parcel.y = flight.pos.y - 3; parcel.z = flight.pos.z;
    parcel.vx = Math.sin(flight.heading) * flight.speed;
    parcel.vz = Math.cos(flight.heading) * flight.speed;
    parcel.vy = flight.verticalSpeed;
    parcel.age = 0;
    return M_PARCEL_DROPPED;
  }

  function stepRings(dt, flight, prevZ) {
    let events = 0;
    const ring = rings[ringIndex];
    if (!ring) return events;
    ring.state = 'next';
    if (prevZ < ring.z && flight.pos.z >= ring.z) {
      const radial = Math.hypot(flight.pos.x - ring.x, flight.pos.y - ring.y);
      if (radial <= ring.radius - 5) {
        ring.state = 'passed';
        combo += 1;
        bestCombo = Math.max(bestCombo, combo);
        score += SCORING.ringPoints + Math.min(SCORING.ringTimeBonusMax, combo * 25);
        events |= M_RING_PASSED;
      } else if (radial <= ring.radius + 6) {
        ring.state = 'passed';
        combo = 0;
        events |= M_RING_CLIPPED;
      } else {
        ring.state = 'missed';
        combo = 0;
        events |= M_RING_MISSED;
      }
      ringIndex += 1;
      if (ringIndex >= rings.length && !done) {
        done = true;
        endReason = 'All gates flown';
        events |= M_COMPLETE;
      }
    }
    return events;
  }

  function stepCargo(dt, flight) {
    let events = 0;
    if (parcel.state !== 'falling') return events;
    parcel.age += dt;
    // Wind pushes the parcel east as it falls; the canopy caps its descent.
    parcel.vx += (3.5 - parcel.vx) * dt * 0.7;
    parcel.vz += (0 - parcel.vz) * dt * 0.25;
    parcel.vy = Math.max(parcel.vy - 22 * dt, parcel.age > 1.1 ? -8.5 : -46);
    parcel.x += parcel.vx * dt;
    parcel.y += parcel.vy * dt;
    parcel.z += parcel.vz * dt;
    const ground = terrainHeight(parcel.x, parcel.z);
    if (parcel.y <= ground + 1) {
      parcel.y = ground + 1;
      parcel.state = 'down';
      parcel.scoreDist = Math.hypot(parcel.x - CARGO_FIELD.x, parcel.z - CARGO_FIELD.z);
      score += Math.max(60, SCORING.cargoBullseye - Math.floor(parcel.scoreDist) * SCORING.cargoPerMetre);
      events |= M_PARCEL_LANDED;
      done = true;
      endReason = parcel.scoreDist <= 14 ? 'Bullseye drop' : `Down ${Math.round(parcel.scoreDist)} m from the centre`;
      events |= M_COMPLETE;
    }
    return events;
  }

  function gradeTouchdown(contact, flight) {
    const inZone = contact.z >= RUNWAY.touchdownStart && contact.z <= RUNWAY.touchdownEnd;
    const centred = Math.abs(contact.x - RUNWAY.x) <= 11;
    const straight = Math.abs(angleDelta(flight.heading, 0)) <= 0.11;
    const sink = Math.abs(contact.sink);
    if (inZone && centred && straight && sink <= 2.6 && contact.speed <= 56) {
      return { label: 'PERFECT', points: SCORING.landingPerfect };
    }
    if (contact.onRunway && sink <= 4.2 && contact.speed <= 66) {
      return { label: 'GOOD', points: SCORING.landingGood };
    }
    if (contact.onRunway) return { label: 'FIRM', points: SCORING.landingFirm };
    return { label: 'OFF FIELD', points: 60 };
  }

  /**
   * One fixed step beside the flight model. `contact` is the flight model's
   * lastContact on the step it touched down, else null.
   */
  function step(dt, flight, prevZ, contact) {
    let events = 0;
    if (isRings) events |= stepRings(dt, flight, prevZ);
    if (isCargo) events |= stepCargo(dt, flight);
    if (kind === MISSION_LANDING && contact && !touchdownGrade) {
      touchdownGrade = gradeTouchdown(contact, flight);
      score += touchdownGrade.points;
    }
    if (kind === MISSION_LANDING && touchdownGrade && flight.onGround && flight.speed < 3 && !done) {
      done = true;
      endReason = `${touchdownGrade.label} touchdown`;
      events |= M_COMPLETE;
    }
    return events;
  }

  function stats(flight) {
    const lines = [
      { label: 'Score', value: String(score) },
      { label: 'Time', value: `${flight.elapsed.toFixed(1)} s` },
      { label: 'Fuel left', value: `${Math.max(0, Math.round(flight.fuel))}%` },
      { label: 'Hull', value: `${Math.round(flight.hull)}%` },
    ];
    if (isRings) lines.splice(1, 0, { label: 'Gates', value: `${rings.filter((r) => r.state === 'passed').length}/${rings.length}` }, { label: 'Best combo', value: `x${bestCombo}` });
    if (isCargo && parcel.scoreDist >= 0) lines.splice(1, 0, { label: 'Drop accuracy', value: `${Math.round(parcel.scoreDist)} m` });
    if (kind === MISSION_LANDING && touchdownGrade) lines.splice(1, 0, { label: 'Touchdown', value: touchdownGrade.label });
    return lines;
  }

  return {
    kind,
    title: MISSION_LIST.find((m) => m.kind === kind).title,
    brief: MISSION_LIST.find((m) => m.kind === kind).brief,
    rings, parcel,
    get score() { return score; },
    get done() { return done; },
    get endReason() { return endReason; },
    get combo() { return combo; },
    startPose, objective, dropParcel, step, stats,
  };
}
