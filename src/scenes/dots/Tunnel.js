import { Scene } from '../Scene.js';
import { TWO_PI, wrap01, clamp, lerp, smoothstep } from '../../lib/math.js';
import { SimplexNoise } from '../../lib/noise.js';

// A vanishing-point tunnel. Two dot modes (Spiral / Rings) plus three line
// modes (Polygon outlines / Lattice wireframe corridor / Braid helix).
// Everything is source-over crisp ink — no additive glow (matches FlowField).
//
// An auto-variation engine ("Evolve") keeps it from feeling monotonous:
//   (a) the vanishing point drifts on a slow noise LFO (banking corridor),
//   (b) section evolution walks a curated list of looks every few bars,
//   (c) strong beats punch a cross-section warp and flash one accent ring.
// All driven from a CONTINUOUS beat clock (never integer beats into sines).

// Curated "looks" the section walker steps through. warpAmp <= ~0.3 and
// integer lobes 3-6 / sides 3-8 keep it geometric, never flowery confetti.
const SECTION_STATES = [
  { twist: 0.0, warpAmp: 0.00, warpLobes: 4, sides: 6, spacing: 2.0 }, // calm rings
  { twist: 0.9, warpAmp: 0.10, warpLobes: 5, sides: 5, spacing: 1.8 }, // gentle helix
  { twist: 0.3, warpAmp: 0.26, warpLobes: 3, sides: 3, spacing: 2.2 }, // triangular star
  { twist: 1.6, warpAmp: 0.14, warpLobes: 6, sides: 8, spacing: 1.6 }, // braided lobes
  { twist: 0.5, warpAmp: 0.20, warpLobes: 4, sides: 4, spacing: 2.4 }, // deep square warp
];
const BAR = 4;            // beats per bar
const SEC_BEATS = BAR * 8; // advance one section every 8 bars

export class Tunnel extends Scene {
  constructor() {
    super('tunnel', 'Tunnel');
    this.trail = 0.3;
    this.modes = [
      { name: 'Spiral' }, { name: 'Rings' },        // 0,1 dots
      { name: 'Polygon' }, { name: 'Lattice' }, { name: 'Braid' }, // 2,3,4 lines
    ];
    this.defineParam('rings', 26, 12, 44, 1, 'Rings');
    this.defineParam('dots', 28, 10, 60, 1, 'Dots/Ring');
    this.defineParam('range', 1, 0.4, 2.2, 0.1, 'Range');
    this.defineParam('evolve', 0.5, 0, 1, 0.05, 'Evolve');
    this.defineParam('auto', 0, 0, 1, 1, 'Auto Mode');

    this.t = 0; this.level = 0; this.bass = 0; this.beat = 0;
    this.noise = new SimplexNoise(31);

    // drop / energy follower (inline mirror of audioMap)
    this._energy = 0; this._drop = 0; this.warpBurst = 0;

    // section evolution
    this._barStart = 0; this._sFrom = 0; this._sTo = 0; this._xfade = 1;

    // smoothed render knobs (continuous followers + integer knobs)
    this.twist = 0; this.warpAmp = 0; this.spacing = 2;
    this.warpLobes = SECTION_STATES[0].warpLobes;
    this._sectionSides = SECTION_STATES[0].sides;
    this._driftX = 0; this._driftY = 0;

    // beat-flashed accent ring
    this._accentSeed = 0; this._accentUntil = -1;

    // reused buffers (no per-frame allocation)
    this._order = []; this._depthBuf = [];
  }

  update(dt, audio, palette, clock) {
    this.t += dt * (0.3 + audio.level * 1.1 + audio.beatHold * 0.6);
    this.bass = audio.bass; this.beat = audio.beatHold; this.level = audio.level;

    const beatsF = clock.beats + clock.beatPhase;

    // --- drop follower: a surge above the running average reads as a drop ---
    this._energy += (audio.level - this._energy) * 0.1;
    const surge = audio.level - this._energy;
    this._drop = Math.max(this._drop - dt * 1.5, surge > 0.12 ? 1 : 0);

    // --- section evolution: advance on the beat grid, crossfade over ~2 bars ---
    if (beatsF - this._barStart >= SEC_BEATS) {
      // Resync if far behind (scene entered/re-entered mid-session) so the
      // walker steps once, not once-per-frame catching up the global clock.
      this._barStart = beatsF - this._barStart > SEC_BEATS * 2 ? beatsF : this._barStart + SEC_BEATS;
      this._sFrom = this._sTo;
      this._sTo = (this._sTo + 1) % SECTION_STATES.length;
      this._xfade = 0;
      if (this.p('auto')) this.setMode(this.modeIndex + 1); // opt-in mode walk
    }
    this._xfade = Math.min(1, this._xfade + dt * (clock.bpm / 60) / (BAR * 2));
    const e = smoothstep(0, 1, this._xfade);
    const A = SECTION_STATES[this._sFrom], B = SECTION_STATES[this._sTo];
    this.twist = lerp(A.twist, B.twist, e);
    this.warpAmp = lerp(A.warpAmp, B.warpAmp, e);
    this.spacing = lerp(A.spacing, B.spacing, e);
    // integer knobs hop only on a bar edge so n-gons never morph mid-shape
    if (clock.beatJustWrapped && clock.beats % BAR === 0) {
      this.warpLobes = B.warpLobes;
      this._sectionSides = B.sides;
    }

    // --- vanishing-point drift (raw; Evolve applied at draw) ---
    this._driftX = this.noise.noise2D(this.t * 0.022, 71.3) * this.w * 0.10;
    this._driftY = this.noise.noise2D(this.t * 0.019, 4.7) * this.h * 0.10;

    // --- beat punctuation: warp pulse + one accent ring for the bar ---
    this.warpBurst *= Math.pow(0.04, dt);
    if (clock.beatJustWrapped && audio.beatHold > 0.6) {
      this.warpBurst = 0.16 + 0.16 * this._drop;
      this._accentSeed = (this._accentSeed + clock.beats * 7 + 5) | 0;
      this._accentUntil = beatsF + BAR;
    }
  }

  draw(ctx, alpha) {
    const ev = this.p('evolve');
    const q = this.clock.quality;
    const beatsF = this.clock.beats + this.clock.beatPhase;
    const cx = this.w / 2 + this._driftX * ev;
    const cy = this.h / 2 + this._driftY * ev;
    const maxR = Math.hypot(this.w, this.h) * 0.55 * this.p('range');
    const rings = Math.max(6, Math.round(this.p('rings') * q));
    const m = this.modeIndex;
    const t = this.t;

    // modulation (Evolve scales it all; at ev=0 the scene obeys the sliders)
    const spExp = clamp(this.spacing, 1.2, 3);
    const wAmp = clamp((this.warpAmp + this.warpBurst) * ev, 0, 0.34);
    const lobes = this.warpLobes;
    const twist = this.twist * ev;

    // accent ring index (one ring, ~one bar, only while evolving)
    let accentRing = -1;
    if (ev > 0 && beatsF < this._accentUntil) {
      accentRing = ((this._accentSeed % rings) + rings) % rings;
    }

    // depth order, far -> near. Sorting by depth makes source-over occlude
    // correctly AND lets rails connect adjacent depths with no wrap-seam line.
    const order = this._order, db = this._depthBuf;
    order.length = rings; db.length = rings;
    for (let k = 0; k < rings; k++) { order[k] = k; db[k] = wrap01(k / rings + t * 0.25); }
    order.sort((a, b) => db[a] - db[b]);

    ctx.globalCompositeOperation = 'source-over';

    if (m < 2) {
      this._drawDots(ctx, alpha, order, db, rings, cx, cy, maxR, spExp, wAmp, lobes, twist, beatsF, m === 0, accentRing);
    } else {
      this._drawLines(ctx, alpha, order, db, rings, cx, cy, maxR, spExp, wAmp, lobes, twist, beatsF, ev, q, m, accentRing);
    }
  }

  _drawDots(ctx, alpha, order, db, rings, cx, cy, maxR, spExp, wAmp, lobes, twist, beatsF, spiral, accentRing) {
    const dots = Math.max(4, Math.round(this.p('dots') * this.clock.quality));
    for (let oi = 0; oi < rings; oi++) {
      const k = order[oi];
      const depth = db[k];
      const baseR = Math.pow(depth, spExp) * maxR;
      if (baseR < 2) continue;
      const acc = k === accentRing; // one ring flashes the accent on a beat
      const size = (0.5 + depth * 3.4) * (0.7 + this.bass * 1.4) * (acc ? 1.5 : 1);
      const rot = this.t * 0.6 + (spiral ? depth * 4 : 0) + this.bass * 0.8
        + Math.sin(depth * 3 + beatsF * 0.25) * twist;
      ctx.globalAlpha = (acc ? 1 : clamp(0.2 + depth, 0, 1)) * alpha;
      ctx.fillStyle = acc
        ? this.palette.accentCss()
        : this.palette.cssAt(wrap01(depth + this.t * 0.05));
      for (let j = 0; j < dots; j++) {
        const a = (j / dots) * TWO_PI + rot;
        const r = baseR * (1 + wAmp * Math.sin(lobes * a + beatsF * 0.5));
        ctx.beginPath();
        ctx.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, size, 0, TWO_PI);
        ctx.fill();
      }
    }
  }

  _drawLines(ctx, alpha, order, db, rings, cx, cy, maxR, spExp, wAmp, lobes, twist, beatsF, ev, q, m, accentRing) {
    ctx.lineJoin = 'miter';
    ctx.lineCap = 'butt';
    const sidesBase = clamp(Math.round(this.p('dots') * 0.25), 3, 14);
    const sides = Math.max(3, Math.round(lerp(sidesBase, this._sectionSides, ev)));

    // BRAID: a few counter-rotating helical strands winding into the depth.
    // High-res sampled (independent of ring count) for a smooth helix; the
    // wrap seam breaks the path so no full-screen line flails each cycle.
    if (m === 4) {
      const strands = 5;
      const wind = 1.5 + twist; // turns from center to edge
      const steps = Math.max(24, Math.round(72 * q));
      ctx.globalAlpha = 0.6 * alpha;
      ctx.strokeStyle = this.palette.cssAt(wrap01(0.1 + this.t * 0.04));
      ctx.lineWidth = Math.max(0.6, 1.5 * (0.8 + this.bass * 0.7));
      for (let j = 0; j < strands; j++) {
        const dir = (j % 2) ? -1 : 1;
        ctx.beginPath();
        let started = false, prev = -1;
        for (let s = 0; s <= steps; s++) {
          const depth = wrap01(s / steps + this.t * 0.25);
          if (depth < prev) started = false; // crossed the wrap seam -> break
          prev = depth;
          const baseR = Math.pow(depth, spExp) * maxR;
          if (baseR < 2) { started = false; continue; }
          const a = (j / strands) * TWO_PI + this.t * 0.6 + this.bass * 0.8
            + depth * wind * TWO_PI * dir;
          const r = baseR * (1 + wAmp * Math.sin(lobes * a + beatsF * 0.5));
          const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
          if (started) ctx.lineTo(x, y); else { ctx.moveTo(x, y); started = true; }
        }
        ctx.stroke();
      }
      return;
    }

    // LATTICE rails (longitudinal). Dropped under load -> renders as Polygon.
    if (m === 3 && q >= 0.6) {
      ctx.globalAlpha = 0.42 * alpha;
      ctx.strokeStyle = this.palette.cssAt(wrap01(0.1 + this.t * 0.04));
      ctx.lineWidth = Math.max(0.5, 0.8 + this.bass * 0.7);
      for (let j = 0; j < sides; j++) {
        ctx.beginPath();
        let started = false;
        for (let oi = 0; oi < rings; oi++) {
          const k = order[oi];
          const depth = db[k];
          const baseR = Math.pow(depth, spExp) * maxR;
          if (baseR < 2) continue;
          const rot = this.t * 0.6 + this.bass * 0.8
            + Math.sin(depth * 3 + beatsF * 0.25) * twist;
          const a = (j / sides) * TWO_PI + rot;
          const r = baseR * (1 + wAmp * Math.sin(lobes * a + beatsF * 0.5));
          const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
          if (started) ctx.lineTo(x, y); else { ctx.moveTo(x, y); started = true; }
        }
        ctx.stroke();
      }
    }

    // RING OUTLINES (Polygon + Lattice). far -> near, depth-cued width & alpha.
    {
      for (let oi = 0; oi < rings; oi++) {
        const k = order[oi];
        const depth = db[k];
        const baseR = Math.pow(depth, spExp) * maxR;
        if (baseR < 2) continue;
        const rot = this.t * 0.6 + this.bass * 0.8
          + Math.sin(depth * 3 + beatsF * 0.25) * twist;
        const acc = k === accentRing; // one ring flashes the accent on a beat
        ctx.globalAlpha = (acc ? 1 : clamp(0.12 + 0.88 * depth, 0, 1)) * alpha;
        ctx.lineWidth = Math.max(0.4, (0.4 + depth * depth * 3.0) * (0.8 + this.bass * 0.7)) * (acc ? 1.8 : 1);
        ctx.strokeStyle = acc
          ? this.palette.accentCss()
          : this.palette.cssAt(wrap01(depth * 0.15 + this.t * 0.04));
        ctx.beginPath();
        for (let j = 0; j <= sides; j++) {
          const a = ((j % sides) / sides) * TWO_PI + rot;
          const r = baseR * (1 + wAmp * Math.sin(lobes * a + beatsF * 0.5));
          const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
          if (j === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.stroke();
      }
    }
  }
}
