// CDP screenshot probe for the flight-game shot scenes.
// Launches chrome-headless-shell with remote debugging, navigates to the
// ?shot= URL, waits for window.__shotReady, captures JPEG via CDP.
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const SHELL = `${process.env.HOME}/.cache/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-linux64/chrome-headless-shell`;
const PORT = 9223;
const url = process.argv[2];
const out = process.argv[3];
const deadline = Date.now() + 90000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(path, method = 'GET') {
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`, { method });
  return res.json();
}

const shell = spawn(SHELL, [
  '--headless', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  `--remote-debugging-port=${PORT}`, '--window-size=1280,720', 'about:blank',
], { stdio: ['ignore', 'pipe', 'pipe'] });
shell.stderr.on('data', () => {});
shell.stdout.on('data', () => {});

let target;
try {
  for (;;) {
    if (Date.now() > deadline) throw new Error('timed out waiting for devtools');
    try { await getJson('/json/version'); break; } catch { await sleep(300); }
  }
  target = await getJson(`/json/new?${encodeURIComponent(url)}`, 'PUT');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const events = [];
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const mid = ++id;
    pending.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    } else if (msg.method) events.push(msg);
  };
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  await send('Page.enable');
  await send('Runtime.enable');
  // Wait for __shotReady (set synchronously by the shot scene during load).
  let ready = false;
  for (;;) {
    if (Date.now() > deadline) throw new Error('timed out waiting for __shotReady');
    try {
      const r = await send('Runtime.evaluate', { expression: 'window.__shotReady === true', returnByValue: true });
      if (r?.result?.value) { ready = true; break; }
    } catch {}
    await sleep(500);
  }
  console.log('shotReady:', ready);
  const shot = await send('Page.captureScreenshot', { format: 'jpeg', quality: 85 });
  writeFileSync(out, Buffer.from(shot.data, 'base64'));
  console.log('saved', out);
} catch (e) {
  console.error('FAILED:', e.message);
  process.exitCode = 1;
} finally {
  try { if (target) await fetch(`http://127.0.0.1:${PORT}/json/close/${target.id}`); } catch {}
  shell.kill('SIGKILL');
}
