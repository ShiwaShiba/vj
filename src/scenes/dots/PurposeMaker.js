import { Scene } from '../Scene.js';
import { TWO_PI } from '../../lib/math.js';
import { SimplexNoise } from '../../lib/noise.js';
import { decodeHandTargets } from './handTargets.js';
import { decodeTurbProfile } from './turbProfile.js';
import { cohesionAt, smoother } from './purposeMakerChoreo.js';
import { breathAt } from './purposeMakerField.js';

// PurposeMaker — hands coalesce out of a video-derived turbulence field (R→L→Both),
// hold, then dissolve, seamlessly. A `recruit` fraction of particles condenses onto
// the baked hand point-clouds; the rest stay ambient, flowing through a region wider
// than the viewport and bleeding off all edges. mono, additive, deterministic.
const MAXN = 44000;
const SIMX = 1.6, SIMY = 1.2;   // sim half-extent (viewport shows ±1.0) -> off-frame bleed
const TILT = 0.06;              // tiny fixed tilt for life (hands stay readable)
const BANDS = 6;

export class PurposeMaker extends Scene {
  constructor() {
    super('purposeMaker', 'PurposeMaker');
    this.trail = 0.16;
    this.modes = [{ name: 'Cycle' }, { name: 'Right' }, { name: 'Left' }, { name: 'Both' }];
    this.modeGroups = [{ key: 'audio', label: 'Audio', options: ['OFF', 'ON'], index: 1 }];
    this.defineParam('count', 42000, 10000, MAXN, 1000, 'Particles');
    this.defineParam('recruit', 0.50, 0.3, 0.9, 0.05, 'Recruit');
    this.defineParam('flow', 0.62, 0.1, 1.5, 0.05, 'Flow Speed');
    this.defineParam('scale', 1.6, 0.6, 3.2, 0.1, 'Field Scale');
    this.defineParam('cohesion', 1.0, 0.3, 2.0, 0.1, 'Cohesion');
    this.defineParam('thread', 0.9, 0.4, 2.0, 0.1, 'Thread');
    this.defineParam('react', 2.0, 0, 6, 0.5, 'React');
    this.defineParam('pace', 1.0, 0.4, 2.0, 0.1, 'Pace');
    this.noise = new SimplexNoise(11);
    this.X = this.Y = this.Z = this.PX = this.PY = this.PZ = null;
    this.sx = this.sy = this.psx = this.psy = this.sval = this.sband = null;
    this.n = 0; this.t = 0; this.level = 0; this.bass = 0; this.treble = 0;
    this.hands = null; this.turb = null;
    this._B = null; this._handBloom = 1;
  }

  init(ctx, w, h) {
    super.init(ctx, w, h);
    this.hands = decodeHandTargets();
    this.turb = decodeTurbProfile();
    this._alloc();
    this._seedAll();
  }
  onResize(w, h) { super.onResize(w, h); } // normalized coords — no respawn

  _alloc() {
    if (this.X) return;
    const F = () => new Float32Array(MAXN);
    this.X = F(); this.Y = F(); this.Z = F(); this.PX = F(); this.PY = F(); this.PZ = F();
    this.sx = F(); this.sy = F(); this.psx = F(); this.psy = F();
    this.sval = new Uint8Array(MAXN); this.sband = new Uint8Array(MAXN);
  }
  // deterministic hash -> [0,1)
  _h(n) {
    n = (n | 0) ^ 0x9e3779b9;
    n = Math.imul(n ^ (n >>> 16), 0x21f0aaad);
    n = Math.imul(n ^ (n >>> 15), 0x735a2d97);
    return ((n ^ (n >>> 15)) >>> 0) / 4294967296;
  }
  // sample an ambient spawn position weighted by the video density map; bias inflow side
  _ambientPos(i, fromEdge) {
    const d = this.turb, dim = d.dim;
    // rejection-sample a cell by density, deterministic per (i, attempt)
    let gx = 0, gy = 0;
    for (let a = 0; a < 24; a++) {
      const rx = this._h(i * 7 + a * 131 + 1), ry = this._h(i * 7 + a * 131 + 2), rp = this._h(i * 7 + a * 131 + 3);
      gx = (rx * dim) | 0; gy = (ry * dim) | 0;
      if (rp < 0.15 + 0.85 * d.density[gy * dim + gx]) break;
    }
    // map grid (0..1) to sim space (wider than viewport)
    let x = (gx / dim) * 2 * SIMX - SIMX;
    let y = (gy / dim) * 2 * SIMY - SIMY;
    if (fromEdge) { // reseed on the inflow edge so flow is continuous
      const ang = this.turb.flowAngle;
      x = -Math.cos(ang) * SIMX; y = Math.sin(ang) * SIMY * 0.6 + (this._h(i * 13 + 9) - 0.5) * SIMY;
    }
    return { x, y, z: this._h(i * 17 + 5) * 2 - 1 };
  }
  _seedAll() {
    const N = MAXN;
    for (let i = 0; i < N; i++) {
      const p = this._ambientPos(i, false);
      this.X[i] = this.PX[i] = p.x; this.Y[i] = this.PY[i] = p.y; this.Z[i] = this.PZ[i] = p.z;
    }
  }
  // hand target (world) for a recruited particle i in the active station
  _targetFor(i, station) {
    const H = this.hands;
    let hand, cloud;
    if (station === 'R') { hand = 'A'; cloud = H.A; }
    else if (station === 'L') { hand = 'B'; cloud = H.B; }
    else { hand = this._h(i * 3 + 1) < 0.5 ? 'A' : 'B'; cloud = hand === 'A' ? H.A : H.B; }
    const idx = i % cloud.n;
    const u = cloud.u[idx] / 32767, v = cloud.v[idx] / 32767;
    // station placement (matches spec): spanX 1.3, spanY 1.0
    let tx, ty = (0.5 - v) * 1.0;
    if (hand === 'A') tx = -0.3 + 1.3 * u; else tx = -1.0 + 1.3 * u;
    if (station === 'Both') ty += hand === 'A' ? 0.12 : -0.12;
    return { tx, ty, tz: 0 };
  }

  update(dt, audio, palette, clock) {
    this.t = clock.time; this.level = audio.level; this.bass = audio.bass; this.treble = audio.treble;
    const q = clock.quality || 1;
    const n = this.n = Math.min(MAXN, Math.round(this.p('count') * q));
    const recruit = this.p('recruit');
    const audioOn = this.mg('audio') === 1;
    const react = this.p('react');
    // station: Cycle = auto choreography; else lock to that station at full cohesion
    const mi = this.modeIndex;
    let st;
    if (mi === 0) st = cohesionAt(this.t, { pace: this.p('pace') });
    else { const map = [null, 'R', 'L', 'Both']; const s = map[mi]; st = { station: s, cR: s !== 'L' ? 1 : 0, cL: s !== 'R' ? 1 : 0, phase: 'hold' }; }

    // line<->particle breathing: ONE coherence pulse K drives every texture cue at once
    // (frequency, comb, scatter, speed, persistence, brightness). Audio (beat/bass/level)
    // snaps K toward the LINE regime, so the STRUCTURE tracks the music — the headline
    // reactive element. Treble adds shimmer; the waveform ripples the filaments crosswise.
    const B = breathAt(this.t, { level: audio.level, bass: audio.bass, treble: audio.treble, beatHold: audio.beatHold }, { react, audioOn });
    this._B = B;
    // persistence breathes too: lines linger (low trail = more persistence), dust is crisper.
    this.trail = 0.10 + 0.20 * (1 - B.K);

    // video-derived field; spatial frequency morphs low(line, smooth)..high(dust, fine).
    const baseFreq = this.turb.scale > 0.001 ? (0.9 / this.turb.scale) : 1.6;
    const fBase = baseFreq * (this.p('scale') / 1.6);
    const f = fBase * (1.35 - 0.95 * B.K);
    const fa = this.turb.flowAngle, dirx = Math.cos(fa), diry = -Math.sin(fa);
    const perpx = -diry, perpy = dirx;
    const swirlAmp = 0.42 + 0.78 * B.scatter;      // dust = more chaotic swirl
    const comb = B.forward + 0.58 * B.advance;     // along-flow comb: stretch into filaments
    const sp = this.p('flow') * B.speed * dt;
    const zt = this.t * 0.05;
    const cohK = this.p('cohesion') * 8.0;
    const rippleAmp = B.ripple * 0.13;             // transverse waveform wave (audio)
    const shimmer = B.shimmer;                     // hi-freq agitation (treble)
    const wave = audio.waveform, wlen = wave ? wave.length : 0;
    const handBloom = 1 + (audioOn ? react * 0.06 * (audio.bass + audio.beatHold) : 0);
    this._handBloom = handBloom;
    const noise = this.noise;

    for (let i = 0; i < n; i++) {
      this.PX[i] = this.X[i]; this.PY[i] = this.Y[i]; this.PZ[i] = this.Z[i];
      const x = this.X[i], y = this.Y[i], z = this.Z[i];
      const hi = this._h(i * 7 + 99);
      const isHand = hi < recruit;
      let cc = 0;
      if (isHand) {
        const which = st.station === 'L' ? st.cL : st.station === 'R' ? st.cR
          : (this._h(i * 3 + 1) < 0.5 ? st.cR : st.cL);
        cc = smoother(which);
      }
      // shared turbulent swirl (its amplitude breathes with scatter)
      let vx = noise.noise3D(x * f, y * f, z * f + zt) * swirlAmp;
      let vy = noise.noise3D(x * f + 5.2, y * f + 9.1, z * f + zt + 2.3) * swirlAmp;
      let vz = noise.noise3D(x * f + 2.7, y * f + 4.4, z * f + zt + 7.8) * swirlAmp * 0.7;
      if (isHand && cc > 0.001) {
        // coalesce onto the hand point-cloud; while held it blooms (bass) + quivers (alive).
        const tgt = this._targetFor(i, st.station);
        vx += dirx * comb; vy += diry * comb;
        const qv = cc > 0.5 ? (0.010 + 0.04 * (handBloom - 1)) * Math.sin(this.t * 16 + hi * TWO_PI) : 0;
        const pullx = (tgt.tx * handBloom - x), pully = (tgt.ty * handBloom - y), pullz = (tgt.tz - z);
        vx = vx * sp * (1 - cc) + (pullx * cohK + qv) * cc * dt;
        vy = vy * sp * (1 - cc) + (pully * cohK + qv * 0.5) * cc * dt;
        vz = vz * sp * (1 - cc) + (pullz * cohK) * cc * dt;
        this.X[i] = x + vx; this.Y[i] = y + vy; this.Z[i] = z + vz;
        continue;
      }
      // ambient medium: comb into aligned filament LINES (coherent forward) or scatter into
      // PARTICLE dust (swirl). A cheap coarse spatial term lets some streamtubes comb first.
      const cn = Math.sin(x * 1.3 + zt * 1.5) * Math.cos(y * 1.1 - zt);
      const lcomb = comb * (0.5 + 0.55 * (cn + 1));
      vx += dirx * lcomb; vy += diry * lcomb;
      if (rippleAmp > 0 && wlen) {
        const sCoord = x * dirx + y * diry;          // position along the flow
        let idx = (((sCoord * 0.5 + 0.5 + this.t * 0.25) * wlen * 0.25) | 0) % wlen;
        if (idx < 0) idx += wlen;
        const wv = (wave[idx] - 128) / 128;
        vx += perpx * rippleAmp * wv; vy += perpy * rippleAmp * wv;
      }
      if (shimmer > 0.01) {
        const j = Math.sin(x * 41.0 + y * 37.0 + this.t * 26.0) * shimmer * 0.5;
        vx += perpx * j; vy += perpy * j;
      }
      let nx = x + vx * sp, ny = y + vy * sp, nz = z + vz * sp;
      // off-box ambient particles re-enter on the inflow edge -> continuous off-frame flow.
      if (nx < -SIMX || nx > SIMX || ny < -SIMY || ny > SIMY || nz < -1.2 || nz > 1.2) {
        const p = this._ambientPos(i, true);
        nx = p.x; ny = p.y; nz = p.z;
        this.PX[i] = nx; this.PY[i] = ny; this.PZ[i] = nz; // no streak across the jump
      }
      this.X[i] = nx; this.Y[i] = ny; this.Z[i] = nz;
    }
  }

  draw(ctx, alpha) {
    const n = this.n || 0; if (!n) return;
    const W = this.w, H = this.h, cx = W / 2, cy = H / 2;
    const R = Math.min(W, H) * 0.5; // world ±1 maps to half-min-dimension (sim ±1.6 bleeds off)
    const cX = Math.cos(TILT), sX = Math.sin(TILT);
    // project + brightness band (project hoisted out of the per-particle loop)
    const project = (wx, wy, wz) => {
      const ty = wy * cX - wz * sX;
      return [cx + wx * R, cy - ty * R];
    };
    for (let i = 0; i < n; i++) {
      const a = project(this.PX[i], this.PY[i], this.PZ[i]);
      const b = project(this.X[i], this.Y[i], this.Z[i]);
      this.psx[i] = a[0]; this.psy[i] = a[1]; this.sx[i] = b[0]; this.sy[i] = b[1];
      // depth 0..1
      let d = this.Z[i] * 0.5 + 0.5; if (d < 0) d = 0; else if (d > 1) d = 1;
      const hi = this._h(i * 7 + 99);
      const isHand = hi < this.p('recruit');
      // hands are the luminous focal point; the ambient field is a dimmer atmosphere that
      // breathes with K (lines = brighter crest, dust = dim powder) and fades toward the
      // frame edges so the plume reads as a mass in black space framing the hands.
      const ambB = this._B ? this._B.bright : 0.7;
      let bv;
      if (isHand) {
        bv = (0.84 * this._handBloom) * (0.5 + 0.5 * d);
      } else {
        const dx = (this.sx[i] - cx) / R, dy = (this.sy[i] - cy) / R;
        const rr = Math.sqrt(dx * dx + dy * dy);
        const fall = rr < 1.0 ? 1 : rr > 1.7 ? 0.14 : 1 - ((rr - 1.0) / 0.7) * 0.86;
        bv = (0.32 * ambB) * (0.4 + 0.6 * d) * fall;
      }
      let band = (bv * BANDS) | 0; if (band >= BANDS) band = BANDS - 1; if (band < 0) band = 0;
      this.sband[i] = band; this.sval[i] = 1;
    }
    const fg = (this.palette && this.palette.fg) || [240, 240, 240];
    const fr = Math.round(fg[0]), fgc = Math.round(fg[1]), fb = Math.round(fg[2]);
    const thread = this.p('thread');
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (let band = 0; band < BANDS; band++) {
      const bc = (band + 0.5) / BANDS;
      ctx.lineWidth = thread * (0.4 + 0.9 * bc);
      ctx.strokeStyle = `rgba(${fr},${fgc},${fb},${(0.05 + 0.5 * bc) * alpha})`;
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        if (this.sval[i] && this.sband[i] === band) {
          ctx.moveTo(this.psx[i], this.psy[i]);
          ctx.lineTo(this.sx[i], this.sy[i]);
        }
      }
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }
}
