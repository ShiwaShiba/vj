// Global configuration constants for the VJ app.
// Tunable in one place; imported wherever needed.

export const CONFIG = {
  // Debug overlay (FPS + audio readout). Toggle with the "D" key on desktop.
  DEBUG: false,

  // Cap device pixel ratio so retina iPads don't over-render and tank FPS.
  MAX_DPR: 2,

  // --- Audio analysis ---
  FFT_SIZE: 2048, // -> 1024 frequency bins
  // Frequency band edges in Hz (mapped to FFT bins using the actual sampleRate).
  BANDS: {
    bass: [20, 250],
    mid: [250, 2000],
    treble: [2000, 8000],
  },
  // Exponential smoothing: fast attack (rise), slow release (fall).
  SMOOTH_ATTACK: 0.5,
  SMOOTH_RELEASE: 0.12,
  // Default mic input gain (user-adjustable via UI).
  SENSITIVITY: 1.4,

  // --- Beat detection ---
  BEAT_HISTORY: 43, // frames (~0.7s at 60fps)
  BEAT_REFRACTORY_MS: 250, // ignore beats closer than this
  BEAT_SENSITIVITY: 1.0, // multiplier on the adaptive threshold

  // --- Engine ---
  DT_CLAMP_MS: 50, // clamp frame delta to survive tab-switch stalls
  CROSSFADE_MS: 600, // scene crossfade duration
  TRAIL_DEFAULT: 0.18, // background persistence (motion trails); 1 = full clear

  // --- Auto-pilot / loop ---
  AUTO_ADVANCE_BEATS: 16, // beats between auto scene/palette changes when Loop is on

  // --- Dancers ---
  DANCER_COUNT: 8,
  DANCER_MAX: 14,

  // --- Adaptive quality ---
  PERF_BUDGET_MS: 22, // if frame work exceeds this for a while, drop quality
  PERF_WINDOW: 90, // frames to average before adjusting
};
