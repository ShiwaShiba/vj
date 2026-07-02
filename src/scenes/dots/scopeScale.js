// src/scenes/dots/scopeScale.js
// Pure soft-ceiling for the Oscilloscope figure's on-screen half-extent.
// GAIN/RANGE and the audio-reactive term multiply a per-mode scale with no upper
// bound, so a loud transient or high gain can throw the figure several times the
// frame — worst exactly at a switch/drop. softCap keeps growth fully linear up to
// knee×cap (normal-level motion untouched), then compresses with an exponential
// soft-knee that asymptotes to `cap` and never exceeds it. Deterministic, no DOM.

// Compression begins at knee×cap; below that the value passes through unchanged.
export function softCap(e, cap, knee = 0.9) {
  if (!(cap > 0) || !(e > 0)) return 0;
  if (e <= knee * cap) return e;
  const kneeAt = knee * cap;
  const over = (e - kneeAt) / (cap - kneeAt); // 0..∞ beyond the knee
  return kneeAt + (cap - kneeAt) * (1 - Math.exp(-over));
}

// Multiplier (≤1) that brings a raw extent within the soft ceiling. Multiply a
// mode's scale by this to fit the whole figure uniformly; == 1 below the knee.
export function fitScale(rawExtent, cap, knee = 0.9) {
  return rawExtent > 1e-6 ? softCap(rawExtent, cap, knee) / rawExtent : 1;
}

// On-screen half-extent of a Sphere/LISSA figure as a fraction of reach·baseR,
// given the waveform's current peak (0..1) — the number the fit-clamp needs to
// size the projection radius. Derived from _spreadPoint's geometry so the clamp
// tracks the figure's ACTUAL extent instead of reserving room for a full-scale
// wave that a quiet mic never sends (which pins the figure small even at max
// gain/range). Feeding the real peak lets a quiet figure grow to fill the frame
// while a loud one still clamps. Spread indices match the Spread modeGroup
// (0 LISSA, 1 SPHERE, 2 TOROID, 3 QUAD, 4 RIBBON); HELIX (5) is sized by the
// caller (its extent is the axial coil height, not waveform-driven) and never
// passed here. peak=1 reproduces the prior full-scale sizing (SPHERE/TOROID are
// tightened to their exact 1.0 radius; they never collapse — hence the floor).
export function lissaExtentFrac(spread, peak) {
  const p = peak < 0 ? 0 : peak > 1 ? 1 : peak;
  switch (spread) {
    case 1: return 0.55 + 0.45 * p; // SPHERE — radius reach·(0.55 + 0.45|w|), structural floor
    case 2: return 0.66 + 0.34 * p; // TOROID — ring ≈ reach·(0.66 + 0.34|w|), structural floor
    case 4: return 1.30 * p;        // RIBBON — QUAD centreline (× ribbon extent const), ∝ peak
    default: return 1.15 * p;       // LISSA(0) / QUAD(3) — self-correlation, collapses ∝ peak
  }
}
