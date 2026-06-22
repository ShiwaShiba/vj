import { Scene } from '../Scene.js';
import { rgbCss, TWO_PI } from '../../lib/math.js';

// Time-domain waveform. Modes: horizontal scope, circular scope, XY (the
// waveform plotted against a delayed copy of itself for Lissajous-like loops).
export class Oscilloscope extends Scene {
  constructor() {
    super('scope', 'Oscilloscope');
    this.trail = 0.3;
    this.modes = [{ name: 'Line' }, { name: 'Circle' }, { name: 'XY' }];
    this.defineParam('thickness', 3, 1, 8, 0.5, 'Thickness');
    this.defineParam('gain', 1, 0.3, 3, 0.1, 'Gain');
  }
  update(dt, audio, palette, clock) {
    this.wave = audio.waveform;
    this.level = audio.level;
    this.t = clock.time;
  }
  draw(ctx, alpha) {
    const wave = this.wave;
    if (!wave || !wave.length) return;
    const mode = this.modeIndex;
    const gain = this.p('gain');
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
        const y = cy + ((wave[i] - 128) / 128) * this.h * 0.4 * gain;
        if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    } else if (mode === 1) {
      const cx = this.w / 2, cy = this.h / 2;
      const r0 = Math.min(this.w, this.h) * 0.25;
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
      const s = Math.min(this.w, this.h) * 0.42 * gain;
      const lag = 8 * step;
      ctx.strokeStyle = rgbCss(this.palette.colorAt((this.t * 0.1) % 1));
      ctx.beginPath();
      let first = true;
      for (let i = 0; i + lag < wave.length; i += step) {
        const x = cx + ((wave[i] - 128) / 128) * s;
        const y = cy + ((wave[i + lag] - 128) / 128) * s;
        if (first) { ctx.moveTo(x, y); first = false; } else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }
}
