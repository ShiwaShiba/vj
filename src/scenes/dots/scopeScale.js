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
