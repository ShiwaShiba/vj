// proto.js — the standalone city-proto page shell. Owns ONLY the app boundary: the renderer
// (from #gl), the RAF loop, the #loading veil, the #start mic gesture, the keyboard tuning
// controls, the DOM overlay/debug HUDs, and window.__proto. ALL scene logic (scene-graph,
// per-frame director/driver/cityScope, live-tuning rebuilds) lives in the injected cityCore,
// which a future CityScene shares — feeding it the main app's audio instead of this mic.
import * as THREE from '../vendor/three.module.js';
import { createCityCore } from './cityCore.js';
import { makeOverlay } from './overlay.js';
import { createLiveDriver } from './liveDriver.js';

const glCanvas = document.getElementById('gl');
const renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setClearColor(0x07080a, 1);

const core = createCityCore({ THREE, renderer });
const { scene, camera, params } = core;

function resize() { core.resize(innerWidth, innerHeight); }
addEventListener('resize', resize); resize(); core.applyCamera();

// Audio-reactive LIVE driver (owns the mic + the pure live.js reactor). Mic is started
// from a tap gesture (see #start below); until then visuals run on the internal clock.
const driver = createLiveDriver();
let liveOverlayI = null;                          // overlay grain intensity, set by the driver
let last = null;                                  // perf timestamp of the previous frame
let debug = false;                                // live-tuning readout overlay (D key). Default OFF → shipped look unchanged

// credits read the baked manifest live (set on load) — never hardcoded.
// grain intensity rides the music in LIVE (null = resting 0.05 look).
const drawOverlay = makeOverlay(
  document.getElementById('ov'),
  () => { const m = core.refs().manifest; return m && m.attribution; },
  () => liveOverlayI,
);
// --- live-tuning readout (D key) — a dev instrument for the audio-reactive session. Default
// OFF so the shipped look is untouched; when on it prints the raw mic bands, the drop-detection
// inputs (so a "no reaction" is instantly attributable to gain vs threshold), and the eased knobs.
const dbgEl = document.createElement('pre');
dbgEl.style.cssText = 'position:fixed;left:8px;top:8px;z-index:20;margin:0;pointer-events:none;'
  + 'font:11px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;color:rgba(194,202,214,0.82);'
  + 'background:rgba(7,8,10,0.55);padding:7px 9px;border-radius:4px;white-space:pre;display:none';
document.body.appendChild(dbgEl);
const f3 = (x) => (x == null ? '—' : x.toFixed(3));
function drawDebug() {
  if (!debug) return;
  const a = driver.audio.state, ft = driver.feat, ps = driver.ps, k = driver.knobs, c = driver.modeConfig;
  const dropL = (ft.level - ft.levelSlow), dropB = (ft.bass - ft.bassSlow);
  const armedL = dropL > c.dropThresh, armedB = dropB > c.bassJump;       // both must hold to fire a drop
  const sinceDrop = ps.clk - ps.lastDropT;
  dbgEl.textContent =
    `phase  ${driver.phase}${driver.started ? '' : '   (mic off — visuals on clock)'}\n`
    + `audio  L ${f3(a.level)}  bass ${f3(a.bass)}  mid ${f3(a.mid)}  treb ${f3(a.treble)}\n`
    + `beat   ${a.beat ? '●' : '·'}  bpm ${a.bpm ? a.bpm.toFixed(0) : '—'}  sens ${f3(driver.audio.sensitivity)}\n`
    + `drop   ΔL ${f3(dropL)}${armedL ? '✓' : ' '}>thr${c.dropThresh}   ΔB ${f3(dropB)}${armedB ? '✓' : ' '}>${c.bassJump}`
    + `   ${sinceDrop < 9e8 ? sinceDrop.toFixed(1) + 's ago' : 'never'}\n`
    + `knobs  breath ${f3(k.camBreath)}  petals ${f3(k.petalDensity)}  chroma ${f3(k.chromaMix)}\n`
    + `       overlay ${f3(k.overlayIntensity)}  season ${k.seasonIndex}  strobe ${f3(k.strobeRate)}  mode ${c.colorMode}`;
}

function loop(now) {
  if (last === null) last = now;
  const dt = Math.min((now - last) / 1000, 0.05); last = now;
  core.update(dt, now, {
    audioState: driver.audio.state, driver, live: driver.isLive(), intro: true,
    setOverlayIntensity: (v) => { liveOverlayI = v; },
  });
  core.render();
  drawOverlay();
  drawDebug();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// Mic needs a user gesture (iOS). Tap the start affordance once to enable; on denial the
// scene keeps running silently (mirrors main.js's non-blocking start).
const startEl = document.getElementById('start');
function beginAudio() {
  if (startEl) startEl.style.display = 'none'; // hide immediately on tap (don't wait on the mic promise)
  driver.start();
}
if (startEl) startEl.addEventListener('pointerdown', beginAudio, { once: true });
else addEventListener('pointerdown', beginAudio, { once: true });

window.__proto = {
  THREE, scene, camera, renderer, params, applyCamera: core.applyCamera,
  seek: (t) => core.seek(t),                        // jump the director clock (seconds)
  goLive: () => core.goLive(driver),                // jump straight into the audio-reactive LIVE phase
  setPaused: (b) => core.setPaused(b),
  setParallax: (b) => core.setParallax(b),
  setMode: (b) => core.setMode(b),                  // 0 mono / 1 chroma (also the C key)
  setStrobe: (b) => core.setStrobe(b),              // 冬 white strobe gate (also the S key)
  // step 6 live-tuning knobs (no HUD yet). Initial state == the current look.
  setChromaVariant: (name) => core.setChromaVariant(name),   // swap chroma register (look-pick)
  setStrobeRate: (hz) => core.setStrobeRate(hz),    // ≤3Hz (守る線)
  setPetals: (partial) => core.setPetals(partial),  // particle emit density
  setTiming: (partial) => core.setTiming(partial),  // director 緩急 overrides
  setFraming: (partial) => core.setFraming(partial),// camrig framing overrides
  setShot: (partial) => core.setShot(partial),      // beat-driven 俯瞰⇔アップ camera (slider HUD)
  setScope: (partial) => core.setScope(partial),    // 音反応 建物変調(HUD)
  state: () => core.state(),
  refs: () => core.refs(),
  driver,                                           // expose the audio-reactive driver for live inspection
};

// build stamp — a glance at the console after reload confirms WHICH code is live (no guessing
// whether a change deployed). Bump the label when shipping a visible change.
console.log('%c[VJ city] build: season look-lag — 散り→新緑の自然遷移 (progColor/progPetal) ✓', 'color:#e39;font-weight:bold');

// Load-bar wiring: fill #loadfill with the glb download %, then fade the veil and
// reveal TAP TO START once the scene is ready. Falls back to the pulsing indeterminate
// bar when the response length is unknown (e.g. gzip transport → no Content-Length).
const loadingEl = document.getElementById('loading'), loadFill = document.getElementById('loadfill');
const onLoadProgress = (e) => {
  if (!loadingEl) return;
  if (e && e.lengthComputable && e.total) { loadingEl.classList.remove('indet'); loadFill.style.width = `${Math.round((e.loaded / e.total) * 100)}%`; }
  else loadingEl.classList.add('indet');
};
core.load(onLoadProgress).then(() => {
  // Mirror the original inspection surface on window.__proto (live snapshot of the core refs).
  const r = core.refs();
  Object.assign(window.__proto, { city: r.city, trees: r.trees, particles: r.particles, manifest: r.manifest, reveal: r.reveal, intro: r.intro, shotDir: r.shotDir, cityScope: r.cityScope });
  // Scene is ready: fill the bar, fade the veil out, reveal the TAP TO START gate.
  if (loadingEl) { loadFill.style.width = '100%'; loadingEl.classList.add('done'); setTimeout(() => { loadingEl.style.display = 'none'; }, 600); }
  if (startEl) startEl.style.display = 'flex';
}).catch((e) => {
  console.error('city load failed', e);
  if (loadingEl) { const l = document.getElementById('loadlabel'); if (l) l.textContent = '読み込みに失敗しました'; loadingEl.classList.remove('indet'); }
});

// Tuning controls (city-proto stage): dial 緩急 by looking. Later → ControlPanel.
addEventListener('keydown', (e) => {
  if (e.key === ' ') { core.setPaused(!core.state().paused); e.preventDefault(); }   // freeze / resume clock
  else if (e.key === '[') { core.seek(core.state().tSec - 1.0); }     // scrub back 1s
  else if (e.key === ']') { core.seek(core.state().tSec + 1.0); }     // scrub forward 1s
  else if (e.key === 'p' || e.key === 'P') { core.setParallax(!core.state().parallax); } // straight dolly ↔ micro-parallax
  else if (e.key === 'c' || e.key === 'C') {
    // LIVE: the audio reactor owns color, so a manual toggle must override it via the reactor's
    // 'manual' colorMode (mono ↔ 季節色). INTRO: the director owns color → toggle the local mode.
    if (driver.isLive()) { const c = driver.modeConfig; driver.setColorMode('manual'); c.manualChromaMix = c.manualChromaMix > 0 ? 0 : 1; }
    else { core.setMode(!core.state().mode); }
  }
  else if (e.key === 'n' || e.key === 'N') { // LIVE: 季節送り 春→夏→秋→冬 (forces manual + 色ON so the pick is visible)
    const c = driver.modeConfig; driver.setColorMode('manual'); c.manualSeason = (c.manualSeason + 1) % 4; c.manualChromaMix = 1;
  }
  else if (e.key === 'b' || e.key === 'B') { driver.setColorMode('burst'); } // LIVE: hand color back to the audio reactor
  else if (e.key === 's' || e.key === 'S') { core.setStrobe(!core.state().strobeEnabled); } // 冬 white strobe (default off)
  else if (e.key === 'm' || e.key === 'M') { console.log('colorMode →', driver.cycleColorMode()); } // LIVE 色モード循環 (burst/advance/manual)
  else if (e.key === 'd' || e.key === 'D') { debug = !debug; dbgEl.style.display = debug ? 'block' : 'none'; } // live-tuning readout
  else if (e.key === 'l' || e.key === 'L') { window.__proto.goLive(); } // jump straight to the audio-reactive LIVE phase
});
