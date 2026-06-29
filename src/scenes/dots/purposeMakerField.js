// PURE, deterministic line<->particle "breathing" for PurposeMaker.
//
// The source reel's turbulence pulses between two regimes (re-analysed 2026-06-30):
//   LINE     (K->1): coherent — low spatial frequency, strong directional stretch,
//                     long bright aligned filament streaks. The plume reaches forward.
//   PARTICLE (K->0): incoherent — high frequency, weak advection, short scattered
//                     luminous dust. The plume falls back.
// breathAt() returns the breathing scalar K(t) plus the dimensionless field controls
// the scene maps into its turbulence + drawing, so one signal drives every texture cue
// at once. Audio (beat/bass/level/treble) pushes K up, so the STRUCTURE snaps to the
// music — the headline reactive element. No Date/random/performance.now (clock + audio
// scalars only) => operator/output mirror + reload reproducibility.

const TAU = Math.PI * 2;

function smoother(x) {
  if (x <= 0) return 0; if (x >= 1) return 1;
  return x * x * x * (x * (x * 6 - 15) + 10);
}
function clamp01(v) { return v == null ? 0 : v < 0 ? 0 : v > 1 ? 1 : v; }

// Organic baseline breath in [0,1]: two incommensurate sines so it never settles into
// an obvious loop, smoothered to linger near the extremes (clear lines / clear dust).
export function baseBreath(t) {
  const a = Math.sin(t * (TAU / 3.7));
  const b = Math.sin(t * (TAU / 5.9) + 1.7);
  const osc = (0.6 * a + 0.4 * b) * 0.5 + 0.5; // -> ~0..1
  // widen toward the rails so we genuinely reach dust and lines, then ease.
  const wide = clamp01((osc - 0.5) * 1.35 + 0.5);
  return smoother(wide);
}

// audio: { level, bass, treble, beatHold }  (scalars 0..1; beat folded into beatHold)
// opts:  { react=1, audioOn=true }
// Returns { K, speed, elong, bright, advance, scatter, forward, shimmer, ripple }.
export function breathAt(t, audio, opts) {
  const o = opts || {};
  const react = o.react == null ? 1 : o.react;
  const audioOn = o.audioOn !== false;
  const a = audio || {};
  const level = clamp01(a.level), bass = clamp01(a.bass), treble = clamp01(a.treble);
  const beatHold = clamp01(a.beatHold);

  const breath = baseBreath(t);
  let K;
  if (audioOn) {
    // Beat punches K toward lines; bass sustains; level adds floor energy. The
    // baseline still breathes underneath so quiet passages keep moving.
    const audE = react * (0.55 * beatHold + 0.40 * bass + 0.15 * level);
    K = clamp01(0.05 + 0.45 * breath + audE);
  } else {
    K = clamp01(0.04 + 0.62 * breath);
  }

  const energy = audioOn ? clamp01(0.6 * level + 0.4 * bass) : 0;
  return {
    K,
    speed: 0.55 + 0.85 * K + 0.50 * energy,        // line state & loud -> faster
    elong: 0.30 + 1.50 * K,                        // streak elongation (line -> long)
    bright: 0.45 + 0.55 * K + 0.35 * energy,       // line state & loud -> brighter
    advance: K,                                    // directional stretch weight 0..1
    scatter: 1 - 0.85 * K,                         // curl/noise amplitude (dust -> high)
    forward: 0.035 + 0.11 * K,                     // net forward drift along flow
    shimmer: audioOn ? treble : 0,                 // hi-freq per-particle jitter (hats)
    ripple: audioOn ? clamp01(0.5 * level + 0.5 * bass) : 0, // transverse waveform amp
  };
}
