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
      { key: 'flow', label: 'Mist Flow', options: ['Directional', 'Radial', 'Wander'], index: 0 },
    ];
    this.defineParam('count', 42000, 10000, MAXN, 1000, 'Particles');
    // — hand —
    this.defineParam('recruit', 0.60, 0.3, 0.9, 0.05, 'Recruit'); // dense hand mass = the star
    this.defineParam('flow', 0.62, 0.1, 1.5, 0.05, 'Hand Flow');
    this.defineParam('cohesion', 1.0, 0.3, 2.0, 0.1, 'Cohesion');
    this.defineParam('react', 1.0, 0, 6, 0.5, 'Hand Audio');
    this.defineParam('pace', 1.0, 0.4, 2.0, 0.1, 'Pace');
    this.defineParam('thread', 0.9, 0.4, 2.0, 0.1, 'Thread');
    this.defineParam('depth', 0.6, 0, 1, 0.05, 'Depth');      // z-sheet parallax during the band phase
    // — 綿毛 (mist / ambient): its own knobs so operating it never fights the hand —
    this.defineParam('ambient', 0.30, 0, 1, 0.05, 'Mist Density'); // sparse calm field between events
    this.defineParam('ambFlow', 0.62, 0.1, 1.5, 0.05, 'Mist Flow');
    this.defineParam('scale', 1.6, 0.6, 3.2, 0.1, 'Mist Scale');
    this.defineParam('ambReact', 1.0, 0, 6, 0.5, 'Mist Audio'); // 明滅 strength + line-snap
    this.defineParam('spread', 0.7, 0.2, 1.4, 0.05, 'Mist Spread'); // Radial: emanation radius / range
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
    this._deriveFingerAnchors();
    this.turb = decodeTurbProfile();
    this._alloc();
    this._seedAll();
  }
  // Derive, per hand, a wrist base + 5 fingertip anchors in (u,v) so the line phase can fan the
  // grains into 5 curved strands that become the 5 fingers (動画と同一). Hand A's wrist is at high
  // u (it enters +x), Hand B's at low u — fingers sit on the far side, binned by v into 5.
  _deriveFingerAnchors() {
    const derive = (cloud, wristHighU) => {
      const n = cloud.n; let wu = 0, wv = 0, wc = 0;
      for (let i = 0; i < n; i++) { const u = cloud.u[i] / 32767; if (wristHighU ? u > 0.7 : u < 0.3) { wu += u; wv += cloud.v[i] / 32767; wc++; } }
      cloud.wrist = wc ? { u: wu / wc, v: wv / wc } : { u: wristHighU ? 0.85 : 0.15, v: 0.5 };
      const tips = [];
      for (let b = 0; b < 5; b++) {
        const vlo = b / 5, vhi = (b + 1) / 5;
        let best = wristHighU ? 2 : -1, bu = 0, bv = 0;
        for (let i = 0; i < n; i++) {
          const u = cloud.u[i] / 32767, v = cloud.v[i] / 32767;
          if (v < vlo || v >= vhi) continue;
          if (wristHighU ? (u < 0.5 && u < best) : (u > 0.5 && u > best)) { best = u; bu = u; bv = v; }
        }
        tips.push((wristHighU ? best < 2 : best > -1) ? { u: bu, v: bv } : { u: wristHighU ? 0.12 : 0.88, v: (vlo + vhi) / 2 });
      }
      cloud.tips = tips;
    };
    derive(this.hands.A, true);
    derive(this.hands.B, false);
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
    if (fromEdge) { // reseed per flow mode so the mist keeps flowing continuously
      const mode = this.mg('flow');
      if (mode === 1) {                 // Radial: reseed near centre -> grains emanate outward
        const ang = this._h(i * 13 + 9) * TWO_PI, rad = (0.04 + 0.12 * this._h(i * 13 + 11)) * SIMX;
        x = Math.cos(ang) * rad; y = Math.sin(ang) * rad;
      } else if (mode === 2) {          // Wander: density-scattered spawn (x,y already sampled)
        /* keep the density-sampled position */
      } else {                          // Directional: reseed on the inflow edge
        const ang = this.turb.flowAngle;
        x = -Math.cos(ang) * SIMX; y = Math.sin(ang) * SIMY * 0.6 + (this._h(i * 13 + 9) - 0.5) * SIMY;
      }
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
    const handReact = this.p('react'), ambReact = this.p('ambReact'); // hand vs 綿毛 audio, separate
    // station: Cycle = auto choreography over the chosen sequence; else lock to one station held.
    const mi = this.modeIndex;
    const seq = SEQS[this.mg('seq')] || SEQS[1];
    let st;
    if (mi === 0) st = cohesionAt(this.t, { pace: this.p('pace'), seq });
    else { const map = [null, 'R', 'L', 'Both']; const s = map[mi]; st = { station: s, c: 1, cR: s !== 'L' ? 1 : 0, cL: s !== 'R' ? 1 : 0, phase: 'hold' }; }

    // line<->particle breathing: ONE coherence pulse K drives every texture cue at once
    // (frequency, comb, scatter, speed, persistence, brightness, streak length). Audio
    // (beat/bass) snaps K toward the LINE regime, so the STRUCTURE tracks the music.
    const B = breathAt(this.t, { level: audio.level, bass: audio.bass, treble: audio.treble, beatHold: audio.beatHold }, { react: ambReact, audioOn });
    this._B = B;
    // form coupling: ONE build progress g drives the recruited grains' texture AND convergence,
    // so the hand IS the fluid converging (dust->line->band->hand). g falls on disperse => the
    // dissolve is the build in reverse. Audio rides the same signal (snapLine/snapConv/flash).
    const g = st.c;
    const rev = st.phase === 'disperse';
    const F = formAt(g, { beatHold: audio.beatHold, bass: audio.bass }, { react: handReact, audioOn });
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
    // 綿毛 flow mode: Directional keeps flowAngle; Wander slowly rotates the global direction.
    const flowMode = this.mg('flow'), spread = this.p('spread');
    let gdx = dirx, gdy = diry;
    if (flowMode === 2) { const wa = fa + 1.6 * Math.sin(this.t * 0.05) + 0.9 * Math.sin(this.t * 0.017 + 1.3); gdx = Math.cos(wa); gdy = -Math.sin(wa); }
    const spreadR2 = (spread * SIMX) * (spread * SIMX);
    const swirlAmp = 0.24 + 0.85 * B.scatter;      // line pole = little swirl -> smooth comb
    const comb = B.forward + 0.62 * B.advance;     // along-flow comb: stretch into filaments
    const handSp = this.p('flow') * dt;            // hand transit speed (decoupled from the 綿毛 breath)
    const ambSp = this.p('ambFlow') * B.speed * dt; // 綿毛 flow speed (breathes with its own K)
    const zt = this.t * 0.05;
    const cohK = this.p('cohesion') * 8.0;
    const noise = this.noise;
    const H = this.hands;
    // 5-finger strand anchors (sim coords) for the active hand(s): P0 wrist, P1 control/bow, P2
    // fingertip. The line phase fans grains along these curves so 複数の線 read as the fingers.
    const both = st.station === 'Both';
    const mkStrands = (hand) => {
      const cloud = hand === 0 ? H.A : H.B, w = cloud.wrist, tips = cloud.tips;
      const offU = both ? (hand === 0 ? BOFFA : BOFFB) : (hand === 0 ? OFFA : OFFB);
      const spanU = both ? BSPANX : SPANX, spanV = both ? BSPANY : SPANY, dy0 = both ? (hand === 0 ? BDY : -BDY) : 0;
      const mx = (u) => offU + spanU * u, my = (v) => (0.5 - v) * spanV + dy0;
      const wx = mx(w.u), wy = my(w.v), fan = [];
      for (let k = 0; k < 5; k++) {
        const fx = mx(tips[k].u), fy = my(tips[k].v);
        const cx2 = (wx + fx) / 2, cy2 = (wy + fy) / 2, ddx = fx - wx, ddy = fy - wy, L = Math.sqrt(ddx * ddx + ddy * ddy) || 1;
        const bow = 0.16 * (k - 2); // splayed perpendicular bow -> gentle, distinct curves
        fan.push([wx, wy, cx2 + (-ddy / L) * bow, cy2 + (ddx / L) * bow, fx, fy]);
      }
      return fan;
    };
    const strandsA = (st.station === 'R' || both) ? mkStrands(0) : null;
    const strandsB = (st.station === 'L' || both) ? mkStrands(1) : null;
    const smax = clamp01(g / GHOLD); // strands grow to full length by the time convergence onsets

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
        // convergence front: targets near the entry edge (low phi) resolve first. phi is a pure
        // function of g, so disperse (g falling) replays the build in REVERSE for free — the
        // fingertips (high phi, last to form) dissolve first, the wrist last (逆展開). `rev` is used
        // only for the streaming DIRECTION below, not the front order.
        const entrySign = hand === 0 ? 1 : -1;
        const dEdge = entrySign > 0 ? (SIMX - tx) / (2 * SIMX) : (tx + SIMX) / (2 * SIMX);
        const phi = dEdge;
        const gp = clamp01((g - phi * ACT_SPAN) / (1 - ACT_SPAN));
        let conv = smoother(clamp01((gp - GHOLD) / (1 - GHOLD)));
        conv = conv + F.snapConv * (1 - conv);               // a kick nudges convergence in
        // 5 curved strands: during the LINE phase pull grains onto their fanned finger-curve (one
        // of 5, by hash), then blend the aim across to the real hand target as the hand resolves —
        // so the 5 curves literally open into the fingers. `ss` spreads grains along the growing
        // strand; `pw` is the strand pull (F.line) handing off to the target pull (conv).
        const fan = hand === 0 ? strandsA : strandsB;
        const seg = fan[(this._h(i * 23 + 5) * 5) | 0];
        const ss = this._h(i * 29 + 13) * smax, oms = 1 - ss;
        const curveX = oms * oms * seg[0] + 2 * oms * ss * seg[2] + ss * ss * seg[4];
        const curveY = oms * oms * seg[1] + 2 * oms * ss * seg[3] + ss * ss * seg[4 + 1];
        const aimX = curveX + (tx - curveX) * conv, aimY = curveY + (ty - curveY) * conv;
        const pw = clamp01(1.1 * F.line + conv);
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
        // filament-comb: the LINE phase stretches grains along the flow into 複数の線. Give it its
        // OWN directional floor (0.55) so it reads even when the ambient comb is weak, + the ambient
        // comb, + a beat punch.
        const lc = F.line * (1 + 0.6 * F.snapLine) * (0.55 + comb);
        vx += dirx * lc + dir * entrySign * adv + entrySign * waver;
        vy += diry * lc;
        vz += (zTarget - z) * SHEET_K * F.sheet + 0.5 * waver; // gather onto the band plane
        const qv = conv > 0.5 ? 0.010 * Math.sin(this.t * 16 + hi * TWO_PI) : 0;
        vx = vx * handSp * (1 - pw) + ((aimX - x) * cohK + qv) * pw * dt;
        vy = vy * handSp * (1 - pw) + ((aimY - y) * cohK + qv * 0.5) * pw * dt;
        vz = vz * handSp * (1 - pw) + ((zTarget - z) * cohK) * pw * dt;
        this.X[i] = x + vx; this.Y[i] = y + vy; this.Z[i] = z + vz;
        this.cv[i] = conv;
        continue;
      }
      // ambient medium ("綿毛"): comb into aligned LINES or scatter into DUST. The flow direction
      // follows the mode — Directional (fixed), Radial (outward from centre), Wander (drifting).
      let adx = gdx, ady = gdy, push;
      const cn = Math.sin(x * 1.3 + zt * 1.5) * Math.cos(y * 1.1 - zt);
      const lcomb = comb * (0.5 + 0.55 * (cn + 1));
      if (flowMode === 1) { const rr = Math.sqrt(x * x + y * y) || 1e-3; adx = x / rr; ady = y / rr; push = lcomb + 0.7; } // firm outward drift dominates the swirl
      else push = lcomb;
      vx += adx * push; vy += ady * push;
      let nx = x + vx * ambSp, ny = y + vy * ambSp, nz = z + vz * ambSp;
      // recycle: Radial grains reseed beyond the spread radius (concentric emanation); all modes
      // also reseed when they leave the sim box -> continuous off-frame flow.
      const offBox = nx < -SIMX || nx > SIMX || ny < -SIMY || ny > SIMY || nz < -1.2 || nz > 1.2;
      if (offBox || (flowMode === 1 && nx * nx + ny * ny > spreadR2)) {
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
    const B = this._B, F = this._F;
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
    const ambFlash = this.p('ambReact');  // 綿毛 明滅 strength (beat flash brightness)
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
        const cv = this.cv[i];
        const Fl = F ? F.line : 0;
        let mvx = sxc - pxs, mvy = syc - pys;
        const mmRaw = Math.sqrt(mvx * mvx + mvy * mvy);
        // the draw streak grows into a filament during the LINE phase (grain still unlocked) and
        // tightens to a crisp grain as the hand resolves — so 複数の線 read, not a fuzzy cloud.
        const cap = R * (0.05 + 0.22 * Fl * (1 - cv));
        if (mmRaw > cap) { const k2 = cap / mmRaw; mvx *= k2; mvy *= k2; }
        bx = sxc - mvx; by = syc - mvy;
        // the wrist/stub DISSOLVES into the field: full bright out to ax≈0.55 (fingertips→palm),
        // then tapers so the arm-root fades off — kills the blocky-forearm read.
        const ax = Math.abs(sxc - cx) / R;
        const armFade = ax < 0.55 ? 1 : Math.max(0.25, 1 - 1.5 * (ax - 0.55));
        // a grain is bright only when it is BOTH converged (emerge) AND settled (settle): the
        // resolved, still hand is the luminous payoff, while transiting/streaming grains stay
        // faint — so the build reads as a quiet coalescing, not bright motion trails.
        // the 5 line strands GLOW even before they lock (they're organised, so no blow-out), and
        // the motion-dimming eases during the line phase so the moving curves stay visible.
        const emerge = Math.max(0.10 + 0.90 * cv * cv, 0.55 * Fl);
        const settle = 1 / (1 + 55 * mmRaw / R * (1 - 0.7 * Fl));
        bv = 1.40 * armFade * (0.5 + 0.5 * d) * (1 + 0.25 * flash) * emerge * settle;
      } else {
        // sparse calm field: draw only a fraction of ambient grains, so the converging mass is the
        // star and the background never reads as a pasted particle sheet (deterministic hash gate).
        if (this._h(i * 101 + 37) >= ambDensity) { this.sval[i] = 0; continue; }
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
        bv = (0.40 * ambB) * depth * fall * core * lenComp + 0.42 * flash * ambFlash * depth * fall;
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
