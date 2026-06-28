import { CONFIG } from '../config.js';
import { clamp } from '../lib/math.js';
import { EnvelopeFollower } from './smoothing.js';
import { BeatDetector } from './BeatDetector.js';

// Owns the AudioContext + mic analyser and exposes a read-only state object
// that scenes consume each frame. Scenes never touch the Web Audio graph.
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.analyser = null;
    this.stream = null;
    this.source = null;
    this.freq = null; // Uint8Array spectrum
    this.time = null; // Uint8Array waveform
    this.binHz = 0;

    this.sensitivity = CONFIG.SENSITIVITY;
    this.beatSource = 'auto'; // 'auto' | 'tap'
    this._tapBpm = 120;
    this._manualBeatPending = false;

    this._envLevel = new EnvelopeFollower(CONFIG.SMOOTH_ATTACK, CONFIG.SMOOTH_RELEASE);
    this._envBass = new EnvelopeFollower(CONFIG.SMOOTH_ATTACK, CONFIG.SMOOTH_RELEASE);
    this._envMid = new EnvelopeFollower(CONFIG.SMOOTH_ATTACK, CONFIG.SMOOTH_RELEASE);
    this._envTreble = new EnvelopeFollower(CONFIG.SMOOTH_ATTACK, CONFIG.SMOOTH_RELEASE);
    this._beatDetector = new BeatDetector();

    this.state = {
      ready: false,
      level: 0, bass: 0, mid: 0, treble: 0,
      beat: false, beatHold: 0,
      bpm: 120,
      spectrum: new Uint8Array(0),
      waveform: new Uint8Array(0),
    };
  }

  // MUST be called from a user gesture (tap). Returns true on success.
  async start() {
    if (this.state.ready) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    // Fire both gesture-sensitive calls synchronously, before any await, so
    // iOS Safari keeps them inside the activating user gesture.
    const constraints = { audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }, video: false };
    const streamPromise = navigator.mediaDevices.getUserMedia(constraints);
    const resumePromise = this.ctx.resume();

    let stream;
    try {
      stream = await streamPromise;
    } catch (e) {
      // Some iPads reject the strict constraint set: retry once, relaxed.
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    }
    await resumePromise.catch(() => {});

    this.stream = stream;
    this.source = this.ctx.createMediaStreamSource(stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = CONFIG.FFT_SIZE;
    this.analyser.smoothingTimeConstant = 0; // we do our own smoothing
    this.source.connect(this.analyser);
    // NOTE: do not connect to ctx.destination — we don't want mic feedback.

    const bins = this.analyser.frequencyBinCount;
    this.freq = new Uint8Array(bins);
    this.time = new Uint8Array(bins);
    this.state.spectrum = this.freq;
    this.state.waveform = this.time;
    this.binHz = this.ctx.sampleRate / CONFIG.FFT_SIZE;

    this.state.ready = true;
    // Recover a context that gets suspended later (tab switch, OS audio focus).
    if (!this._visBound) {
      this._visBound = true;
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden && this.ctx) this.ctx.resume().catch(() => {});
      });
    }
    return true;
  }

  setSensitivity(v) { this.sensitivity = v; }
  setBeatSource(src) { this.beatSource = src; }
  // Tap-tempo: call repeatedly on UI taps; also fires a manual beat now.
  tap(nowMs) {
    this._manualBeatPending = true;
    if (this._lastTapMs) {
      const dt = nowMs - this._lastTapMs;
      if (dt > 250 && dt < 2000) {
        let bpm = 60000 / dt;
        while (bpm > 180) bpm /= 2;
        while (bpm < 70) bpm *= 2;
        this._tapBpm += (bpm - this._tapBpm) * 0.5;
      }
    }
    this._lastTapMs = nowMs;
  }

  _bandEnergy(loHz, hiHz) {
    const lo = Math.max(0, Math.floor(loHz / this.binHz));
    const hi = Math.min(this.freq.length - 1, Math.ceil(hiHz / this.binHz));
    let sum = 0;
    for (let i = lo; i <= hi; i++) sum += this.freq[i];
    return sum / (hi - lo + 1) / 255; // raw band average, 0..1 (gain applied by caller)
  }

  update(nowMs) {
    const s = this.state;
    if (!s.ready) return;
    // Autoplay policy can leave the AudioContext suspended even after the start
    // gesture; re-resume so the analyser actually receives samples (otherwise
    // levels read zero and nothing reacts despite the mic being connected).
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    this.analyser.getByteFrequencyData(this.freq);
    this.analyser.getByteTimeDomainData(this.time);

    // RMS loudness from time-domain (centered at 128).
    let sumSq = 0;
    for (let i = 0; i < this.time.length; i++) {
      const v = (this.time[i] - 128) / 128;
      sumSq += v * v;
    }
    const rms = Math.sqrt(sumSq / this.time.length);
    // Fixed RMS gain (CONFIG.LEVEL_GAIN); sensitivity is applied once, same as bands.
    const rawLevel = clamp(rms * CONFIG.LEVEL_GAIN * this.sensitivity, 0, 1);

    // Apply the band gain UNDER the user sensitivity. Keep an UNCLAMPED boosted bass
    // for the beat detector: its onset test is a ratio (peak vs running mean), so a
    // hard clamp at 1.0 would flatten loud kicks into the mean and kill detection.
    const G = CONFIG.BAND_GAIN * this.sensitivity;
    const bassBoost = this._bandEnergy(CONFIG.BANDS.bass[0], CONFIG.BANDS.bass[1]) * G;
    const midBoost = this._bandEnergy(CONFIG.BANDS.mid[0], CONFIG.BANDS.mid[1]) * G;
    const trebleBoost = this._bandEnergy(CONFIG.BANDS.treble[0], CONFIG.BANDS.treble[1]) * G;

    s.level = this._envLevel.push(rawLevel);
    s.bass = this._envBass.push(clamp(bassBoost, 0, 1));
    s.mid = this._envMid.push(clamp(midBoost, 0, 1));
    s.treble = this._envTreble.push(clamp(trebleBoost, 0, 1));

    // Beat detection.
    let beat = false;
    if (this.beatSource === 'auto') {
      this._beatDetector.sensitivity = CONFIG.BEAT_SENSITIVITY;
      beat = this._beatDetector.push(bassBoost, nowMs);
      s.bpm = this._beatDetector.bpm;
    } else {
      s.bpm = this._tapBpm;
      if (this._manualBeatPending) { beat = true; this._manualBeatPending = false; }
    }

    s.beat = beat;
    if (beat) s.beatHold = 1;
    else s.beatHold *= 0.9;
  }
}
