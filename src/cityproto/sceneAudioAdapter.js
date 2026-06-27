// Task 3 — the re-authored, mic-LESS variant of liveDriver.js for the body-scene integration.
// liveDriver.js says it is "the ONLY file a future production Scene wrapper re-authors; live.js
// (the contract) stays portable." This is that re-authored variant: it runs the SAME pure
// pipeline from live.js and performs the SAME LIVE writes, but owns NO microphone — instead it
// consumes the MAIN app's already-computed AudioEngine.state + Clock via update(audioState, clock).
//
//   * Owns no microphone, no Web-Audio context, no media-capture API, no analyser node.
//     (asserted by the source-scan tests)
//   * Deterministic: no RNG, no wall-clock reads.
//   * Always LIVE: the body-scene has no 76s intro. ps is seeded into PHASE.LIVE at construction;
//     reduce() then skips the INTRO block forever and keeps next.phase === LIVE.
//
// CAMERA-OWNERSHIP STANCE (critical seam for Task 5 / cityCore):
//   In the body-scene the ④ full-city framing camera is owned by cityCore's intro:false update
//   path (Object.assign(params, kfInputs.full) → shotDir.apply → applyCamera, all done by cityCore
//   itself). To avoid the camera being driven twice, this adapter deliberately leaves
//   ps.parkParams === null. parkParams is ONLY ever assigned inside reduce()'s INTRO→LIVE
//   transition block (live.js:149), which we never execute (we start already LIVE), so it stays
//   null and the `if (ps.parkParams && params && applyCamera)` camera block below never fires.
//   The adapter therefore never calls shotDir.apply / applyCamera — cityCore owns the camera.
//   Everything else LIVE needs (cityScope, trees/particles season+uMode+strobe, overlay, particle
//   density) is still driven here.
//
// Spec: docs/superpowers/specs/2026-06-26-city-audio-reactive-mapping.md
import {
  PHASE, defaultModeConfig, initPhaseState, initFeat, initKnobs,
  extractFeatures, reduce, smoothKnobs,
} from './live.js';

const COLOR_MODES = ['burst', 'advance', 'manual'];

// Re-authored from liveDriver.js (module-private there, not exported). seasonProg(構造ramp)から
// 色と花びらの遅延progを導出＝色は構造に遅れ、花びらは色より更に長く薄く尾を引く。settled(prog=1)
// では両者1。
const _ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const seasonLookProgs = (sp) => ({ progColor: _ss(0.15, 0.92, sp), progPetal: _ss(0.28, 1.0, sp) });

export function createSceneAudioAdapter() {
  const cfg = defaultModeConfig();
  let ps = initPhaseState(cfg);
  ps.phase = PHASE.LIVE;        // body-scene is always LIVE; no INTRO → parkParams stays null forever
  let feat = initFeat();
  let knobs = initKnobs(cfg);
  knobs.phase = PHASE.LIVE;

  // Internal carriers that mirror the MAIN app each update(). The live.js pipeline reads these
  // exactly like liveDriver reads its own AudioEngine.state / Clock — but nothing writes them via
  // a mic; update() copies the host's values in.
  const aState = {
    ready: false, level: 0, bass: 0, mid: 0, treble: 0,
    beat: false, beatHold: 0, bpm: 120,
    spectrum: null, waveform: null, directorCam: null,
  };
  const clock = { beats: 0, beatPhase: 0, beatJustWrapped: false, directorCam: null };
  const audio = { state: aState, sensitivity: 1 }; // liveDriver.audio-compatible (sensitivity fixed at 1)

  const isLive = () => ps.phase === PHASE.LIVE; // always true (seeded LIVE, reduce keeps it LIVE)
  const setColorMode = (name) => { if (COLOR_MODES.includes(name)) cfg.colorMode = name; return cfg.colorMode; };
  const cycleColorMode = () => setColorMode(COLOR_MODES[(COLOR_MODES.indexOf(cfg.colorMode) + 1) % COLOR_MODES.length]);
  const setConfig = (p) => { if (p) Object.assign(cfg, p); return cfg; };

  // Mirror the MAIN app's AudioEngine.state + Clock into the internal carriers. Replaces
  // liveDriver's `audio.update(nowMs)` / `clock.update(dt, bpm, beat)` — we never open a mic or
  // advance our own clock; the host already computed all of this.
  function update(audioState, extClock) {
    if (audioState) {
      aState.ready = !!audioState.ready;
      aState.level = +audioState.level || 0;
      aState.bass = +audioState.bass || 0;
      aState.mid = +audioState.mid || 0;
      aState.treble = +audioState.treble || 0;
      aState.beat = !!audioState.beat;
      aState.beatHold = +audioState.beatHold || 0;
      if (audioState.bpm != null) aState.bpm = +audioState.bpm || 0;
      if (audioState.spectrum != null) aState.spectrum = audioState.spectrum;
      if (audioState.waveform != null) aState.waveform = audioState.waveform;
    }
    if (extClock) {
      clock.beats = +extClock.beats || 0;
      clock.beatPhase = +extClock.beatPhase || 0;
      clock.beatJustWrapped = !!extClock.beatJustWrapped;
    }
  }

  // Once per frame from cityCore's LIVE loop. ctx carries the live THREE refs + callbacks (they can
  // change when the director/particles are rebuilt, so they're passed each frame). Mirrors
  // liveDriver.frame's body MINUS the mic ownership (update() supplies aState/clock) and MINUS the
  // camera writes (cityCore owns the camera — see stance note above).
  function frame(dt, nowMs, ctx) {
    const dir = ctx.director;
    if (dir) {
      // Optional handoff geometry re-read (INTRO-only fields; harmless in always-LIVE). Kept for
      // parity so a host that wires a director stays consistent.
      cfg.cycleDur = dir.cycleDur;
      cfg.winterCycleStart = 3 * dir.cycleDur;
      let acc = 0;
      for (const s of dir.segments) { if (s.name === 'hold4') { cfg.hold4Start = acc; cfg.hold4Dur = s.dur; break; } acc += s.dur; }
    }

    // NO audio.update / clock.update — the host mirrored aState/clock via update() already.
    aState.directorCam = ctx.directorCam || null;
    feat = extractFeatures(aState, clock, feat, dt, cfg);
    if (ctx.tSec != null) feat.tSec = ctx.tSec; // INTRO-only; harmless in LIVE
    const r = reduce(ps, feat, cfg, dt); ps = r.next;
    knobs = smoothKnobs(knobs, r.targets, dt, cfg);

    const { trees, particles, params, applyCamera, setOverlayIntensity, strobe } = ctx;

    // overlay grain rides the music; particle density from reduce (LIVE combine).
    if (setOverlayIntensity) setOverlayIntensity(knobs.overlayIntensity);
    if (particles && particles.uniforms.uEmitMul) particles.uniforms.uEmitMul.value = knobs.petalDensity;

    if (ps.phase === PHASE.LIVE) {
      // age=1: 夏は settled(黄緑)で安定。固定カメラの LIVE は経年据え置き(連続性保持)。
      const season = { index: knobs.seasonIndex, prog: knobs.seasonProg, age: 1, ...seasonLookProgs(knobs.seasonProg) };

      // CAMERA: deliberately gated on ps.parkParams (always null in this adapter) → never fires.
      // cityCore owns the ④ framing camera. See the stance note in the file header.
      if (ps.parkParams && params && applyCamera) {
        const p = ps.parkParams;
        params.camX = p.camX; params.camY = p.camY;
        params.camZ = p.camZ * (1 - cfg.breathAmp * knobs.camBreath);
        params.fov = p.fov; params.lookX = p.lookX; params.lookY = p.lookY; params.lookV = p.lookV;
        if (ctx.shotDir && ctx.beat) ctx.shotDir.apply(params, ctx.beat, dt);
        applyCamera();
      }

      // 音反応 建物変調（CityScope）: 固定カメラの LIVE で建物が音/ビートに連動。
      if (ctx.cityScope) ctx.cityScope.frame(feat, dt);

      // sole effective writer of uMode in LIVE: update() (mode=null) eases uMode toward its old
      // modeTarget, so override AFTER update() every frame. strobe clamped ≤3Hz (luminance guard).
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
    audio, clock, update, frame, isLive, setColorMode, cycleColorMode, setConfig,
    started: true,                 // no mic to start; the scene is live from construction
    get phase() { return ps.phase; },
    get knobs() { return knobs; },
    get modeConfig() { return cfg; },
    get feat() { return feat; },
    get ps() { return ps; },
  };
}
