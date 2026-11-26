// The aircraft and how it flies: a small arcade flight model with real
// discipline in it — throttle against drag and gravity, coordinated turns
// from bank, a stall that drops the nose when the wing is starved of speed,
// fuel that burns faster at full throttle and in the climb, and ground
// contact that is gentle on the runway and unforgiving everywhere else.
// Pure simulation: no drawing, no browser. step() returns what happened as
// bit flags so the caller can score it, sound it and show it.
import { AIRCRAFT, RUNWAY, WORLD } from './config.js';
import { angleDelta, clamp } from './random.js';
import { SURFACE, surfaceAt, terrainHeight } from './terrain.js';

export const F_CRASH = 1;
export const F_GROUND_CONTACT = 2;
export const F_TAKEOFF = 4;
export const F_OUT_OF_BOUNDS = 8;
export const F_FUEL_EMPTY = 16;

const GEAR_HEIGHT = 2.2; // metres from the aircraft origin to its wheels
const GRAVITY = 9.81;

export function createFlight(palette) {
  const state = {
    pos: { x: 0, y: 200, z: 0 },
    heading: 0, pitch: 0, bank: 0,
    speed: AIRCRAFT.startSpeed, throttle: 0.62,
    verticalSpeed: 0, fuel: AIRCRAFT.fuelCapacity, hull: AIRCRAFT.hull,
    airborne: true, onGround: false, crashed: false,
    propPhase: 0, elapsed: 0,
    engineDead: false,
    lastContact: null, // { onRunway, sink, speed, surface, x, z } at the latest touchdown
    warnings: { stall: false, lowFuel: false, pullUp: false, engineOut: false },
  };

  /** Place the aircraft for a sortie: airborne at a spot, or on the runway. */
  function place({ x, y, z, heading = 0, speed = AIRCRAFT.startSpeed, throttle = 0.62, onGround = false }) {
    state.pos.x = x; state.pos.y = y; state.pos.z = z;
    state.heading = heading; state.pitch = 0; state.bank = 0;
    state.speed = speed; state.throttle = throttle;
    state.verticalSpeed = 0;
    state.fuel = AIRCRAFT.fuelCapacity; state.hull = AIRCRAFT.hull;
    state.airborne = !onGround; state.onGround = onGround; state.crashed = false;
    state.elapsed = 0; state.engineDead = false; state.lastContact = null;
  }

  function damage(amount) {
    state.hull = Math.max(0, state.hull - amount);
    if (state.hull <= 0 && !state.crashed) {
      state.crashed = true;
      return true;
    }
    return false;
  }

  function onRunwayStrip(x, z) {
    return Math.abs(x - RUNWAY.x) <= RUNWAY.width / 2
      && z >= RUNWAY.zStart && z <= RUNWAY.zEnd;
  }

  /**
   * One fixed step. `controls` is { bank, pitch, throttleDelta }, each -1..1,
   * from input.js (or the screenshot autopilot).
   */
  function step(dt, controls) {
    let events = 0;
    if (state.crashed) return events;
    state.elapsed += dt;

    // Throttle and engine.
    if (!state.engineDead) {
      state.throttle = clamp(state.throttle + controls.throttleDelta * AIRCRAFT.throttleRate * dt, 0, 1);
    } else {
      state.throttle = Math.max(0, state.throttle - dt * 0.8);
    }

    // Attitude: bank and pitch ease toward what the pilot steers.
    const targetBank = controls.bank * AIRCRAFT.maxBank;
    state.bank += clamp(targetBank - state.bank, -AIRCRAFT.bankRate * dt, AIRCRAFT.bankRate * dt);
    const authority = clamp(state.speed / AIRCRAFT.stallSpeed, 0.25, 1);
    let targetPitch = controls.pitch * (controls.pitch >= 0 ? AIRCRAFT.maxPitchUp : -AIRCRAFT.maxPitchDown);
    if (state.speed < AIRCRAFT.stallSpeed && state.airborne) {
      // Starved of speed, the nose falls away no matter what the pilot asks.
      targetPitch = Math.min(targetPitch, -0.12 - (AIRCRAFT.stallSpeed - state.speed) * 0.012);
    }
    state.pitch += clamp((targetPitch - state.pitch) * authority, -AIRCRAFT.pitchRate * dt, AIRCRAFT.pitchRate * dt);

    // Coordinated turn: heading rate from bank and speed, the real relation.
    if (state.airborne) {
      state.heading += (GRAVITY * 2.1 * Math.tan(state.bank)) / Math.max(state.speed, 24) * dt;
    } else if (state.onGround) {
      state.heading += controls.bank * 0.5 * clamp(state.speed / 30, 0, 1) * dt;
    }

    // Speed: thrust against drag, and gravity along the flight path.
    const thrustAccel = state.throttle * 15.5;
    const drag = AIRCRAFT.dragBase * state.speed * state.speed + 1.1;
    const slopeAccel = -GRAVITY * Math.sin(state.pitch) * 0.92;
    state.speed = clamp(state.speed + (thrustAccel - drag + slopeAccel) * dt, 0, AIRCRAFT.maxSpeed * 1.3);
    if (state.onGround) {
      // Rolling friction, and real brakes when the throttle is shut.
      state.speed = Math.max(0, state.speed - (state.throttle < 0.05 ? 5.5 : 0.7) * dt);
    }

    // Velocity from attitude, plus the stall's extra sink.
    const cosPitch = Math.cos(state.pitch);
    let vy = Math.sin(state.pitch) * state.speed;
    if (state.airborne && state.speed < AIRCRAFT.stallSpeed) {
      vy -= (AIRCRAFT.stallSpeed - state.speed) * 0.34;
    }
    state.verticalSpeed = vy;
    const vx = Math.sin(state.heading) * cosPitch * state.speed;
    const vz = Math.cos(state.heading) * cosPitch * state.speed;
    const prevY = state.pos.y;
    state.pos.x += vx * dt;
    state.pos.y += vy * dt;
    state.pos.z += vz * dt;

    // Fuel: cruise burn grows with throttle, and climbing hard burns more.
    if (state.airborne || state.speed > 4) {
      let burn = AIRCRAFT.fuelBurnCruise * (0.3 + state.throttle * 0.95);
      if (vy > 5) burn += AIRCRAFT.fuelBurnClimb * (vy / 16);
      state.fuel -= burn * dt;
      if (state.fuel <= 0 && !state.engineDead) {
        state.fuel = 0;
        state.engineDead = true;
        events |= F_FUEL_EMPTY;
      }
    }
    state.propPhase += dt * (4 + state.throttle * 30 + state.speed * 0.12);

    // The ground, and what meeting it means.
    const ground = terrainHeight(state.pos.x, state.pos.z);
    const wheelY = state.pos.y - GEAR_HEIGHT;
    if (wheelY <= ground) {
      const sink = state.verticalSpeed;
      const wasAirborne = state.airborne;
      state.pos.y = ground + GEAR_HEIGHT;
      state.verticalSpeed = 0;
      const surface = surfaceAt(state.pos.x, state.pos.z, palette).kind;
      const strip = onRunwayStrip(state.pos.x, state.pos.z);
      if (wasAirborne) {
        state.lastContact = { onRunway: strip, sink, speed: state.speed, surface, x: state.pos.x, z: state.pos.z };
        events |= F_GROUND_CONTACT;
        const hardCrash = sink < -8.5
          || surface === SURFACE.WATER_SEA || surface === SURFACE.WATER_RIVER
          || (!strip && (sink < -4.2 || state.speed > 74))
          || (strip && Math.abs(angleDelta(state.heading, 0)) > 0.5 && state.speed > 40);
        if (hardCrash) {
          state.crashed = true;
          state.hull = 0;
          events |= F_CRASH;
          return events;
        }
        if (sink < -4.2 || (!strip && state.speed > 46)) {
          if (damage(strip ? 10 : 22)) { events |= F_CRASH; return events; }
        }
        state.airborne = false;
        state.onGround = true;
      }
      // Rolling: the ground carries the aircraft, and a held-back stick
      // rotates it off again once there is speed for the wing.
      if (state.onGround) {
        state.pitch = Math.max(0, state.pitch) * 0.92;
        if (state.speed > AIRCRAFT.stallSpeed + 9 && state.pitch > 0.06 && state.throttle > 0.3) {
          state.airborne = true;
          state.onGround = false;
          state.pos.y += 0.5;
          events |= F_TAKEOFF;
        }
        if (state.speed < 0.4 && state.throttle < 0.05) state.speed = 0;
      }
    } else if (state.onGround && wheelY > ground + 0.6) {
      state.onGround = false;
      state.airborne = true;
    }
    if (prevY === state.pos.y && state.onGround) state.verticalSpeed = 0;

    // Leaving the valley ends the sortie.
    if (state.pos.z > WORLD.courseLength + 900 || state.pos.z < -700
      || Math.abs(state.pos.x) > 3400 || state.pos.y > 1100) {
      events |= F_OUT_OF_BOUNDS;
    }

    // Warnings the HUD and the sound board both read.
    const heightAboveGround = state.pos.y - terrainHeight(state.pos.x, state.pos.z);
    state.warnings.stall = state.airborne && state.speed < AIRCRAFT.stallSpeed + 2;
    state.warnings.lowFuel = state.fuel < 22 && !state.engineDead;
    state.warnings.engineOut = state.engineDead;
    state.warnings.pullUp = state.airborne && heightAboveGround < 55 && state.verticalSpeed < -6;
    return events;
  }

  return { state, place, step, damage, onRunwayStrip };
}
