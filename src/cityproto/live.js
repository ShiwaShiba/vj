// Plan 3 — audio-reactive LIVE layer for the city scene. PURE: no THREE, no DOM, no
// AudioEngine, no Math.random, no Date. Everything is a deterministic function of
// (audioState, clock, modeConfig, phaseState, dt), so 100% of behavior is unit-testable
// by feeding synthetic audio frames (see tests/cityproto/live.test.mjs). The non-pure
// adapter that owns the AudioEngine + writes THREE lives in liveDriver.js.
//
// Spec: docs/superpowers/specs/2026-06-26-city-audio-reactive-mapping.md
//   - two-phase machine: authored INTRO (director-owned) → audio-reactive LIVE
//   - knobs are TARGETS the driver eases via the pure smoothKnobs (stateless expSmooth,
//     k = 1 - exp(-dt/τ) — NOT EnvelopeFollower, which is stateful and clamps to [0,1])
//   - chroma is transient-only (drop-triggered bloom decaying to 0); mono is the rest state
//   - reactor emits seasonIndex + chromaMix (0..1), NEVER RGB (seasons.js stays SoT)
//   - strobe gate stays the VJ S-key; the reactor only sets a rate (≤3Hz)
import { clamp } from '../lib/math.js';

export const PHASE = { INTRO: 'intro', LIVE: 'live' };

const WINTER = 3; // SEASON_NAMES = [spring, summer, autumn, winter] (director.js)
const EPS = 1e-6;

// dt-honest exponential approach: move `current` toward `target` by k=1-exp(-dt/τ).
// τ in seconds. Asymmetric when tauDown given (fast rise / slow fall).
function smoothTo(current, target, tauUp, tauDown, dt) {
  const tau = (tauDown != null && target < current) ? tauDown : tauUp;
  if (tau <= 0) return target;
  const k = 1 - Math.exp(-dt / tau);
  return current + (target - current) * k;
}

const median = (arr) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// ---- config (plain data; one object per color-mode test case) -----------------------
export function defaultModeConfig() {
  return {
    colorMode: 'burst',        // 'burst' | 'advance' | 'manual'
    heroFraming: 'k4',         // park keyframe for LIVE (driver resolves to params)
    // handoff geometry — the driver overwrites these each frame from the LIVE director:
    cycleDur: 20.4, winterCycleStart: 61.2, hold4Start: 15.2, hold4Dur: 1.2,
    // drop / season tuning (device-tuned later):
    dropThresh: 0.25, dropRefractoryS: 2.0, bassJump: 0.1,
    advanceOnPhrase: false, seasonMinDwellBeats: 4, seasonRampDur: 3.0,
    manualSeason: 3, manualChromaMix: 0,
    // chroma bloom (transient-only):
    chromaCeil: 0.9, chromaBurst: 0.6, chromaDecayTau: 2.0,
    // camera breath + particle density:
    breathAmp: 0.04, petalIdleMul: 0.2, petalCap: 2.0, bassFloorGain: 1.4,
    beatPulseGain: 0.5, beatPulseGainWinter: 0.18, // winter attenuated (≤3Hz luminance guard)
    trebleSparkleGain: 0.5,
    // bpm jitter guard (pure median-hold over audioState.bpm):
    bpmMedianWindow: 8,
    // overlay grain ride:
    overlayBase: 0.17, overlayGain: 0.8,
  };
}

// ---- state ---------------------------------------------------------------------------
export function initPhaseState(cfg = defaultModeConfig()) {
  return {
    phase: PHASE.INTRO,
    tSec: 0,                   // mirrors the director clock during INTRO
    clk: 0,                    // free-running clock (both phases) for refractory/dwell
    armed: false,
    frozenTSec: null,
    seasonIndex: WINTER, seasonProg: 1,
    chromaEnv: 0,
    lastDropT: -1e9, lastAdvanceBeat: -1e9,
    parkParams: null,
  };
}

export function initFeat() {
  return { levelSlow: 0, bassSlow: 0, levelFast: 0, silenceSec: 0, bpmHist: [] };
}

export function initKnobs(cfg = defaultModeConfig()) {
  return {
    phase: PHASE.INTRO, camParams: null, camBreath: 0,
    seasonIndex: WINTER, seasonProg: 1, chromaMix: 0,
    petalDensity: 1, strobeRate: 2, overlayIntensity: cfg.overlayBase,
  };
}

// ---- pure feature extraction ---------------------------------------------------------
// audioState = AudioEngine.state {level,bass,mid,treble,beat,beatHold,bpm,...}
// clock = {beatPhase, beats, beatJustWrapped} (Clock.js); directorCam optional (driver-set)
export function extractFeatures(audioState, clock, prevFeat, dt, cfg = defaultModeConfig()) {
  const a = audioState;
  const levelSlow = smoothTo(prevFeat.levelSlow, a.level, 3.0, null, dt); // ~3s baseline
  const bassSlow = smoothTo(prevFeat.bassSlow, a.bass, 1.5, null, dt);
  const levelFast = smoothTo(prevFeat.levelFast, a.level, 0.08, null, dt);
  const silenceSec = a.level < 0.02 ? prevFeat.silenceSec + dt : 0;

  const bpmHist = [...prevFeat.bpmHist, a.bpm].slice(-cfg.bpmMedianWindow);
  const bpm = median(bpmHist);

  const buildAmt = clamp((levelFast - levelSlow) / 0.3, 0, 1);

  return {
    level: a.level, levelFast, levelSlow,
    bass: a.bass, bassSlow, mid: a.mid, treble: a.treble,
    beat: !!a.beat, beatHold: a.beatHold || 0, bpm, buildAmt, silenceSec,
    beatPhase: clock.beatPhase, beats: clock.beats, beatJustWrapped: !!clock.beatJustWrapped,
    directorCam: audioState.directorCam || clock.directorCam || null,
    // carry the smoothing state forward (the driver threads this back as prevFeat):
    bpmHist,
  };
}

// ---- pure reducer: the two-phase machine --------------------------------------------
export function reduce(phaseState, feat, cfg, dt) {
  const ps = phaseState;
  const next = { ...ps };
  next.clk = ps.clk + dt;                       // always advances (refractory/dwell, wall-clock)
  // INTRO mirrors the director clock. The driver passes the REAL director tSec via feat.tSec
  // so a pause/scrub keeps the handoff clock in lockstep with the visible intro; tests omit
  // feat.tSec and fall back to self-advancing by dt.
  if (ps.phase === PHASE.INTRO) next.tSec = (feat.tSec != null) ? feat.tSec : ps.tSec + dt;

  // --- drop detection (shared, pure; uses only level/bass + refractory) ---
  const dropSignal = (feat.level - feat.levelSlow) > cfg.dropThresh
    && feat.bass > feat.bassSlow + cfg.bassJump;
  let dropFired = false;
  if (dropSignal && (next.clk - ps.lastDropT) > cfg.dropRefractoryS) {
    dropFired = true;
    next.lastDropT = next.clk;
  }

  // --- INTRO: director owns camera/season/reveal; reactor only accents + handoff ---
  // Arm once the winter cycle begins; fire on the first musical cue while the camera is in
  // ④ hold4, with a hard fallback at the end of hold4 (so we never enter the reverse leg
  // and the transition always completes headlessly). Uses ABSOLUTE tSec windows so a coarse
  // frame step can't skip past a narrow sub-window and miss the deadline.
  if (ps.phase === PHASE.INTRO) {
    if (!next.armed && next.tSec >= cfg.winterCycleStart - EPS) next.armed = true;
    const hold4StartAbs = cfg.winterCycleStart + cfg.hold4Start;
    const hold4EndAbs = hold4StartAbs + cfg.hold4Dur;
    if (next.armed) {
      const inHold4 = next.tSec >= hold4StartAbs - EPS && next.tSec <= hold4EndAbs + EPS;
      const phraseCue = feat.beatJustWrapped && feat.beats % 16 === 0;
      const past = next.tSec >= hold4EndAbs - EPS; // fallback: hold4 elapsed
      if ((inHold4 && (dropFired || phraseCue)) || past) {
        next.phase = PHASE.LIVE;
        next.frozenTSec = hold4StartAbs;
        next.parkParams = feat.directorCam ? { ...feat.directorCam } : null;
        next.seasonIndex = WINTER; next.seasonProg = 1; next.chromaEnv = 0;
      }
    }
  }

  // --- season + chroma (LIVE only owns these; INTRO leaves them for the director) ---
  if (next.phase === PHASE.LIVE) {
    if (cfg.colorMode === 'manual') {
      next.seasonIndex = ((cfg.manualSeason % 4) + 4) % 4;
      next.chromaEnv = cfg.manualChromaMix;
    } else {
      // advance: a drop steps the season (with a min-dwell guard)
      if (cfg.colorMode === 'advance' && dropFired
        && (feat.beats - ps.lastAdvanceBeat) >= cfg.seasonMinDwellBeats) {
        next.seasonIndex = (ps.seasonIndex + 1) % 4;
        next.seasonProg = 0;
        next.lastAdvanceBeat = feat.beats;
      } else {
        next.seasonProg = Math.min(1, ps.seasonProg + dt / cfg.seasonRampDur);
      }
      // chroma is transient-only: a drop blooms, then decays to 0 (mono rest state)
      let env = ps.chromaEnv;
      if (dropFired) env = Math.min(cfg.chromaCeil, env + cfg.chromaBurst);
      env *= Math.exp(-dt / cfg.chromaDecayTau);
      next.chromaEnv = env < 1e-4 ? 0 : env;
    }
  }

  // --- knob TARGETS (the driver eases these via smoothKnobs) ---
  const live = next.phase === PHASE.LIVE;
  const winter = next.seasonIndex === WINTER;

  // petal density (→ particles uEmitMul). INTRO keeps the authored full look + tiny shimmer.
  const trebleSparkle = clamp((feat.treble - 0.1) / 0.6, 0, 1) * cfg.trebleSparkleGain;
  let petalDensity;
  if (live) {
    const bassFloor = feat.bass * cfg.bassFloorGain;
    const beatSpike = feat.beat ? (winter ? cfg.beatPulseGainWinter : cfg.beatPulseGain) : 0;
    petalDensity = clamp(Math.max(cfg.petalIdleMul, bassFloor) + beatSpike + trebleSparkle, 0, cfg.petalCap);
  } else {
    petalDensity = clamp(1 + trebleSparkle * 0.3, 0, cfg.petalCap); // authored full + subtle accent
  }

  const targets = {
    phase: next.phase,
    camParams: live ? next.parkParams : null,           // INTRO: director owns camera
    camBreath: live ? Math.pow(clamp(feat.level, 0, 1), 1.5) : 0,
    seasonIndex: next.seasonIndex,
    seasonProg: next.seasonProg,
    chromaMix: clamp(next.chromaEnv, 0, 1),              // owned by reduce; smoothKnobs passes through
    petalDensity,
    strobeRate: Math.min(3, feat.bpm / 60),             // ≤3Hz hard cap; only used when VJ gate on
    overlayIntensity: clamp(cfg.overlayBase + feat.levelSlow * cfg.overlayGain, 0, 1),
  };

  return { next, targets };
}

// ---- pure knob smoothing (stateless expSmooth; no EnvelopeFollower) ------------------
// Per-knob τ (seconds). chromaMix/seasonIndex/seasonProg/camParams/phase pass through
// (chroma is already integrated by reduce; season is discrete; camParams is constant in LIVE).
const TAU = {
  camBreath: { up: 0.8, down: 0.8 },
  overlayIntensity: { up: 1.2, down: 1.2 },
  petalDensity: { up: 0.06, down: 0.35 }, // fast kick, slow fall → the beat accent reads
  strobeRate: { up: 0.3, down: 0.3 },
};
const KNOB_DOMAIN = { camBreath: [0, 1], overlayIntensity: [0, 1], strobeRate: [0, 3] };

export function smoothKnobs(prevKnobs, targets, dt, cfg = defaultModeConfig()) {
  const out = { ...targets };
  for (const key of Object.keys(TAU)) {
    const t = TAU[key];
    let v = smoothTo(prevKnobs[key], targets[key], t.up, t.down, dt);
    const dom = KNOB_DOMAIN[key];
    if (dom) v = clamp(v, dom[0], dom[1]);
    out[key] = v;
  }
  out.petalDensity = clamp(out.petalDensity, 0, cfg.petalCap); // own domain (not [0,1])
  // pass-through (no double-smoothing): phase, camParams, seasonIndex, seasonProg, chromaMix
  out.chromaMix = clamp(targets.chromaMix, 0, 1);
  return out;
}
