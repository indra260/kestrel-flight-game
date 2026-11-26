// Sky Courier — Valley Circuit: the game loop and the screens around the
// simulation. Owns the fixed-step clock, the title/playing/paused/results
// state machine, the full-circuit mode (three missions on one tank of fuel
// and one hull), best scores in localStorage, and the wiring that turns
// simulation events into score popups, sounds, particles and announcements.
import { BEST_KEY, PALETTE, STEP } from './config.js';
import { clamp } from './random.js';
import { ACTION_CONFIRM, ACTION_DROP, ACTION_MUTE, ACTION_PAUSE, createInput } from './input.js';
import {
  F_CRASH, F_FUEL_EMPTY, F_GROUND_CONTACT, F_OUT_OF_BOUNDS, F_TAKEOFF, createFlight,
} from './flight.js';
import {
  M_COMPLETE, M_PARCEL_DROPPED, M_PARCEL_LANDED, M_RING_CLIPPED, M_RING_MISSED, M_RING_PASSED,
  MISSION_CARGO, MISSION_LANDING, MISSION_LIST, MISSION_RINGS, createMission,
} from './missions.js';
import { createRenderer } from './render.js';
import { createHud } from './hud.js';
import { createAudio } from './audio.js';
import { setupShotMode } from './shots.js';

const canvas = document.getElementById('game');
const statusEl = document.getElementById('status');
const flight = createFlight(PALETTE);
const input = createInput(canvas);
const renderer = createRenderer(canvas);
const hud = createHud(canvas);
const audio = createAudio();

const CIRCUIT_ORDER = [MISSION_RINGS, MISSION_CARGO, MISSION_LANDING];

// ---- Best scores ------------------------------------------------------------
function loadBests() {
  try { return JSON.parse(localStorage.getItem(BEST_KEY) || '{}'); } catch { return {}; }
}
function saveBest(key, scoreValue) {
  const bests = loadBests();
  if (scoreValue > (bests[key] || 0)) { bests[key] = scoreValue; localStorage.setItem(BEST_KEY, JSON.stringify(bests)); return true; }
  return false;
}

// ---- Game state ---------------------------------------------------------------
let screen = 'title';
let mission = null;
let selected = 0;
let circuit = false;
let circuitIndex = 0;
let circuitScore = 0;
let carryAircraft = null; // { fuel, hull } kept between circuit legs
let hasFlown = false;
let resultsOk = false;
let resultsTitle = '';
let resultsSub = '';
let resultsLines = [];
let isNewBest = false;
let message = null;
let time = 0;
let lastOutOfBoundsAt = -99;
let prevPassedCount = 0;

function announce(text) { if (statusEl) statusEl.textContent = text; }
function showMessage(text, color, dur = 2.2) { message = { text, color, until: time + dur, dur }; }

function totalScore() { return circuitScore + (mission ? mission.score : 0); }

// ---- Sorties ------------------------------------------------------------------
function startMission(kind, keepAircraft) {
  mission = createMission(kind);
  flight.place(mission.startPose());
  if (keepAircraft && carryAircraft) {
    flight.state.fuel = carryAircraft.fuel;
    flight.state.hull = carryAircraft.hull;
    if (flight.state.fuel <= 0) flight.state.engineDead = true;
  }
  hasFlown = false;
  prevPassedCount = 0;
  screen = 'playing';
  showMessage(mission.title.toUpperCase(), '#ffb054', 2.4);
  announce(`${mission.title}. ${mission.brief}`);
}

function startSelected() {
  circuit = false;
  circuitScore = 0;
  carryAircraft = null;
  startMission(MISSION_LIST[selected].kind, false);
}

function startCircuit() {
  circuit = true;
  circuitIndex = 0;
  circuitScore = 0;
  carryAircraft = null;
  startMission(CIRCUIT_ORDER[0], false);
  showMessage('FULL CIRCUIT — ONE TANK, ONE HULL', '#ffb054', 2.8);
}

function endMission(ok, title, sub) {
  resultsOk = ok;
  resultsTitle = title;
  resultsSub = sub;
  resultsLines = mission.stats(flight.state).map((l) => [l.label, l.value]);
  if (circuit) {
    resultsLines.push(['Circuit so far', String(circuitScore + mission.score)]);
  }
  isNewBest = false;
  if (ok) {
    isNewBest = saveBest(mission.kind, mission.score) || isNewBest;
    if (circuit && circuitIndex === CIRCUIT_ORDER.length - 1) {
      isNewBest = saveBest('circuit', circuitScore + mission.score) || isNewBest;
    }
    audio.success();
  } else {
    audio.fail();
  }
  screen = 'results';
  announce(`${title}. Score ${totalScore()}.`);
}

function nextCircuitLeg() {
  carryAircraft = { fuel: flight.state.fuel, hull: flight.state.hull };
  circuitScore += mission.score;
  circuitIndex += 1;
  startMission(CIRCUIT_ORDER[circuitIndex], true);
  showMessage(`LEG ${circuitIndex + 1} — ${mission.title.toUpperCase()}`, '#ffb054', 2.6);
}

function toTitle() {
  screen = 'title';
  mission = null;
  circuit = false;
  placeAttractAircraft();
  announce('Sky Courier — Valley Circuit. Choose a mission.');
}

// ---- Title attract flight -------------------------------------------------------
const ATTRACT_WAYPOINTS = [
  { x: 180, z: 1300 }, { x: 180, z: 10800 }, { x: -820, z: 11200 }, { x: -820, z: 1300 },
];
let attractIndex = 1;
function placeAttractAircraft() {
  flight.place({ x: 150, y: 255, z: 1150, heading: 0, speed: 70, throttle: 0.6, onGround: false });
  attractIndex = 1;
}
function attractControls() {
  const target = ATTRACT_WAYPOINTS[attractIndex];
  const dx = target.x - flight.state.pos.x;
  const dz = target.z - flight.state.pos.z;
  if (Math.hypot(dx, dz) < 320) attractIndex = (attractIndex + 1) % ATTRACT_WAYPOINTS.length;
  const wanted = Math.atan2(dx, dz);
  let delta = wanted - flight.state.heading;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  const bank = clamp(delta * 1.1, -0.55, 0.55);
  const pitch = clamp((255 - flight.state.pos.y) * 0.012 - flight.state.verticalSpeed * 0.012, -0.4, 0.4);
  return { bank, pitch, throttleDelta: 0 };
}

// ---- Event wiring ---------------------------------------------------------------
function handleFlightEvents(events) {
  const s = flight.state;
  if (events & F_TAKEOFF) hasFlown = true;
  if (events & F_GROUND_CONTACT) {
    const c = s.lastContact;
    if (c) {
      audio.thud(clamp(c.sink / 6, 0.25, 1.1));
      if (c.onRunway && c.sink <= 2.2) showMessage('SMOOTH TOUCHDOWN', '#7ee787', 1.6);
      else if (c.onRunway && c.sink > 4.4) showMessage('HEAVY LANDING', '#ffb054', 1.8);
      else if (!c.onRunway && !s.crashed) showMessage('OFF THE STRIP!', '#ff6b5e', 1.8);
    }
  }
  if (events & F_FUEL_EMPTY) showMessage('TANK DRY — GLIDE HER IN', '#ff6b5e', 3);
  if ((events & F_OUT_OF_BOUNDS) && time - lastOutOfBoundsAt > 6) {
    lastOutOfBoundsAt = time;
    showMessage('TURN BACK — LEAVING THE VALLEY', '#ffb054', 2.2);
  }
  if (events & F_CRASH) {
    renderer.burst(s.pos, [255, 140, 60], 30, 22, 1.1, 5);
    renderer.burst(s.pos, [70, 70, 74], 22, 12, 1.6, 7);
    const where = s.lastContact ? s.lastContact.surface : 'terrain';
    const reason = s.hull <= 0 ? 'The Kestrel broke apart under the strain.'
      : where === 'sea' || where === 'river' ? 'Down in the water. The valley keeps the parcel.'
        : 'The valley floor came up too fast.';
    endMission(false, 'CRASHED', reason);
  }
}

function handleMissionEvents(events) {
  if (events & M_RING_PASSED) {
    const passed = mission.rings.filter((r) => r.state === 'passed');
    const ring = passed[passed.length - 1];
    if (ring) renderer.burst(ring, [255, 196, 92], 18, 15, 0.8, 4);
    audio.chime(mission.combo);
    prevPassedCount = passed.length;
    showMessage(mission.combo > 1 ? `GATE ${passed.length} — COMBO ×${mission.combo}` : `GATE ${passed.length} CLEAN`, '#7ee787', 1.5);
  }
  if (events & M_RING_CLIPPED) {
    audio.thud(0.7);
    showMessage('CLIPPED THE GATE — HULL DAMAGE', '#ffb054', 2);
    // The message is the truth: clipping a gate frame costs hull, and a
    // Kestrel already held together by hope can come apart on it.
    if (flight.damage(7) && screen === 'playing') {
      renderer.burst(flight.state.pos, [255, 140, 60], 30, 22, 1.1, 5);
      renderer.burst(flight.state.pos, [70, 70, 74], 22, 12, 1.6, 7);
      endMission(false, 'CRASHED', 'One gate frame too many — the Kestrel came apart.');
    }
  }
  if (events & M_RING_MISSED) showMessage('GATE MISSED', '#ff6b5e', 1.6);
  if (events & M_PARCEL_DROPPED) { audio.drop(); showMessage('PARCEL AWAY!', '#ffb054', 1.6); }
  if (events & M_PARCEL_LANDED) {
    const d = Math.round(mission.parcel.scoreDist);
    if (d <= 14) { showMessage('BULLSEYE!', '#7ee787', 2.4); renderer.burst(mission.parcel, [126, 231, 135], 22, 13, 0.9, 4); }
    else if (d <= 40) showMessage(`ON THE FIELD — ${d} m`, '#7ee787', 2.2);
    else if (d <= 90) showMessage(`IN THE VALLEY — ${d} m OFF`, '#ffb054', 2.2);
    else showMessage(`WAY OFF — ${d} m`, '#ff6b5e', 2.2);
  }
  if ((events & M_COMPLETE) && screen === 'playing') {
    endMission(true, mission.kind === MISSION_LANDING ? 'DOWN AND STOPPED' : 'MISSION COMPLETE', mission.endReason || '');
  }
}

// ---- Fixed-step simulation -------------------------------------------------------
function stepPlaying() {
  const steer = input.steer();
  const controls = {
    bank: steer.bank,
    pitch: steer.pitch,
    throttleDelta: input.throttle() * (inputFineThrottle() ? 0.4 : 1),
  };
  const prevZ = flight.state.pos.z;
  const fevents = flight.step(STEP, controls);
  handleFlightEvents(fevents);
  if (screen !== 'playing') return; // a crash ended the mission mid-step
  const contact = (fevents & F_GROUND_CONTACT) ? flight.state.lastContact : null;
  const mevents = mission.step(STEP, flight.state, prevZ, contact);
  handleMissionEvents(mevents);
  // Down and stopped without completing anything: the sortie is over.
  if (screen === 'playing' && hasFlown && flight.state.onGround && flight.state.speed < 2 && !flight.state.crashed) {
    if (mission.kind === MISSION_LANDING) {
      endMission(true, 'DOWN AND STOPPED', mission.endReason || 'Rolled to a stop.');
    } else {
      endMission(false, 'BACK ON THE GROUND', 'Down safe — but the job is not done.');
    }
  }
}

let fineThrottle = false;
function inputFineThrottle() { return fineThrottle; }
window.addEventListener('keydown', (e) => { if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') fineThrottle = true; });
window.addEventListener('keyup', (e) => { if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') fineThrottle = false; });

// ---- UI keys that are not flight controls -----------------------------------------
window.addEventListener('keydown', (e) => {
  audio.start();
  if (screen === 'title') {
    if (e.code === 'Digit1') { selected = 0; audio.click(); }
    if (e.code === 'Digit2') { selected = 1; audio.click(); }
    if (e.code === 'Digit3') { selected = 2; audio.click(); }
    if (e.code === 'KeyC') startCircuit();
  } else if (screen === 'paused') {
    if (e.code === 'KeyR') startMission(mission.kind, false);
    if (e.code === 'KeyT') toTitle();
  } else if (screen === 'results') {
    if (e.code === 'KeyT') toTitle();
    if (e.code === 'KeyR') {
      if (circuit && resultsOk && circuitIndex < CIRCUIT_ORDER.length - 1) nextCircuitLeg();
      else if (circuit) { startCircuit(); } else startMission(mission.kind, false);
    }
  }
});

// ---- Actions (confirm / pause / drop / mute) ---------------------------------------
function handleActions() {
  const actions = input.takeActions();
  if (actions & ACTION_MUTE) { audio.start(); audio.toggleMute(); }
  if (screen === 'title') {
    if (actions & ACTION_CONFIRM) { audio.start(); startSelected(); }
    // Left/right on the title walks the mission cards.
    const steer = input.steer();
    if (steer.bank < -0.6 && !titleSteerHeld) { selected = (selected + MISSION_LIST.length - 1) % MISSION_LIST.length; titleSteerHeld = true; audio.click(); }
    else if (steer.bank > 0.6 && !titleSteerHeld) { selected = (selected + 1) % MISSION_LIST.length; titleSteerHeld = true; audio.click(); }
    else if (Math.abs(steer.bank) < 0.25) titleSteerHeld = false;
    return;
  }
  if (screen === 'playing') {
    if (actions & ACTION_PAUSE) { screen = 'paused'; announce('Paused.'); return; }
    if ((actions & ACTION_DROP) && mission.kind === MISSION_CARGO) {
      handleMissionEvents(mission.dropParcel(flight.state));
    }
    return;
  }
  if (screen === 'paused') {
    if ((actions & ACTION_PAUSE) || (actions & ACTION_CONFIRM)) { screen = 'playing'; announce('Flying.'); }
    return;
  }
  if (screen === 'results') {
    if (actions & ACTION_CONFIRM) {
      if (circuit && resultsOk && circuitIndex < CIRCUIT_ORDER.length - 1) nextCircuitLeg();
      else if (circuit && !resultsOk) startCircuit();
      else if (circuit) startCircuit();
      else startMission(mission.kind, false);
    }
  }
}
let titleSteerHeld = false;

// ---- Frame loop -----------------------------------------------------------------------
let lastStamp = null;
let accumulator = 0;
function frame(stamp) {
  requestAnimationFrame(frame);
  if (lastStamp === null) lastStamp = stamp;
  let dt = Math.min(0.1, (stamp - lastStamp) / 1000);
  lastStamp = stamp;
  time += dt;
  handleActions();
  accumulator += dt;
  while (accumulator >= STEP) {
    accumulator -= STEP;
    if (screen === 'playing') stepPlaying();
    else if (screen === 'title') flight.step(STEP, attractControls());
  }
  const steerNow = screen === 'playing' ? input.steer() : { bank: 0, pitch: 0 };
  renderer.draw({ flight: flight.state, mission: screen === 'title' ? null : mission, steer: steerNow, time }, dt);
  const objective = mission && screen !== 'title' ? mission.objective(flight.state) : null;
  hud.draw({
    screen,
    time,
    flight: flight.state,
    mission: screen === 'title' ? null : mission,
    camera: renderer.camera,
    score: totalScore(),
    combo: mission ? mission.combo : 0,
    best: mission ? (loadBests()[mission.kind] || 0) : 0,
    bests: loadBests(),
    objectiveText: objective ? objective.label : '',
    progressText: progressText(),
    target: objective,
    message,
    selected,
    circuit,
    hasNext: circuitIndex < CIRCUIT_ORDER.length - 1,
    resultsOk,
    resultsTitle,
    resultsSub,
    resultsLines,
    isNewBest,
    muted: audio.muted,
  });
  audio.update(screen === 'playing' || screen === 'paused' ? flight.state : null, time);
}

function progressText() {
  if (!mission) return '';
  if (mission.kind === MISSION_RINGS) {
    const passed = mission.rings.filter((r) => r.state === 'passed').length;
    const missed = mission.rings.filter((r) => r.state === 'missed').length;
    return `GATES ${passed}/${mission.rings.length}${missed ? ` · ${missed} MISSED` : ''}`;
  }
  if (mission.kind === MISSION_CARGO) {
    if (mission.parcel.state === 'carried') return 'PARCEL ABOARD — SPACE TO DROP';
    if (mission.parcel.state === 'falling') return 'PARCEL FALLING…';
    return 'PARCEL DOWN — HEAD HOME';
  }
  return 'TOUCHDOWN ZONE COUNTS';
}

// Shot mode replaces the interactive loop entirely when ?shot= is present.
if (!setupShotMode({ canvas, flight, renderer, hud, input })) {
  placeAttractAircraft();
  announce('Sky Courier — Valley Circuit. Choose a mission.');
  requestAnimationFrame(frame);
}
