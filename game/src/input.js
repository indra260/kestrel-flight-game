// Keyboard and mouse input for the flight model. Held keys and the pointer
// give continuous steering (bank and pitch) and throttle; one-shot presses
// (confirm, pause, drop, mute) are queued as bit flags and taken once by the
// loop, so a press between two frames is never lost or counted twice.
import { clamp } from './random.js';

export const ACTION_CONFIRM = 1;
export const ACTION_PAUSE = 2;
export const ACTION_DROP = 4;
export const ACTION_MUTE = 8;

const BANK_LEFT = new Set(['ArrowLeft', 'KeyA']);
const BANK_RIGHT = new Set(['ArrowRight', 'KeyD']);
const PITCH_UP = new Set(['ArrowUp']);
const PITCH_DOWN = new Set(['ArrowDown']);
const CONFIRM = new Set(['Space', 'Enter']);
const PAUSE = new Set(['KeyP', 'Escape']);
const MUTE = new Set(['KeyM']);

export function createInput(canvas) {
  const held = new Set();
  let actions = 0;
  let pointerX = 0.5;
  let pointerY = 0.5;
  let pointerSeenAt = -Infinity;

  window.addEventListener('keydown', (event) => {
    if (BANK_LEFT.has(event.code) || BANK_RIGHT.has(event.code)
      || PITCH_UP.has(event.code) || PITCH_DOWN.has(event.code)
      || CONFIRM.has(event.code)) {
      event.preventDefault();
    }
    if (event.repeat) return;
    held.add(event.code);
    if (CONFIRM.has(event.code)) actions |= ACTION_CONFIRM | ACTION_DROP;
    else if (PAUSE.has(event.code)) actions |= ACTION_PAUSE;
    else if (MUTE.has(event.code)) actions |= ACTION_MUTE;
  });
  window.addEventListener('keyup', (event) => held.delete(event.code));
  // A key released while the tab is hidden never sends keyup: let go of everything on blur.
  window.addEventListener('blur', () => held.clear());

  canvas.addEventListener('pointermove', (event) => {
    const rect = canvas.getBoundingClientRect();
    pointerX = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    pointerY = clamp((event.clientY - rect.top) / rect.height, 0, 1);
    pointerSeenAt = performance.now();
  });
  canvas.addEventListener('pointerdown', () => { actions |= ACTION_CONFIRM; });

  const anyHeld = (set) => {
    for (const code of set) if (held.has(code)) return true;
    return false;
  };

  return {
    /**
     * Continuous steering, each axis -1..1. Arrow/A/D keys win while held;
     * otherwise the pointer steers: left/right of centre banks, above centre
     * climbs. (W/S are the throttle, so pitch-up on the keyboard is ArrowUp.)
     */
    steer() {
      let bank = 0;
      let pitch = 0;
      if (anyHeld(BANK_LEFT)) bank -= 1;
      if (anyHeld(BANK_RIGHT)) bank += 1;
      if (anyHeld(PITCH_UP)) pitch += 1;
      if (anyHeld(PITCH_DOWN)) pitch -= 1;
      if (bank === 0 && pitch === 0 && performance.now() - pointerSeenAt < 4000) {
        bank = clamp((pointerX - 0.5) * 2.2, -1, 1);
        pitch = clamp((0.5 - pointerY) * 2.2, -1, 1);
        if (Math.abs(bank) < 0.08) bank = 0;
        if (Math.abs(pitch) < 0.08) pitch = 0;
      }
      return { bank: clamp(bank, -1, 1), pitch: clamp(pitch, -1, 1) };
    },
    /** Throttle travel: +1 while W is held, -1 while S is held. */
    throttle() {
      return (held.has('KeyW') ? 1 : 0) - (held.has('KeyS') ? 1 : 0);
    },
    /** The one-shot presses since the last call, as ACTION_* flags. */
    takeActions() {
      const taken = actions;
      actions = 0;
      return taken;
    },
  };
}
