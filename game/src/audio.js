// All sound is synthesised with WebAudio — an engine hum that follows the
// throttle, wind that follows the speed, a stall beeper, and small jingles
// for gates, parcels and landings. No audio files, nothing to load. The
// context starts on the first user gesture, as browsers require.
export function createAudio() {
  let ac = null;
  let master = null;
  let engineOscA = null;
  let engineOscB = null;
  let engineGain = null;
  let engineFilter = null;
  let windGain = null;
  let windFilter = null;
  let beeper = null;
  let beeperGain = null;
  let muted = false;

  function start() {
    if (ac) { if (ac.state === 'suspended') ac.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ac = new AC();
    master = ac.createGain();
    master.gain.value = muted ? 0 : 0.9;
    master.connect(ac.destination);

    // Engine: two detuned oscillators through a low-pass, gain by throttle.
    engineOscA = ac.createOscillator(); engineOscA.type = 'sawtooth';
    engineOscB = ac.createOscillator(); engineOscB.type = 'square';
    engineFilter = ac.createBiquadFilter(); engineFilter.type = 'lowpass'; engineFilter.frequency.value = 420;
    engineGain = ac.createGain(); engineGain.gain.value = 0;
    engineOscA.connect(engineFilter); engineOscB.connect(engineFilter);
    engineFilter.connect(engineGain); engineGain.connect(master);
    engineOscA.start(); engineOscB.start();

    // Wind: looped noise through a band-pass, gain and pitch by speed.
    const noiseLength = ac.sampleRate * 1.5;
    const noiseBuffer = ac.createBuffer(1, noiseLength, ac.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < noiseLength; i += 1) data[i] = Math.random() * 2 - 1;
    const noise = ac.createBufferSource(); noise.buffer = noiseBuffer; noise.loop = true;
    windFilter = ac.createBiquadFilter(); windFilter.type = 'bandpass'; windFilter.frequency.value = 500; windFilter.Q.value = 0.7;
    windGain = ac.createGain(); windGain.gain.value = 0;
    noise.connect(windFilter); windFilter.connect(windGain); windGain.connect(master);
    noise.start();

    // Stall beeper.
    beeper = ac.createOscillator(); beeper.type = 'square'; beeper.frequency.value = 840;
    beeperGain = ac.createGain(); beeperGain.gain.value = 0;
    beeper.connect(beeperGain); beeperGain.connect(master);
    beeper.start();
  }

  function tone(freqA, freqB, dur, type = 'sine', gainPeak = 0.16, delay = 0) {
    if (!ac) return;
    const t0 = ac.currentTime + delay;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freqA, t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(30, freqB), t0 + dur);
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(gainPeak, t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(gain); gain.connect(master);
    osc.start(t0); osc.stop(t0 + dur + 0.05);
  }

  function noiseBurst(dur, filterFreq, gainPeak, delay = 0) {
    if (!ac) return;
    const t0 = ac.currentTime + delay;
    const length = Math.max(1, Math.floor(ac.sampleRate * dur));
    const buffer = ac.createBuffer(1, length, ac.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
    const src = ac.createBufferSource(); src.buffer = buffer;
    const filter = ac.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = filterFreq;
    const gain = ac.createGain(); gain.gain.value = gainPeak;
    src.connect(filter); filter.connect(gain); gain.connect(master);
    src.start(t0);
  }

  return {
    start,
    get muted() { return muted; },
    toggleMute() {
      muted = !muted;
      if (master && ac) master.gain.setTargetAtTime(muted ? 0 : 0.9, ac.currentTime, 0.03);
      return muted;
    },
    /** Per-frame: engine and wind follow the aircraft; the beeper follows the stall warning. */
    update(flight, time) {
      if (!ac) return;
      const t = ac.currentTime;
      if (!flight) {
        engineGain.gain.setTargetAtTime(0, t, 0.1);
        windGain.gain.setTargetAtTime(0, t, 0.1);
        beeperGain.gain.setTargetAtTime(0, t, 0.03);
        return;
      }
      const running = !flight.crashed;
      const engineTarget = running ? 0.028 + flight.throttle * 0.075 : 0;
      engineGain.gain.setTargetAtTime(engineTarget, t, 0.09);
      const rpm = 42 + flight.throttle * 46 + flight.speed * 0.12;
      engineOscA.frequency.setTargetAtTime(rpm, t, 0.06);
      engineOscB.frequency.setTargetAtTime(rpm * 0.5 + 3, t, 0.06);
      engineFilter.frequency.setTargetAtTime(300 + flight.throttle * 520, t, 0.1);
      const windTarget = flight.airborne ? Math.min(0.11, Math.max(0, (flight.speed - 25) / 480)) : 0;
      windGain.gain.setTargetAtTime(windTarget, t, 0.12);
      windFilter.frequency.setTargetAtTime(340 + flight.speed * 6.5, t, 0.12);
      const beepOn = flight.warnings.stall && flight.airborne && Math.sin(time * 21) > -0.1;
      beeperGain.gain.setTargetAtTime(beepOn ? 0.035 : 0, t, 0.02);
    },
    click() { tone(1250, 900, 0.05, 'square', 0.05); },
    chime(combo = 1) {
      const base = 660 * Math.pow(1.059, Math.min(combo - 1, 8));
      tone(base, base, 0.14, 'sine', 0.15);
      tone(base * 1.5, base * 1.5, 0.2, 'sine', 0.13, 0.07);
    },
    drop() { tone(880, 240, 0.28, 'sine', 0.07); noiseBurst(0.22, 900, 0.05); },
    success() {
      [523, 659, 784, 1046].forEach((f, i) => tone(f, f, 0.22, 'triangle', 0.14, i * 0.09));
    },
    fail() { tone(220, 62, 0.55, 'sawtooth', 0.12); noiseBurst(0.3, 300, 0.1, 0.05); },
    thud(strength = 1) {
      tone(95, 38, 0.22, 'sine', 0.22 * Math.min(1, strength));
      noiseBurst(0.16, 240, 0.16 * Math.min(1, strength));
    },
    bounce() { tone(300, 180, 0.1, 'sine', 0.08); },
  };
}
