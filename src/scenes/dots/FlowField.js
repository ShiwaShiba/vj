import { Scene } from '../Scene.js';
import { TWO_PI } from '../../lib/math.js';
import { SimplexNoise } from '../../lib/noise.js';

// 水墨画 / 毛筆 (案A, session 6) — particles drift through an evolving simplex
// flow field, but each one is rendered as a SUMI ink BRUSH rather than a round-cap
// line (which read as a string of beads = the old complaint). The brush is built
// from pre-rendered, fg-tinted radial sprites stamped along the path:
//   ・soft-edged core stamps     → continuous ribbon, no bead chain
//   ・2-3 offset bristle passes   → 毛割れ (split-hair streaks), along the stroke
//   ・paper-grain gate            → かすれ / 飛白 (dry brush breaks up fast strokes)
//   ・wide soft halo (にじみ)     → ink bleeding softly into the paper
//   ・edge-darkening ring core    → darker rim / lighter centre, like wet ink
//   ・per-particle ink-load       → 濃→淡 as the tip dries, then a re-dip reloads
// Single ink colour (palette.fg) baked into the sprites — no additive glow, no hue
// cycling — plus an optional sparse 朱 seal (落款) accent (seal / sealTone).
//
// 保留 (deferred this session — kept as internal constants, NOT exposed as sliders;
// promote to defineParam() later if wanted, see HANDOFF §1/§3):
//   ・BRISTLES — 毛割れの本数
//   ・DRY_RATE — 墨量の枯れ速度
export class FlowField extends Scene {
  constructor() {
    super('flowField', 'Flow Field');
    this.trail = 0.05; // 余韻: ink lingers and slowly dries back to the paper colour
    this.modes = [{ name: 'Streams' }, { name: 'Swarm' }];
    this.defineParam('count', 800, 200, 1800, 100, 'Particles');
    this.defineParam('scale', 0.0024, 0.0008, 0.006, 0.0002, 'Field Scale');
    this.defineParam('brush', 4.0, 1.5, 10.0, 0.5, 'Brush Width');
    this.defineParam('bleed', 0.5, 0.0, 1.0, 0.05, 'Ink Bleed');   // にじみ
    this.defineParam('dryness', 0.5, 0.0, 1.0, 0.05, 'Dryness');   // かすれ
    this.defineParam('seal', 0.015, 0.0, 0.12, 0.005, 'Seal');     // 落款の頻度 0=純墨
    this.defineParam('sealTone', 0, 0, 3, 1, 'Seal Tone');         // 0朱 1accent 2藍 3金茶
    this.noise = new SimplexNoise(7);
    this.px = null; this.py = null; this.prx = null; this.pry = null;
    this.load = null; this.spd = null;
    this.t = 0; this.level = 0; this.bass = 0; this.treble = 0; this.n = 0;
    this._spr = null;     // { core, halo, ring } tinted to palette.fg
    this._sealSpr = null; // core tinted to the seal pigment
    this._fgKey = ''; this._sealKey = '';
  }
  init(ctx, w, h) { super.init(ctx, w, h); this._spawn(); }
  onResize(w, h) { super.onResize(w, h); this._spawn(); }
  _spawn() {
    const n = 1800; // max Particles param; allocate once
    this.px = new Float32Array(n); this.py = new Float32Array(n);
    this.prx = new Float32Array(n); this.pry = new Float32Array(n);
    this.load = new Float32Array(n); this.spd = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = Math.random() * this.w, y = Math.random() * this.h;
      this.px[i] = this.prx[i] = x; this.py[i] = this.pry[i] = y;
      this.load[i] = 0.4 + Math.random() * 0.6;
      this.spd[i] = 0.6 + Math.random() * 0.9; // per-particle speed = wet/dry variety
    }
  }

  // Pre-render a soft radial ink sprite tinted `rgb`, with [pos, alpha] stops.
  _sprite(rgb, stops) {
    const S = 64, c = document.createElement('canvas'); c.width = S; c.height = S;
    const x = c.getContext('2d');
    const g = x.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    for (let i = 0; i < stops.length; i++) g.addColorStop(stops[i][0], `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${stops[i][1]})`);
    x.fillStyle = g; x.fillRect(0, 0, S, S);
    return c;
  }
  // Rebuild sprites only when the (rounded) ink colour or seal pigment changes —
  // palette.fg mutates in place during transitions / brightness-contrast tweaks.
  _ensureSprites(palette) {
    const fr = Math.round(palette.fg[0]), fg2 = Math.round(palette.fg[1]), fb = Math.round(palette.fg[2]);
    const fgKey = fr + ',' + fg2 + ',' + fb;
    if (fgKey !== this._fgKey) {
      const rgb = [fr, fg2, fb];
      this._spr = {
        core: this._sprite(rgb, [[0, 1], [0.5, 0.72], [1, 0]]),
        halo: this._sprite(rgb, [[0, 0.42], [0.55, 0.16], [1, 0]]),
        ring: this._sprite(rgb, [[0, 0.42], [0.5, 0.6], [0.72, 0.95], [0.9, 0.38], [1, 0]]),
      };
      this._fgKey = fgKey;
    }
    const ti = this.p('sealTone') | 0;
    const s = (ti === 1 && palette.accent) ? palette.accent : (SEAL[ti] || SEAL[0]);
    const sr = Math.round(s[0]), sg = Math.round(s[1]), sb = Math.round(s[2]);
    const sealKey = ti + ':' + sr + ',' + sg + ',' + sb;
    if (sealKey !== this._sealKey) {
      this._sealSpr = this._sprite([sr, sg, sb], [[0, 1], [0.45, 0.8], [1, 0]]);
      this._sealKey = sealKey;
    }
  }

  // Paper-fibre grain (stable per screen location) → かすれ gate. ~[0,1].
  _grain(x, y) { return this.noise.noise3D(x * 0.18, y * 0.18, 7.3) * 0.5 + 0.5; }

  update(dt, audio, palette, clock) {
    this.t = clock.time;
    this.level = audio.level; this.bass = audio.bass; this.treble = audio.treble;
    this._ensureSprites(palette);
    const n = Math.max(200, Math.round(this.p('count') * clock.quality));
    this.n = Math.min(n, this.px.length);
    const sc = this.p('scale');
    const swarm = this.modeIndex ? 1.6 : 1;
    const speed = (0.8 + this.level * 4 + this.bass * 3) * swarm * 60 * dt;
    const zt = this.t * 0.12;
    const dryStep = DRY_RATE * dt * swarm; // Swarm dries (and re-dips) faster
    for (let i = 0; i < this.n; i++) {
      this.prx[i] = this.px[i]; this.pry[i] = this.py[i];
      const ang = this.noise.noise3D(this.px[i] * sc, this.py[i] * sc, zt) * TWO_PI * 2;
      const v = speed * this.spd[i];
      this.px[i] += Math.cos(ang) * v;
      this.py[i] += Math.sin(ang) * v;
      this.load[i] -= dryStep;
      if (this.load[i] <= 0.05) {
        // tip exhausted: re-dip — relocate, reload, no streak across the canvas.
        this.px[i] = Math.random() * this.w; this.py[i] = Math.random() * this.h;
        this.prx[i] = this.px[i]; this.pry[i] = this.py[i];
        this.load[i] = 0.6 + Math.random() * 0.4;
        this.spd[i] = 0.6 + Math.random() * 0.9;
        continue;
      }
      if (this.px[i] < 0) { this.px[i] += this.w; this.prx[i] = this.px[i]; }
      else if (this.px[i] >= this.w) { this.px[i] -= this.w; this.prx[i] = this.px[i]; }
      if (this.py[i] < 0) { this.py[i] += this.h; this.pry[i] = this.py[i]; }
      else if (this.py[i] >= this.h) { this.py[i] -= this.h; this.pry[i] = this.py[i]; }
    }
  }

  // Stamp `sprite` along the segment a->b (offset `off` along normal nx,ny),
  // skipping where the paper grain falls below `gate` (= dry-brush gaps).
  _stamp(ctx, ax, ay, bx, by, seg, r, a, off, nx, ny, gate, sprite) {
    if (a <= 0.003 || r < 0.3) return;
    const steps = Math.min(6, Math.max(1, Math.ceil(seg / (r * 0.55))));
    const d = 2 * r;
    ctx.globalAlpha = a;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const x = ax + (bx - ax) * t + nx * off;
      const y = ay + (by - ay) * t + ny * off;
      if (gate > 0 && this._grain(x, y) < gate) continue;
      ctx.drawImage(sprite, x - r, y - r, d, d);
    }
  }

  draw(ctx, alpha) {
    const n = this.n || 0;
    if (!this._spr) return;
    const W = this.w;
    const brush = this.p('brush'), bleed = this.p('bleed'), dry = this.p('dryness');
    const wetW = 0.6 + 0.4 * this.bass; // bass thickens the wet brush
    const quality = (this.clock && this.clock.quality) || 1;
    const bristles = quality < 0.5 ? 1 : quality < 0.8 ? 2 : BRISTLES;
    const doHalo = quality > 0.45;
    const core = this._spr.core, halo = this._spr.halo, ring = this._spr.ring;
    const sealSpr = this._sealSpr;
    const seal = this.p('seal');
    const sealStep = seal > 0 ? Math.max(1, Math.round(1 / seal)) : 0;

    ctx.globalCompositeOperation = 'source-over'; // ink, never additive glow
    // (SceneManager._drawScene set ctx.globalAlpha = crossfade alpha; we fold it
    // into every stamp alpha so crossfades still dissolve this scene correctly.)
    for (let i = 0; i < n; i++) {
      const ax = this.prx[i], ay = this.pry[i], bx = this.px[i], by = this.py[i];
      const dx = bx - ax, dy = by - ay;
      const seg = Math.sqrt(dx * dx + dy * dy);
      if (seg < 0.01 || seg > W * 0.5) continue; // skip stalls + wrap jumps
      let sp = seg / 7; if (sp > 1) sp = 1;        // 0 = slow/wet/fat, 1 = fast/dry/thin
      const load = this.load[i];
      const r = brush * (1.3 - 0.7 * sp) * 0.5 * wetW + 0.5;
      const nx = -dy / seg, ny = dx / seg;

      if (sealStep > 0 && (i % sealStep) === 0) {
        if (sealSpr) {
          const a = (0.4 + 0.4 * (1 - sp)) * alpha; // 落款: small dense seal mark
          this._stamp(ctx, ax, ay, bx, by, seg, r * 0.9, a, 0, 0, 0, 0, sealSpr);
        }
        continue;
      }

      // にじみ: a wide soft halo soaking under the stroke.
      if (doHalo && bleed > 0.02) {
        const ha = (0.06 + 0.10 * (1 - sp)) * (0.4 + 0.8 * bleed) * alpha;
        this._stamp(ctx, ax, ay, bx, by, seg, r * (1.8 + 1.6 * bleed), ha, 0, 0, 0, 0, halo);
      }

      // core bristles: edge-darkening ring + ink-load value (濃→淡) + 紙目 gate.
      const base = (0.13 + 0.20 * (1 - sp)) * (0.45 + 0.55 * load) * alpha;
      const gate = 0.18 + (0.45 + 0.4 * dry) * sp; // dry/fast → higher gate → flying white
      const br = bristles > 1 ? r * 0.62 : r;
      for (let h = 0; h < bristles; h++) {
        const off = (h - (bristles - 1) / 2) * r * 0.85;
        this._stamp(ctx, ax, ay, bx, by, seg, br, base, off, nx, ny, gate, ring);
      }
    }
    ctx.globalAlpha = 1;
  }
}

// Traditional seal/ink pigments for the 朱 accent (index 1 = palette accent).
const SEAL = [
  [255, 34, 0],   // 0 朱 (Ikeda red 朱墨)
  null,           // 1 -> palette.accent (resolved at draw/sprite time)
  [27, 58, 91],   // 2 藍 (indigo)
  [150, 108, 30], // 3 金茶 (gold ochre)
];

// 保留: スライダー非公開・内部定数（HANDOFF §1/§3）。
const BRISTLES = 3;   // 毛割れの本数（quality で 1〜3 に自動縮小）
const DRY_RATE = 0.4; // 墨量の枯れ速度 /秒（≈2.5秒で一画が枯れて再浸し）
