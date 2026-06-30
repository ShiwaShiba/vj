// PURE, deterministic COUPLING between the choreography and the texture morph.
//
// This is the fix for "the fluid and the hand are two separate effects": the hand is the
// fluid CONVERGING, so its convergence AND its texture must be driven by one signal — the
// choreography's build progress g(t) in [0,1] (rises over gather, 1 at hold, falls over
// disperse, 0 at gap). formAt(g) turns g into the form descriptor the scene maps onto its
// recruited particles, so as the hand builds it morphs through:
//
//   dust  ->  multiple lines  ->  particle planes/bands  ->  the hand's grains
//   (g~0)     (line peaks ~0.30)   (sheet peaks ~0.60)       (conv -> 1 at g=1)
//
// Because formAt is a pure function of g, disperse (g falling) replays the build in reverse
// for free — the "逆展開". Audio (beat/bass) rides the SAME signal additively (it punches the
// line-snap and nudges convergence) so the structure reacts to the music. No Date/random/
// performance.now (g + audio scalars only) => operator/output mirror + reload reproducibility.

function smoother(x) {
  if (x <= 0) return 0; if (x >= 1) return 1;
  return x * x * x * (x * (x * 6 - 15) + 10);
}
function clamp01(v) { return v == null || v !== v ? 0 : v < 0 ? 0 : v > 1 ? 1 : v; } // NaN -> 0 (defensive on external audio)

// A smooth bell over g: 0 outside [lo,hi], 1 at mid. Exactly 0 at and beyond the rails so a
// phase's weight fully vanishes at g=0 and g=1 (no stray lines on the flat hand or in dust).
export function riseFall(g, lo, mid, hi) {
  if (g <= lo || g >= hi) return 0;
  return g < mid ? smoother((g - lo) / (mid - lo)) : smoother((hi - g) / (hi - mid));
}

export const GHOLD = 0.45;   // convergence onset: the hand only resolves in the back of gather
export const ADV_BASE = 1.0; // streaming-carry magnitude before the grains lock

// g:     build progress in [0,1] from cohesionAt().c
// audio: { beatHold, bass } (scalars 0..1; beat folded into beatHold)
// opts:  { react=1, audioOn=true }
// Returns the dimensionless form controls the scene maps onto recruited particles + draw:
//   conv     0..1  convergence onto the hand grains (pure g; the audio nudge is snapConv)
//   line     0..1  filament-comb weight (peaks early-mid)
//   sheet    0..1  z-band / plane weight (peaks after lines)
//   advance  0..1  net streaming carry, dies as conv -> 1
//   snapLine 0..1  beat punch on the filaments (line-snap)
//   snapConv 0..1  small beat nudge on convergence (applied by the scene)
//   flash    0..1  additive beat brightness transient
export function formAt(g, audio, opts) {
  const o = opts || {}, react = o.react == null ? 1 : o.react, audioOn = o.audioOn !== false;
  const a = audio || {}, beatHold = clamp01(a.beatHold), bass = clamp01(a.bass);
  const conv = smoother(clamp01((g - GHOLD) / (1 - GHOLD)));
  const line = riseFall(g, 0.05, 0.30, 0.62);
  const sheet = riseFall(g, 0.28, 0.60, 0.92);
  const snap = audioOn ? react * (0.80 * beatHold + 0.20 * Math.max(0, bass - 0.25)) : 0;
  return {
    conv,
    line,
    sheet,
    advance: ADV_BASE * (1 - conv),
    snapLine: clamp01(snap),
    snapConv: clamp01(0.25 * snap),
    flash: audioOn ? beatHold : 0,
  };
}
