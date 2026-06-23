import { Scene } from '../Scene.js';
import { TWO_PI } from '../../lib/math.js';
import { SimplexNoise } from '../../lib/noise.js';

// 水墨画 / 毛筆 — particles drift through an evolving simplex-noise flow field, but
// each one is rendered as a SUMI ink stroke (the segment it moved this frame),
// not a glowing dot. Width tracks speed (slow = fat & wet, fast = thin & dry =
// かすれ), a faint wide re-stroke gives にじみ (ink bleed), and a very low trail
// leaves 余韻 (the lingering fade). Single ink colour (palette.fg) — no additive
// glow, no hue cycling — with an optional sparse 朱 seal (落款) accent.
export class FlowField extends Scene {
  constructor() {
    super('flowField', 'Flow Field');
    this.trail = 0.045; // 余韻: ink lingers and slowly dries to the paper colour
    this.modes = [{ name: 'Streams' }, { name: 'Swarm' }];
    this.defineParam('count', 1400, 300, 2600, 100, 'Particles');
    this.defineParam('scale', 0.0024, 0.0008, 0.006, 0.0002, 'Field Scale');
    this.defineParam('brush', 3.0, 1.0, 9.0, 0.5, 'Brush Width');
    this.defineParam('bleed', 0.4, 0.0, 1.0, 0.05, 'Ink Bleed');   // にじみ
    this.defineParam('dryness', 0.5, 0.0, 1.0, 0.05, 'Dryness');   // かすれ
    this.defineParam('seal', 0.015, 0.0, 0.12, 0.005, 'Seal'); // 落款の頻度 0=純墨
    this.defineParam('sealTone', 0, 0, 3, 1, 'Seal Tone'); // 0朱 1accent 2藍 3金茶
    this.noise = new SimplexNoise(7);
    this.px = null; this.py = null; this.prx = null; this.pry = null;
    this.t = 0; this.level = 0; this.bass = 0; this.treble = 0;
    this._lut = []; // per-frame alpha -> fg css cache
  }
  init(ctx, w, h) { super.init(ctx, w, h); this._spawn(); }
  onResize(w, h) { super.onResize(w, h); this._spawn(); }
  _spawn() {
    const n = 2600;
    this.px = new Float32Array(n);
    this.py = new Float32Array(n);
    this.prx = new Float32Array(n);
    this.pry = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = Math.random() * this.w, y = Math.random() * this.h;
      this.px[i] = this.prx[i] = x;
      this.py[i] = this.pry[i] = y;
    }
  }
  update(dt, audio, palette, clock) {
    this.t = clock.time;
    this.level = audio.level; this.bass = audio.bass; this.treble = audio.treble;
    const n = Math.max(300, Math.round(this.p('count') * clock.quality));
    this.n = n;
    const sc = this.p('scale');
    const speed = (0.8 + this.level * 4 + this.bass * 3) * (this.modeIndex ? 1.6 : 1) * 60 * dt;
    const zt = this.t * 0.12;
    for (let i = 0; i < n; i++) {
      // remember where the brush tip was, so draw() can ink the stroke it traced.
      this.prx[i] = this.px[i]; this.pry[i] = this.py[i];
      const ang = this.noise.noise3D(this.px[i] * sc, this.py[i] * sc, zt) * TWO_PI * 2;
      this.px[i] += Math.cos(ang) * speed;
      this.py[i] += Math.sin(ang) * speed;
      // wrap around edges; reset the prev point too so the wrapped step isn't
      // drawn as a stroke clear across the canvas.
      if (this.px[i] < 0) { this.px[i] += this.w; this.prx[i] = this.px[i]; }
      else if (this.px[i] >= this.w) { this.px[i] -= this.w; this.prx[i] = this.px[i]; }
      if (this.py[i] < 0) { this.py[i] += this.h; this.pry[i] = this.py[i]; }
      else if (this.py[i] >= this.h) { this.py[i] -= this.h; this.pry[i] = this.py[i]; }
    }
  }
  draw(ctx, alpha) {
    const n = this.n || 0;
    const P = this.palette;
    // Per-frame ink LUT: quantise alpha (0..0.45) to fg css strings so we don't
    // build ~n colour strings every frame.
    const LN = 64, AMAX = 0.5, INV = (LN - 1) / AMAX, lut = this._lut;
    for (let k = 0; k < LN; k++) lut[k] = P.fgCss((k / (LN - 1)) * AMAX);
    const fgA = (a) => lut[a <= 0 ? 0 : a >= AMAX ? LN - 1 : (a * INV) | 0];

    // Seal (落款) ink: a sparse accent. sealTone picks a traditional pigment.
    const seal = this.p('seal');
    const sealStep = seal > 0 ? Math.max(1, Math.round(1 / seal)) : 0;
    const ti = this.p('sealTone') | 0;
    let sr, sg, sb;
    if (ti === 1 && P.accent) { sr = P.accent[0]; sg = P.accent[1]; sb = P.accent[2]; }
    else { const T = SEAL[ti] || SEAL[0]; sr = T[0]; sg = T[1]; sb = T[2]; }
    const sealCss = (a) => `rgba(${sr},${sg},${sb},${a})`;

    const brush = this.p('brush');
    const bleed = this.p('bleed');
    const dry = this.p('dryness');
    const wetW = 0.6 + 0.4 * this.bass; // bass thickens the wet brush

    ctx.globalCompositeOperation = 'source-over'; // ink, never additive glow
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // (SceneManager._drawScene already applies the crossfade globalAlpha.)

    for (let i = 0; i < n; i++) {
      const ax = this.prx[i], ay = this.pry[i], bx = this.px[i], by = this.py[i];
      const dx = bx - ax, dy = by - ay;
      const seg = Math.sqrt(dx * dx + dy * dy);
      if (seg < 0.01 || seg > this.w * 0.5) continue; // skip stalls + wrap jumps
      let sp = seg / 9; if (sp > 1) sp = 1;            // 0 = slow/wet/fat, 1 = fast/dry/thin
      const wdt = brush * (1.5 - sp) * wetW;
      const a = (0.16 + 0.32 * (1 - sp)) * (1 - 0.55 * dry * sp); // ink density (かすれ on the dry end)
      const isSeal = sealStep > 0 && (i % sealStep) === 0;

      // にじみ: a wide, soft pass under the core stroke = ink soaking into the paper.
      if (bleed > 0.02) {
        const ba = a * (0.22 + 0.5 * bleed);
        ctx.strokeStyle = isSeal ? sealCss(ba.toFixed(3)) : fgA(ba);
        ctx.lineWidth = wdt * (2.0 + 2.6 * bleed);
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
      }
      // core brush stroke.
      ctx.strokeStyle = isSeal ? sealCss(a.toFixed(3)) : fgA(a);
      ctx.lineWidth = wdt;
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    }
  }
}

// Traditional seal/ink pigments for the 朱 accent (index 1 = palette accent).
const SEAL = [
  [255, 34, 0],   // 0 朱 (Ikeda red 朱墨)
  null,           // 1 -> palette.accent (resolved at draw time)
  [27, 58, 91],   // 2 藍 (indigo)
  [150, 108, 30], // 3 金茶 (gold ochre)
];
