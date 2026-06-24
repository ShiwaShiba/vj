import { Scene } from '../Scene.js';
import { clamp, lerp, smoothstep, map, rgbCss, lerpRgb } from '../../lib/math.js';
import { SimplexNoise } from '../../lib/noise.js';

// GROUND PLAN — the historical Kunitachi (国立) university-town district map that
// RISES from a flat blueprint into a 3D city, gradually, driven by mic energy.
// Canvas-2D, monochrome. Reuses the codebase's proven machinery:
//   - weak-perspective yaw/pitch projection + bg->fg tone-bucket shading +
//     backface cull + far->near face sort + far/near floor split  (FallingCubes)
//   - section walker on the continuous beat clock with resync guard     (Tunnel)
// A single build accumulator `b` (0..1) is the master clock: streets plot in,
// the camera tilts from top-down to 3/4, blocks extrude near->far, the city
// breathes + auto-varies, then re-sinks to the plan and rebuilds — a designed
// loop. Faces NEVER sample a palette ramp (cssAt) so no accent hue can bleed
// onto a roof; the only saturated mark is the single Ikeda-red station node.

const BAR = 4;
const SEC_BEATS = BAR * 8;        // vantage change cadence in LIVE (Tunnel cadence)
const FOCAL = 4.5;                // focal length in units of H (DancerRig / FallingCubes)
const NTONE = 16;                 // grayscale buckets (cache-friendly fillStyle)
const MAX_BLOCKS = 220;           // hard ceiling, independent of the density slider
const FACES = 5;                  // faces tested per block (top + 4 walls; floor skipped)

const STALL = 0.02;               // idle creep so silence still eventually completes
const SINK_RATE = 0.26;           // teardown speed (audio-independent so it can't stall)
const LIVE_SECTIONS = 3;          // vantages held in LIVE before a re-sink

// Light fixed in WORLD space (shading stays stable while the camera tilts).
// up = -y, so a top face (normal 0,-1,0) faces the light => roofs read bright.
const LX = -0.4, LY = -0.7, LZ = 0.55;
const LL = Math.hypot(LX, LY, LZ);
const LNX = LX / LL, LNY = LY / LL, LNZ = LZ / LL;

// Box vertices, in (u, y, v) order. base = ground (down, +y), top = base - h (up).
//   0:(uMin,base,vMin) 1:(uMax,base,vMin) 2:(uMax,top,vMin) 3:(uMin,top,vMin)
//   4:(uMin,base,vMax) 5:(uMax,base,vMax) 6:(uMax,top,vMax) 7:(uMin,top,vMax)
const BOX_F = [
  { idx: [3, 2, 6, 7], n: [0, -1, 0] }, // top (up)
  { idx: [0, 1, 2, 3], n: [0, 0, -1] }, // north wall
  { idx: [4, 5, 6, 7], n: [0, 0, 1] },  // south wall
  { idx: [0, 3, 7, 4], n: [-1, 0, 0] }, // west wall
  { idx: [1, 2, 6, 5], n: [1, 0, 0] },  // east wall
];

// LIVE camera vantages: pitch magnitude (rad), yaw kick, height emphasis.
const LIVE_VANTAGES = [
  { pitch: 0.55, yaw: 0.0, emph: 1.0 },
  { pitch: 0.72, yaw: 0.5, emph: 1.18 },
  { pitch: 0.46, yaw: -0.45, emph: 0.9 },
  { pitch: 0.62, yaw: 0.28, emph: 1.28 },
];

export class GroundPlan extends Scene {
  constructor() {
    super('groundplan', 'Ground Plan');
    this.trail = 0.35;
    this.modes = [{ name: 'Hybrid' }, { name: 'Wireframe' }, { name: 'Solid' }];
    this.views = [{ name: 'Axon' }, { name: 'Plan-Lock' }];
    this.viewIndex = 0;

    this.defineParam('buildSpeed', 0.12, 0.04, 0.4, 0.02, 'Build Speed');
    this.defineParam('density', 0.85, 0.4, 1.0, 0.05, 'Density');
    this.defineParam('light', 0.6, 0, 1, 0.05, 'Light');
    this.defineParam('trail', 0.35, 0.1, 1.0, 0.05, 'Trail');
    this.defineParam('autoVary', 0.6, 0, 1, 0.05, 'Auto Vary');
    this.defineParam('camYaw', 0.45, 0, 6.28, 0.02, 'Cam Yaw');
    this.defineParam('accent', 1, 0, 1, 1, 'Accent Flash');

    this.t = 0;
    this.noise = new SimplexNoise(19);

    // build accumulator + smoothed render copy
    this._b = 0; this._bView = 0; this._sinking = false;
    this._energy = 0;
    this._hAudio = 1; this._emph = 1;

    // camera (pitch stored NEGATIVE: -1.45 top-down .. -0.55 three-quarter)
    this._camYaw = 0.45; this._camPitch = -1.45;

    // LIVE walker
    this._inLive = false; this._secStart = 0;
    this._vFrom = 0; this._vTo = 0; this._xfade = 1; this._liveSection = 0;

    // beat-flash accent block
    this._accentUntil = -1; this._accentSlot = -1;

    // data (built once; plan coords are size-independent)
    this._seg = null; this._blocks = null; this._accentBlock = -1;

    // projection / draw scratch (allocation-free hot loop)
    this._pvx = new Float32Array(MAX_BLOCKS * 8);
    this._pvy = new Float32Array(MAX_BLOCKS * 8);
    this._pvf = new Float32Array(MAX_BLOCKS * 8);
    this._front = new Uint8Array(MAX_BLOCKS * FACES);
    this._fSlot = new Int32Array(MAX_BLOCKS * FACES);
    this._fIdx = new Uint8Array(MAX_BLOCKS * FACES);
    this._fCz = new Float32Array(MAX_BLOCKS * FACES);
    this._fBucket = new Uint8Array(MAX_BLOCKS * FACES);
    this._fOrder = [];
    this._toneCss = new Array(NTONE);
    this._tmpRgb = [0, 0, 0];
    this._g0 = [0, 0, 0, 0]; this._g1 = [0, 0, 0, 0]; // ground-segment scratch
    this._sp = [0, 0, 0]; // station-point scratch
  }

  init(ctx, w, h) { super.init(ctx, w, h); this._layout(); if (!this._blocks) this._build(); }
  onResize(w, h) { super.onResize(w, h); this._layout(); }
  setView(i) { this.viewIndex = ((i % this.views.length) + this.views.length) % this.views.length; }

  _layout() {
    this._H = Math.min(this.w, this.h);
    this._spanX = this._H * 0.52;     // plan half-width  (u in [-1,1])
    this._spanZ = this._H * 0.50;     // plan half-depth  (v in [0,1] -> z)
    this._groundY = this._H * 0.13;   // ground plane (down = +y)
  }

  // half-width of the tapering boundary at depth v (centered on u=0).
  _half(v) { return lerp(0.18, 0.92, clamp((v - 0.05) / 0.92, 0, 1)); }

  // Author the stylised Kunitachi plan: railway + station, the radiating trident
  // (大学通り + 富士見/旭 fan avenues), a grid clipped to the tapering boundary,
  // building footprints + the two university super-blocks. Order keys make streets
  // plot in station-first and the city grow southward.
  _build() {
    const seg = []; // {u0,v0,u1,v1, ord, kind} kind:0 grid 1 avenue 2 boundary
    // boundary trapezoid
    const B = [[-0.18, 0.05], [0.18, 0.05], [0.92, 0.97], [-0.92, 0.97]];
    for (let i = 0; i < 4; i++) {
      const a = B[i], b = B[(i + 1) % 4];
      seg.push({ u0: a[0], v0: a[1], u1: b[0], v1: b[1], ord: 0.0, kind: 2 });
    }
    // railway (double line across the top) + the trident of avenues
    seg.push({ u0: -0.55, v0: 0.035, u1: 0.55, v1: 0.035, ord: 0.02, kind: 1 });
    seg.push({ u0: -0.55, v0: 0.058, u1: 0.55, v1: 0.058, ord: 0.03, kind: 1 });
    seg.push({ u0: 0, v0: 0.06, u1: 0, v1: 0.96, ord: 0.06, kind: 1 });       // 大学通り
    seg.push({ u0: 0, v0: 0.08, u1: -0.62, v1: 0.93, ord: 0.12, kind: 1 });   // 富士見通り
    seg.push({ u0: 0, v0: 0.08, u1: 0.62, v1: 0.93, ord: 0.12, kind: 1 });    // 旭通り
    // secondary grid — verticals (skip the central boulevard corridor)
    const Ug = [-0.7, -0.55, -0.4, -0.25, 0.25, 0.4, 0.55, 0.7];
    for (const u of Ug) {
      const au = Math.abs(u);
      // inside the boundary from the v where half(v) first exceeds |u|
      let vs = 0.06;
      if (au > 0.18) vs = Math.max(0.06, 0.05 + 0.92 * (au - 0.18) / 0.74 + 0.01);
      if (vs >= 0.94) continue;
      seg.push({ u0: u, v0: vs, u1: u, v1: 0.95, ord: 0.45 + 0.5 * (au / 0.92), kind: 0 });
    }
    // horizontals (clipped to the tapering boundary, split by the boulevard)
    const Vg = [0.18, 0.30, 0.42, 0.54, 0.66, 0.78, 0.90];
    for (const v of Vg) {
      const hw = this._half(v);
      const ord = 0.5 + 0.45 * v;
      seg.push({ u0: -hw, v0: v, u1: -0.05, v1: v, ord, kind: 0 });
      seg.push({ u0: 0.05, v0: v, u1: hw, v1: v, ord, kind: 0 });
    }
    this._seg = seg;

    // building footprints. Landmarks go FIRST so the density cap (which culls by
    // iteration order) never sheds them; the grid fills in after.
    const blocks = [];
    // two university super-blocks (一橋大学 west / east), broad + low
    blocks.push({ uMin: -0.36, uMax: -0.12, vMin: 0.34, vMax: 0.62, hNorm: 0.7, key: 0.34, uni: 1 });
    blocks.push({ uMin: 0.12, uMax: 0.36, vMin: 0.34, vMax: 0.62, hNorm: 0.62, key: 0.34, uni: 1 });
    this._accentBlock = 1; // the east campus is the beat-flash mark
    // station building (slim tower just south of the railway)
    blocks.push({ uMin: -0.035, uMax: 0.035, vMin: 0.075, vMax: 0.13, hNorm: 1.25, key: 0.03 });
    const bw = 0.085, bd = 0.078;
    const cols = [-0.82, -0.69, -0.56, -0.43, -0.30, -0.17, 0.17, 0.30, 0.43, 0.56, 0.69, 0.82];
    const rows = [0.13, 0.23, 0.33, 0.43, 0.53, 0.63, 0.73, 0.83, 0.92];
    for (const cu of cols) {
      for (const cv of rows) {
        if (Math.abs(cu) < 0.06) continue;                       // keep boulevard clear
        if (Math.abs(cu) + bw / 2 > this._half(cv) - 0.015) continue; // outside boundary
        // leave room for the two campuses (added explicitly below)
        if (cv > 0.31 && cv < 0.65 && Math.abs(cu) > 0.10 && Math.abs(cu) < 0.40) continue;
        const n = this.noise.noise2D(cu * 3.1, cv * 3.1) * 0.5 + 0.5; // 0..1 stable
        const classMul = 1 + 0.6 * smoothstep(0.42, 0.0, Math.abs(cu)); // taller near the spine
        blocks.push({
          uMin: cu - bw / 2, uMax: cu + bw / 2, vMin: cv - bd / 2, vMax: cv + bd / 2,
          hNorm: (0.35 + 0.65 * n) * classMul, key: clamp((cv - 0.05) / 0.92, 0, 1),
        });
      }
    }
    this._blocks = blocks;
  }

  update(dt, audio, palette, clock) {
    this.t += dt;
    this.trail = this.p('trail');
    const beatsF = clock.beats + clock.beatPhase;
    const av = this.p('autoVary');

    // energy follower / build drive (mirror of FallingCubes' drop follower)
    this._energy += (audio.level - this._energy) * 0.1;
    const surge = audio.level - this._energy;
    const drive = clamp(audio.level * 0.7 + Math.max(0, surge) * 1.6 + audio.bass * 0.5, 0, 1.5);

    if (this._sinking) {
      this._b -= dt * SINK_RATE;
      if (this._b <= 0) { this._b = 0; this._sinking = false; this._secStart = beatsF; }
    } else {
      this._b += dt * this.p('buildSpeed') * Math.max(STALL, drive);
      if (this._b >= 1) this._b = 1;
    }
    this._b = clamp(this._b, 0, 1);
    this._bView += (this._b - this._bView) * Math.min(1, dt * 4); // anti-pop

    // LIVE breathing + section walker (only at full build)
    const live = this._bView >= 0.97 && !this._sinking;
    let vantPitch = 0.55, vantEmph = 1;
    if (live) {
      if (!this._inLive) { this._inLive = true; this._secStart = beatsF; this._vFrom = this._vTo = 0; this._xfade = 1; this._liveSection = 0; }
      if (beatsF - this._secStart >= SEC_BEATS) {
        this._secStart = beatsF - this._secStart > SEC_BEATS * 2 ? beatsF : this._secStart + SEC_BEATS;
        this._vFrom = this._vTo; this._vTo = (this._vTo + 1) % LIVE_VANTAGES.length; this._xfade = 0;
        if (++this._liveSection >= LIVE_SECTIONS) { this._sinking = true; this._inLive = false; this._liveSection = 0; }
      }
      this._xfade = Math.min(1, this._xfade + dt * (clock.bpm / 60) / (BAR * 2));
      const e = smoothstep(0, 1, this._xfade);
      const A = LIVE_VANTAGES[this._vFrom], Bv = LIVE_VANTAGES[this._vTo];
      vantPitch = lerp(A.pitch, Bv.pitch, e);
      vantEmph = lerp(A.emph, Bv.emph, e);
    } else {
      this._inLive = false;
    }

    // camera targets
    const planLock = this.viewIndex === 1;
    let pitchMag, yawBase;
    if (planLock) {
      pitchMag = lerp(1.54, 1.40, this._bView);           // stays near top-down
      yawBase = lerp(0.0, 0.12, this._bView);
    } else {
      const tilt = smoothstep(0.32, 0.66, this._bView);   // top-down -> three-quarter
      const buildPitch = lerp(1.52, 0.62, tilt);
      pitchMag = live ? vantPitch : buildPitch;
      pitchMag += live ? this.noise.noise2D(this.t * 0.05, 3) * 0.12 * av : 0;
      yawBase = lerp(0.05, this.p('camYaw'), tilt);        // north-up plot -> angled axon
    }
    const yawTgt = yawBase
      + (live && !planLock ? LIVE_VANTAGES[this._vTo].yaw * av : 0)
      + (live && !planLock ? this.noise.noise2D(this.t * 0.04, 9) * 0.2 * av : 0);
    this._camPitch += (-pitchMag - this._camPitch) * Math.min(1, dt * 3);
    this._camYaw += (yawTgt - this._camYaw) * Math.min(1, dt * 3);
    this._emph += ((live ? vantEmph : 1) - this._emph) * Math.min(1, dt * 2);
    this._hAudio += ((live ? 1 + audio.bass * 0.2 : 1) - this._hAudio) * Math.min(1, dt * 5);

    // beat punctuation: flash one campus roof for a bar
    if (clock.beatJustWrapped && audio.beatHold > 0.6 && this.p('accent') > 0.5) {
      this._accentUntil = beatsF + BAR;
    }
  }

  draw(ctx, alpha) {
    const A = alpha;
    const H = this._H, F = FOCAL * H, q = this.clock.quality;
    const bView = this._bView;
    const ccy = Math.cos(this._camYaw), scy = Math.sin(this._camYaw);
    const ccp = Math.cos(this._camPitch), scp = Math.sin(this._camPitch);
    // vertical origin rides up as the city rises: keeps the station near the top
    // in the flat plot, then centers the 3D city (the fan opens toward the camera).
    const cx = this.w * 0.5, cy = this.h * 0.5 + H * lerp(0.05, -0.10, smoothstep(0.30, 0.72, bView));
    const beatsF = this.clock.beats + this.clock.beatPhase;

    // monochrome tone table (bg -> fg), rebuilt per frame; cache-friendly
    const bg = this.palette.bg, fg = this.palette.fg, lightP = this.p('light');
    for (let i = 0; i < NTONE; i++) this._toneCss[i] = rgbCss(lerpRgb(bg, fg, i / (NTONE - 1), this._tmpRgb));
    const streetCss = rgbCss(lerpRgb(bg, fg, 0.5, this._tmpRgb));
    const aveCss = rgbCss(lerpRgb(bg, fg, 0.72, this._tmpRgb));
    const bndCss = rgbCss(lerpRgb(bg, fg, 0.6, this._tmpRgb));

    ctx.globalCompositeOperation = 'source-over';
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';

    const plotFrac = smoothstep(0.0, 0.32, bView);
    const Z2c = this._groundY * scp;          // split plane at the ground centroid
    const basis = { ccy, scy, ccp, scp, F, cx, cy, gy: this._groundY };

    // --- streets, FAR half (drawn behind the risen blocks) ---
    this._drawStreets(ctx, A, basis, Z2c, false, plotFrac, q, streetCss, aveCss, bndCss);

    // --- project + shade buildings (those the wavefront has reached) ---
    // front sweeps key 0->1 as bView 0.44->1.0; *1.15 so the farthest blocks
    // (key~0.95) still reach full height by bView=1. local is 0 at front=0, so
    // NOTHING extrudes during PLOT — the plan stays flat until the tilt begins.
    const front = 1.15 * smoothstep(0.44, 1.0, bView);
    const cap = Math.min(MAX_BLOCKS, Math.round(this._blocks.length * this.p('density')));
    const hScale = H * 0.105 * this._emph * this._hAudio;
    const mode = this.modeIndex, wantFaces = mode !== 1;
    this._accentSlot = -1;
    let bi = 0, fc = 0;
    for (let k = 0; k < this._blocks.length && bi < cap; k++) {
      const b = this._blocks[k];
      const local = smoothstep(b.key, b.key + 0.14, front);
      if (local <= 0.001) continue;
      const h = b.hNorm * hScale * local;
      if (h < 0.5) continue;
      const base = this._groundY, top = this._groundY - h;
      const x0 = b.uMin * this._spanX, x1 = b.uMax * this._spanX;
      const z0 = (b.vMin - 0.5) * 2 * this._spanZ, z1 = (b.vMax - 0.5) * 2 * this._spanZ;
      const slot = bi * 8;
      // 8 verts in BOX_V order
      this._pv(slot + 0, x0, base, z0, basis); this._pv(slot + 1, x1, base, z0, basis);
      this._pv(slot + 2, x1, top, z0, basis); this._pv(slot + 3, x0, top, z0, basis);
      this._pv(slot + 4, x0, base, z1, basis); this._pv(slot + 5, x1, base, z1, basis);
      this._pv(slot + 6, x1, top, z1, basis); this._pv(slot + 7, x0, top, z1, basis);
      // block-center camera z (stable sort key) — also cull behind the camera
      const cxw = (x0 + x1) * 0.5, czw = (z0 + z1) * 0.5, cyw = (base + top) * 0.5;
      const Zc = cxw * scy + czw * ccy;
      const blockCz = cyw * scp + Zc * ccp;
      if (blockCz >= F * 0.92) continue;
      if (k === this._accentBlock) this._accentSlot = bi;
      // faces: world-normal shading (stable) + camera-normal-z cull
      for (let f = 0; f < FACES; f++) {
        const n = BOX_F[f].n;
        const Zn = n[0] * scy + n[2] * ccy;
        const camNz = n[1] * scp + Zn * ccp;
        const isFront = camNz > 0;
        this._front[bi * FACES + f] = isFront ? 1 : 0;
        if (!wantFaces || !isFront) continue;
        const ndl = Math.max(0, n[0] * LNX + n[1] * LNY + n[2] * LNZ);
        let shadeT = 0.34 + 0.6 * ndl * (0.5 + 0.5 * lightP);
        const depthCue = clamp(map(blockCz, -0.5 * H, 0.5 * H, 0.7, 1.0), 0.68, 1.0);
        shadeT = clamp(shadeT * depthCue + (b.uni ? 0.04 : 0) + (f === 0 ? 0.06 : 0), 0, 1);
        this._fSlot[fc] = bi; this._fIdx[fc] = f; this._fCz[fc] = blockCz;
        this._fBucket[fc] = Math.round(shadeT * (NTONE - 1));
        fc++;
      }
      bi++;
    }

    if (mode === 1) {
      this._strokeFaces(ctx, A, fc);
    } else {
      // sort faces far -> near (ascending camera-z; camera sits at +F)
      const order = this._fOrder; order.length = fc;
      for (let i = 0; i < fc; i++) order[i] = i;
      order.sort((a, b) => (this._fCz[a] - this._fCz[b]) || (a - b));
      const pvx = this._pvx, pvy = this._pvy;
      ctx.globalAlpha = A;
      let lastB = -1;
      for (let oi = 0; oi < fc; oi++) {
        const rec = order[oi], bk = this._fBucket[rec];
        if (bk !== lastB) { ctx.fillStyle = this._toneCss[bk]; lastB = bk; }
        const s = this._fSlot[rec] * 8, id = BOX_F[this._fIdx[rec]].idx;
        ctx.beginPath();
        ctx.moveTo(pvx[s + id[0]], pvy[s + id[0]]);
        ctx.lineTo(pvx[s + id[1]], pvy[s + id[1]]);
        ctx.lineTo(pvx[s + id[2]], pvy[s + id[2]]);
        ctx.lineTo(pvx[s + id[3]], pvy[s + id[3]]);
        ctx.closePath(); ctx.fill();
      }
      // beat-flash the east campus roof (the one saturated accent on the city)
      if (this._accentSlot >= 0 && beatsF < this._accentUntil) {
        const s = this._accentSlot * 8, id = BOX_F[0].idx;
        ctx.globalAlpha = A; ctx.fillStyle = this.palette.accentCss();
        ctx.beginPath();
        ctx.moveTo(pvx[s + id[0]], pvy[s + id[0]]);
        ctx.lineTo(pvx[s + id[1]], pvy[s + id[1]]);
        ctx.lineTo(pvx[s + id[2]], pvy[s + id[2]]);
        ctx.lineTo(pvx[s + id[3]], pvy[s + id[3]]);
        ctx.closePath(); ctx.fill();
      }
      // Hybrid bright edges (skipped under load)
      if (mode === 0 && q > 0.6) this._strokeFaces(ctx, clamp(0.6 + 0.3 * (this.audio ? this.audio.beatHold : 0), 0, 1) * A, fc, this.palette.fgCss());
    }

    // --- streets, NEAR half (drawn over the blocks: foreground plan lines) ---
    this._drawStreets(ctx, A, basis, Z2c, true, plotFrac, q, streetCss, aveCss, bndCss);

    // --- the single Ikeda-red accent: the station node ---
    this._project(0, this._groundY, (0.04 - 0.5) * 2 * this._spanZ, basis, this._sp);
    ctx.globalAlpha = clamp(plotFrac * 1.2, 0, 1) * A;
    ctx.fillStyle = this.palette.accentCss();
    const r = Math.max(2.5, H * 0.012);
    ctx.beginPath();
    ctx.moveTo(this._sp[0], this._sp[1] - r); ctx.lineTo(this._sp[0] + r, this._sp[1]);
    ctx.lineTo(this._sp[0], this._sp[1] + r); ctx.lineTo(this._sp[0] - r, this._sp[1]);
    ctx.closePath(); ctx.fill();
    ctx.globalAlpha = A;
  }

  // project a world point (wx, wy, wz) -> out=[sx, sy, f]
  _project(wx, wy, wz, b, out) {
    const X = wx * b.ccy - wz * b.scy;
    const Z = wx * b.scy + wz * b.ccy;
    const Y = wy * b.ccp - Z * b.scp;
    const Z2 = wy * b.scp + Z * b.ccp;
    const f = b.F / (b.F - Z2);
    out[0] = b.cx + X * f; out[1] = b.cy + Y * f; out[2] = f;
  }
  // project into the vertex buffers at index vi
  _pv(vi, wx, wy, wz, b) {
    const X = wx * b.ccy - wz * b.scy;
    const Z = wx * b.scy + wz * b.ccy;
    const Y = wy * b.ccp - Z * b.scp;
    const Z2 = wy * b.scp + Z * b.ccp;
    const f = b.F / (b.F - Z2);
    this._pvx[vi] = b.cx + X * f; this._pvy[vi] = b.cy + Y * f; this._pvf[vi] = f;
  }

  // wireframe / hybrid edges: stroke the visible-face outlines, far -> near
  _strokeFaces(ctx, A, fc, css) {
    const order = this._fOrder; order.length = fc;
    for (let i = 0; i < fc; i++) order[i] = i;
    order.sort((a, b) => (this._fCz[a] - this._fCz[b]) || (a - b));
    ctx.strokeStyle = css || this.palette.fgCss();
    const pvx = this._pvx, pvy = this._pvy, pvf = this._pvf;
    for (let oi = 0; oi < fc; oi++) {
      const rec = order[oi], s = this._fSlot[rec] * 8, id = BOX_F[this._fIdx[rec]].idx;
      const fw = (pvf[s + id[0]] + pvf[s + id[2]]) * 0.5;
      ctx.globalAlpha = clamp(A * clamp(fw, 0.6, 1.3), 0, 1);
      ctx.lineWidth = Math.max(0.6, 1.0 * fw);
      ctx.beginPath();
      ctx.moveTo(pvx[s + id[0]], pvy[s + id[0]]);
      ctx.lineTo(pvx[s + id[1]], pvy[s + id[1]]);
      ctx.lineTo(pvx[s + id[2]], pvy[s + id[2]]);
      ctx.lineTo(pvx[s + id[3]], pvy[s + id[3]]);
      ctx.closePath(); ctx.stroke();
    }
    ctx.globalAlpha = A;
  }

  // Draw the plan's lines on the ground, clipped to one side of the split plane
  // (the FallingCubes _drawFloor idea) so foreground lines cross IN FRONT of the
  // risen blocks and background lines pass behind them. Each segment fades in by
  // its order key vs the plot progress.
  _drawStreets(ctx, A, b, Z2c, near, plotFrac, q, streetCss, aveCss, bndCss) {
    const sx = this._spanX, sz = this._spanZ;
    const p0 = this._g0, p1 = this._g1;
    for (let i = 0; i < this._seg.length; i++) {
      const sgm = this._seg[i];
      if (sgm.kind === 0 && q < 0.7 && (i & 1)) continue; // shed half the grid under load
      const fade = smoothstep(sgm.ord, sgm.ord + 0.06, plotFrac);
      if (fade <= 0.002) continue;
      // to world
      let wx0 = sgm.u0 * sx, wz0 = (sgm.v0 - 0.5) * 2 * sz;
      let wx1 = sgm.u1 * sx, wz1 = (sgm.v1 - 0.5) * 2 * sz;
      // split at the ground centroid plane: da = Z*ccp (near = da>=0)
      const za = (wx0 * b.scy + wz0 * b.ccy) * b.ccp;
      const zb = (wx1 * b.scy + wz1 * b.ccy) * b.ccp;
      const aIn = near ? za >= 0 : za < 0;
      const bIn = near ? zb >= 0 : zb < 0;
      if (!aIn && !bIn) continue;
      let ta = 0, tb = 1;
      if (aIn !== bIn) { const tc = za / (za - zb); if (aIn) tb = tc; else ta = tc; }
      const ax = wx0 + (wx1 - wx0) * ta, az = wz0 + (wz1 - wz0) * ta;
      const bx = wx0 + (wx1 - wx0) * tb, bz = wz0 + (wz1 - wz0) * tb;
      this._project(ax, b.gy, az, b, p0);
      this._project(bx, b.gy, bz, b, p1);
      const depth = clamp((p0[2] + p1[2]) * 0.5, 0.5, 1.4);
      // near-half lines sit OVER the blocks as faint blueprint overlay
      const base = sgm.kind === 2 ? 0.62 : sgm.kind === 1 ? 0.8 : 0.42;
      ctx.globalAlpha = clamp(base * fade * depth * (near ? 0.85 : 1) * A, 0, 1);
      ctx.strokeStyle = sgm.kind === 2 ? bndCss : sgm.kind === 1 ? aveCss : streetCss;
      ctx.lineWidth = Math.max(0.5, (sgm.kind === 1 ? 1.7 : sgm.kind === 2 ? 1.2 : 0.8) * depth);
      ctx.beginPath();
      ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]); ctx.stroke();
    }
    ctx.globalAlpha = A;
  }
}
