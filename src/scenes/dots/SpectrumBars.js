import { Scene } from '../Scene.js';
import { rgbCss, TWO_PI, clamp } from '../../lib/math.js';

// Classic FFT spectrum. Modes: linear bars, mirrored center, radial ring.
// Bins are grouped on a roughly log scale so bass and treble both read well.
export class SpectrumBars extends Scene {
  constructor() {
    super('spectrum', 'Spectrum');
    this.trail = 1;
    this.modes = [{ name: 'Bars' }, { name: 'Mirror' }, { name: 'Radial' }];
    this.defineParam('bars', 64, 24, 128, 4, 'Bars');
    this.vals = new Float32Array(128);
  }
  update(dt, audio, palette, clock) {
    this.spectrum = audio.spectrum;
    this.beat = audio.beatHold;
    const n = Math.round(this.p('bars'));
    const spec = audio.spectrum;
    if (!spec || !spec.length) return;
    // Log-ish grouping across the lower ~3/4 of the spectrum.
    const usable = Math.floor(spec.length * 0.7);
    for (let i = 0; i < n; i++) {
      const lo = Math.floor(Math.pow(i / n, 1.7) * usable);
      const hi = Math.max(lo + 1, Math.floor(Math.pow((i + 1) / n, 1.7) * usable));
      let m = 0;
      for (let b = lo; b < hi; b++) m = Math.max(m, spec[b]);
      const target = m / 255;
      // smooth fall for a springy look
      this.vals[i] = target > this.vals[i] ? target : this.vals[i] + (target - this.vals[i]) * 0.2;
    }
  }
  draw(ctx, alpha) {
    const n = Math.round(this.p('bars'));
    const mode = this.modeIndex;
    if (mode === 2) return this._radial(ctx, n);
    const bw = this.w / n;
    for (let i = 0; i < n; i++) {
      const v = this.vals[i];
      const col = this.palette.colorAt(i / n);
      ctx.fillStyle = rgbCss(col);
      const bh = v * this.h * (mode === 1 ? 0.46 : 0.92);
      const x = i * bw;
      if (mode === 1) {
        const cy = this.h / 2;
        ctx.fillRect(x, cy - bh, bw - 2, bh);
        ctx.fillRect(x, cy, bw - 2, bh);
      } else {
        ctx.fillRect(x, this.h - bh, bw - 2, bh);
      }
    }
  }
  _radial(ctx, n) {
    const cx = this.w / 2, cy = this.h / 2;
    const r0 = Math.min(this.w, this.h) * 0.18 * (1 + this.beat * 0.2);
    const maxLen = Math.min(this.w, this.h) * 0.34;
    ctx.lineCap = 'round';
    for (let i = 0; i < n; i++) {
      const v = this.vals[i];
      const a = (i / n) * TWO_PI - Math.PI / 2;
      const len = r0 + v * maxLen;
      const col = this.palette.colorAt(i / n);
      ctx.strokeStyle = rgbCss(col);
      ctx.lineWidth = clamp((TWO_PI * r0) / n - 2, 2, 14);
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      ctx.lineTo(cx + Math.cos(a) * len, cy + Math.sin(a) * len);
      ctx.stroke();
    }
  }
}
