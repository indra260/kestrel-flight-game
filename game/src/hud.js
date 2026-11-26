// The instrument panel and screens: altitude, speed and heading readouts, a
// compass strip, an artificial horizon, throttle/fuel/hull gauges, the
// objective arrow, warning captions — and the title, pause and results
// screens that make the game a game. Pure canvas, drawn over the render.
import { PALETTE, VIEW } from './config.js';
import { clamp } from './random.js';
import { MISSION_LIST } from './missions.js';
import { terrainHeight } from './terrain.js';

const INK = 'rgba(232, 242, 248, 0.96)';
const DIM = 'rgba(178, 198, 212, 0.85)';
const PANEL = 'rgba(9, 15, 22, 0.58)';
const EDGE = 'rgba(255, 255, 255, 0.16)';
const ACCENT = '#ffb054';
const GOOD = '#7ee787';
const BAD = '#ff6b5e';

function panel(ctx, x, y, w, h, r = 12) {
  ctx.fillStyle = PANEL;
  ctx.strokeStyle = EDGE;
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.fill(); ctx.stroke();
}
function label(ctx, text, x, y, size = 11, color = DIM, align = 'left', weight = 700) {
  ctx.fillStyle = color;
  ctx.font = `${weight} ${size}px "Segoe UI", system-ui, sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(text, x, y);
}
function value(ctx, text, x, y, size = 30, color = INK, align = 'left') {
  ctx.fillStyle = color;
  ctx.font = `800 ${size}px "Segoe UI", system-ui, sans-serif`;
  ctx.textAlign = align;
  ctx.fillText(text, x, y);
}
function wrapText(ctx, text, maxWidth) {
  const words = text.split(' ');
  const lines = [];
  let line = '';
  for (const word of words) {
    const trial = line ? `${line} ${word}` : word;
    if (ctx.measureText(trial).width > maxWidth && line) { lines.push(line); line = word; }
    else line = trial;
  }
  if (line) lines.push(line);
  return lines;
}

function drawCompass(ctx, headingDeg) {
  const cx = VIEW.width / 2;
  panel(ctx, cx - 190, 14, 380, 46, 10);
  ctx.save();
  ctx.beginPath(); ctx.rect(cx - 182, 18, 364, 38); ctx.clip();
  for (let off = -60; off <= 60; off += 5) {
    let deg = Math.round((headingDeg + off) / 5) * 5 % 360;
    if (deg < 0) deg += 360;
    const x = cx + off * 3.1;
    const major = deg % 30 === 0;
    ctx.strokeStyle = major ? 'rgba(255,255,255,0.75)' : 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, 52); ctx.lineTo(x, major ? 42 : 47); ctx.stroke();
    if (major) {
      const names = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' };
      const text = names[deg] ?? String(deg / 10).padStart(2, '0');
      label(ctx, text, x, 36, 12, deg === 0 ? ACCENT : INK, 'center');
    }
  }
  ctx.restore();
  ctx.fillStyle = ACCENT;
  ctx.beginPath(); ctx.moveTo(cx - 6, 60); ctx.lineTo(cx + 6, 60); ctx.lineTo(cx, 68); ctx.closePath(); ctx.fill();
  // The readout floats over open sky: give it a shadow so a bright cloud
  // behind it cannot wash the digits out.
  ctx.save();
  ctx.shadowColor = 'rgba(6,10,18,0.75)'; ctx.shadowBlur = 5;
  label(ctx, `${String(Math.round(headingDeg)).padStart(3, '0')}°`, cx, 84, 13, INK, 'center');
  ctx.restore();
}

function drawHorizon(ctx, flight) {
  const cx = 92;
  const cy = VIEW.height - 96;
  const r = 56;
  panel(ctx, cx - r - 12, cy - r - 12, (r + 12) * 2, (r + 12) * 2, 14);
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
  ctx.translate(cx, cy);
  ctx.rotate(-flight.bank);
  const pitchPx = clamp(flight.pitch, -0.5, 0.5) * 95;
  ctx.fillStyle = '#6fb6d9';
  ctx.fillRect(-r - 30, -r - 40 + pitchPx, (r + 30) * 2, r + 40);
  ctx.fillStyle = '#8a6b46';
  ctx.fillRect(-r - 30, pitchPx, (r + 30) * 2, r + 40);
  ctx.strokeStyle = 'rgba(255,255,255,0.95)';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(-r - 30, pitchPx); ctx.lineTo(r + 30, pitchPx); ctx.stroke();
  ctx.lineWidth = 1.2;
  for (const deg of [-20, -10, 10, 20]) {
    const y = pitchPx - deg * 1.6;
    const w = deg % 20 === 0 ? 17 : 11;
    ctx.beginPath(); ctx.moveTo(-w, y); ctx.lineTo(w, y); ctx.stroke();
  }
  ctx.restore();
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
  // Roll pointer.
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-flight.bank);
  ctx.fillStyle = ACCENT;
  ctx.beginPath(); ctx.moveTo(0, -r + 3); ctx.lineTo(-5, -r + 12); ctx.lineTo(5, -r + 12); ctx.closePath(); ctx.fill();
  ctx.restore();
  // The fixed aircraft symbol.
  ctx.strokeStyle = '#ffd75e';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(cx - 26, cy); ctx.lineTo(cx - 9, cy); ctx.lineTo(cx - 5, cy + 5);
  ctx.moveTo(cx + 26, cy); ctx.lineTo(cx + 9, cy); ctx.lineTo(cx + 5, cy + 5);
  ctx.stroke();
  ctx.fillStyle = '#ffd75e';
  ctx.beginPath(); ctx.arc(cx, cy, 2.6, 0, Math.PI * 2); ctx.fill();
  label(ctx, 'HORIZON', cx, cy + r + 26, 10, DIM, 'center');
}

function drawBar(ctx, x, y, w, name, frac, color, text) {
  label(ctx, name, x, y + 4, 10, DIM);
  ctx.fillStyle = 'rgba(255,255,255,0.13)';
  ctx.beginPath(); ctx.roundRect(x + 40, y - 6, w, 10, 5); ctx.fill();
  ctx.fillStyle = color;
  if (frac > 0.01) { ctx.beginPath(); ctx.roundRect(x + 40, y - 6, Math.max(8, w * clamp(frac, 0, 1)), 10, 5); ctx.fill(); }
  label(ctx, text, x + 48 + w, y + 4, 11, INK);
}

function drawObjectiveArrow(ctx, view) {
  const { camera, target, flight, objectiveText } = view;
  if (!target) return;
  const dist = Math.hypot(target.x - flight.pos.x, target.z - flight.pos.z);
  const distText = dist >= 1000 ? `${(dist / 1000).toFixed(1)} km` : `${Math.round(dist)} m`;
  const p = camera.project(target);
  ctx.fillStyle = ACCENT;
  if (p && p.x > 30 && p.x < VIEW.width - 30 && p.y > 90 && p.y < VIEW.height - 40) {
    ctx.save();
    ctx.translate(p.x, p.y - 26);
    ctx.beginPath(); ctx.moveTo(0, 8); ctx.lineTo(-7, -4); ctx.lineTo(7, -4); ctx.closePath(); ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.shadowColor = 'rgba(6,10,18,0.8)'; ctx.shadowBlur = 5;
    label(ctx, distText, p.x, p.y - 36, 12, ACCENT, 'center');
    ctx.restore();
    return;
  }
  // Off-screen: a chevron on the lower centre line pointing the way to turn.
  const bearing = Math.atan2(target.x - flight.pos.x, target.z - flight.pos.z);
  let delta = bearing - flight.heading;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  const cx = VIEW.width / 2 + clamp(delta, -1, 1) * 240;
  const cy = VIEW.height - 34;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(delta > 0 ? Math.PI / 2 : -Math.PI / 2);
  if (Math.abs(delta) < 0.06) ctx.rotate(-Math.PI / 2 + Math.PI); // straight ahead: point up-screen
  ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(-6, 5); ctx.lineTo(6, 5); ctx.closePath(); ctx.fill();
  ctx.restore();
  label(ctx, `${objectiveText ?? ''} · ${distText}`, VIEW.width / 2, VIEW.height - 52, 12.5, ACCENT, 'center');
}

function drawWarnings(ctx, flight, time) {
  const w = flight.warnings;
  const items = [];
  if (w.engineOut) items.push(['ENGINE OUT — GLIDE!', BAD, true]);
  else if (w.stall) items.push(['STALL', BAD, true]);
  if (w.pullUp && flight.airborne) items.push(['PULL UP', BAD, true]);
  if (w.lowFuel) items.push(['LOW FUEL', '#ffb054', false]);
  let y = 118;
  for (const [text, color, urgent] of items) {
    if (urgent && Math.floor(time * 3.2) % 2 === 0 && text !== 'PULL UP') { y += 30; continue; }
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 8;
    value(ctx, text, VIEW.width / 2, y, 25, color, 'center');
    ctx.restore();
    y += 30;
  }
  // Takeoff coaching: the hints a new pilot actually needs, in order.
  if (flight.onGround && !flight.crashed && flight.speed > 34) {
    label(ctx, '↑  ROTATE', VIEW.width / 2, VIEW.height - 120, 17, INK, 'center', 800);
  } else if (flight.onGround && !flight.crashed && flight.speed < 12 && flight.throttle < 0.9 && flight.elapsed < 20) {
    label(ctx, 'W — THROTTLE UP', VIEW.width / 2, VIEW.height - 120, 17, INK, 'center', 800);
  }
}

function drawPlaying(ctx, view) {
  const { flight, mission, score, time } = view;
  // Soft vignette so the panel reads against bright sky.
  const vig = ctx.createRadialGradient(640, 360, 420, 640, 360, 860);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(4,8,14,0.32)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, VIEW.width, VIEW.height);

  const ground = terrainHeight(flight.pos.x, flight.pos.z);
  const aglFt = Math.max(0, Math.round((flight.pos.y - ground) * 3.281));
  const altFt = Math.round(flight.pos.y * 3.281);
  const mph = Math.round(flight.speed * 2.237);
  const headingDeg = ((flight.heading * 180 / Math.PI) % 360 + 360) % 360;

  panel(ctx, 18, 14, 196, 142, 12);
  label(ctx, 'ALT  AGL', 32, 38, 11);
  value(ctx, `${aglFt}`, 32, 70, 30);
  label(ctx, 'ft', 32 + ctx.measureText(`${aglFt}`).width + 22, 70, 12, DIM);
  label(ctx, `MSL ${altFt} ft`, 32, 90, 11.5, DIM);
  label(ctx, 'SPD', 32, 112, 11);
  value(ctx, `${mph}`, 66, 114, 19);
  label(ctx, 'mph', 66 + ctx.measureText(`${mph}`).width + 16, 114, 11, DIM);
  const vsFpm = Math.round(flight.verticalSpeed * 196.85 / 10) * 10;
  label(ctx, 'V/S', 32, 138, 11);
  value(ctx, `${vsFpm > 0 ? '+' : ''}${vsFpm}`, 66, 140, 15, vsFpm < -1200 ? BAD : INK);
  label(ctx, 'ft/min', 66 + ctx.measureText(`${vsFpm > 0 ? '+' : ''}${vsFpm}`).width + 14, 140, 10.5, DIM);

  panel(ctx, VIEW.width - 232, 14, 214, 118, 12);
  label(ctx, mission ? mission.title.toUpperCase() : '', VIEW.width - 218, 38, 11.5, ACCENT);
  label(ctx, view.objectiveText ?? '', VIEW.width - 218, 58, 12, INK);
  if (view.progressText) label(ctx, view.progressText, VIEW.width - 218, 78, 12, DIM);
  label(ctx, 'SCORE', VIEW.width - 218, 104, 10.5);
  value(ctx, `${score}`, VIEW.width - 218, 126, 21);
  if (view.combo > 1) label(ctx, `COMBO ×${view.combo}`, VIEW.width - 30, 126, 13, ACCENT, 'right');
  if (view.best > 0) label(ctx, `BEST ${view.best}`, VIEW.width - 30, 104, 10.5, DIM, 'right');

  drawCompass(ctx, headingDeg);
  drawHorizon(ctx, flight);

  panel(ctx, VIEW.width - 252, VIEW.height - 118, 234, 100, 12);
  drawBar(ctx, VIEW.width - 238, VIEW.height - 88, 118, 'THR', flight.throttle, '#ffb054', `${Math.round(flight.throttle * 100)}%`);
  const fuelColor = flight.fuel < 22 ? BAD : flight.fuel < 45 ? '#ffb054' : GOOD;
  drawBar(ctx, VIEW.width - 238, VIEW.height - 58, 118, 'FUEL', flight.fuel / 100, fuelColor, `${Math.round(flight.fuel)}`);
  const hullColor = flight.hull < 35 ? BAD : flight.hull < 65 ? '#ffb054' : GOOD;
  drawBar(ctx, VIEW.width - 238, VIEW.height - 28, 118, 'HULL', flight.hull / 100, hullColor, `${Math.round(flight.hull)}`);

  drawObjectiveArrow(ctx, view);
  drawWarnings(ctx, flight, time);

  if (view.message && time < view.message.until) {
    const remain = view.message.until - time;
    ctx.save();
    ctx.globalAlpha = clamp(remain / 0.4, 0, 1);
    ctx.shadowColor = 'rgba(0,0,0,0.65)'; ctx.shadowBlur = 10;
    value(ctx, view.message.text, VIEW.width / 2, 168, 27, view.message.color ?? INK, 'center');
    ctx.restore();
  }
  if (view.muted) label(ctx, 'SOUND OFF (M)', VIEW.width - 18, VIEW.height - 8, 10.5, DIM, 'right');
}

function drawTitle(ctx, view) {
  const grad = ctx.createLinearGradient(0, 0, 0, VIEW.height);
  grad.addColorStop(0, 'rgba(6,12,22,0.5)');
  grad.addColorStop(0.55, 'rgba(6,12,22,0.28)');
  grad.addColorStop(1, 'rgba(6,12,22,0.66)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, VIEW.width, VIEW.height);
  label(ctx, 'A  V A L L E Y   C O U R I E R   S T O R Y', VIEW.width / 2, 92, 13, ACCENT, 'center');
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = 16;
  value(ctx, 'SKY COURIER', VIEW.width / 2, 158, 64, '#ffffff', 'center');
  ctx.restore();
  label(ctx, 'Fly the Kestrel-9 through the valley — gates, cargo and one honest runway.', VIEW.width / 2, 190, 15.5, INK, 'center', 600);

  const cardW = 372;
  const cardH = 218;
  const gap = 26;
  const x0 = (VIEW.width - cardW * 3 - gap * 2) / 2;
  const y0 = 232;
  MISSION_LIST.forEach((m, i) => {
    const x = x0 + i * (cardW + gap);
    const selected = view.selected === i;
    ctx.fillStyle = selected ? 'rgba(16,26,38,0.88)' : 'rgba(10,17,26,0.72)';
    ctx.strokeStyle = selected ? ACCENT : EDGE;
    ctx.lineWidth = selected ? 2.4 : 1;
    ctx.beginPath(); ctx.roundRect(x, y0, cardW, cardH, 14); ctx.fill(); ctx.stroke();
    label(ctx, `${i + 1}`, x + 22, y0 + 40, 15, selected ? ACCENT : DIM);
    value(ctx, m.title, x + 48, y0 + 42, 21, '#ffffff');
    ctx.font = '400 13.5px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = DIM;
    ctx.textAlign = 'left';
    const lines = wrapText(ctx, m.brief, cardW - 44);
    lines.forEach((line, li) => ctx.fillText(line, x + 22, y0 + 76 + li * 19));
    const best = view.bests?.[m.kind] ?? 0;
    label(ctx, best > 0 ? `BEST  ${best}` : 'NOT FLOWN YET', x + 22, y0 + cardH - 20, 11.5, best > 0 ? GOOD : DIM);
    if (selected) label(ctx, 'ENTER — FLY THIS', x + cardW - 22, y0 + cardH - 20, 11.5, ACCENT, 'right');
  });

  label(ctx, '← → choose   ·   ENTER fly   ·   C fly the full circuit (all three, one tank)', VIEW.width / 2, 496, 14, INK, 'center', 600);
  panel(ctx, VIEW.width / 2 - 400, 528, 800, 118, 12);
  label(ctx, 'CONTROLS', VIEW.width / 2, 556, 11, ACCENT, 'center');
  label(ctx, '↑ climb · ↓ descend · ← → bank & turn · W / S throttle · hold SHIFT for fine throttle', VIEW.width / 2, 584, 14, INK, 'center', 600);
  label(ctx, 'SPACE drop parcel / confirm · P or ESC pause · M sound · mouse & touch: drag to steer', VIEW.width / 2, 610, 14, INK, 'center', 600);
  label(ctx, 'Mind the stall: slow + steep = falling. The valley forgives a lot. The runway does not.', VIEW.width / 2, 692, 12.5, DIM, 'center', 600);
}

function drawPause(ctx, view) {
  ctx.fillStyle = 'rgba(5,9,16,0.55)';
  ctx.fillRect(0, 0, VIEW.width, VIEW.height);
  value(ctx, 'PAUSED', VIEW.width / 2, 330, 44, '#ffffff', 'center');
  label(ctx, view.circuit ? 'Circuit paused — the tank keeps what is left.' : 'Take a breath. The valley waits.', VIEW.width / 2, 366, 15, INK, 'center', 600);
  label(ctx, 'P / ESC resume · R restart mission · T back to title', VIEW.width / 2, 404, 14, DIM, 'center', 600);
}

function drawResults(ctx, view) {
  ctx.fillStyle = 'rgba(5,9,16,0.6)';
  ctx.fillRect(0, 0, VIEW.width, VIEW.height);
  const ok = view.resultsOk;
  value(ctx, view.resultsTitle ?? '', VIEW.width / 2, 168, 40, ok ? GOOD : BAD, 'center');
  if (view.resultsSub) label(ctx, view.resultsSub, VIEW.width / 2, 200, 15, INK, 'center', 600);
  const lines = view.resultsLines ?? [];
  const w = 430;
  const h = 64 + lines.length * 30 + 58;
  panel(ctx, VIEW.width / 2 - w / 2, 232, w, h, 14);
  let y = 232 + 44;
  for (const [name, val] of lines) {
    label(ctx, name, VIEW.width / 2 - w / 2 + 28, y, 14, DIM, 'left', 600);
    label(ctx, `${val}`, VIEW.width / 2 + w / 2 - 28, y, 14.5, INK, 'right', 800);
    y += 30;
  }
  ctx.strokeStyle = EDGE;
  ctx.beginPath(); ctx.moveTo(VIEW.width / 2 - w / 2 + 28, y + 2); ctx.lineTo(VIEW.width / 2 + w / 2 - 28, y + 2); ctx.stroke();
  label(ctx, 'TOTAL', VIEW.width / 2 - w / 2 + 28, y + 32, 14, ACCENT, 'left', 800);
  label(ctx, `${view.score}`, VIEW.width / 2 + w / 2 - 28, y + 32, 19, '#ffffff', 'right', 800);
  const hint = view.circuit && ok && view.hasNext
    ? 'ENTER — next leg (same aircraft, same tank) · T title'
    : 'ENTER — fly again · T title';
  label(ctx, hint, VIEW.width / 2, 232 + h + 40, 14, INK, 'center', 600);
  if (view.isNewBest) label(ctx, '★ NEW BEST', VIEW.width / 2, 232 + h + 68, 13, ACCENT, 'center');
}

export function createHud(canvas) {
  const ctx = canvas.getContext('2d');
  function draw(view) {
    if (view.screen === 'title') { drawTitle(ctx, view); return; }
    drawPlaying(ctx, view);
    if (view.screen === 'paused') drawPause(ctx, view);
    if (view.screen === 'results') drawResults(ctx, view);
  }
  return { draw };
}
