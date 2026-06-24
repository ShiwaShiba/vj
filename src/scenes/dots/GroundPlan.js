import { Scene } from '../Scene.js';
import { clamp, lerp, smoothstep, rgbCss, lerpRgb, TWO_PI } from '../../lib/math.js';

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

export class GroundPlan extends Scene {
  constructor() {
    super('groundplan', 'Ground Plan');
    this.trail = 0.85;

    this.defineParam('buildSpeed', 0.14, 0.04, 0.5, 0.02, 'Build Speed');
    this.defineParam('density', 1.2, 0.4, 2.0, 0.05, 'Grid (fine↔coarse)');
    this.defineParam('avenueWidth', 3.0, 1.5, 5.0, 0.1, '大学通り Width');
    this.defineParam('spark', 1, 0, 1, 1, 'Spark');
    this.defineParam('trail', 0.85, 0.3, 1.0, 0.05, 'Trail');

    this.t = 0;
    this._front = 0;     // 0..1 energization progress (monotonic; holds at 1)
    this._energy = 0;    // slow level follower (for surge detection)

    this._seg = null;    // plan segments (rebuilt when the Grid slider changes)
    this._gridK = -1;    // grid-spacing value the current segments were built at
    this._reach = 1;     // plan distance from apex to the farthest screen corner

    this._H = 0; this._S = 0; this._cx = 0; this._topY = 0;
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
  }

  draw(ctx, alpha) {
    const A = alpha;
    const cx = this._cx, topY = this._topY, S = this._S, H = this._H;
    const q = this.clock.quality;
    const R = this._front * this._reach;          // wavefront radius (plan units)
    const aveW = this.p('avenueWidth');
    const spark = this.p('spark') > 0.5;
    const base = Math.max(0.6, H * 0.0016);       // grid line width in px

    ctx.globalCompositeOperation = 'source-over';
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';

    const sparkR = Math.max(1.2, base * 1.1);
    for (let i = 0; i < this._seg.length; i++) {
      const s = this._seg[i];
      if ((s.kind === K_GRID || s.kind === K_GOUT) && q < 0.7 && (i & 1)) continue; // shed under load
      if (R <= s.dA) continue;                    // wavefront hasn't reached this line
      const t = s.dB > s.dA ? clamp((R - s.dA) / (s.dB - s.dA), 0, 1) : 1;

      const ax = cx + s.ax * S, ay = topY + s.ay * S;
      const tipX = s.ax + (s.bx - s.ax) * t, tipY = s.ay + (s.by - s.ay) * t;
      const sx = cx + tipX * S, sy = topY + tipY * S;

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

    this._drawMarks(ctx, A, R, cx, topY, S, base);
    ctx.globalAlpha = A;
  }

  _drawMarks(ctx, A, R, cx, topY, S, base) {
    // rotary + station building fade in early (the source)
    const appear = clamp(this._front * 6, 0, 1);
    if (appear > 0.01) {
      ctx.strokeStyle = this.palette.fgCss(0.85 * appear * A);
      ctx.lineWidth = Math.max(1, base * 1.4);
      ctx.beginPath();
      ctx.arc(cx, topY, Math.max(3, 0.045 * S), 0, TWO_PI); // roundabout at the apex
      ctx.stroke();
      this._rect(ctx, -0.05, -0.078, 0.05, -0.018, cx, topY, S,
        this.palette.fgCss(0.95 * appear * A), Math.max(1, base * 1.3));
    }

    // 一橋大学 super-blocks appear as the wavefront sweeps over them
    for (const c of this._campus) {
      const near = Math.hypot(Math.min(Math.abs(c[0]), Math.abs(c[2])), c[1]);
      const f = clamp((R - near) / 0.12, 0, 1);
      if (f <= 0.01) continue;
      this._rect(ctx, c[0], c[1], c[2], c[3], cx, topY, S,
        this.palette.fgCss(0.72 * f * A), Math.max(0.8, base * 1.2));
    }

    // the single Ikeda-red node: the station / energizing source
    ctx.globalAlpha = clamp(appear * 1.2, 0, 1) * A;
    ctx.fillStyle = this.palette.accentCss();
    const r = Math.max(2.5, this._H * 0.011);
    ctx.beginPath();
    ctx.moveTo(cx, topY - r); ctx.lineTo(cx + r, topY);
    ctx.lineTo(cx, topY + r); ctx.lineTo(cx - r, topY);
    ctx.closePath(); ctx.fill();
    ctx.globalAlpha = A;
  }

  // stroke a plan-space rectangle outline
  _rect(ctx, x0, y0, x1, y1, cx, topY, S, css, lw) {
    const a = cx + x0 * S, b = topY + y0 * S, c = cx + x1 * S, d = topY + y1 * S;
    ctx.strokeStyle = css; ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.rect(Math.min(a, c), Math.min(b, d), Math.abs(c - a), Math.abs(d - b));
    ctx.stroke();
  }
}
