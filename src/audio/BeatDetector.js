import { CONFIG } from '../config.js';

// Adaptive-threshold onset detection on the bass band.
// Standard, cheap, and robust for live-mic VJ work.
export class BeatDetector {
  constructor() {
    this.size = CONFIG.BEAT_HISTORY;
    this.history = new Float32Array(this.size);
    this.idx = 0;
    this.filled = 0;
    this.lastBeatMs = -1e9;
    this.sensitivity = CONFIG.BEAT_SENSITIVITY;
    // BPM estimation from inter-onset intervals (median of a small window).
    this.intervals = [];
    this.bpm = 120;
  }

  // Returns true on the frame a beat is detected.
  push(bassEnergy, nowMs) {
    // Compute stats over current history (before inserting the new sample).
    let mean = 0;
    const n = this.filled || 1;
    for (let i = 0; i < n; i++) mean += this.history[i];
    mean /= n;
    let variance = 0;
    for (let i = 0; i < n; i++) {
      const d = this.history[i] - mean;
      variance += d * d;
    }
    variance /= n;

    // Insert new sample.
    this.history[this.idx] = bassEnergy;
    this.idx = (this.idx + 1) % this.size;
    if (this.filled < this.size) this.filled++;

    // Adaptive threshold: spikier signals require a bigger jump to count.
    // Capped so live-mic room noise (high variance) doesn't kill detection.
    const C = (1.25 + 0.8 * Math.min(variance, 1.5)) / this.sensitivity;
    const isLoudEnough = bassEnergy > 0.04; // ignore near-silence
    const refractoryOk = nowMs - this.lastBeatMs > CONFIG.BEAT_REFRACTORY_MS;

    if (this.filled >= 4 && isLoudEnough && refractoryOk && bassEnergy > mean * C) {
      if (this.lastBeatMs > -1e8) {
        const interval = nowMs - this.lastBeatMs;
        if (interval > 200 && interval < 2000) {
          this.intervals.push(interval);
          if (this.intervals.length > 8) this.intervals.shift();
          this._updateBpm();
        }
      }
      this.lastBeatMs = nowMs;
      return true;
    }
    return false;
  }

  _updateBpm() {
    const arr = [...this.intervals].sort((a, b) => a - b);
    const median = arr[Math.floor(arr.length / 2)];
    let bpm = 60000 / median;
    while (bpm > 180) bpm /= 2;
    while (bpm < 70) bpm *= 2;
    // Ease toward the new estimate to avoid jitter.
    this.bpm += (bpm - this.bpm) * 0.3;
  }
}
