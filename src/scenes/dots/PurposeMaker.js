import { Scene } from '../Scene.js';
import { TWO_PI } from '../../lib/math.js';
import { SimplexNoise } from '../../lib/noise.js';
import { decodeHandTargets } from './handTargets.js';
import { decodeTurbProfile } from './turbProfile.js';
import { cohesionAt, smoother } from './purposeMakerChoreo.js';
import { breathAt } from './purposeMakerField.js';
import { formAt, GHOLD } from './purposeMakerForm.js';

// PurposeMaker — hands coalesce out of a video-derived turbulence field (R→L→Both),
// hold, then dissolve, seamlessly. A `recruit` fraction of particles condenses onto
// the baked hand point-clouds; the rest stay ambient, flowing through a region wider
// than the viewport and bleeding off all edges. mono, additive, deterministic.
const MAXN = 44000;
const SIMX = 1.6, SIMY = 1.2;   // sim half-extent (viewport shows ±1.0) -> off-frame bleed
const TILT = 0.06;              // tiny fixed tilt for life (hands stay readable)
const BANDS = 6;
// Hand placement. The fixtures are cropped hand-dominant (~1.78 aspect); spanX ≈ aspect*spanY
// keeps the mapping UNDISTORTED so the long fingers render long (not squished stubby). Single
// hand: fingertips reach centre, the wrist/stub runs off toward its entry edge. Both: scaled
// down so two hands fit, fingertips meeting at centre with a small gap + vertical offset.
const SPANX = 1.64, SPANY = 0.92, OFFA = -0.30, OFFB = -1.34;
// Both: kept large enough (undistorted) that the long fingers still separate; fingertips meet
// just off-centre with a small vertical offset so the two hands read distinctly, not as a knot.
const BSPANX = 1.20, BSPANY = 0.67, BOFFA = -0.224, BOFFB = -0.976, BDY = 0.13;
const ACT_SPAN = 0.35;          // convergence-front width: the fraction of g the edge->locus sweep spans
const NSHEET = 4, SHEET_Z = 0.55, SHEET_K = 4.0; // depth slabs / half-depth / plane stiffness (面/帯)
const SEQS = [['R', 'L', 'Both'], ['R', 'L', 'R', 'L', 'Both'], ['R', 'L', 'R', 'L', 'R', 'L', 'Both']];
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

export class PurposeMaker extends Scene {
  constructor() {
    super('purposeMaker', 'PurposeMaker');
    this.trail = 0.16;
    this.modes = [{ name: 'Cycle' }, { name: 'Right' }, { name: 'Left' }, { name: 'Both' }];
    this.modeGroups = [
      { key: 'audio', label: 'Audio', options: ['OFF', 'ON'], index: 1 },
      { key: 'seq', label: 'Seq', options: ['R L Both', 'R L R L Both', 'R L R L R L Both'], index: 1 },
    ];
    this.defineParam('count', 42000, 10000, MAXN, 1000, 'Particles');
    this.defineParam('recruit', 0.60, 0.3, 0.9, 0.05, 'Recruit'); // dense hand mass = the star
    this.defineParam('flow', 0.62, 0.1, 1.5, 0.05, 'Flow Speed');
    this.defineParam('scale', 1.6, 0.6, 3.2, 0.1, 'Field Scale');
    this.defineParam('cohesion', 1.0, 0.3, 2.0, 0.1, 'Cohesion');
    this.defineParam('thread', 0.9, 0.4, 2.0, 0.1, 'Thread');
    this.defineParam('react', 1.0, 0, 6, 0.5, 'React');
    this.defineParam('pace', 1.0, 0.4, 2.0, 0.1, 'Pace');
    this.defineParam('ambient', 0.30, 0, 1, 0.05, 'Ambient'); // sparse calm field between events
    this.defineParam('depth', 0.6, 0, 1, 0.05, 'Depth');      // z-sheet parallax during the band phase
    this.noise = new SimplexNoise(11);
    this.X = this.Y = this.Z = this.PX = this.PY = this.PZ = null;
    this.sx = this.sy = this.psx = this.psy = this.sval = this.sband = null;
    this.n = 0; this.t = 0; this.level = 0; this.bass = 0; this.treble = 0;
    this.hands = null; this.turb = null;
    this._B = null;
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
    this.cv = F(); // per-particle convergence (draw reads it so grains EMERGE rather than burst)
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
  update(dt, audio, palette, clock) {
    this.t = clock.time; this.level = audio.level; this.bass = audio.bass; this.treble = audio.treble;
    const q = clock.quality || 1;
    const n = this.n = Math.min(MAXN, Math.round(this.p('count') * q));
    const recruit = this.p('recruit');
    const audioOn = this.mg('audio') === 1;
    const react = this.p('react');
    // station: Cycle = auto choreography over the chosen sequence; else lock to one station held.
    const mi = this.modeIndex;
    const seq = SEQS[this.mg('seq')] || SEQS[1];
    let st;
    if (mi === 0) st = cohesionAt(this.t, { pace: this.p('pace'), seq });
    else { const map = [null, 'R', 'L', 'Both']; const s = map[mi]; st = { station: s, c: 1, cR: s !== 'L' ? 1 : 0, cL: s !== 'R' ? 1 : 0, phase: 'hold' }; }

    // line<->particle breathing: ONE coherence pulse K drives every texture cue at once
    // (frequency, comb, scatter, speed, persistence, brightness, streak length). Audio
    // (beat/bass) snaps K toward the LINE regime, so the STRUCTURE tracks the music.
    const B = breathAt(this.t, { level: audio.level, bass: audio.bass, treble: audio.treble, beatHold: audio.beatHold }, { react, audioOn });
    this._B = B;
    // form coupling: ONE build progress g drives the recruited grains' texture AND convergence,
    // so the hand IS the fluid converging (dust->line->band->hand). g falls on disperse => the
    // dissolve is the build in reverse. Audio rides the same signal (snapLine/snapConv/flash).
    const g = st.c;
    const rev = st.phase === 'disperse';
    const F = formAt(g, { beatHold: audio.beatHold, bass: audio.bass }, { react, audioOn });
    this._F = F;
    // depth cue: the band phase tilts the field for parallax (the slabs read as stacked planes),
    // easing back to a near-flat tilt at hold so the resolved hand is crisp. +a tiny sway for life.
    this._tilt = TILT + 0.22 * this.p('depth') * F.sheet + 0.02 * Math.sin(this.t * 0.3);
    // persistence breathes too: lines linger (low trail = more persistence), dust is crisper.
    this.trail = 0.16 + 0.13 * (1 - B.K);

    // video-derived field; spatial frequency morphs low(line, smooth)..high(dust, fine).
    const baseFreq = this.turb.scale > 0.001 ? (0.9 / this.turb.scale) : 1.6;
    const fBase = baseFreq * (this.p('scale') / 1.6);
    const f = fBase * (1.35 - 0.95 * B.K);
    const fa = this.turb.flowAngle, dirx = Math.cos(fa), diry = -Math.sin(fa);
    const swirlAmp = 0.24 + 0.85 * B.scatter;      // line pole = little swirl -> smooth comb
    const comb = B.forward + 0.62 * B.advance;     // along-flow comb: stretch into filaments
    const sp = this.p('flow') * B.speed * dt;
    const zt = this.t * 0.05;
    const cohK = this.p('cohesion') * 8.0;
    const noise = this.noise;
    const H = this.hands;

    for (let i = 0; i < n; i++) {
      this.PX[i] = this.X[i]; this.PY[i] = this.Y[i]; this.PZ[i] = this.Z[i];
      const x = this.X[i], y = this.Y[i], z = this.Z[i];
      const hi = this._h(i * 7 + 99);
      const isHand = hi < recruit;
      this.cv[i] = 0; // default: ambient grains carry no convergence
      // shared turbulent swirl (amplitude breathes with scatter)
      let vx = noise.noise3D(x * f, y * f, z * f + zt) * swirlAmp;
      let vy = noise.noise3D(x * f + 5.2, y * f + 9.1, z * f + zt + 2.3) * swirlAmp;
      let vz = noise.noise3D(x * f + 2.7, y * f + 4.4, z * f + zt + 7.8) * swirlAmp * 0.7;
      // The hand is the fluid CONVERGING. While a station is active (not the gap) recruited grains
      // stream in from the entry edge and morph dust->line->band->hand under formAt(g); in the gap
      // they fall through to the ambient block and rejoin the calm field.
      if (isHand && st.phase !== 'gap') {
        let hand, cloud;
        if (st.station === 'R') { hand = 0; cloud = H.A; }
        else if (st.station === 'L') { hand = 1; cloud = H.B; }
        else { hand = this._h(i * 3 + 1) < 0.5 ? 0 : 1; cloud = hand === 0 ? H.A : H.B; }
        const idx = i % cloud.n;
        const u = cloud.u[idx] / 32767, vv = cloud.v[idx] / 32767;
        let tx, ty;
        if (st.station === 'Both') {
          tx = (hand === 0 ? BOFFA : BOFFB) + BSPANX * u;
          ty = (0.5 - vv) * BSPANY + (hand === 0 ? BDY : -BDY);
        } else {
          tx = (hand === 0 ? OFFA : OFFB) + SPANX * u;
          ty = (0.5 - vv) * SPANY;
        }
        // convergence front: targets near the entry edge resolve first (low phi -> high gp); on
        // disperse the far/fingertip side dissolves first. gp = this grain's staggered progress.
        const entrySign = hand === 0 ? 1 : -1;
        const dEdge = entrySign > 0 ? (SIMX - tx) / (2 * SIMX) : (tx + SIMX) / (2 * SIMX);
        const phi = rev ? (1 - dEdge) : dEdge;
        const gp = clamp01((g - phi * ACT_SPAN) / (1 - ACT_SPAN));
        let conv = smoother(clamp01((gp - GHOLD) / (1 - GHOLD)));
        conv = conv + F.snapConv * (1 - conv);               // a kick nudges convergence in
        // wavering advance/retreat before the grains lock (slow, deterministic, dies as conv->1)
        const waver = Math.sin(this.t * 0.7 + hi * TWO_PI) * 0.10 * (1 - conv);
        const adv = 0.9 * F.advance * (1 - conv);            // net streaming carry along entry axis
        const dir = rev ? 1 : -1;                            // edge->locus (gather) / locus->edge (disperse)
        // 3D "面/帯": each grain belongs to one depth slab (independent hash salt, so every band
        // samples the whole silhouette -> stacked planes, not vertical slices). The slab lifts
        // during the band phase and collapses to z=0 as the hand resolves into a flat plane.
        const sIdx = (this._h(i * 5 + 3) * NSHEET) | 0;
        const sheetZ = (sIdx / (NSHEET - 1) - 0.5) * SHEET_Z;
        const zTarget = sheetZ * F.sheet * (1 - conv);
        const lc = (F.line * (1 + 0.6 * F.snapLine)) * comb; // filament-comb, punched by the beat
        vx += dirx * lc + dir * entrySign * adv + entrySign * waver;
        vy += diry * lc;
        vz += (zTarget - z) * SHEET_K * F.sheet + 0.5 * waver; // gather onto the band plane
        const qv = conv > 0.5 ? 0.010 * Math.sin(this.t * 16 + hi * TWO_PI) : 0;
        vx = vx * sp * (1 - conv) + ((tx - x) * cohK + qv) * conv * dt;
        vy = vy * sp * (1 - conv) + ((ty - y) * cohK + qv * 0.5) * conv * dt;
        vz = vz * sp * (1 - conv) + ((zTarget - z) * cohK) * conv * dt;
        this.X[i] = x + vx; this.Y[i] = y + vy; this.Z[i] = z + vz;
        this.cv[i] = conv;
        continue;
      }
      // ambient medium: comb into aligned LINES (coherent forward) or scatter into DUST.
      // A cheap coarse spatial term lets some streamtubes comb before others.
      const cn = Math.sin(x * 1.3 + zt * 1.5) * Math.cos(y * 1.1 - zt);
      const lcomb = comb * (0.5 + 0.55 * (cn + 1));
      vx += dirx * lcomb; vy += diry * lcomb;
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
    const tilt = this._tilt != null ? this._tilt : TILT;
    const cX = Math.cos(tilt), sX = Math.sin(tilt);
    const B = this._B;
    const elong = B ? B.elong : 0.5, flash = B ? B.flash : 0, ambB = B ? B.bright : 0.7;
    const recruit = this.p('recruit');
    const streakMax = R * 0.075;                    // px length of a fully-extended LINE streak
    // light conservation: a longer streak spreads one particle's light over more pixels, so its
    // per-stroke brightness must fall ~1/length. => DUST = bright compact grains, LINE = faint
    // long strands (sparse, not a bright bank). The beat-flash is ADDITIVE (below) so it is not
    // swallowed by this division.
    const lenComp = 0.62 / (0.30 + elong);
    const fa = this.turb.flowAngle, dirx = Math.cos(fa), diry = -Math.sin(fa);
    const perpx = -diry, perpy = dirx;
    // positional audio displacement (drawn-only -> legible, no sim diffusion): a transverse
    // standing wave from the waveform + fine treble jitter, in pixels.
    const wave = this.audio && this.audio.waveform, wlen = wave ? wave.length : 0;
    const ripAmp = (B ? B.ripple : 0) * 0.09 * R;
    const shAmp = (B ? B.shimmer : 0) * 0.05 * R;
    const tw = this.t;
    const ambDensity = this.p('ambient'); // fraction of ambient grains drawn (calm sparse field)
    for (let i = 0; i < n; i++) {
      const z = this.Z[i];
      const tyc = this.Y[i] * cX - z * sX;
      let sxc = cx + this.X[i] * R, syc = cy - tyc * R;
      const typ = this.PY[i] * cX - this.PZ[i] * sX;
      const pxs = cx + this.PX[i] * R, pys = cy - typ * R;
      let d = z * 0.5 + 0.5; if (d < 0) d = 0; else if (d > 1) d = 1;
      const hi = this._h(i * 7 + 99);
      const isHand = hi < recruit;
      let bx, by, bv;
      if (isHand) {
        // hands = the luminous focal point. Grains EMERGE: faint while transiting/forming, full
        // bright only as they resolve onto the silhouette, so the build reads as lines/bands
        // coalescing rather than a blown-out burst. The draw streak is capped so fast-converging
        // grains don't smear into bright bars.
        let mvx = sxc - pxs, mvy = syc - pys;
        const mmRaw = Math.sqrt(mvx * mvx + mvy * mvy), cap = R * 0.05;
        if (mmRaw > cap) { const k2 = cap / mmRaw; mvx *= k2; mvy *= k2; }
        bx = sxc - mvx; by = syc - mvy;
        // the wrist/stub DISSOLVES into the field: full bright out to ax≈0.55 (fingertips→palm),
        // then tapers so the arm-root fades off — kills the blocky-forearm read.
        const ax = Math.abs(sxc - cx) / R;
        const armFade = ax < 0.55 ? 1 : Math.max(0.25, 1 - 1.5 * (ax - 0.55));
        // a grain is bright only when it is BOTH converged (emerge) AND settled (settle): the
        // resolved, still hand is the luminous payoff, while transiting/streaming grains stay
        // faint — so the build reads as a quiet coalescing, not bright motion trails.
        const cv = this.cv[i];
        const emerge = 0.10 + 0.90 * cv * cv;
        const settle = 1 / (1 + 55 * mmRaw / R);
        bv = 1.40 * armFade * (0.5 + 0.5 * d) * (1 + 0.25 * flash) * emerge * settle;
      } else {
        // sparse calm field: draw only a fraction of ambient grains, so the converging mass is the
        // star and the background never reads as a pasted particle sheet (deterministic hash gate).
        if (this._h(i * 11 + 7) >= ambDensity) { this.sval[i] = 0; continue; }
        // ambient: positional waveform + treble displacement applied to the head.
        if (ripAmp || shAmp) {
          let off = 0;
          if (ripAmp && wlen) {
            const sCoord = this.X[i] * dirx + this.Y[i] * diry;
            let idx = (((sCoord * 0.5 + 0.5 + tw * 0.2) * wlen * 0.3) | 0) % wlen;
            if (idx < 0) idx += wlen;
            off += ripAmp * ((wave[idx] - 128) / 128);
          }
          if (shAmp) off += shAmp * Math.sin(this.X[i] * 53 + this.Y[i] * 47 + tw * 30);
          sxc += perpx * off; syc += perpy * off;
        }
        // streak: a tail behind the head along screen motion, length scaled by elong(K):
        // ~a dot at the DUST pole, a long filament at the LINE pole.
        let mvx = sxc - pxs, mvy = syc - pys;
        let mag = Math.sqrt(mvx * mvx + mvy * mvy);
        if (mag < 1e-3) { mvx = dirx; mvy = -diry; mag = Math.sqrt(mvx * mvx + mvy * mvy) || 1; }
        const L = streakMax * elong;
        bx = sxc - (mvx / mag) * L; by = syc - (mvy / mag) * L;
        // edge falloff (plume in black space) + a luminous central nucleus the dust sprays from.
        const ex = (sxc - cx) / R, ey = (syc - cy) / R;
        const rr = Math.sqrt(ex * ex + ey * ey);
        const fall = rr < 1.0 ? 1 : rr > 1.7 ? 0.14 : 1 - ((rr - 1.0) / 0.7) * 0.86;
        const core = 1 + 0.9 * Math.exp(-rr * rr * 1.8);   // bright nucleus -> fainter spray
        const depth = 0.4 + 0.6 * d;
        // conserved field light + an ADDITIVE beat flash (outside length-conservation, so the
        // kick is unmistakably BRIGHTER, not cancelled by the streak-length division).
        bv = (0.40 * ambB) * depth * fall * core * lenComp + 0.42 * flash * depth * fall;
      }
      this.psx[i] = bx; this.psy[i] = by; this.sx[i] = sxc; this.sy[i] = syc;
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
