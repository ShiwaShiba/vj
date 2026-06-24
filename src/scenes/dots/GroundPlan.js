import { Scene } from '../Scene.js';
import { clamp, lerp, smoothstep, map, rgbCss, lerpRgb, TWO_PI } from '../../lib/math.js';
import { SimplexNoise } from '../../lib/noise.js';

// GROUND PLAN — a precise FLAT (true top-down) blueprint of the Kunitachi (国立)
// university town. The line work emanates from the station like current through a
// circuit: a wavefront radius grows OUTWARD from the apex with mic energy and holds
// once the whole board is lit. Faithful to the supplied maps + aerial:
//   - 中央線 railway: double E-W line through the station (the apex's north side)
//   - 大学通り: thickest spine, due south (0°), pierces past the district to the south
//   - 富士見通り: ~52° west of the spine — the wider, longer radial
//   - 旭通り:     ~46° east of the spine — tighter + much shorter (length ratio ≈1.7)
//   - an orthogonal street grid that fills the WHOLE frame: BRIGHT inside the
//     home-plate district, DIM outside it, with a bold pentagon boundary between
//   - the station footprint + rotary at the apex (the energizing "source")
//   - the two 一橋大学 super-blocks hugging 大学通り (open, the grid routes around)
// Monochrome (Ikeda / Kraftwerk); the only saturated marks are the energizing tip
// sparks and the single station node. 3D extrusion is intentionally deferred — this
// pass is ALL about the flat map. The 3D version is preserved in git history.

const DEG = Math.PI / 180;
const STALL = 0.05;          // idle creep so silence still eventually completes the build

// Plan space: apex (station rotary) at the origin, +y = south, equal scale on both
// axes so a 45° road is drawn at a true 45°. The pentagon bottom sits at y = SOUTH.
const SOUTH = 1.0;
const SPINE = 0.025;         // half-width of the 大学通り corridor kept clear of grid
const CL = SPINE + 0.02;     // grid clearance from the spine (narrow margin each side)
const AVE_MX = 0.026;        // grid clearance from the avenues (keeps the diagonals clean)

// Outer-mesh extent (plan units) — generously past the frame; off-frame lines are
// skipped at draw time, so this just guarantees the visible frame is fully filled.
const EXT_X = 1.9, EXT_N = -0.30, EXT_S = 1.85;
const MAX_SEG = 1500;        // hard ceiling on segment count (perf backstop)

// Base spacings; the Grid slider scales these (finer at high values, coarser at low).
const DV_BASE = 0.041;       // N-S column spacing at slider = 1
const DH_BASE = 0.036;       // E-W row spacing   at slider = 1

// Avenue angles from the spine (south axis). The aerial shows the fan opening WIDER
// than a crisp 45° — 富士見 at 45° read too acute — so both open up, 富士見 the wider.
const A_FUJIMI = 52 * DEG;   // 富士見通り, west — the wider, longer radial
const A_ASAHI = 46 * DEG;   // 旭通り, east — a touch tighter (the "ambiguous" one)
const TAN_F = Math.tan(A_FUJIMI); // ≈1.280
const TAN_A = Math.tan(A_ASAHI);  // ≈1.036

// Pentagon shoulders. The WEST side (富士見) runs much LONGER than the EAST (旭) —
// the real district extends far further to the west (length ratio ≈1.7, kept).
const SH_L = 0.945;                // left shoulder px — the long, wide side
const SH_L_Y = SH_L / TAN_F;       // ≈0.738
const SH_R = 0.511;                // right shoulder px — the short side
const SH_R_Y = SH_R / TAN_A;       // ≈0.493

// kinds: 0 inside-grid, 1 avenue, 2 spine, 3 boundary, 4 railway, 5 outside-grid
const K_GRID = 0, K_AVE = 1, K_SPINE = 2, K_BOUND = 3, K_RAIL = 4, K_GOUT = 5;

// Building footprints (3D phase). Blocks use a COARSER grid than the streets so
// they read as city blocks, independent of the street-density slider.
const MAX_BLOCKS = 240;
const BDV = 0.095, BDH = 0.085;          // building-block grid spacing (plan units)
const K_INSIDE = 0, K_OUTSIDE = 1, K_LAND = 2; // block kinds: inside district / outside / landmark
const FOCAL = 4.5;                       // camera focal length in units of H (weak perspective)

// Phase loop: ENERGIZE (flat circuit) -> RISE (city extrudes) -> HOLD -> SINK -> RISE…
const PH_ENERGIZE = 0, PH_RISE = 1, PH_HOLD = 2, PH_SINK = 3;
const BAR = 4, SEC_BEATS = BAR * 8, HOLD_SECTIONS = 3;
const SINK_RATE = 0.26;                  // teardown speed (audio-independent, can't stall)

// 3D box faces + monochrome shading (reused from the 3D checkpoint / FallingCubes).
const NTONE = 16, FACES = 5;             // grayscale buckets; faces per block (top + 4 walls)
const LX = -0.4, LY = -0.7, LZ = 0.55, LL = Math.hypot(LX, LY, LZ);
const LNX = LX / LL, LNY = LY / LL, LNZ = LZ / LL; // world light dir (up = -y, so roofs read bright)
// box verts in (x,y,z); base = ground (y=0), top = y=-h. floor face skipped.
const BOX_F = [
  { idx: [3, 2, 6, 7], n: [0, -1, 0] }, // top (up)
  { idx: [0, 1, 2, 3], n: [0, 0, -1] }, // north wall
  { idx: [4, 5, 6, 7], n: [0, 0, 1] },  // south wall
  { idx: [0, 3, 7, 4], n: [-1, 0, 0] }, // west wall
  { idx: [1, 2, 6, 5], n: [1, 0, 0] },  // east wall
];

export class GroundPlan extends Scene {
  constructor() {
    super('groundplan', 'Ground Plan');
    this.trail = 0.85;

    this.defineParam('buildSpeed', 0.14, 0.04, 0.5, 0.02, 'Build Speed');
    this.defineParam('riseSpeed', 0.16, 0.04, 0.5, 0.02, 'Rise Speed');
    this.defineParam('density', 1.2, 0.4, 2.0, 0.05, 'Grid (fine↔coarse)');
    this.defineParam('avenueWidth', 3.0, 1.5, 5.0, 0.1, '大学通り Width');
    this.defineParam('spark', 1, 0, 1, 1, 'Spark');
    this.defineParam('trail', 0.85, 0.3, 1.0, 0.05, 'Trail');
    this.defineParam('light', 0.6, 0, 1, 0.05, 'Light');

    // independent switchable axes (rendered as labelled button rows by ControlPanel)
    this.modeGroups = [
      { key: 'scope', label: '範囲', options: ['District', 'City', 'Landmark'], index: 0 },
      { key: 'cam', label: 'カメラ', options: ['Tilt', 'Live', 'Plan'], index: 1 },
      { key: 'height', label: '高さ', options: ['Vary', 'Even', 'Pulse'], index: 0 },
      { key: 'style', label: 'スタイル', options: ['Hybrid', 'Wire', 'Solid'], index: 0 },
    ];

    this.t = 0;
    this._front = 0;     // 0..1 energization progress (monotonic; holds at 1)
    this._energy = 0;    // slow level follower (for surge detection)

    this._seg = null;    // plan segments (rebuilt when the Grid slider changes)
    this._gridK = -1;    // grid-spacing value the current segments were built at
    this._reach = 1;     // plan distance from apex to the farthest screen corner

    this._H = 0; this._S = 0; this._cx = 0; this._topY = 0;

    this.noise = new SimplexNoise(19); // stable per-block height variation
    this._blocks = null;               // building footprints (built with the grid)

    this._camYaw = 0; this._camPitch = -Math.PI / 2; // top-down until the city rises
    this._cyLift = 0;                                 // vertical re-framing as it tilts
    this._p0 = [0, 0, 0]; this._p1 = [0, 0, 0];       // projection scratch

    this._phase = PH_ENERGIZE; this._rise = 0; this._riseView = 0;
    this._secStart = 0; this._holdN = 0;

    // 3D projection / face scratch (allocation-free hot loop)
    this._pvx = new Float32Array(MAX_BLOCKS * 8);
    this._pvy = new Float32Array(MAX_BLOCKS * 8);
    this._pvf = new Float32Array(MAX_BLOCKS * 8);
    this._fSlot = new Int32Array(MAX_BLOCKS * FACES);
    this._fIdx = new Uint8Array(MAX_BLOCKS * FACES);
    this._fCz = new Float32Array(MAX_BLOCKS * FACES);
    this._fBucket = new Uint8Array(MAX_BLOCKS * FACES);
    this._fOrder = [];
    this._toneCss = new Array(NTONE);
    this._tmpRgb = [0, 0, 0];
  }

  init(ctx, w, h) {
    super.init(ctx, w, h);
    this._layout();
    this._build();
    this._front = 0; // energize fresh on first mount
  }
  onResize(w, h) { super.onResize(w, h); this._layout(); }

  _layout() {
    this._H = Math.min(this.w, this.h);
    this._S = this._H * 0.60;     // plan-unit -> px (visual scale; tune vs. map)
    this._cx = this.w * 0.5;
    this._topY = this.h * 0.13;   // apex y on screen (station near the top)
    // reach = farthest screen corner, so front=1 lights the whole visible frame.
    let reach = 0;
    for (const [sx, sy] of [[0, 0], [this.w, 0], [0, this.h], [this.w, this.h]]) {
      const px = (sx - this._cx) / this._S, py = (sy - this._topY) / this._S;
      reach = Math.max(reach, Math.hypot(px, py));
    }
    this._reach = reach * 1.04;
  }

  // east/west district edge (the actual boundary road) at depth py.
  _xLb(py) { return -Math.min(py * TAN_F, SH_L); }
  _xRb(py) { return Math.min(py * TAN_A, SH_R); }

  // Author the Kunitachi plan into `this._seg`. Each segment is ordered near->far
  // from the apex so the wavefront draws it outward.
  _build() {
    const seg = [];
    const add = (ax, ay, bx, by, kind) => {
      if (seg.length >= MAX_SEG) return;
      let dA = Math.hypot(ax, ay), dB = Math.hypot(bx, by);
      if (dB < dA) { // keep (ax,ay) as the station-near end
        const tx = ax; ax = bx; bx = tx; const ty = ay; ay = by; by = ty;
        const td = dA; dA = dB; dB = td;
      }
      seg.push({ ax, ay, bx, by, dA, dB, kind });
    };

    // 中央線 railway: double E-W line through the station, split at the spine.
    const railHalf = 0.50;
    for (const ry of [-0.045, -0.062]) {
      add(0, ry, -railHalf, ry, K_RAIL);
      add(0, ry, railHalf, ry, K_RAIL);
    }

    // The radiating trident — 富士見 (west) runs much LONGER than 旭 (east).
    add(0, 0, 0, 1.15, K_SPINE);                 // 大学通り (pierces south)
    add(0, 0, -SH_L, SH_L_Y, K_AVE);             // 富士見通り (long, wide)
    add(0, 0, SH_R, SH_R_Y, K_AVE);              // 旭通り     (short)

    // Pentagon boundary (the avenues themselves are the two diagonal upper edges).
    add(-SH_L, SH_L_Y, -SH_L, SOUTH, K_BOUND);   // west vertical side
    add(-SH_L, SOUTH, SH_R, SOUTH, K_BOUND);     // south base
    add(SH_R, SOUTH, SH_R, SH_R_Y, K_BOUND);     // east vertical side

    // 一橋大学 super-blocks hugging 大学通り (open + ungridded; grid routes around).
    const CAMP = [
      [-0.30, 0.26, -0.08, 0.56], // west campus (left of the spine)
      [0.08, 0.30, 0.27, 0.52],  // east campus (right of the spine)
    ];
    this._campus = CAMP;

    const k = this.p('density');
    this._genGrid(add, DV_BASE / k, DH_BASE / k, CAMP);
    this._gridK = k;

    this._seg = seg;
    this._buildBlocks();
  }

  // Building footprints derived from the frozen flat geometry: the station tower +
  // two 一橋 super-blocks (landmarks, never culled), then a coarse block grid split
  // into inside-district / outside blocks. Capped at MAX_BLOCKS (nearest kept).
  _buildBlocks() {
    const blocks = [];
    const reach = this._reach || 1.4;
    const distKey = (u, v) => clamp(Math.hypot(u, v) / reach, 0, 1);
    const inPent = (u, v) => v >= 0 && v <= SOUTH && u > this._xLb(v) && u < this._xRb(v);
    const inCamp = (u, v) => this._campus.some((c) => u > c[0] && u < c[2] && v > c[1] && v < c[3]);

    blocks.push({ uMin: -0.05, uMax: 0.05, vMin: -0.06, vMax: 0.04, hNorm: 1.4, key: 0.02, kind: K_LAND }); // 駅舎タワー
    for (const c of this._campus) {
      blocks.push({ uMin: c[0], uMax: c[2], vMin: c[1], vMax: c[3], hNorm: 0.5,
        key: distKey((c[0] + c[2]) / 2, (c[1] + c[3]) / 2), kind: K_LAND }); // 一橋 西/東
    }

    const inset = Math.min(BDV, BDH) * 0.18;
    for (let v = 0.08; v < EXT_S - BDH; v += BDH) {
      for (let u = -EXT_X + BDV; u < EXT_X; u += BDV) {
        const cu = u + BDV / 2, cv = v + BDH / 2;
        if (Math.abs(cu) < CL) continue;              // spine corridor kept clear
        if (inCamp(cu, cv)) continue;                 // campuses are explicit landmarks
        const inside = inPent(cu, cv);
        const n = this.noise.noise2D(cu * 3.1, cv * 3.1) * 0.5 + 0.5; // 0..1 stable
        const spineBoost = 1 + 0.5 * smoothstep(0.5, 0.0, Math.abs(cu)); // taller near 大学通り
        const hNorm = (inside ? 0.35 + 0.6 * n : 0.18 + 0.25 * n) * spineBoost;
        blocks.push({ uMin: u + inset, uMax: u + BDV - inset, vMin: v + inset, vMax: v + BDH - inset,
          hNorm, key: distKey(cu, cv), kind: inside ? K_INSIDE : K_OUTSIDE });
      }
    }
    const land = blocks.filter((b) => b.kind === K_LAND);
    const rest = blocks.filter((b) => b.kind !== K_LAND).sort((a, b) => a.key - b.key);
    this._blocks = land.concat(rest).slice(0, MAX_BLOCKS);
  }

  // Full-frame orthogonal grid: BRIGHT (K_GRID) inside the pentagon, DIM (K_GOUT)
  // outside it. Inside lines keep the avenue clearance + route around the campuses.
  _genGrid(add, DVe, DHe, CAMP) {
    const colC = (px) => CAMP.find((c) => px > c[0] && px < c[2]);
    const rowC = (py, x0, x1) => CAMP.find((c) => py > c[1] && py < c[3] && x1 > c[0] && x0 < c[2]);

    // ---- N-S columns ----
    const genCol = (px) => {
      const ap = Math.abs(px), east = px > 0;
      const TANe = east ? TAN_A : TAN_F, SHe = east ? SH_R : SH_L;
      if (ap > SHe) { add(px, EXT_N, px, EXT_S, K_GOUT); return; } // lateral: all dim
      const pB = ap / TANe;                   // enters the district (on the avenue)
      const pBri = (ap + AVE_MX) / TANe;      // bright grid starts (avenue clearance)
      if (pB > EXT_N + 0.01) add(px, EXT_N, px, pB, K_GOUT);   // dim above the district
      if (EXT_S > SOUTH + 0.01) add(px, SOUTH, px, EXT_S, K_GOUT); // dim below
      if (pBri < SOUTH - 0.02) {              // bright inside, carved around a campus
        const c = colC(px);
        if (c && pBri < c[3]) {
          if (pBri < c[1] - 0.01) add(px, pBri, px, c[1], K_GRID);
          add(px, c[3], px, SOUTH, K_GRID);
        } else {
          add(px, pBri, px, SOUTH, K_GRID);
        }
      }
    };
    for (let px = CL; px < EXT_X; px += DVe) genCol(px);
    for (let px = -CL; px > -EXT_X; px -= DVe) genCol(px);

    // ---- E-W rows ----
    const brightRow = (x0, x1, py) => { // x0<x1, carve campus
      const c = rowC(py, x0, x1);
      if (c) {
        if (x0 < c[0] - 0.01) add(x0, py, c[0], py, K_GRID);
        if (x1 > c[2] + 0.01) add(c[2], py, x1, py, K_GRID);
      } else {
        add(x0, py, x1, py, K_GRID);
      }
    };
    const genRow = (py) => {
      if (py >= 0 && py <= SOUTH) {
        const le = this._xLb(py), re = this._xRb(py);   // district edges
        if (le > -EXT_X + 0.01) add(-EXT_X, py, le, py, K_GOUT); // dim west of district
        if (re < EXT_X - 0.01) add(re, py, EXT_X, py, K_GOUT);   // dim east of district
        const bl = le + AVE_MX, br = re - AVE_MX;        // bright inside (split by spine)
        if (bl < -CL - 0.01) brightRow(bl, -CL, py);
        if (br > CL + 0.01) brightRow(CL, br, py);
      } else {
        const spineHere = py > SOUTH && py < 1.18;       // 大学通り still runs just past SOUTH
        if (spineHere) {
          add(-EXT_X, py, -CL, py, K_GOUT);
          add(CL, py, EXT_X, py, K_GOUT);
        } else {
          add(-EXT_X, py, EXT_X, py, K_GOUT);
        }
      }
    };
    for (let py = EXT_N; py < EXT_S; py += DHe) genRow(py);
  }

  update(dt, audio, palette, clock) {
    this.t += dt;
    this.trail = this.p('trail');

    if (this.p('density') !== this._gridK) this._build(); // rebuild when slider moves

    // build drive: steady level + transient surge + bass kick
    this._energy += (audio.level - this._energy) * 0.1;
    const surge = audio.level - this._energy;
    const drive = clamp(audio.level * 0.7 + Math.max(0, surge) * 1.6 + audio.bass * 0.5, 0, 1.5);

    // monotonic — current only ever flows further out, then holds at full
    this._front = clamp(this._front + dt * this.p('buildSpeed') * Math.max(STALL, drive), 0, 1);

    // phase loop: energize -> rise -> hold -> sink -> rise…
    const beatsF = clock.beats + clock.beatPhase;
    switch (this._phase) {
      case PH_ENERGIZE:
        if (this._front >= 1) this._phase = PH_RISE;
        break;
      case PH_RISE:
        this._rise = clamp(this._rise + dt * this.p('riseSpeed') * Math.max(STALL, drive), 0, 1);
        if (this._rise >= 1) { this._phase = PH_HOLD; this._secStart = beatsF; this._holdN = 0; }
        break;
      case PH_HOLD:
        if (beatsF - this._secStart >= SEC_BEATS) {
          this._secStart = beatsF;
          if (++this._holdN >= HOLD_SECTIONS) this._phase = PH_SINK;
        }
        break;
      case PH_SINK:
        this._rise -= dt * SINK_RATE;
        if (this._rise <= 0) { this._rise = 0; this._phase = PH_RISE; } // map stays energized; city rebuilds
        break;
    }
    this._riseView += (this._rise - this._riseView) * Math.min(1, dt * 4); // anti-pop

    // camera: top-down (俯瞰) -> three-quarter as the city rises (Tilt behaviour;
    // cam modes wired in Task 6). Re-frame slightly so the tilted city stays centered.
    const tilt = smoothstep(0.0, 1.0, this._riseView);
    const pitchTgt = lerp(Math.PI / 2, 0.62, tilt);
    const yawTgt = lerp(0.0, 0.45, tilt);
    this._camPitch += (-pitchTgt - this._camPitch) * Math.min(1, dt * 3);
    this._camYaw += (yawTgt - this._camYaw) * Math.min(1, dt * 3);
    this._cyLift = lerp(0, this._H * 0.06, tilt);
  }

  draw(ctx, alpha) {
    const A = alpha;
    const H = this._H;
    const q = this.clock.quality;
    const R = this._front * this._reach;          // wavefront radius (plan units)
    const aveW = this.p('avenueWidth');
    const spark = this.p('spark') > 0.5;
    const base = Math.max(0.6, H * 0.0016);       // grid line width in px
    const b = this._basis();
    const p0 = this._p0, p1 = this._p1;

    ctx.globalCompositeOperation = 'source-over';
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';

    const sparkR = Math.max(1.2, base * 1.1);
    for (let i = 0; i < this._seg.length; i++) {
      const s = this._seg[i];
      if ((s.kind === K_GRID || s.kind === K_GOUT) && q < 0.7 && (i & 1)) continue; // shed under load
      if (R <= s.dA) continue;                    // wavefront hasn't reached this line
      const t = s.dB > s.dA ? clamp((R - s.dA) / (s.dB - s.dA), 0, 1) : 1;

      this._g(s.ax, s.ay, b, p0);                 // station-near end
      const tipU = s.ax + (s.bx - s.ax) * t, tipV = s.ay + (s.by - s.ay) * t;
      this._g(tipU, tipV, b, p1);                 // live tip
      const ax = p0[0], ay = p0[1], sx = p1[0], sy = p1[1];

      let lw, al;
      switch (s.kind) {
        case K_SPINE: lw = base * aveW; al = 1.0; break;
        case K_AVE: lw = base * 2.0; al = 0.95; break;
        case K_BOUND: lw = base * 2.0; al = 0.95; break; // bold frame around the district
        case K_RAIL: lw = base * 1.7; al = 0.9; break;
        case K_GOUT: lw = base * 0.8; al = 0.20; break;  // DIM outer mesh
        default: lw = base; al = 0.6;                    // BRIGHT inside grid
      }
      ctx.strokeStyle = this.palette.fgCss(al * A);
      ctx.lineWidth = lw;
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(sx, sy); ctx.stroke();

      if (spark && s.kind !== K_GOUT && t > 0.001 && t < 0.999) { // crackle at live tips
        ctx.fillStyle = this.palette.accentCss(clamp(0.85 * A, 0, 1));
        ctx.beginPath(); ctx.arc(sx, sy, sparkR, 0, TWO_PI); ctx.fill();
      }
    }

    // --- buildings: extrude the footprints the rise wavefront has reached ---
    const front3d = 1.15 * smoothstep(0, 1, this._riseView);
    if (front3d > 0.001) {
      const S = this._S;
      const style = this.mg('style');
      const wantFaces = style !== 1;        // Wire = stroke only, no fills
      const lightP = this.p('light');
      const hScale = H * 0.105;
      const bg = this.palette.bg, fg = this.palette.fg, tmp = this._tmpRgb;
      for (let i = 0; i < NTONE; i++) this._toneCss[i] = rgbCss(lerpRgb(bg, fg, i / (NTONE - 1), tmp));
      const ccy = b.ccy, scy = b.scy, ccp = b.ccp, scp = b.scp, F = b.F;
      let bi = 0, fc = 0;
      for (let k = 0; k < this._blocks.length && bi < MAX_BLOCKS; k++) {
        const blk = this._blocks[k];
        const local = smoothstep(blk.key, blk.key + 0.14, front3d);
        if (local <= 0.001) continue;
        const h = blk.hNorm * hScale * local;
        if (h < 0.5) continue;
        const x0 = blk.uMin * S, x1 = blk.uMax * S;
        const z0 = (blk.vMin - 0.5) * S, z1 = (blk.vMax - 0.5) * S;
        const top = -h, slot = bi * 8;
        this._pv(slot + 0, x0, 0, z0, b); this._pv(slot + 1, x1, 0, z0, b);
        this._pv(slot + 2, x1, top, z0, b); this._pv(slot + 3, x0, top, z0, b);
        this._pv(slot + 4, x0, 0, z1, b); this._pv(slot + 5, x1, 0, z1, b);
        this._pv(slot + 6, x1, top, z1, b); this._pv(slot + 7, x0, top, z1, b);
        const Zc = (x0 + x1) * 0.5 * scy + (z0 + z1) * 0.5 * ccy;
        const blockCz = (top * 0.5) * scp + Zc * ccp;
        if (blockCz >= F * 0.92) continue;   // behind / too close to the camera
        for (let f = 0; f < FACES; f++) {
          const n = BOX_F[f].n;
          const camNz = n[1] * scp + (n[0] * scy + n[2] * ccy) * ccp;
          if (camNz <= 0) continue;          // backface cull
          this._fSlot[fc] = bi; this._fIdx[fc] = f; this._fCz[fc] = blockCz;
          if (wantFaces) {
            const ndl = Math.max(0, n[0] * LNX + n[1] * LNY + n[2] * LNZ);
            let shadeT = 0.34 + 0.6 * ndl * (0.5 + 0.5 * lightP);
            const depthCue = clamp(map(blockCz, -0.5 * H, 0.5 * H, 0.7, 1.0), 0.68, 1.0);
            shadeT = clamp(shadeT * depthCue + (blk.kind === K_LAND ? 0.04 : 0) + (f === 0 ? 0.06 : 0), 0, 1);
            this._fBucket[fc] = Math.round(shadeT * (NTONE - 1));
          }
          fc++;
        }
        bi++;
      }
      if (!wantFaces) {
        this._strokeFaces(ctx, A, fc, this.palette.fgCss());
      } else {
        const order = this._fOrder; order.length = fc;
        for (let i = 0; i < fc; i++) order[i] = i;
        order.sort((p, qq) => (this._fCz[p] - this._fCz[qq]) || (p - qq)); // far -> near
        const pvx = this._pvx, pvy = this._pvy;
        ctx.globalAlpha = A;
        let lastB = -1;
        for (let oi = 0; oi < fc; oi++) {
          const rec = order[oi], bk = this._fBucket[rec];
          if (bk !== lastB) { ctx.fillStyle = this._toneCss[bk]; lastB = bk; }
          const sIdx = this._fSlot[rec] * 8, id = BOX_F[this._fIdx[rec]].idx;
          ctx.beginPath();
          ctx.moveTo(pvx[sIdx + id[0]], pvy[sIdx + id[0]]);
          ctx.lineTo(pvx[sIdx + id[1]], pvy[sIdx + id[1]]);
          ctx.lineTo(pvx[sIdx + id[2]], pvy[sIdx + id[2]]);
          ctx.lineTo(pvx[sIdx + id[3]], pvy[sIdx + id[3]]);
          ctx.closePath(); ctx.fill();
        }
        if (style === 0 && q > 0.6) this._strokeFaces(ctx, 0.5 * A, fc, this.palette.fgCss()); // Hybrid edges
      }
      ctx.globalAlpha = A;
    }

    this._drawMarks(ctx, A, R, b, base);
    ctx.globalAlpha = A;
  }

  _drawMarks(ctx, A, R, b, base) {
    const S = this._S, p = this._p0;
    // rotary + station building fade in early (the source)
    const appear = clamp(this._front * 6, 0, 1);
    if (appear > 0.01) {
      this._g(0, 0, b, p); // apex
      ctx.strokeStyle = this.palette.fgCss(0.85 * appear * A);
      ctx.lineWidth = Math.max(1, base * 1.4);
      ctx.beginPath();
      ctx.arc(p[0], p[1], Math.max(3, 0.045 * S * p[2]), 0, TWO_PI); // roundabout at the apex
      ctx.stroke();
      this._projRect(ctx, -0.05, -0.078, 0.05, -0.018, b,
        this.palette.fgCss(0.95 * appear * A), Math.max(1, base * 1.3));
    }

    // 一橋大学 super-blocks appear as the wavefront sweeps over them
    for (const c of this._campus) {
      const near = Math.hypot(Math.min(Math.abs(c[0]), Math.abs(c[2])), c[1]);
      const f = clamp((R - near) / 0.12, 0, 1);
      if (f <= 0.01) continue;
      this._projRect(ctx, c[0], c[1], c[2], c[3], b,
        this.palette.fgCss(0.72 * f * A), Math.max(0.8, base * 1.2));
    }

    // the single Ikeda-red node: the station / energizing source
    this._g(0, 0, b, p);
    ctx.globalAlpha = clamp(appear * 1.2, 0, 1) * A;
    ctx.fillStyle = this.palette.accentCss();
    const r = Math.max(2.5, this._H * 0.011);
    ctx.beginPath();
    ctx.moveTo(p[0], p[1] - r); ctx.lineTo(p[0] + r, p[1]);
    ctx.lineTo(p[0], p[1] + r); ctx.lineTo(p[0] - r, p[1]);
    ctx.closePath(); ctx.fill();
    ctx.globalAlpha = A;
  }

  // camera basis. At pitch=-90°/yaw=0 the projection collapses to the ortho flat
  // plot (sx=cx+u*S, sy=topY+v*S); tilting pitch yields the 3D view.
  _basis() {
    const S = this._S;
    return {
      ccy: Math.cos(this._camYaw), scy: Math.sin(this._camYaw),
      ccp: Math.cos(this._camPitch), scp: Math.sin(this._camPitch),
      F: FOCAL * this._H, cx: this._cx, cy: this._topY + 0.5 * S + this._cyLift,
    };
  }

  // weak-perspective projection of a world point (wx, wy, wz) -> out=[sx, sy, f]
  _project(wx, wy, wz, b, out) {
    const X = wx * b.ccy - wz * b.scy;
    const Z = wx * b.scy + wz * b.ccy;
    const Y = wy * b.ccp - Z * b.scp;
    const Z2 = wy * b.scp + Z * b.ccp;
    const f = b.F / (b.F - Z2);
    out[0] = b.cx + X * f; out[1] = b.cy + Y * f; out[2] = f;
  }

  // project a ground point at plan (u, v), height h above ground (default 0)
  _g(u, v, b, out, h = 0) { this._project(u * this._S, -h, (v - 0.5) * this._S, b, out); }

  // stroke a plan-space rectangle outline on the ground (projected quad)
  _projRect(ctx, u0, v0, u1, v1, b, css, lw) {
    const p = this._p0;
    ctx.strokeStyle = css; ctx.lineWidth = lw;
    ctx.beginPath();
    this._g(u0, v0, b, p); ctx.moveTo(p[0], p[1]);
    this._g(u1, v0, b, p); ctx.lineTo(p[0], p[1]);
    this._g(u1, v1, b, p); ctx.lineTo(p[0], p[1]);
    this._g(u0, v1, b, p); ctx.lineTo(p[0], p[1]);
    ctx.closePath(); ctx.stroke();
  }

  // project a box vertex (wx, wy, wz) into the vertex buffers at index vi
  _pv(vi, wx, wy, wz, b) {
    const X = wx * b.ccy - wz * b.scy;
    const Z = wx * b.scy + wz * b.ccy;
    const Y = wy * b.ccp - Z * b.scp;
    const Z2 = wy * b.scp + Z * b.ccp;
    const f = b.F / (b.F - Z2);
    this._pvx[vi] = b.cx + X * f; this._pvy[vi] = b.cy + Y * f; this._pvf[vi] = f;
  }

  // stroke the visible box-face outlines (wireframe / hybrid edges), far -> near
  _strokeFaces(ctx, A, fc, css) {
    const order = this._fOrder; order.length = fc;
    for (let i = 0; i < fc; i++) order[i] = i;
    order.sort((p, q) => (this._fCz[p] - this._fCz[q]) || (p - q));
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
}
