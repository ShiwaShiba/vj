import { Scene } from '../Scene.js';

// Binary data fields — the Ikeda staple. Vertical barcode that reshuffles on
// the beat, a flickering data matrix, and a glitch scan. Stark on/off cells.
export class Datamatrix extends Scene {
  constructor() {
    super('data', 'Datamatrix');
    this.trail = 1;
    this.modes = [{ name: 'Barcode' }, { name: 'Matrix' }, { name: 'Scan' }];
    this.defineParam('cols', 72, 16, 160, 4, 'Density');
    this.t = 0;
    this.beats = 0;
  }
  update(dt, audio, palette, clock) {
    this.t = clock.time;
    this.beats = clock.beats;
    this.level = audio.level;
    this.bass = audio.bass;
    this.treble = audio.treble;
    this.spectrum = audio.spectrum;
  }
  _hash(a, b) {
    const h = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
    return h - Math.floor(h);
  }
  draw(ctx, alpha) {
    const cols = Math.round(this.p('cols'));
    const fg = this.palette.fgCss();
    const accent = this.palette.accentCss();
    if (this.modeIndex === 0) {
      // Barcode: full-height columns, ~40% on, reshuffled each beat.
      const bw = this.w / cols;
      const density = 0.28 + this.level * 0.4;
      const seed = Math.floor(this.beats);
      ctx.fillStyle = fg;
      for (let i = 0; i < cols; i++) {
        const on = this._hash(i, seed) < density;
        if (!on) continue;
        // occasional accent stripe driven by treble
        ctx.fillStyle = this._hash(i, seed + 9) < this.treble * 0.5 ? accent : fg;
        ctx.fillRect(Math.floor(i * bw), 0, Math.ceil(bw) - 1, this.h);
      }
    } else if (this.modeIndex === 1) {
      // Matrix: spectrum-driven quantised columns of cells.
      const spec = this.spectrum;
      const cell = this.w / cols;
      const rows = Math.max(4, Math.round(this.h / cell));
      const ch = this.h / rows;
      ctx.fillStyle = fg;
      for (let i = 0; i < cols; i++) {
        const bin = Math.floor(Math.pow(i / cols, 1.7) * (spec ? spec.length * 0.7 : 1));
        const v = spec ? spec[bin] / 255 : 0.5;
        const lit = Math.round(v * rows);
        for (let r = 0; r < lit; r++) {
          if (this._hash(i, r + 1) < 0.85) {
            ctx.fillRect(Math.floor(i * cell) + 1, this.h - (r + 1) * ch + 1, Math.ceil(cell) - 2, Math.ceil(ch) - 2);
          }
        }
      }
    } else {
      // Scan: sparse horizontal glitch lines flickering with treble.
      const lines = Math.round(cols * 0.5);
      const frame = Math.floor(this.t * 24);
      ctx.fillStyle = fg;
      for (let i = 0; i < lines; i++) {
        if (this._hash(i, frame) > 0.5 + this.treble * 0.3) continue;
        const y = this._hash(i, 7) * this.h;
        const lh = 1 + Math.floor(this._hash(i, 3) * 3);
        const lw = (0.2 + this._hash(i, 5) * 0.8) * this.w;
        const lx = this._hash(i, frame + 1) * (this.w - lw);
        ctx.fillStyle = this._hash(i, frame + 2) < this.bass * 0.4 ? accent : fg;
        ctx.fillRect(lx, y, lw, lh);
      }
    }
  }
}
