import { PALETTES } from './palettes.js';
import { lerpRgb, rampAt, rgbCss, clamp } from '../lib/math.js';

// Holds the active palette and cross-fades to a new one over ~500ms. Scenes
// never hardcode hex; they call cssAt()/colorAt()/bg/fg/accent here.
//
// Live adjustments (brightness / contrast / invert / accent strength) are baked
// into the exposed colours every frame, so the whole app — scenes, the HUD, the
// background clear — reacts without any of them knowing adjustments exist. The
// transition still runs in *base* (unadjusted) colour space.
export class PaletteManager {
  constructor() {
    this.list = PALETTES;
    this.index = 0;
    this.from = PALETTES[0];
    this.to = PALETTES[0];
    this.t = 1; // transition progress (1 = settled)
    this.duration = 0.5;

    // Base (unadjusted) colours the transition lerps.
    this._bBg = this.to.bg.slice();
    this._bFg = this.to.fg.slice();
    this._bAccent = this.to.accent.slice();
    this._bRamp = this.to.ramp.map((c) => c.slice());

    // Live (adjusted) colours every consumer reads.
    this.bg = this._bBg.slice();
    this.fg = this._bFg.slice();
    this.accent = this._bAccent.slice();
    this._ramp = this._bRamp.map((c) => c.slice());

    // Live adjustments.
    this.brightness = 1; // 0.5..1.5
    this.contrast = 1; // 0.5..2
    this.invert = false; // swap field/figure (negative)
    this.accentStrength = 1; // 0 = accent==fg, 1 = full accent

    this._tmp = [0, 0, 0];
    this._tmpA = [0, 0, 0];
    this._cssCache = new Map(); // quantized (t,alpha) -> css string
    this._recolor();
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

  setBrightness(v) { this.brightness = v; this._recolor(); }
  setContrast(v) { this.contrast = v; this._recolor(); }
  setInvert(v) { this.invert = !!v; this._recolor(); }
  setAccentStrength(v) { this.accentStrength = v; this._recolor(); }

  _snapshot() {
    return { bg: this._bBg.slice(), fg: this._bFg.slice(), accent: this._bAccent.slice(), ramp: this._bRamp.map((c) => c.slice()) };
  }

  // Map one base colour through invert -> contrast -> brightness into `out`.
  _apply(src, out) {
    let r = src[0], g = src[1], b = src[2];
    if (this.invert) { r = 255 - r; g = 255 - g; b = 255 - b; }
    const k = this.contrast, br = this.brightness;
    r = ((r / 255 - 0.5) * k + 0.5) * br * 255;
    g = ((g / 255 - 0.5) * k + 0.5) * br * 255;
    b = ((b / 255 - 0.5) * k + 0.5) * br * 255;
    out[0] = clamp(r, 0, 255); out[1] = clamp(g, 0, 255); out[2] = clamp(b, 0, 255);
    return out;
  }

  // Recompute the live (adjusted) colours from the base colours.
  _recolor() {
    this._apply(this._bBg, this.bg);
    this._apply(this._bFg, this.fg);
    // Accent strength fades accent toward fg in base space, then adjusts.
    lerpRgb(this._bFg, this._bAccent, this.accentStrength, this._tmpA);
    this._apply(this._tmpA, this.accent);
    for (let i = 0; i < this._bRamp.length; i++) {
      this._ramp[i] = this._apply(this._bRamp[i], this._ramp[i] || [0, 0, 0]);
    }
    this._ramp.length = this._bRamp.length;
    this._cssCache.clear();
  }

  update(dt) {
    if (this.t >= 1) return;
    this.t = Math.min(1, this.t + dt / this.duration);
    const t = this.t;
    lerpRgb(this.from.bg, this.to.bg, t, this._bBg);
    lerpRgb(this.from.fg, this.to.fg, t, this._bFg);
    lerpRgb(this.from.accent, this.to.accent, t, this._bAccent);
    const n = Math.max(1, Math.max(this.from.ramp.length, this.to.ramp.length));
    for (let i = 0; i < n; i++) {
      const a = this.from.ramp[Math.min(i, this.from.ramp.length - 1)];
      const b = this.to.ramp[Math.min(i, this.to.ramp.length - 1)];
      this._bRamp[i] = lerpRgb(a, b, t, this._bRamp[i] || [0, 0, 0]);
    }
    this._bRamp.length = n;
    this._recolor(); // bake adjustments into the live colours
  }

  // Sample the (adjusted) ramp at t in [0,1]. Writes into `out` if given.
  colorAt(t, out) { return rampAt(this._ramp, t, out); }

  // Cached CSS string for ramp position t (and optional alpha). The cache is
  // cleared whenever colours change (transition frame or adjustment), so it
  // always reflects the current adjusted ramp.
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
