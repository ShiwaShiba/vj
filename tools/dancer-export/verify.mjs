#!/usr/bin/env node
// Headless visual check for the built dancers-standalone.html — no puppeteer.
// Launches headless Chrome, loads the file:// build, drives it through a few
// states (GRAPHIC front, GRAPHIC side, PICTO, crowd), and for each one asserts:
//   * window.__err is empty (no load-time / runtime module error), and
//   * the canvas actually rendered (non-black pixels present, read via getImageData).
// A PNG per state is written to ./shots/ so a human can eyeball the result.
// Exits non-zero if any state errored or came back black. Node 22+ (global
// WebSocket, fetch).
//
// Usage:  node tools/dancer-export/verify.mjs [--html=PATH] [--w=1280] [--h=800]

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([^=]+)=([\s\S]*)$/); return m ? [m[1], m[2]] : [a.replace(/^--/, ''), true];
}));
const HTML = args.html || join(HERE, 'dancers-standalone.html');
const W = +(args.w || 1280), H = +(args.h || 800);
const SHOTS = join(HERE, 'shots');
const URL_ = 'file://' + HTML;
const PORT = 9222 + Math.floor((Date.now() % 1000));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Each state: a setup expression run before probing, plus a filename. The
// deltas assume a fresh load starts at STYLE=GRAPHIC, VIEW=FRONT, DANCERS=1.
const STATES = [
  { name: 'graphic · front', setup: '', file: '1-graphic-front.png' },
  { name: 'graphic · side', file: '2-graphic-side.png',
    setup: "document.getElementById('view').click(); document.getElementById('view').click();" }, // FRONT->3-4->SIDE
  { name: 'picto', file: '3-picto.png',
    setup: "document.getElementById('style').click();" }, // GRAPHIC->PICTO
  { name: 'crowd (24)', file: '4-crowd.png',
    setup: "const e=document.getElementById('count'); e.value=24; e.dispatchEvent(new Event('input'));" },
];

// Probe: read window.__err and count non-black canvas pixels; also report the
// current STYLE/VIEW button labels so the summary is self-describing.
const PROBE = `(() => {
  const c = document.getElementById('c');
  if (!c) return { ok:false, reason:'no #c canvas' };
  const g = c.getContext('2d');
  const w = c.width, h = c.height;
  let d;
  try { d = g.getImageData(0, 0, w, h).data; }
  catch (e) { return { ok:false, reason:'getImageData: ' + e.message }; }
  let nonblack = 0;
  for (let i = 0; i < d.length; i += 4) { if (d[i] > 24 || d[i+1] > 24 || d[i+2] > 24) nonblack++; }
  return { ok:true, w, h, nonblack,
    style: document.getElementById('style').textContent,
    view: document.getElementById('view').textContent,
    err: (window.__err || []).slice() };
})()`;

let ws;
function send(id, method, params) {
  return new Promise((resolve) => {
    const onMsg = (ev) => { const m = JSON.parse(ev.data); if (m.id === id) { ws.removeEventListener('message', onMsg); resolve(m.result); } };
    ws.addEventListener('message', onMsg);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

let idc = 1;
async function evaluate(expression) {
  const r = await send(idc++, 'Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r && r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r && r.result ? r.result.value : undefined;
}
async function screenshot(path) {
  const shot = await send(idc++, 'Page.captureScreenshot', { format: 'png' });
  writeFileSync(path, Buffer.from(shot.data, 'base64'));
}

const chrome = spawn(CHROME, [
  '--headless=new', '--hide-scrollbars', '--mute-audio', '--no-first-run', '--no-default-browser-check',
  '--allow-file-access-from-files', // let file:// getImageData read the canvas
  `--remote-debugging-port=${PORT}`, `--window-size=${W},${H}`,
  '--user-data-dir=/tmp/dancer-verify-' + PORT, 'about:blank',
], { stdio: 'ignore' });

let failed = false;
try {
  mkdirSync(SHOTS, { recursive: true });

  let target;
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' }); target = await r.json(); break; }
    catch { await sleep(200); }
  }
  if (!target || !target.webSocketDebuggerUrl) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/json`); target = (await r.json())[0]; } catch {}
  }
  if (!target || !target.webSocketDebuggerUrl) throw new Error('no devtools target');

  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });

  await send(idc++, 'Page.enable');
  await send(idc++, 'Runtime.enable');
  const loaded = new Promise((res) => {
    const onMsg = (ev) => { const m = JSON.parse(ev.data); if (m.method === 'Page.loadEventFired') { ws.removeEventListener('message', onMsg); res(); } };
    ws.addEventListener('message', onMsg);
  });
  await send(idc++, 'Page.navigate', { url: URL_ });
  await loaded;
  await sleep(1400); // let a few animated frames render

  console.log('verifying', URL_, '\n');
  for (const st of STATES) {
    if (st.setup) { await evaluate(st.setup); await sleep(800); } else { await sleep(200); }
    const p = await evaluate(PROBE);
    await screenshot(join(SHOTS, st.file));

    const errs = (p && p.err) || [];
    const rendered = p && p.ok && p.nonblack > 200;
    const pass = rendered && errs.length === 0;
    if (!pass) failed = true;
    const label = p && p.ok ? `${(p.style || '').padEnd(15)} ${(p.view || '').padEnd(12)} nonblack=${p.nonblack}` : `PROBE FAIL: ${p && p.reason}`;
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${st.name.padEnd(16)} ${label}  -> shots/${st.file}`);
    if (errs.length) console.log('      window.__err:\n        ' + errs.join('\n        '));
  }
  console.log('\n' + (failed ? 'RESULT: FAIL' : 'RESULT: PASS') + '  (PNGs in tools/dancer-export/shots/)');
} catch (e) {
  console.error('verify.mjs failed:', e.message);
  failed = true;
} finally {
  try { ws && ws.close(); } catch {}
  chrome.kill('SIGKILL');
  await sleep(200);
}
process.exit(failed ? 1 : 0);
