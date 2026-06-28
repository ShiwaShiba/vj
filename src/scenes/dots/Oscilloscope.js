import { Scene } from '../Scene.js';
import { rgbCss, TWO_PI } from '../../lib/math.js';

// Time-domain waveform. Modes: horizontal scope, circular scope, XY (the
// waveform plotted against a delayed copy of itself for Lissajous-like loops).
//
// XY is the headline mode. Beyond gain/range it exposes parameter-driven
// variation: Phase (the self-correlation lag = the loop SHAPE), Flip (mirror
// one axis = reverse the bass diagonal UL/LR <-> LL/UR), a Drive band selector
// (BASS / TREBLE / LEVEL drives the breathing scale; small bands lifted by a
// gamma so treble — which rarely peaks — still reads), and Rotate (spin the
// whole figure). Spin has an explicit OFF/ON toggle so stopping the rotation is
// one tap (no hunting for slider-zero), and the Rotate slider has a centre
// dead-zone so its middle is a reliable "stopped" position on a touchscreen.
// Auto wanders all of these hands-off, fully deterministic from clock
// time/beats (no Math.random/Date), so an unattended scope keeps evolving.
export class Oscilloscope extends Scene {
  constructor() {
    super('scope', 'Oscilloscope');
    this.trail = 0.3;
    this.modes = [{ name: 'Line' }, { name: 'Circle' }, { name: 'XY' }];
    this.defineParam('thickness', 3, 1, 8, 0.5, 'Thickness');
    this.defineParam('gain', 1, 0.3, 3, 0.1, 'Gain');
    this.defineParam('range', 1, 0.4, 2.2, 0.1, 'Range');
    // XY-mode levers (no effect in Line/Circle).
    this.defineParam('phase', 8, 1, 64, 1, 'Phase');     // self-correlation lag = loop shape
    this.defineParam('rotate', 0, -0.5, 0.5, 0.02, 'Rotate'); // spin speed/dir, rev/s (centre dead-zone)
    this.defineParam('drive', 0.6, 0, 1.5, 0.05, 'Drive');    // band-driven breathing depth
    // Button groups (rendered by ControlPanel; only meaningful in XY).
    // Spin OFF freezes the figure instantly regardless of the Rotate slider.
    this.modeGroups = [
      { key: 'drive', label: 'Drive', options: ['BASS', 'TREBLE', 'LEVEL'], index: 0 },
      { key: 'flip', label: 'Flip', options: ['OFF', 'ON'], index: 0 },
      { key: 'spin', label: 'Spin', options: ['OFF', 'ON'], index: 1 },
      { key: 'auto', label: 'Auto', options: ['OFF', 'ON'], index: 0 },
    ];
    this._spin = 0; // accumulated rotation, radians
  }

  update(dt, audio, palette, clock) {
    this.wave = audio.waveform;
    this.level = audio.level;
    this.bass = audio.bass;
    this.treble = audio.treble;
    this.t = clock.time;
    this.beats = clock.beats;

    // Rotation: manual slider, OR a slow bold wander when Auto is on. Band is
    // intentionally NOT mixed into spin — Drive drives the scale, Rotate the
    // spin — so each lever stays predictable. Auto is the master override; below
    // it, Spin OFF freezes the figure and the Rotate slider has a centre
    // dead-zone so its middle reliably means "stopped" on a touchscreen.
    let spinRate;
    if (this.mg('auto') === 1) {
      spinRate = 0.05 + 0.035 * Math.sin(this.t * 0.045 * TWO_PI); // ~0.015..0.085 rev/s
    } else if (this.mg('spin') === 1) {
      let r = this.p('rotate'); // rev/s
      if (Math.abs(r) < 0.03) r = 0; // centre dead-zone (catches 0 and ±one step)
      spinRate = r;
    } else {
      spinRate = 0; // Spin OFF — frozen wherever it is, slider ignored
    }
    this._spin = (this._spin + dt * spinRate * TWO_PI) % TWO_PI;
  }

  // Effective XY controls. Auto overrides the manual values with deterministic
  // time/beat functions so the figure evolves on its own.
  _effPhase() {
    if (this.mg('auto') === 1) {
      // sweep 4..60 over ~12.5s — bold range, slow period
      return 4 + (Math.sin(this.t * 0.08 * TWO_PI) * 0.5 + 0.5) * 56;
    }
    return this.p('phase');
  }
  _effFlip() {
    if (this.mg('auto') === 1) return Math.floor(this.beats / 16) % 2 === 1; // flip every 4 bars
    return this.mg('flip') === 1;
  }
  _effBandIndex() {
    if (this.mg('auto') === 1) return Math.floor(this.beats / 32) % 3; // cycle every 8 bars
    return this.mg('drive');
  }
  _driveEnergy() {
    const idx = this._effBandIndex();
    const raw = idx === 0 ? this.bass : idx === 1 ? this.treble : this.level;
    const b = raw < 0 ? 0 : raw > 1 ? 1 : raw;
    return Math.pow(b, 0.6); // lift small bands so treble still reads
  }

  draw(ctx, alpha) {
    const wave = this.wave;
    if (!wave || !wave.length) return;
    const mode = this.modeIndex;
    const gain = this.p('gain');
    const range = this.p('range');
    ctx.lineWidth = this.p('thickness') + this.level * 3;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.globalCompositeOperation = 'lighter';
    const step = Math.max(1, Math.floor(wave.length / 512));

    if (mode === 0) {
      ctx.strokeStyle = rgbCss(this.palette.colorAt((this.t * 0.1) % 1));
      ctx.beginPath();
      const cy = this.h / 2;
      for (let i = 0, k = 0; i < wave.length; i += step, k++) {
        const x = (i / (wave.length - 1)) * this.w;
        const y = cy + ((wave[i] - 128) / 128) * this.h * 0.4 * gain * range;
        if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    } else if (mode === 1) {
      const cx = this.w / 2, cy = this.h / 2;
      const r0 = Math.min(this.w, this.h) * 0.25 * range;
      ctx.strokeStyle = rgbCss(this.palette.colorAt((this.t * 0.1) % 1));
      ctx.beginPath();
      let first = true;
      const N = Math.floor(wave.length / step);
      for (let i = 0, k = 0; i < wave.length; i += step, k++) {
        const a = (k / N) * TWO_PI;
        const r = r0 + ((wave[i] - 128) / 128) * r0 * 0.9 * gain;
        const x = cx + Math.cos(a) * r;
        const y = cy + Math.sin(a) * r;
        if (first) { ctx.moveTo(x, y); first = false; } else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.stroke();
    } else {
      const cx = this.w / 2, cy = this.h / 2;
      // Band breathes the figure; Drive sets how strongly.
      const band = this._driveEnergy();
      const s = Math.min(this.w, this.h) * 0.42 * gain * range * (1 + this.p('drive') * band * 0.9);
      const lag = Math.max(1, Math.round(this._effPhase())) * step;
      const flip = this._effFlip() ? -1 : 1;
      const cosA = Math.cos(this._spin), sinA = Math.sin(this._spin);
      ctx.strokeStyle = rgbCss(this.palette.colorAt((this.t * 0.1) % 1));
      ctx.beginPath();
      let first = true;
      for (let i = 0; i + lag < wave.length; i += step) {
        const px = ((wave[i] - 128) / 128) * s;
        const py = ((wave[i + lag] - 128) / 128) * s * flip;
        const x = cx + px * cosA - py * sinA;
        const y = cy + px * sinA + py * cosA;
        if (first) { ctx.moveTo(x, y); first = false; } else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }
}
