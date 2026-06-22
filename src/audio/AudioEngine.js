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
    this.source = this.ctx.createMediaStreamAudioSource(stream);
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
    const avg = sum / (hi - lo + 1) / 255; // 0..1
    return clamp(avg * this.sensitivity, 0, 1);
  }

  update(nowMs) {
    const s = this.state;
    if (!s.ready) return;
    this.analyser.getByteFrequencyData(this.freq);
    this.analyser.getByteTimeDomainData(this.time);

    // RMS loudness from time-domain (centered at 128).
    let sumSq = 0;
    for (let i = 0; i < this.time.length; i++) {
      const v = (this.time[i] - 128) / 128;
      sumSq += v * v;
    }
    const rms = Math.sqrt(sumSq / this.time.length);
    // 2.2 is a fixed RMS gain; sensitivity is applied once, same as bands.
    const rawLevel = clamp(rms * 2.2 * this.sensitivity, 0, 1);

    const rawBass = this._bandEnergy(CONFIG.BANDS.bass[0], CONFIG.BANDS.bass[1]);
    const rawMid = this._bandEnergy(CONFIG.BANDS.mid[0], CONFIG.BANDS.mid[1]);
    const rawTreble = this._bandEnergy(CONFIG.BANDS.treble[0], CONFIG.BANDS.treble[1]);

    s.level = this._envLevel.push(rawLevel);
    s.bass = this._envBass.push(rawBass);
    s.mid = this._envMid.push(rawMid);
    s.treble = this._envTreble.push(rawTreble);

    // Beat detection.
    let beat = false;
    if (this.beatSource === 'auto') {
      this._beatDetector.sensitivity = CONFIG.BEAT_SENSITIVITY;
      beat = this._beatDetector.push(rawBass, nowMs);
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
