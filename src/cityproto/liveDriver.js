// Plan 3 — the non-pure adapter for the audio-reactive LIVE layer. Owns the AudioEngine
// (Web Audio) + a Clock + the pure-state carriers, calls into the PURE live.js each frame,
// and writes the result into THREE objects. This is the ONLY file a future production Scene
// wrapper re-authors; live.js (the contract) stays portable.
//
// Spec: docs/superpowers/specs/2026-06-26-city-audio-reactive-mapping.md
import { Clock } from '../engine/Clock.js';
import { AudioEngine } from '../audio/AudioEngine.js';
import {
  PHASE, defaultModeConfig, initPhaseState, initFeat, initKnobs,
  extractFeatures, reduce, smoothKnobs,
} from './live.js';

const COLOR_MODES = ['burst', 'advance', 'manual'];

// 見た目の遅延(intro と同じ「散り→新緑」の自然な重なり)を LIVE でも。seasonProg(構造ramp)から
// 色と花びらの遅延progを導出＝色は構造に遅れ、花びらは色より更に長く薄く尾を引く。設定値は director
// の seasonColorWin/seasonPetalWin と同趣旨を [0,1] 正規化したもの。settled(prog=1)では両者1。
const _ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const seasonLookProgs = (sp) => ({ progColor: _ss(0.15, 0.92, sp), progPetal: _ss(0.28, 1.0, sp) });

export function createLiveDriver() {
  const audio = new AudioEngine();
  const clock = new Clock();
  const cfg = defaultModeConfig();
  let ps = initPhaseState(cfg);
  let feat = initFeat();
  let knobs = initKnobs(cfg);
  let started = false;

  async function start() {
    try { started = await audio.start(); } catch (e) { started = false; console.warn('mic start failed; visuals continue on the internal clock', e); }
    return started;
  }
  const isLive = () => ps.phase === PHASE.LIVE;
  const setColorMode = (name) => { if (COLOR_MODES.includes(name)) cfg.colorMode = name; return cfg.colorMode; };
  const cycleColorMode = () => setColorMode(COLOR_MODES[(COLOR_MODES.indexOf(cfg.colorMode) + 1) % COLOR_MODES.length]);

  // Called once per frame from proto.js's loop. ctx carries the live THREE refs + callbacks
  // (they can change when the director/particles are rebuilt, so they're passed each frame).
  function frame(dt, nowMs, ctx) {
    const dir = ctx.director;
    if (dir) {
      // re-read handoff geometry from the LIVE director (durations change via setTiming)
      cfg.cycleDur = dir.cycleDur;
      cfg.winterCycleStart = 3 * dir.cycleDur;
      let acc = 0;
      for (const s of dir.segments) { if (s.name === 'hold4') { cfg.hold4Start = acc; cfg.hold4Dur = s.dur; break; } acc += s.dur; }
    }

    audio.update(nowMs);
    clock.update(dt, audio.state.bpm, audio.state.beat);
    const aState = audio.state;
    aState.directorCam = ctx.directorCam || null; // for the LIVE park snapshot
    feat = extractFeatures(aState, clock, feat, dt, cfg);
    if (ctx.tSec != null) feat.tSec = ctx.tSec;   // real director clock → handoff in lockstep with the visible intro
    const r = reduce(ps, feat, cfg, dt); ps = r.next;
    knobs = smoothKnobs(knobs, r.targets, dt, cfg);

    const { trees, particles, params, applyCamera, setOverlayIntensity, strobe } = ctx;

    // overlay grain rides the music in BOTH phases (accent in INTRO, full in LIVE)
    if (setOverlayIntensity) setOverlayIntensity(knobs.overlayIntensity);
    // particle density: phase-aware value from reduce (INTRO ≈ authored full; LIVE = combine)
    if (particles && particles.uniforms.uEmitMul) particles.uniforms.uEmitMul.value = knobs.petalDensity;

    if (ps.phase === PHASE.LIVE) {
      const season = { index: knobs.seasonIndex, prog: knobs.seasonProg, ...seasonLookProgs(knobs.seasonProg) };
      // camera: parked hero framing + a level-driven breath micro-dolly on camZ (no travel)
      if (ps.parkParams && params && applyCamera) {
        const p = ps.parkParams;
        params.camX = p.camX; params.camY = p.camY;
        params.camZ = p.camZ * (1 - cfg.breathAmp * knobs.camBreath);
        params.fov = p.fov; params.lookX = p.lookX; params.lookY = p.lookY; params.lookV = p.lookV;
        applyCamera();
      }
      // sole effective writer of uMode in LIVE: update() (mode=null) still eases uMode toward
      // its old modeTarget, so override AFTER update() every frame.
      if (trees) {
        trees.update(season, null, dt, { strobe });
        trees.uniforms.uMode.value = knobs.chromaMix;
        if (trees.uniforms.uStrobeRate) trees.uniforms.uStrobeRate.value = Math.max(0, Math.min(3, knobs.strobeRate));
      }
      if (particles) {
        particles.update(season, null, dt);
        particles.uniforms.uMode.value = knobs.chromaMix;
      }
    }
    return ps.phase;
  }

  return {
    audio, clock, start, frame, isLive, setColorMode, cycleColorMode,
    get phase() { return ps.phase; },
    get knobs() { return knobs; },
    get modeConfig() { return cfg; },
    get started() { return started; },
    get feat() { return feat; },   // smoothed features (drop-detection inputs) — for the live tuning HUD
    get ps() { return ps; },       // phase-machine state (armed/lastDropT/season) — for the live tuning HUD
  };
}
