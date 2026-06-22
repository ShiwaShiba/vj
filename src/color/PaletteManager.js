import { PALETTES } from './palettes.js';
import { lerpRgb, rampAt, rgbCss } from '../lib/math.js';

// Holds the active palette and cross-fades to a new one over ~500ms.
// Scenes never hardcode hex; they call cssAt()/colorAt()/bg/accent here.
// A small CSS-string cache avoids rebuilding "rgb(...)" strings per dot.
export class PaletteManager {
  constructor() {
    this.list = PALETTES;
    this.index = 0;
    this.from = PALETTES[0];
    this.to = PALETTES[0];
    this.t = 1; // transition progress (1 = settled)
    this.duration = 0.5;

    this.bg = this.to.bg.slice();
    this.fg = this.to.fg.slice();
    this.accent = this.to.accent.slice();
    this._ramp = this.to.ramp.map((c) => c.slice());

    this._tmp = [0, 0, 0];
    this._cssCache = new Map(); // quantized (t,alpha) -> css string
  }

  set(index) {
    index = ((index % this.list.length) + this.list.length) % this.list.length;
    if (index === this.index && this.t >= 1) return;
    this.from = this._snapshot();
    this.to = this.list[index];
    this.index = index;
    this.t = 0;
    this._cssCache.clear();
  }
  next() { this.set(this.index + 1); }
  prev() { this.set(this.index - 1); }
  get name() { return this.list[this.index].name; }

  _snapshot() {
    return { bg: this.bg.slice(), fg: this.fg.slice(), accent: this.accent.slice(), ramp: this._ramp.map((c) => c.slice()) };
  }

  update(dt) {
    if (this.t >= 1) return;
    this.t = Math.min(1, this.t + dt / this.duration);
    const t = this.t;
    lerpRgb(this.from.bg, this.to.bg, t, this.bg);
    lerpRgb(this.from.fg, this.to.fg, t, this.fg);
    lerpRgb(this.from.accent, this.to.accent, t, this.accent);
    const n = Math.max(1, Math.max(this.from.ramp.length, this.to.ramp.length));
    for (let i = 0; i < n; i++) {
      const a = this.from.ramp[Math.min(i, this.from.ramp.length - 1)];
      const b = this.to.ramp[Math.min(i, this.to.ramp.length - 1)];
      this._ramp[i] = lerpRgb(a, b, t, this._ramp[i] || [0, 0, 0]);
    }
    this._ramp.length = n;
    this._cssCache.clear(); // colors changed this frame
  }

  // Sample the ramp at t in [0,1]. Writes into `out` if given (no allocation).
  colorAt(t, out) { return rampAt(this._ramp, t, out); }

  // Cached CSS string for ramp position t (and optional alpha). Quantized so
  // the cache stays small; cleared whenever the palette changes.
  cssAt(t, a = 1) {
    const qt = Math.round(((t % 1) + 1) % 1 * 255);
    const qa = a >= 1 ? 256 : Math.round(a * 16);
    const key = qt * 257 + qa;
    let s = this._cssCache.get(key);
    if (s === undefined) {
      rampAt(this._ramp, t, this._tmp);
      s = rgbCss(this._tmp, a);
      this._cssCache.set(key, s);
    }
    return s;
  }

  bgCss(a = 1) { return rgbCss(this.bg, a); }
  fgCss(a = 1) { return rgbCss(this.fg, a); }
  accentCss(a = 1) { return rgbCss(this.accent, a); }
}
