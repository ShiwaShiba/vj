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
const MAX_BLOCKS = 2600;                  // buffer ceiling; the drawn count is the live maxBlocks param
const BLOCK_CELLS = 1.15;                 // finer footprints → a dense low-rise carpet (reference)
const CUBE_FILL_IN = 0.82;                // inside the district: cubes nearly fill cells (びっしり)
const CUBE_FILL_OUT = 0.62;               // outside: fuller so the fabric reads continuous N+S
const OUT_SPARSE = 0.32;                  // District scope: fraction of outside cells that rise
const JIT_POS = 0.09;                     // per-cell position jitter — breaks the CG-perfect grid
const NORTH_V = -0.18;                    // dense voxel carpet reaches this far N of the apex (3D only)
const K_INSIDE = 0, K_OUTSIDE = 1, K_LAND = 2; // block kinds: inside district / outside / landmark
const FOCAL = 4.5;                       // camera focal length in units of H (weak perspective)

// Phase loop: ENERGIZE (flat circuit) -> RISE (city extrudes) -> HOLD -> SINK -> RISE…
const PH_ENERGIZE = 0, PH_RISE = 1, PH_HOLD = 2, PH_SINK = 3;
const BAR = 4, SEC_BEATS = BAR * 8, HOLD_SECTIONS = 4; // let all four LIVE vantages play before SINK
const SINK_RATE = 0.26;                  // teardown ease rate (audio-independent, can't stall)
const SINK_W = 0.12;                      // collapse-wave thickness in key space (mirrors the rise)
const RETRACT_RATE = 0.5;                // SINK: speed the lit circuit recedes after buildings drop
// Tilt-driven reframing (both gated by `tilt`, 0 at riseView=0, so the locked top-down
// plot is provably untouched): a uniform width-fill ZOOM applied in _project about (cx,cy)
// — which scales the whole 3D view (blocks, roads, station, marks, HUD anchors) coherently
// without touching _drawStation or any _S read — plus a vertical frame DROP to seat the
// near-horizontal railway in the upper-middle. Both are live params (frameZoom / frameDrop).
// Branching-energize schedule (Fix A): trunks grow first with staggered starts; the
// street grid branches off its parent trunk after the trunk has passed its attach point.
const TRUNK_SPAN = 0.55;                 // front-space a full-length trunk takes to grow
const BRANCH_DELAY = 0.015;              // gap after a parent passes before its child starts

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

// LIVE camera vantages (pitch from vertical, yaw kick) walked during HOLD.
// Constrained so every HOLD cut keeps the railway near-horizontal (yaw∈[-0.05,0.18]) at a
// consistent shallow aerial (pitch∈[0.44,0.56]) — the reference's calm framing, with parallax.
const LIVE_VANTAGES = [
  { pitch: 0.50, yaw: 0.08 },  // establishing — railway near-flat, gentle down-right
  { pitch: 0.44, yaw: 0.16 },  // shallower, a touch more east-side rake
  { pitch: 0.56, yaw: -0.04 }, // slightly higher, railway almost dead-flat
  { pitch: 0.48, yaw: 0.12 },  // back toward establishing
];

export class GroundPlan extends Scene {
  constructor() {
    super('groundplan', 'Ground Plan');
    this.trail = 0.85;

    this.defineParam('buildSpeed', 0.14, 0.04, 0.5, 0.02, 'Build Speed');
    this.defineParam('riseSpeed', 0.16, 0.04, 0.5, 0.02, 'Rise Speed');
    this.defineParam('density', 2.0, 0.4, 2.0, 0.05, 'Grid (fine↔coarse)');
    this.defineParam('avenueWidth', 3.0, 1.5, 5.0, 0.1, '大学通り Width');
    this.defineParam('spark', 1, 0, 1, 1, 'Spark');
    this.defineParam('trail', 0.85, 0.3, 1.0, 0.05, 'Trail');
    this.defineParam('light', 0.6, 0, 1, 0.05, 'Light');
    // Reference-framing pose (live-tunable): shallow aerial + near-horizontal railway.
    this.defineParam('pitchTilt', 0.46, 0.30, 0.90, 0.01, 'Aerial Pitch');
    this.defineParam('yawTilt', 0.10, -0.20, 0.50, 0.01, 'Aerial Yaw');
    this.defineParam('frameZoom', 1.40, 1.0, 1.8, 0.02, 'Frame Zoom');   // tilt-gated width fill
    this.defineParam('frameDrop', 0.05, 0.0, 0.25, 0.01, 'Frame Drop');  // tilt-gated vertical seat
    this.defineParam('maxBlocks', 1900, 800, MAX_BLOCKS, 100, 'Carpet Density'); // drawn-block cap (live)

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

    this._phase = PH_ENERGIZE; this._rise = 0; this._riseView = 0; this._sinkFront = 0;
    this._secStart = 0; this._holdN = 0;
    this._vFrom = 0; this._vTo = 0; this._xfade = 1; // LIVE vantage walker

    // 3D projection / face scratch (allocation-free hot loop)
    this._pvx = new Float32Array(MAX_BLOCKS * 8);
    this._pvy = new Float32Array(MAX_BLOCKS * 8);
    this._pvf = new Float32Array(MAX_BLOCKS * 8);
    this._fSlot = new Int32Array(MAX_BLOCKS * FACES);
    this._fIdx = new Uint8Array(MAX_BLOCKS * FACES);
    this._fCz = new Float32Array(MAX_BLOCKS * FACES);
    this._fBucket = new Uint8Array(MAX_BLOCKS * FACES);
    this._fDepth = new Uint8Array(MAX_BLOCKS * FACES); // per-face depth bucket (O(n) painter sort)
    this._fDCnt = new Int32Array(257);                 // depth-bucket counts (NB=256 + 1)
    this._fOrder = [];
    this._toneCss = new Array(NTONE);
    this._tmpRgb = [0, 0, 0];

    // --- reference "scanner UI" HUD state (drawn by drawHud over the generic overlay) ---
    this.hudOwnsCorners = true;                 // tells Overlay to suppress its generic corners
    this._aSt = [0, 0, 0]; this._aRail = [0, 0, 0]; this._aAve = [0, 0, 0]; // projected label anchors
    this._anchors = { station: this._aSt, rail: this._aRail, avenue: this._aAve };
    this._hudA = { kick: 0, snare: 0, hihat: 0, bass: 0, pad: 0, pMid: 0 };  // cosmetic 5-band meters
    this._hudL = [0, 0, 0, 0, 0, 0];            // per-layer activity (list + status dots)
    this._hudT = 0;                             // last drawHud time (for meter dt)
  }

  init(ctx, w, h) {
    super.init(ctx, w, h);
    this._layout();
    this._build();
    this._front = 0; this._sinkFront = 0; // energize fresh on first mount
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
    // Half-length matches 富士見's terminus extent so the line is as long (Fix D).
    const railHalf = SH_L;
    for (const ry of [-0.045, -0.062]) {
      add(0, ry, -railHalf, ry, K_RAIL);
      add(0, ry, railHalf, ry, K_RAIL);
    }

    // The radiating trident — 富士見 (west) runs much LONGER than 旭 (east).
    add(0, 0, 0, 1.06, K_SPINE);                 // 大学通り (pierces just past the district)
    add(0, 0, -SH_L, SH_L_Y, K_AVE);             // 富士見通り (long, wide)
    add(0, 0, SH_R, SH_R_Y, K_AVE);              // 旭通り     (short)

    // Per-trunk growth schedule for the branching energize (Fix A). Lengths from
    // constants; staggered t0 = time-offset starts, tg ∝ length = equal spatial speed.
    const lenFujimi = Math.hypot(SH_L, SH_L_Y), lenAsahi = Math.hypot(SH_R, SH_R_Y);
    this._trunkSched = {
      spine:  { t0: 0.00, tg: TRUNK_SPAN, len: 1.06 },
      rail:   { t0: 0.02, tg: TRUNK_SPAN * 0.7 * (railHalf / lenFujimi), len: railHalf },
      fujimi: { t0: 0.05, tg: TRUNK_SPAN, len: lenFujimi },
      asahi:  { t0: 0.09, tg: TRUNK_SPAN * (lenAsahi / lenFujimi), len: lenAsahi },
    };

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
    this._schedule();
    this._buildBlocks();
  }

  // Assign each segment a front-space growth schedule {t0, tg} so the energize grows
  // by BRANCHING — trunks first (staggered), then grid streets branch off their parent
  // trunk after it passes — instead of a circular wavefront (Fix A). draw() compares
  // this._front to s.t0 rather than clipping by radius.
  _schedule() {
    const sc = this._trunkSched;
    const fEnd = sc.fujimi.t0 + sc.fujimi.tg, aEnd = sc.asahi.t0 + sc.asahi.tg;
    const goutBase = fEnd + 0.04, GOUT_SPAN = 0.30;
    for (let i = 0; i < this._seg.length; i++) {
      const s = this._seg[i];
      switch (s.kind) {
        case K_SPINE: s.t0 = sc.spine.t0; s.tg = sc.spine.tg; break;
        case K_RAIL:  s.t0 = sc.rail.t0;  s.tg = sc.rail.tg;  break;
        case K_AVE: {
          const tr = (s.ax < 0 || s.bx < 0) ? sc.fujimi : sc.asahi;
          s.t0 = tr.t0; s.tg = tr.tg; break;
        }
        case K_BOUND: {
          let cT;                                                   // key off geometry, not a-order
          if (Math.abs(s.ax) >= SH_L - 0.01) cT = fEnd;            // west vertical side
          else if (Math.abs(s.ax) >= SH_R - 0.01 && Math.abs(s.ay - SOUTH) > 0.2) cT = aEnd; // east side
          else cT = Math.max(fEnd, aEnd);                          // south base
          s.t0 = cT + BRANCH_DELAY; s.tg = TRUNK_SPAN * 0.5; break;
        }
        case K_GOUT: {                                             // dim outer mesh: fill from the
          const ex = Math.max(0, Math.abs(s.ax) - SH_L);          // district envelope OUTWARD so no
          const ey = Math.max(0, s.ay - SOUTH) + Math.max(0, -s.ay); // circle re-forms (alpha 0.20)
          const outward = clamp((ex + ey) / EXT_X, 0, 1);
          const hsh = Math.sin(s.ax * 12.9898 + s.ay * 78.233) * 43758.5453;
          const j = (hsh - Math.floor(hsh)) - 0.5;                 // -0.5..0.5 de-circling jitter
          s.t0 = goutBase + outward * GOUT_SPAN + j * 0.06; s.tg = TRUNK_SPAN * 0.7; break;
        }
        default: {                                                // K_GRID
          if (s.ax === s.bx) {                                    // vertical column → branch off avenue
            const ave = s.ax < 0 ? sc.fujimi : sc.asahi;
            const connDist = Math.hypot(s.ax, s.ay);
            const connectT = ave.t0 + (Math.min(connDist, ave.len) / ave.len) * ave.tg;
            s.t0 = connectT + BRANCH_DELAY; s.tg = TRUNK_SPAN * 0.6;
          } else {                                                // horizontal row → branch off spine,
            const py = s.ay;                                      // keyed by spine depth (py) so both
            const connectT = sc.spine.t0 + (clamp(py, 0, sc.spine.len) / sc.spine.len) * sc.spine.tg;
            s.t0 = connectT + BRANCH_DELAY; s.tg = TRUNK_SPAN * 0.6; // campus-split halves share it
          }
        }
      }
    }
  }

  // Building footprints derived from the frozen flat geometry: the station tower +
  // two 一橋 super-blocks (landmarks, never culled), then a coarse block grid split
  // into inside-district / outside blocks. Capped at MAX_BLOCKS (nearest kept).
  _buildBlocks() {
    const blocks = [];
    const reach = this._reach || 1.4;
    // building blocks track the street grid: finer grid → smaller blocks (Fix C).
    const k = this.p('density');
    const bdv = (DV_BASE / k) * BLOCK_CELLS, bdh = (DH_BASE / k) * BLOCK_CELLS;
    this._cellScale = clamp(Math.min(bdv, bdh) / 0.085, 0.4, 1.2); // non-landmark height shrinks too
    const distKey = (u, v) => clamp(Math.hypot(u, v) / reach, 0, 1);
    const inPent = (u, v) => v >= 0 && v <= SOUTH && u > this._xLb(v) && u < this._xRb(v);
    const inCamp = (u, v) => this._campus.some((c) => u > c[0] && u < c[2] && v > c[1] && v < c[3]);

    // (the station itself is the旧駅舎, drawn as a custom gabled landmark in _drawStation)
    for (const c of this._campus) {
      blocks.push({ uMin: c[0], uMax: c[2], vMin: c[1], vMax: c[3], hNorm: 0.5,
        key: distKey((c[0] + c[2]) / 2, (c[1] + c[3]) / 2), kind: K_LAND }); // 一橋 西/東
    }

    const inset = Math.min(bdv, bdh) * 0.18;
    for (let v = NORTH_V; v < EXT_S - bdh; v += bdh) {  // start N of the apex (reference shows city both sides of the rail)
      for (let u = -EXT_X + bdv; u < EXT_X; u += bdv) {
        const cu = u + bdv / 2, cv = v + bdh / 2;
        if (Math.abs(cu) < CL) continue;              // spine corridor kept clear
        if (inCamp(cu, cv)) continue;                 // campuses are explicit landmarks
        if (cv < 0.08) {                              // the new northern band: keep the hero + tracks clear
          if (Math.abs(cu) < 0.16 && cv > -0.10) continue; // 旧駅舎 footprint (incl. west wing) — no voxel overlap
          if (Math.abs(cv + 0.053) < 0.025) continue;      // 中央線 rail corridor
        }
        const inside = inPent(cu, cv);
        const inNorth = cv < 0 && cv > NORTH_V && Math.abs(cu) < SH_L; // dense fabric just N of the apex
        const dense = inside || inNorth;
        const n = this.noise.noise2D(cu * 3.1, cv * 3.1) * 0.5 + 0.5; // 0..1 stable
        const n2 = this.noise.noise2D(cu * 1.3, cv * 1.3) * 0.5 + 0.5; // low-freq "districts"
        const nMix = clamp(0.55 * n + 0.55 * n2 * n2, 0, 1);          // n2² keeps tall clumps rare
        const spineBoost = 1 + 0.8 * smoothstep(0.18, 0.0, Math.abs(cu)); // a tight 大学通り main-street ridge
        // anti-"cheap": shrink (~60% smaller) + jitter size/position to break the perfect grid
        const jx = this.noise.noise2D(cu * 7.7 + 3, cv * 7.7 + 3) * bdv * JIT_POS;
        const jy = this.noise.noise2D(cu * 7.7 + 9, cv * 7.7 + 9) * bdh * JIT_POS;
        const sj = 0.86 + 0.28 * (this.noise.noise2D(cu * 5.3 + 1, cv * 5.3 + 1) * 0.5 + 0.5);
        const fill = dense ? CUBE_FILL_IN : CUBE_FILL_OUT;
        const halfU = (bdv * 0.5 - inset) * fill * sj;
        const halfV = (bdh * 0.5 - inset) * fill * sj;
        const ox = cu + jx, oy = cv + jy;
        // keep cubes LOW so a dense field reads as a low-rise city, not tall gravestones
        const hNorm = (dense ? 0.10 + 0.55 * nMix : 0.07 + 0.28 * nMix) * spineBoost; // low floor, rare tall
        const rnd = this.noise.noise2D(cu * 11.3 + 21, cv * 11.3 + 21) * 0.5 + 0.5; // sparse-outside roll
        blocks.push({ uMin: ox - halfU, uMax: ox + halfU, vMin: oy - halfV, vMax: oy + halfV,
          hNorm, key: distKey(ox, oy), kind: inside ? K_INSIDE : K_OUTSIDE, rnd });
      }
    }
    const land = blocks.filter((b) => b.kind === K_LAND);
    const rest = blocks.filter((b) => b.kind !== K_LAND).sort((a, b) => a.key - b.key);
    this._blocks = land.concat(rest).slice(0, MAX_BLOCKS);
    this._keyMax = 0.001;                          // farthest kept block — anchors the SINK collapse wave
    for (const b of this._blocks) if (b.kind !== K_LAND && b.key > this._keyMax) this._keyMax = b.key;
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
        const spineHere = py > SOUTH && py < 1.08;       // 大学通り still runs just past SOUTH
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

    // dev-only freeze-frame override (production untouched when window.__pose is unset).
    // Lets headless verification pin an exact pose: window.__pose = { riseView, front,
    // phase, sinkFront, camPitch, camYaw }. Any omitted field keeps its current value;
    // camera is set DIRECTLY (no smoothing) so a single rendered frame is exact.
    if (typeof window !== 'undefined' && window.__pose) {
      const P = window.__pose;
      if (P.riseView != null) { this._rise = P.riseView; this._riseView = P.riseView; }
      if (P.front != null) this._front = P.front;
      if (P.phase != null) this._phase = P.phase;
      if (P.sinkFront != null) this._sinkFront = P.sinkFront;
      const tilt = smoothstep(0.0, 1.0, this._riseView);
      let pitchTgt, yawTgt;
      if (this.mg('cam') === 2) { pitchTgt = lerp(Math.PI / 2, 1.28, tilt); yawTgt = lerp(0.0, 0.12, tilt); }
      else { pitchTgt = lerp(Math.PI / 2, this.p('pitchTilt'), tilt); yawTgt = lerp(0.0, this.p('yawTilt'), tilt); }
      if (P.camPitch != null) pitchTgt = P.camPitch;
      if (P.camYaw != null) yawTgt = P.camYaw;
      this._camPitch = -pitchTgt; this._camYaw = yawTgt;
      this._cyLift = lerp(0, this._H * this.p('frameDrop'), tilt);
      return;
    }

    // build drive: steady level + transient surge + bass kick
    this._energy += (audio.level - this._energy) * 0.1;
    const surge = audio.level - this._energy;
    const drive = clamp(audio.level * 0.7 + Math.max(0, surge) * 1.6 + audio.bass * 0.5, 0, 1.5);

    // phase loop: energize (branch-grow the circuit) -> rise (city) -> hold -> sink -> energize…
    // The branching energize replays every loop: SINK recedes the circuit, then it re-grows.
    const beatsF = clock.beats + clock.beatPhase;
    const fStep = dt * this.p('buildSpeed') * Math.max(STALL, drive);
    switch (this._phase) {
      case PH_ENERGIZE:
        this._front = clamp(this._front + fStep, 0, 1); // branching grows outward with energy
        if (this._front >= 1) this._phase = PH_RISE;
        break;
      case PH_RISE:
        this._front = 1;                                // circuit fully lit while the city rises
        this._rise = clamp(this._rise + dt * this.p('riseSpeed') * Math.max(STALL, drive), 0, 1);
        if (this._rise >= 1) {
          this._phase = PH_HOLD; this._secStart = beatsF; this._holdN = 0;
          this._vFrom = this._vTo = 0; this._xfade = 1;
        }
        break;
      case PH_HOLD:
        if (beatsF - this._secStart >= SEC_BEATS) {
          this._secStart = beatsF;
          this._vFrom = this._vTo; this._vTo = (this._vTo + 1) % LIVE_VANTAGES.length; this._xfade = 0;
          if (++this._holdN >= HOLD_SECTIONS) { this._phase = PH_SINK; this._sinkFront = 0; }
        }
        break;
      case PH_SINK:
        // far→near collapse wave (mirror of the rise): the city falls from the far edge
        // inward while the camera stays tilted so we watch it; only once the wave has
        // passed do we de-tilt + recede the lit circuit, then re-energize.
        this._sinkFront += dt * SINK_RATE;
        if (this._sinkFront < this._keyMax + SINK_W) {
          this._rise = 1;                                                  // hold tilt during the collapse
        } else {
          this._rise += (0 - this._rise) * Math.min(1, dt * SINK_RATE * 4); // de-tilt the emptied board
          this._front = Math.max(0, this._front - dt * RETRACT_RATE);       // recede the lit circuit
          if (this._rise <= 0.004 && this._front <= 0.004) {
            this._rise = 0; this._front = 0; this._sinkFront = 0; this._phase = PH_ENERGIZE;
          }
        }
        break;
    }
    this._riseView += (this._rise - this._riseView) * Math.min(1, dt * 4); // anti-pop

    // camera (cam axis): 俯瞰 -> three-quarter as the city rises.
    const cam = this.mg('cam');
    const tilt = smoothstep(0.0, 1.0, this._riseView);
    let pitchTgt, yawTgt;
    if (cam === 2) {                          // Plan: stay near top-down (low relief)
      pitchTgt = lerp(Math.PI / 2, 1.28, tilt);
      yawTgt = lerp(0.0, 0.12, tilt);
    } else {                                  // Tilt / Live base: shallow aerial, railway ~horizontal
      pitchTgt = lerp(Math.PI / 2, this.p('pitchTilt'), tilt);
      yawTgt = lerp(0.0, this.p('yawTilt'), tilt);
    }
    if (cam === 1 && this._phase === PH_HOLD) { // Live: walk vantages during hold
      this._xfade = Math.min(1, this._xfade + dt * (clock.bpm / 60) / (BAR * 2));
      const e = smoothstep(0, 1, this._xfade);
      const vf = LIVE_VANTAGES[this._vFrom], vt = LIVE_VANTAGES[this._vTo];
      pitchTgt = lerp(vf.pitch, vt.pitch, e);
      yawTgt = lerp(vf.yaw, vt.yaw, e);
      yawTgt += 0.03 * Math.sin(this.t * 0.25); // a slow breath within the held vantage (no swoop)
    }
    this._camPitch += (-pitchTgt - this._camPitch) * Math.min(1, dt * 3);
    this._camYaw += (yawTgt - this._camYaw) * Math.min(1, dt * 3);
    this._cyLift = lerp(0, this._H * this.p('frameDrop'), tilt); // seat the tilted city (0 at top-down)
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
      if (this._front <= s.t0) continue;          // branching front hasn't reached this segment yet
      const raw = s.tg > 0 ? clamp((this._front - s.t0) / s.tg, 0, 1) : 1;
      const t = smoothstep(0, 1, raw);            // eased tip (kills the cheap linear crawl)

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
      const style = this.mg('style'), scope = this.mg('scope'), height = this.mg('height');
      const wantFaces = style !== 1;        // Wire = stroke only, no fills
      const lightP = this.p('light');
      const hScaleLand = H * 0.105;                          // landmarks keep full height
      const hScaleCity = H * 0.105 * (this._cellScale || 1); // non-landmarks shrink with the grid (Fix C)
      const bg = this.palette.bg, fg = this.palette.fg, tmp = this._tmpRgb;
      for (let i = 0; i < NTONE; i++) this._toneCss[i] = rgbCss(lerpRgb(bg, fg, i / (NTONE - 1), tmp));
      // hero landmark: the旧国立駅舎 (gabled), at 大学通り's origin — drawn first (sits at the back)
      const stStand = this._phase === PH_SINK ? clamp(1 - smoothstep(this._keyMax, this._keyMax + SINK_W, this._sinkFront), 0, 1) : 1;
      this._drawStation(ctx, b, A, clamp(smoothstep(0, 0.16, front3d), 0, 1) * stStand, lightP, wantFaces, style); // station falls last
      this._drawCampus(ctx, b, A, front3d, lightP, wantFaces); // 一橋: low open plates, not towers
      const ccy = b.ccy, scy = b.scy, ccp = b.ccp, scp = b.scp, F = b.F;
      const cap = Math.round(Math.min(this.p('maxBlocks'), MAX_BLOCKS) * clamp(q, 0.5, 1)); // live density × q-shed
      let bi = 0, fc = 0;
      for (let k = 0; k < this._blocks.length && bi < cap; k++) {
        const blk = this._blocks[k];
        if (blk.kind === K_LAND) continue;                   // 一橋 campuses drawn as open plates (_drawCampus)
        if (scope === 2 && blk.kind !== K_LAND) continue;    // Landmark: only landmarks rise
        if (scope === 0 && blk.kind === K_OUTSIDE && blk.rnd > OUT_SPARSE) continue; // District: sparse outside
        const local = smoothstep(blk.key, blk.key + 0.10, front3d);
        if (local <= 0.001) continue;
        const stand = this._phase === PH_SINK
          ? clamp(1 - smoothstep(this._keyMax - blk.key, this._keyMax - blk.key + SINK_W, this._sinkFront), 0, 1) : 1; // far→near collapse
        let hN = blk.hNorm;
        if (height === 1) hN = (blk.kind === K_LAND ? blk.hNorm : 0.6);           // Even
        else if (height === 2) hN = blk.hNorm * (0.4 + 1.4 * this._bandFor(blk)); // Pulse
        const h = hN * (blk.kind === K_LAND ? hScaleLand : hScaleCity) * local * stand;
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
        const order = this._depthOrder(fc); // O(n) far -> near painter sort
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

    // HUD anchors: project the three labelled features for the overlay's leader lines.
    // Overwrites the shared arrays in place (no per-frame alloc). _g collapses to the flat
    // ortho plot at riseView=0, so the leaders track correctly in both 2D and tilted views.
    this._g(0, 0, b, this._aSt);
    this._g(0.52, -0.053, b, this._aRail);
    this._g(0, 0.72, b, this._aAve);
  }

  // ===== reference "scanner UI" HUD (screen-space; never touches the map raster) =====
  // Layer 05 activity for the HUD; Phase 4 (open/green zones) overrides this getter.
  greenActivity() { return 0; }

  // Derive 5 cosmetic meters (KICK/SNARE/HI-HAT/BASS/PAD) from the existing bass/mid/treble
  // + beat signals. HUD-only — no new DSP. Alpha smoothings tuned for ~60fps; fine cosmetically.
  _hudBands(audio) {
    const m = this._hudA;
    const bh = audio.beatHold || 0, bs = audio.bass || 0, md = audio.mid || 0, tr = audio.treble || 0, lv = audio.level || 0;
    const kt = clamp(bh * (0.4 + 0.6 * bs), 0, 1);
    m.kick += (kt - m.kick) * (kt > m.kick ? 0.9 : 0.12);          // beat-gated bass punch
    const snT = Math.max(0, md - m.pMid); m.pMid += (md - m.pMid) * 0.25;
    const st = clamp(snT * 3 + md * 0.25, 0, 1);
    m.snare += (st - m.snare) * (st > m.snare ? 0.8 : 0.15);       // mid transient
    m.hihat += (tr - m.hihat) * 0.5;                               // trebly twitch
    m.bass += (bs - m.bass) * 0.18;                               // slow body
    const pt = clamp(lv * 0.8 - bh * 0.3, 0, 1);
    m.pad += (pt - m.pad) * 0.06;                                  // ambient room tone
    return m;
  }

  // 6 layer-activity values [railway, station, road, block, green, density], 0..1, derived
  // from the live animation state so the indicators track the events they name.
  _hudLayers(audio) {
    const sc = this._trunkSched || {}, L = this._hudL;
    const trunk = (tr) => tr ? clamp((this._front - tr.t0) / (tr.tg || 1), 0, 1) : 0;
    const rise = this._riseView, sink = this._sinkFront, ph = this._phase;
    L[0] = trunk(sc.rail) * (0.5 + 0.5 * (audio.treble || 0));
    L[1] = clamp(this._front * 6, 0, 1) * (0.6 + 0.4 * (audio.beatHold || 0));
    L[2] = Math.max(trunk(sc.fujimi), trunk(sc.asahi), trunk(sc.spine)) * (0.5 + 0.5 * (audio.mid || 0));
    L[3] = smoothstep(0, 0.6, rise) * (0.5 + 0.5 * (audio.bass || 0));
    L[4] = Math.max(smoothstep(0.2, 0.9, rise) * 0.8, this.greenActivity());
    const dens = ph === PH_RISE ? rise : ph === PH_HOLD ? 1
      : ph === PH_SINK ? clamp(1 - sink / ((this._keyMax || 1) + 0.12), 0, 1) : this._front;
    L[5] = dens * (0.4 + 0.6 * (audio.level || 0));
    for (let i = 0; i < 6; i++) L[i] = clamp(L[i], 0, 1);
    return L;
  }

  _hudSeg(ctx, x, y, v, pal, N, segW, segH, gap) {
    const lit = Math.round(clamp(v, 0, 1) * N);
    for (let i = 0; i < N; i++) {
      ctx.fillStyle = pal.fgCss(i < lit ? 0.82 : 0.13);
      ctx.fillRect(x + i * (segW + gap), y, segW, segH);
    }
  }

  _hudTc(t) {
    const f = Math.floor((t % 1) * 30), s = Math.floor(t) % 60, mm = Math.floor(t / 60) % 60, hh = Math.floor(t / 3600);
    const p = (n) => String(n).padStart(2, '0');
    return `${p(hh)}:${p(mm)}:${p(s)}:${p(f)}`;
  }

  // Tiny live schematic of the district (pentagon + railway + trident + station star).
  // ~14 strokes — far cheaper than re-projecting the city; reads as the reference minimap.
  _hudMinimap(ctx, x, y, mw, mh, pal) {
    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = pal.fgCss(0.4); ctx.strokeRect(x + 0.5, y + 0.5, mw, mh);
    const t = 6, C = [[x, y, 1, 1], [x + mw, y, -1, 1], [x, y + mh, 1, -1], [x + mw, y + mh, -1, -1]];
    ctx.strokeStyle = pal.fgCss(0.55); ctx.beginPath();
    for (const [px, py, sx, sy] of C) { ctx.moveTo(px, py + sy * t); ctx.lineTo(px, py); ctx.lineTo(px + sx * t, py); }
    ctx.stroke();
    if ('letterSpacing' in ctx) ctx.letterSpacing = '1px';
    ctx.font = "9px ui-monospace, Menlo, monospace"; ctx.textAlign = 'left';
    ctx.fillStyle = pal.fgCss(0.4); ctx.fillText('WIDE AREA', x + 5, y + 12);
    const cx = x + mw * 0.5, ay = y + mh * 0.30, ms = mh * 0.46;
    const P = (u, v) => [cx + u * ms, ay + v * ms];
    let p, q;
    ctx.strokeStyle = pal.fgCss(0.3);
    p = P(-0.945, -0.05); q = P(0.945, -0.05);
    ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); ctx.stroke();     // railway
    ctx.beginPath();
    p = P(0, 0); q = P(0, 1.06); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]);        // spine
    p = P(0, 0); q = P(-0.945, 0.738); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]);  // 富士見
    p = P(0, 0); q = P(0.511, 0.493); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]);   // 旭
    ctx.stroke();
    ctx.strokeStyle = pal.fgCss(0.22); ctx.beginPath();
    p = P(-0.945, 0.738); ctx.moveTo(p[0], p[1]);
    q = P(-0.945, 1.0); ctx.lineTo(q[0], q[1]);
    q = P(0.511, 1.0); ctx.lineTo(q[0], q[1]);
    q = P(0.511, 0.493); ctx.lineTo(q[0], q[1]); ctx.stroke();                          // pentagon base
    const st = P(0, 0);
    ctx.strokeStyle = pal.fgCss(0.9); ctx.lineWidth = 1.1; ctx.beginPath();
    for (let i = 0; i < 3; i++) { const a = i * Math.PI / 3; ctx.moveTo(st[0] - 4 * Math.cos(a), st[1] - 4 * Math.sin(a)); ctx.lineTo(st[0] + 4 * Math.cos(a), st[1] + 4 * Math.sin(a)); }
    ctx.stroke();                                                                       // station star
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
    ctx.restore();
  }

  drawHud(ctx, w, h, info) {
    const pal = info.palette, audio = info.audio, clock = info.clock;
    this._hudT = this.t;
    const m = this._hudBands(audio);
    const L = this._hudLayers(audio);
    const an = this._anchors;
    const hasLS = 'letterSpacing' in ctx;
    const pad = 16;
    const NAMES = ['RAILWAY', 'STATION', 'MAIN ROAD', 'BLOCK', 'GREEN / OPEN', 'BUILDING DENSITY'];
    const XS = "10px ui-monospace, 'SF Mono', Menlo, monospace";
    const SM = "11px ui-monospace, 'SF Mono', Menlo, monospace";
    const BIG = "13px ui-monospace, 'SF Mono', Menlo, monospace";

    ctx.save();
    ctx.textBaseline = 'alphabetic';
    ctx.lineWidth = 1;

    // ---- TOP-LEFT: title + layer list ----
    const lx = pad + 62;
    if (hasLS) ctx.letterSpacing = '2px';
    ctx.font = BIG; ctx.textAlign = 'left'; ctx.fillStyle = pal.fgCss(0.85);
    ctx.fillText('KUNITACHI CITY // AROUND KUNITACHI STATION', lx, 30);
    if (hasLS) ctx.letterSpacing = '1px';
    ctx.font = XS;
    for (let i = 0; i < 6; i++) {
      const y = 50 + i * 15;
      ctx.strokeStyle = pal.fgCss(0.45); ctx.strokeRect(lx + 0.5, y - 7.5, 7, 7);
      ctx.fillStyle = pal.fgCss(0.12 + 0.7 * L[i]); ctx.fillRect(lx + 11, y - 7.5, 7, 7);
      ctx.fillStyle = pal.fgCss(0.5); ctx.fillText(String(i + 1).padStart(2, '0'), lx + 24, y);
      ctx.fillStyle = pal.fgCss(0.72); ctx.fillText(NAMES[i], lx + 42, y);
    }

    // ---- TOP-RIGHT: BPM + timecode + minimap ----
    const rx = w - pad - 6;
    ctx.textAlign = 'right';
    ctx.font = BIG; ctx.fillStyle = pal.fgCss(0.85);
    ctx.fillText(`${(audio.bpm || 0).toFixed(1)} BPM`, rx, 30);
    ctx.font = SM; ctx.fillStyle = pal.fgCss(0.45);
    ctx.fillText(this._hudTc(clock.time), rx, 48);
    this._hudMinimap(ctx, rx - 150, 58, 150, 104, pal);

    // ---- MAP LABELS with leader lines (track projected anchors) ----
    if (an) {
      const label = (text, bx, by, a, accentTip) => {
        if (hasLS) ctx.letterSpacing = '1px';
        ctx.font = XS; ctx.textAlign = 'left';
        const tw = ctx.measureText(text).width;
        ctx.strokeStyle = pal.fgCss(0.4); ctx.strokeRect(bx - 4 + 0.5, by - 11 + 0.5, tw + 8, 15);
        ctx.fillStyle = pal.fgCss(0.78); ctx.fillText(text, bx, by);
        if (a && a[2] > 0.05 && a[0] > pad && a[0] < w - pad && a[1] > pad && a[1] < h - pad) {
          ctx.strokeStyle = pal.fgCss(0.35);
          ctx.beginPath(); ctx.moveTo(bx - 4, by + 4); ctx.lineTo(a[0], a[1]); ctx.stroke();
          ctx.fillStyle = accentTip ? pal.accentCss(0.9) : pal.fgCss(0.7);
          ctx.beginPath(); ctx.arc(a[0], a[1], 2.2, 0, TWO_PI); ctx.fill();
        }
      };
      label('KUNITACHI STATION', w * 0.40, h * 0.17, an.station, true);
      label('JR CHUO LINE', w * 0.70, h * 0.20, an.rail, false);
      label('UNIVERSITY AVENUE', w * 0.40, h * 0.78, an.avenue, false);
    }

    // ---- BOTTOM-LEFT: AUDIO REACTIVITY + MIC ----
    if (hasLS) ctx.letterSpacing = '2px';
    ctx.textAlign = 'left'; ctx.font = XS; ctx.fillStyle = pal.fgCss(0.5);
    ctx.fillText('AUDIO REACTIVITY', pad + 8, h - 96);
    if (hasLS) ctx.letterSpacing = '1px';
    const meters = [['KICK', m.kick], ['SNARE', m.snare], ['HI-HAT', m.hihat], ['BASS', m.bass], ['PAD / ATMOS', m.pad]];
    for (let i = 0; i < 5; i++) {
      const y = h - 82 + i * 13;
      ctx.fillStyle = pal.fgCss(0.55); ctx.fillText(meters[i][0], pad + 8, y);
      this._hudSeg(ctx, pad + 78, y - 7, meters[i][1], pal, 12, 5, 6, 2);
    }
    const my = h - pad - 6;
    ctx.fillStyle = pal.fgCss(0.5); ctx.fillText(audio.ready ? 'MIC' : 'MIC OFF', pad + 8, my);
    ctx.strokeStyle = pal.fgCss(0.3); ctx.strokeRect(pad + 44.5, my - 8.5, 90, 8);
    ctx.fillStyle = pal.fgCss(0.8); ctx.fillRect(pad + 45, my - 8, clamp(audio.level || 0, 0, 1) * 88, 6);
    const lmh = [['L', audio.bass], ['M', audio.mid], ['H', audio.treble]];
    for (let i = 0; i < 3; i++) {
      const bx = pad + 148 + i * 26;
      ctx.fillStyle = (lmh[i][1] || 0) > 0.45 ? pal.accentCss(0.9) : pal.fgCss(0.3); ctx.fillRect(bx, my - 8, 7, 7);
      ctx.fillStyle = pal.fgCss(0.5); ctx.fillText(lmh[i][0], bx + 10, my);
    }

    // ---- BOTTOM-RIGHT: LAYER STATUS + coordinates ----
    const colX = w - pad - 6 - 175;
    if (hasLS) ctx.letterSpacing = '2px';
    ctx.textAlign = 'left'; ctx.font = XS; ctx.fillStyle = pal.fgCss(0.5);
    ctx.fillText('LAYER STATUS', colX, h - 96);
    if (hasLS) ctx.letterSpacing = '1px';
    const DOTS = 9;
    for (let i = 0; i < 6; i++) {
      const y = h - 82 + i * 12;
      ctx.fillStyle = pal.fgCss(0.5);
      ctx.fillText(`${String(i + 1).padStart(2, '0')} ${NAMES[i].split(' ')[0]}`, colX, y);
      const lit = Math.round(L[i] * DOTS), scan = Math.floor((clock.time * 6 + i) % DOTS);
      for (let d = 0; d < DOTS; d++) {
        let a = d < lit ? 0.8 : 0.12;
        if (d === scan && L[i] > 0.05) a = 1.0;
        ctx.fillStyle = pal.fgCss(a);
        ctx.beginPath(); ctx.arc(colX + 92 + d * 7, y - 3, 1.5, 0, TWO_PI); ctx.fill();
      }
    }
    ctx.textAlign = 'right'; ctx.font = SM; ctx.fillStyle = pal.fgCss(0.5);
    ctx.fillText('35.6844° N  139.4509° E', w - pad - 6, h - pad - 18);
    ctx.font = XS; ctx.fillStyle = pal.fgCss(0.45);
    ctx.fillText(`${pal.name}  ${Math.round(info.fps)}FPS`, w - pad - 6, h - pad - 6);

    if (hasLS) ctx.letterSpacing = '0px';
    ctx.restore();
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

    // 一橋大学 super-blocks appear as their parent avenue's branch reaches them
    for (const c of this._campus) {
      const ave = ((c[0] + c[2]) / 2 < 0) ? this._trunkSched.fujimi : this._trunkSched.asahi;
      const arriveT = ave.t0 + (c[1] / ave.len) * ave.tg;
      const f = clamp((this._front - arriveT) / 0.10, 0, 1);
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

  // The 旧国立駅舎 (1926) as the hero landmark at 大学通り's origin: a LOW building
  // whose identity is the steep, asymmetric red gable roof. Monochrome here, so it
  // reads by silhouette — a tall main gable (faces south, toward 大学通り) with an
  // off-centre ridge + a distinctly LOWER east wing (the unequal-length roof).
  // Custom mesh (not a box); projected/shaded/sorted like the city, drawn at the back.
  _drawStation(ctx, b, A, local, lightP, wantFaces, style) {
    if (local <= 0.001) return;
    const S = this._S, hsc = S * 0.175 * local; // == _H*0.105 at natural layout (_S=_H*0.6)
    // main hall (steep, roof-dominant, ridge biased west) + lower east wing.
    // Built to measured ratios of the reference: main gable depth:width ≈ 1.7 (long edge =
    // the ridge running back, like 富士見:旭), pitch ~51°, low walls, faces south. The 小屋
    // sits on the LEFT (west); its ridge runs E-W, so from the front it reads as a flat
    // sloped plane (a triangle only in side view). Plus a low platform canopy skirt.
    const uW = -0.060, uE = 0.060, vS = 0.065, vN = -0.037, hW = 0.26, hR = 0.683;        // MAIN gable (~51°, depth halved)
    const wuW = -0.140, wuE = -0.050, wvS = 0.058, wvN = -0.026, wRv = 0.016, whW = 0.17, whR = 0.40; // LEFT low gable (E-W ridge, lower, inserts into main → step+valley)
    const cuW = -0.062, cuE = 0.062, cvN = 0.065, cvS = 0.118, cb = 0.12, ct = 0.175;     // canopy
    const V = [
      [uW, vS, 0], [uE, vS, 0], [uE, vN, 0], [uW, vN, 0],
      [uW, vS, hW], [uE, vS, hW], [uE, vN, hW], [uW, vN, hW], [0, vS, hR], [0, vN, hR],
      [wuW, wvS, 0], [wuE, wvS, 0], [wuE, wvN, 0], [wuW, wvN, 0],
      [wuW, wvS, whW], [wuE, wvS, whW], [wuE, wvN, whW], [wuW, wvN, whW], [wuW, wRv, whR], [wuE, wRv, whR],
      [cuW, cvS, cb], [cuE, cvS, cb], [cuE, cvN, cb], [cuW, cvN, cb],
      [cuW, cvS, ct], [cuE, cvS, ct], [cuE, cvN, ct], [cuW, cvN, ct],
    ];
    const FACES_ST = [
      [0, 1, 5, 4], [1, 2, 6, 5], [3, 0, 4, 7], [2, 3, 7, 6],            // main walls S,E,W,N
      [4, 5, 8], [7, 6, 9], [4, 7, 9, 8], [5, 8, 9, 6],                  // main gable + slopes (idx4=S gable)
      [10, 11, 15, 14], [13, 10, 14, 17], [12, 13, 17, 16],             // 小屋 walls S,W,N
      [14, 15, 19, 18], [16, 17, 18, 19], [14, 17, 18],                 // 小屋 S slope, N slope, W gable
      [24, 25, 26, 27], [20, 21, 25, 24], [21, 22, 26, 25], [23, 20, 24, 27], // canopy top,S,E,W
    ];
    const N = V.length, SX = this._stSX || (this._stSX = []), SY = this._stSY || (this._stSY = []);
    const WX = [], WY = [], WZ = [], out = this._p1;
    let cxw = 0, cyw = 0, czw = 0;
    for (let i = 0; i < N; i++) {
      const wx = V[i][0] * S, wy = -V[i][2] * hsc, wz = (V[i][1] - 0.5) * S;
      WX[i] = wx; WY[i] = wy; WZ[i] = wz; cxw += wx; cyw += wy; czw += wz;
      this._project(wx, wy, wz, b, out); SX[i] = out[0]; SY[i] = out[1];
    }
    cxw /= N; cyw /= N; czw /= N;
    const recs = [];
    for (let f = 0; f < FACES_ST.length; f++) {
      const id = FACES_ST[f];
      const ax = WX[id[1]] - WX[id[0]], ay = WY[id[1]] - WY[id[0]], az = WZ[id[1]] - WZ[id[0]];
      const bx = WX[id[2]] - WX[id[0]], by = WY[id[2]] - WY[id[0]], bz = WZ[id[2]] - WZ[id[0]];
      let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
      let fx = 0, fy = 0, fz = 0;
      for (const vi of id) { fx += WX[vi]; fy += WY[vi]; fz += WZ[vi]; }
      fx /= id.length; fy /= id.length; fz /= id.length;
      if ((fx - cxw) * nx + (fy - cyw) * ny + (fz - czw) * nz < 0) { nx = -nx; ny = -ny; nz = -nz; }
      const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
      const camNz = ny * b.scp + (nx * b.scy + nz * b.ccy) * b.ccp;
      if (camNz <= 0) continue;                               // backface cull
      const camZ = fy * b.scp + (fx * b.scy + fz * b.ccy) * b.ccp;
      let bucket = 0;
      if (wantFaces) {
        const ndl = Math.max(0, nx * LNX + ny * LNY + nz * LNZ);
        let shadeT = 0.34 + 0.6 * ndl * (0.5 + 0.5 * lightP);
        shadeT = clamp(shadeT + 0.05 + (f === 4 ? 0.05 : 0), 0, 1); // landmark + south-gable pop
        bucket = Math.round(shadeT * (NTONE - 1));
      }
      recs.push({ id, camZ, bucket });
    }
    recs.sort((p, q) => p.camZ - q.camZ);                     // far -> near
    ctx.globalAlpha = A;
    if (wantFaces) {
      for (const r of recs) {
        const id = r.id; ctx.fillStyle = this._toneCss[r.bucket];
        ctx.beginPath(); ctx.moveTo(SX[id[0]], SY[id[0]]);
        for (let j = 1; j < id.length; j++) ctx.lineTo(SX[id[j]], SY[id[j]]);
        ctx.closePath(); ctx.fill();
      }
    }
    if (!wantFaces || style === 0) {                          // wire / hybrid edges
      ctx.strokeStyle = this.palette.fgCss(); ctx.lineWidth = Math.max(0.8, 1.1);
      ctx.globalAlpha = (wantFaces ? 0.5 : 1) * A;
      for (const r of recs) {
        const id = r.id;
        ctx.beginPath(); ctx.moveTo(SX[id[0]], SY[id[0]]);
        for (let j = 1; j < id.length; j++) ctx.lineTo(SX[id[j]], SY[id[j]]);
        ctx.closePath(); ctx.stroke();
      }
    }
    // south-gable detail (the iconic 半円アーチ窓 + three tall windows above), only when
    // the south face is toward the camera. Drawn on the gable plane v=vS.
    if (b.ccy * b.ccp > 0.04) {
      const o2 = [0, 0, 0];
      const pj = (u, z) => { this._project(u * S, -z * hsc, (vS - 0.5) * S, b, o2); return [o2[0], o2[1]]; };
      ctx.strokeStyle = this.palette.fgCss(0.9 * A);
      ctx.lineWidth = Math.max(0.7, 1.0); ctx.lineJoin = 'round';
      const wr = 0.025, wz0 = 0.19, wz1 = 0.31, zr = wr / 0.175; // above the canopy; zr keeps arch round
      ctx.beginPath();
      let p = pj(-wr, wz0); ctx.moveTo(p[0], p[1]);
      p = pj(-wr, wz1); ctx.lineTo(p[0], p[1]);
      for (let a = 0; a <= 8; a++) { const th = Math.PI * (1 - a / 8); p = pj(wr * Math.cos(th), wz1 + zr * Math.sin(th)); ctx.lineTo(p[0], p[1]); }
      p = pj(wr, wz0); ctx.lineTo(p[0], p[1]); ctx.closePath(); ctx.stroke();
      ctx.lineWidth = Math.max(1.0, 1.5);
      for (const cu of [-0.008, 0, 0.008]) { // three tall windows high in the gable
        ctx.beginPath();
        p = pj(cu, 0.50); ctx.moveTo(p[0], p[1]);
        p = pj(cu, 0.59); ctx.lineTo(p[0], p[1]); ctx.stroke();
      }
      // semicircular ドーマー窓 (eyebrow) sitting on the LEFT low roof's south slope, toward the front
      ctx.lineWidth = Math.max(0.7, 1.0);
      const slopePt = (u, t) => { const vv = wvS + t * (wRv - wvS), zz = whW + t * (whR - whW); this._project(u * S, -zz * hsc, (vv - 0.5) * S, b, o2); return [o2[0], o2[1]]; };
      const du = -0.092, dr = 0.020, dt = 0.16, dt0 = 0.13;
      ctx.beginPath();
      for (let a = 0; a <= 10; a++) { const th = Math.PI * (a / 10); const pp = slopePt(du + dr * Math.cos(th), dt0 + dt * Math.sin(th)); if (a === 0) ctx.moveTo(pp[0], pp[1]); else ctx.lineTo(pp[0], pp[1]); }
      ctx.stroke();
    }
    ctx.globalAlpha = A;
  }

  // The 一橋大学 super-blocks as LOW OPEN PLATES (not towers): a large flat raised
  // platform with a bright perimeter curb, in mid-gray. Reads as open campus ground —
  // distinct from the dense cube field, never competing with the hero station. Gated by
  // front3d (0 at top-down → invisible there; the flat map uses _drawMarks outlines).
  _drawCampus(ctx, b, A, front3d, lightP, wantFaces) {
    const S = this._S, H = this._H, out = this._p1;
    const SX = this._cSX || (this._cSX = []), SY = this._cSY || (this._cSY = []);
    for (let k = 0; k < this._blocks.length; k++) {
      const blk = this._blocks[k];
      if (blk.kind !== K_LAND) continue;
      const local = smoothstep(blk.key, blk.key + 0.14, front3d);
      if (local <= 0.001) continue;
      const stand = this._phase === PH_SINK
        ? clamp(1 - smoothstep(this._keyMax - blk.key, this._keyMax - blk.key + SINK_W, this._sinkFront), 0, 1) : 1; // far→near collapse
      const h = H * 0.008 * local * stand;          // low plate — well below the cube field
      if (h < 0.3) continue;                          // fully collapsed during the SINK wave
      const x0 = blk.uMin * S, x1 = blk.uMax * S;
      const z0 = (blk.vMin - 0.5) * S, z1 = (blk.vMax - 0.5) * S;
      const V = [[x0, 0, z0], [x1, 0, z0], [x1, -h, z0], [x0, -h, z0],
                 [x0, 0, z1], [x1, 0, z1], [x1, -h, z1], [x0, -h, z1]];
      for (let i = 0; i < 8; i++) { this._project(V[i][0], V[i][1], V[i][2], b, out); SX[i] = out[0]; SY[i] = out[1]; }
      const recs = [];
      for (let f = 0; f < FACES; f++) {
        const n = BOX_F[f].n, id = BOX_F[f].idx;
        const camNz = n[1] * b.scp + (n[0] * b.scy + n[2] * b.ccy) * b.ccp;
        if (camNz <= 0) continue;                   // backface cull
        let cz = 0;
        for (const vi of id) cz += V[vi][1] * b.scp + (V[vi][0] * b.scy + V[vi][2] * b.ccy) * b.ccp;
        cz /= id.length;
        let bucket = 0;
        if (wantFaces) {
          const ndl = Math.max(0, n[0] * LNX + n[1] * LNY + n[2] * LNZ);
          let shadeT = 0.26 + 0.32 * ndl * (0.5 + 0.5 * lightP); // mid-gray, capped (not a bright tower)
          shadeT = clamp(shadeT + (f === 0 ? 0.05 : 0), 0, 0.55);
          bucket = Math.round(shadeT * (NTONE - 1));
        }
        recs.push({ id, cz, bucket });
      }
      recs.sort((p, q) => p.cz - q.cz);             // far -> near
      ctx.globalAlpha = A;
      if (wantFaces) {
        for (const r of recs) {
          ctx.fillStyle = this._toneCss[r.bucket];
          ctx.beginPath(); ctx.moveTo(SX[r.id[0]], SY[r.id[0]]);
          for (let j = 1; j < r.id.length; j++) ctx.lineTo(SX[r.id[j]], SY[r.id[j]]);
          ctx.closePath(); ctx.fill();
        }
        ctx.strokeStyle = this.palette.fgCss(0.8 * A); ctx.lineWidth = Math.max(0.8, 1.2);
        ctx.beginPath(); ctx.moveTo(SX[3], SY[3]);  // bright curb on the top rim (verts 3,2,6,7)
        ctx.lineTo(SX[2], SY[2]); ctx.lineTo(SX[6], SY[6]); ctx.lineTo(SX[7], SY[7]);
        ctx.closePath(); ctx.stroke();
      } else {                                       // wire: outline every visible face
        ctx.strokeStyle = this.palette.fgCss(0.85 * A); ctx.lineWidth = Math.max(0.7, 1.0);
        for (const r of recs) {
          ctx.beginPath(); ctx.moveTo(SX[r.id[0]], SY[r.id[0]]);
          for (let j = 1; j < r.id.length; j++) ctx.lineTo(SX[r.id[j]], SY[r.id[j]]);
          ctx.closePath(); ctx.stroke();
        }
      }
    }
    ctx.globalAlpha = A;
  }

  // camera basis. At pitch=-90°/yaw=0 the projection collapses to the ortho flat
  // plot (sx=cx+u*S, sy=topY+v*S); tilting pitch yields the 3D view.
  _basis() {
    const S = this._S;
    const tilt = smoothstep(0, 1, this._riseView);
    return {
      ccy: Math.cos(this._camYaw), scy: Math.sin(this._camYaw),
      ccp: Math.cos(this._camPitch), scp: Math.sin(this._camPitch),
      F: FOCAL * this._H, cx: this._cx, cy: this._topY + 0.5 * S + this._cyLift,
      zoom: lerp(1, this.p('frameZoom'), tilt), // uniform width-fill scale about (cx,cy); =1 at riseView=0
    };
  }

  // weak-perspective projection of a world point (wx, wy, wz) -> out=[sx, sy, f]
  _project(wx, wy, wz, b, out) {
    const X = wx * b.ccy - wz * b.scy;
    const Z = wx * b.scy + wz * b.ccy;
    const Y = wy * b.ccp - Z * b.scp;
    const Z2 = wy * b.scp + Z * b.ccp;
    const f = b.F / (b.F - Z2);
    const z = b.zoom || 1;
    out[0] = b.cx + X * f * z; out[1] = b.cy + Y * f * z; out[2] = f;
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

  // Pulse height: pick an audio band by the block's lateral region (west=bass,
  // center=mid, east=treble) for an equalizer-like pulsing city.
  _bandFor(blk) {
    const a = this.audio; if (!a) return 0;
    const cu = (blk.uMin + blk.uMax) * 0.5;
    return cu < -0.25 ? a.bass : cu > 0.25 ? a.treble : a.mid;
  }

  // project a box vertex (wx, wy, wz) into the vertex buffers at index vi
  _pv(vi, wx, wy, wz, b) {
    const X = wx * b.ccy - wz * b.scy;
    const Z = wx * b.scy + wz * b.ccy;
    const Y = wy * b.ccp - Z * b.scp;
    const Z2 = wy * b.scp + Z * b.ccp;
    const f = b.F / (b.F - Z2);
    const z = b.zoom || 1;
    this._pvx[vi] = b.cx + X * f * z; this._pvy[vi] = b.cy + Y * f * z; this._pvf[vi] = f;
  }

  // O(n) far->near painter ordering of the fc collected faces by camera depth (_fCz):
  // a counting/bucket sort replacing the O(n log n) comparison sort. Stable within a bucket
  // (increasing original index) so it matches the old `|| (p-q)` tie-break. NB=256 buckets
  // resolve the low-rise voxels; returns this._fOrder filled to length fc.
  _depthOrder(fc) {
    const order = this._fOrder; order.length = fc;
    if (fc <= 1) { if (fc === 1) order[0] = 0; return order; }
    const cz = this._fCz, dep = this._fDepth, cnt = this._fDCnt, NB = 256;
    let mn = Infinity, mx = -Infinity;
    for (let i = 0; i < fc; i++) { const v = cz[i]; if (v < mn) mn = v; if (v > mx) mx = v; }
    const scale = mx > mn ? (NB - 1) / (mx - mn) : 0;
    cnt.fill(0);
    for (let i = 0; i < fc; i++) { let b = ((cz[i] - mn) * scale) | 0; if (b < 0) b = 0; else if (b >= NB) b = NB - 1; dep[i] = b; cnt[b]++; }
    let acc = 0;
    for (let b = 0; b < NB; b++) { const c = cnt[b]; cnt[b] = acc; acc += c; }
    for (let i = 0; i < fc; i++) { const b = dep[i]; order[cnt[b]++] = i; }
    return order;
  }

  // stroke the visible box-face outlines (wireframe / hybrid edges), far -> near
  _strokeFaces(ctx, A, fc, css) {
    const order = this._depthOrder(fc);
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
