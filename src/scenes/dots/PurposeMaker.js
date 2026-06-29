import { Scene } from '../Scene.js';
import { TWO_PI } from '../../lib/math.js';
import { SimplexNoise } from '../../lib/noise.js';
import { decodeHandTargets } from './handTargets.js';
import { decodeTurbProfile } from './turbProfile.js';
import { cohesionAt, smoother } from './purposeMakerChoreo.js';

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
    this.defineParam('count', 34000, 10000, MAXN, 1000, 'Particles');
    this.defineParam('recruit', 0.65, 0.3, 0.9, 0.05, 'Recruit');
    this.defineParam('flow', 0.5, 0.1, 1.5, 0.05, 'Flow Speed');
    this.defineParam('scale', 1.6, 0.6, 3.2, 0.1, 'Field Scale');
    this.defineParam('cohesion', 1.0, 0.3, 2.0, 0.1, 'Cohesion');
    this.defineParam('thread', 0.9, 0.4, 2.0, 0.1, 'Thread');
    this.defineParam('react', 2.0, 0, 6, 0.5, 'React');
    this.defineParam('pace', 1.0, 0.4, 2.0, 0.1, 'Pace');
    this.noise = new SimplexNoise(11);
    this.X = this.Y = this.Z = this.PX = this.PY = this.PZ = null;
    this.sx = this.sy = this.psx = this.psy = this.sval = this.sband = null;
    this.n = 0; this.t = 0; this.level = 0; this.bass = 0;
    this.hands = null; this.turb = null;
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
    const idx = ((i / 1) | 0) % cloud.n;
    const u = cloud.u[idx] / 32767, v = cloud.v[idx] / 32767;
    // station placement (matches spec): spanX 1.3, spanY 1.0
    let tx, ty = (0.5 - v) * 1.0;
    if (hand === 'A') tx = -0.3 + 1.3 * u; else tx = -1.0 + 1.3 * u;
    if (station === 'Both') ty += hand === 'A' ? 0.12 : -0.12;
    return { tx, ty, tz: 0 };
  }

  update(dt, audio, palette, clock) {
    this.t = clock.time; this.level = audio.level; this.bass = audio.bass;
    const q = clock.quality || 1;
    const n = this.n = Math.min(MAXN, Math.round(this.p('count') * q));
    const recruit = this.p('recruit');
    const audioOn = this.mg('audio') === 1;
    const react = audioOn ? this.p('react') : 0;
    // station: Cycle = auto choreography; else lock to that station at full cohesion
    const mi = this.modeIndex;
    let st;
    if (mi === 0) st = cohesionAt(this.t, { pace: this.p('pace') });
    else { const map = [null, 'R', 'L', 'Both']; const s = map[mi]; st = { station: s, cR: s !== 'L' ? 1 : 0, cL: s !== 'R' ? 1 : 0, phase: 'hold' }; }
    // video-derived field params
    const baseFreq = this.turb.scale > 0.001 ? (0.9 / this.turb.scale) : 1.6;
    const f = baseFreq * (this.p('scale') / 1.6);
    const fa = this.turb.flowAngle, fcos = Math.cos(fa), fsin = Math.sin(fa);
    const drift = (0.15 + 0.6 * this.turb.coherence);
    const sp = this.p('flow') * (1 + react * 0.25 * (this.level + this.bass)) * dt;
    const zt = this.t * 0.05;
    const cohK = this.p('cohesion') * 8.0;
    const noise = this.noise;
    for (let i = 0; i < n; i++) {
      this.PX[i] = this.X[i]; this.PY[i] = this.Y[i]; this.PZ[i] = this.Z[i];
      const x = this.X[i], y = this.Y[i], z = this.Z[i];
      // video-driven turbulent velocity: simplex field + mean drift along measured flow
      let vx = noise.noise3D(x * f, y * f, z * f + zt) + fcos * drift;
      let vy = noise.noise3D(x * f + 5.2, y * f + 9.1, z * f + zt + 2.3) - fsin * drift;
      let vz = noise.noise3D(x * f + 2.7, y * f + 4.4, z * f + zt + 7.8);
      const hi = this._h(i * 7 + 99);
      const isHand = hi < recruit;
      let cc = 0;
      if (isHand) {
        const which = st.station === 'L' ? st.cL : st.station === 'R' ? st.cR
          : (this._h(i * 3 + 1) < 0.5 ? st.cR : st.cL);
        cc = smoother(which);
      }
      if (isHand && cc > 0.001) {
        const tgt = this._targetFor(i, st.station);
        const pullx = (tgt.tx - x), pully = (tgt.ty - y), pullz = (tgt.tz - z);
        // blend turbulence -> pull by cohesion; hold quiver keeps it alive
        const qv = cc > 0.6 ? 0.012 * Math.sin(this.t * 18 + hi * TWO_PI) : 0;
        vx = vx * sp * (1 - cc) + (pullx * cohK + qv) * cc * dt;
        vy = vy * sp * (1 - cc) + (pully * cohK) * cc * dt;
        vz = vz * sp * (1 - cc) + (pullz * cohK) * cc * dt;
      } else {
        vx *= sp; vy *= sp; vz *= sp;
      }
      let nx = x + vx, ny = y + vy, nz = z + vz;
      // edge reseed: ambient (and released hand) particles that leave the sim box
      // re-enter on the inflow edge -> continuous off-frame flow
      if (cc < 0.02 && (nx < -SIMX || nx > SIMX || ny < -SIMY || ny > SIMY || nz < -1.2 || nz > 1.2)) {
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
    // project + brightness band
    for (let i = 0; i < n; i++) {
      const project = (wx, wy, wz) => {
        const ty = wy * cX - wz * sX;
        return [cx + wx * R, cy - ty * R];
      };
      const a = project(this.PX[i], this.PY[i], this.PZ[i]);
      const b = project(this.X[i], this.Y[i], this.Z[i]);
      this.psx[i] = a[0]; this.psy[i] = a[1]; this.sx[i] = b[0]; this.sy[i] = b[1];
      // depth 0..1
      let d = this.Z[i] * 0.5 + 0.5; if (d < 0) d = 0; else if (d > 1) d = 1;
      const hi = this._h(i * 7 + 99);
      const isHand = hi < this.p('recruit');
      const bv = (isHand ? 0.7 : 0.32) * (0.45 + 0.55 * d);
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
