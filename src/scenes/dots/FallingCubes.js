import { Scene } from '../Scene.js';
import { TWO_PI, HALF_PI, clamp, lerp, smoothstep, map, rand, rgbCss, lerpRgb } from '../../lib/math.js';
import { SimplexNoise } from '../../lib/noise.js';

// STACK — true-3D cubes fall toward a center, accumulate IRREGULARLY (Mound on a
// floor / Cluster floating in mid-air), then BURST outward; loops forever.
// Canvas-2D only, monochrome. Mirrors the codebase's established patterns:
//   - weak-perspective yaw/pitch projection (DancerRig: cam()/pr(), f=F/(F-z))
//   - section walker on the continuous beat clock (Tunnel: SEC_BEATS + smoothstep)
//   - local drop follower (Tunnel: _energy chase + surge>0.12 + decay 1.5/s)
//   - two parallel discrete pickers: modes=render style, views=accumulation form
// Shading blends palette bg->fg (NOT a ramp sample) so it is monochrome by
// construction on every palette — no accent-ramp hue can ever bleed onto a face.

const BAR = 4;
const SEC_BEATS = BAR * 8;       // 8 bars between camera cuts (Tunnel cadence)
const FOCAL = 4.5;               // focal length in units of H (DancerRig)
const MAX_CUBES = 160;           // hard device-safe ceiling (separate from slider)
const NTONE = 16;                // grayscale buckets (cache-friendly fillStyle)
const GN = 12;                   // height-grid resolution for Mound stacking

const ST_FALL = 0, ST_SETTLED = 1, ST_BURST = 2;

// Unit cube: 8 verts, 6 faces (idx traces the quad perimeter; outward normal),
// 12 edges. Winding is irrelevant for fills; the backface test uses the normal.
const CUBE_V = [
  [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
  [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
];
const CUBE_F = [
  { idx: [0, 1, 2, 3], n: [0, 0, -1] },
  { idx: [4, 5, 6, 7], n: [0, 0, 1] },
  { idx: [0, 3, 7, 4], n: [-1, 0, 0] },
  { idx: [1, 2, 6, 5], n: [1, 0, 0] },
  { idx: [0, 1, 5, 4], n: [0, -1, 0] },
  { idx: [3, 2, 6, 7], n: [0, 1, 0] },
];
const CUBE_E = [
  [0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4],
  [0, 4], [1, 5], [2, 6], [3, 7],
];
// edge index -> the faces that touch it (for wireframe visible-edge culling)
const EDGE_FACES = CUBE_E.map(([a, b]) => {
  const fs = [];
  for (let f = 0; f < 6; f++) {
    const id = CUBE_F[f].idx;
    for (let k = 0; k < 4; k++) {
      const u = id[k], v = id[(k + 1) % 4];
      if ((u === a && v === b) || (u === b && v === a)) { fs.push(f); break; }
    }
  }
  return fs;
});

// Light fixed in WORLD space (shading stays stable while the camera orbits).
const LX = -0.4, LY = -0.7, LZ = 0.55;
const LL = Math.hypot(LX, LY, LZ);
const LNX = LX / LL, LNY = LY / LL, LNZ = LZ / LL;

// Camera "cut" vantages: each cut nudges the orbit phase (yawKick, eased over
// ~0.3s) and re-aims the pitch. Selected by noise, never repeating the last.
const VANTAGES = [
  { k: 1.3, pitch: 0.12 }, { k: -1.0, pitch: 0.26 }, { k: 2.1, pitch: 0.10 },
  { k: -1.8, pitch: 0.30 }, { k: 0.8, pitch: 0.16 }, { k: -2.4, pitch: 0.22 },
  { k: 1.7, pitch: 0.14 },
];

export class FallingCubes extends Scene {
  constructor() {
    super('stack', 'Stack');
    this.trail = 0.35;
    this.modes = [{ name: 'Hybrid' }, { name: 'Wireframe' }, { name: 'Shaded' }];
    this.views = [{ name: 'Mound' }, { name: 'Cluster' }];
    this.viewIndex = 0;

    this.defineParam('count', 90, 16, 140, 2, 'Cubes');
    this.defineParam('size', 0.045, 0.02, 0.07, 0.005, 'Cube Size');
    this.defineParam('fallSpeed', 1.0, 0.4, 2.2, 0.1, 'Fall Speed');
    this.defineParam('spawn', 1.0, 0.3, 2.5, 0.1, 'Spawn Rate');
    this.defineParam('burstBars', 8, 2, 16, 1, 'Burst Bars');
    this.defineParam('burstPow', 1.0, 0.4, 2.0, 0.1, 'Burst Power');
    this.defineParam('autocam', 1, 0, 1, 1, 'Auto Cam');
    this.defineParam('camYaw', 0.4, 0, 6.28, 0.02, 'Cam Yaw');
    this.defineParam('floor', 1, 0, 1, 1, 'Floor');
    this.defineParam('light', 0.6, 0, 1, 0.05, 'Light');
    this.defineParam('burstNow', 0, 0, 1, 1, 'Burst!');

    this.t = 0;
    this.phase = 'FALL';
    this.noise = new SimplexNoise(73);

    // drop / energy follower (mirror of Tunnel's local algorithm)
    this._energy = 0; this._drop = 0;

    // camera state
    this._camYaw = 0.4; this._camPitch = 0.18;
    this._orbit = 0.4; this._pitchTarget = 0.18;
    this._camSecStart = 0; this._vIdx = 0;

    // burst / loop bookkeeping
    this._lastBurst = -999; this._lastBurstNow = false;
    this._activeCount = 0; this._settledCount = 0;
    this._spawnT = 0; this._lastView = 0;

    // cube pool (pre-allocated; reuse inactive slots, never push/splice in hot path)
    this.cubes = new Array(MAX_CUBES);
    for (let i = 0; i < MAX_CUBES; i++) {
      this.cubes[i] = {
        active: false, st: ST_FALL, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
        rx: 0, ry: 0, rz: 0, wx: 0, wy: 0, wz: 0, size: 0, sizeMul: 1,
        shadeBias: 0, land: 0, seed: 0, tx: 0, ty: 0, tz: 0,
      };
    }

    // projection / draw scratch (allocation-free hot loop)
    this._pvx = new Float32Array(MAX_CUBES * 8);
    this._pvy = new Float32Array(MAX_CUBES * 8);
    this._pvf = new Float32Array(MAX_CUBES * 8);
    this._cubeCz = new Float32Array(MAX_CUBES);
    this._front = new Uint8Array(MAX_CUBES * 6);
    // face record pool (parallel arrays + index order for sorting)
    this._fSlot = new Int32Array(MAX_CUBES * 6);
    this._fIdx = new Uint8Array(MAX_CUBES * 6);
    this._fCz = new Float32Array(MAX_CUBES * 6);
    this._fBucket = new Uint8Array(MAX_CUBES * 6);
    this._fOrder = [];
    this._cubeOrder = [];
    this._toneCss = new Array(NTONE);
    this._tmpRgb = [0, 0, 0];
  }

  init(ctx, w, h) { super.init(ctx, w, h); this._layout(); this._seedIdle(); }
  onResize(w, h) { super.onResize(w, h); this._layout(); }

  setView(i) { this.viewIndex = ((i % this.views.length) + this.views.length) % this.views.length; }

  _layout() {
    this._H = Math.min(this.w, this.h);
    this._floorY = this._H * 0.18;
    this._clusterY = -this._H * 0.04;
    this._spawnY = -this._H * 0.95;
    this._R = this._H * 0.5;
    if (!this._grid) this._grid = new Float32Array(GN * GN); else this._grid.fill(0);
  }

  _seedIdle() {
    for (let i = 0; i < 6; i++) this._spawn();
  }

  _cell(x, z) {
    const gx = clamp(Math.floor(((x / this._R) * 0.5 + 0.5) * GN), 0, GN - 1);
    const gz = clamp(Math.floor(((z / this._R) * 0.5 + 0.5) * GN), 0, GN - 1);
    return gx * GN + gz;
  }

  _spawn() {
    let c = null;
    for (let i = 0; i < MAX_CUBES; i++) { if (!this.cubes[i].active) { c = this.cubes[i]; break; } }
    if (!c) return;
    const H = this._H, R = this._R;
    const a = rand(TWO_PI), rr = R * (0.2 + 0.55 * rand());
    c.active = true; c.st = ST_FALL;
    c.x = Math.cos(a) * rr; c.z = Math.sin(a) * rr; c.y = this._spawnY - rand(0, 0.3 * H);
    c.vx = 0; c.vy = rand(0.05, 0.25) * H; c.vz = 0;
    c.rx = rand(TWO_PI); c.ry = rand(TWO_PI); c.rz = rand(TWO_PI);
    c.wx = rand(-1.6, 1.6); c.wy = rand(-1.6, 1.6); c.wz = rand(-1.6, 1.6);
    c.sizeMul = 0.8 + 0.45 * rand();            // per-cube ratio; live size = p('size')*H*sizeMul
    c.size = this.p('size') * H * c.sizeMul;
    c.shadeBias = rand(-0.5, 0.5); c.land = 0; c.seed = rand(0, 1000);
    this._setTarget(c);
  }

  // Assign a settle target for the current accumulation form.
  _setTarget(c) {
    const H = this._H, R = this._R;
    if (this.viewIndex === 0) {            // Mound: a column biased toward center
      const a = rand(TWO_PI), r = R * 0.62 * Math.sqrt(rand());
      c.tx = Math.cos(a) * r; c.tz = Math.sin(a) * r; c.ty = this._floorY; // ty refined at settle
    } else {                               // Cluster: lumpy shell around a mid-air point
      const u = rand(-1, 1), th = rand(TWO_PI), s = Math.sqrt(Math.max(0, 1 - u * u));
      let dx = s * Math.cos(th), dy = u, dz = s * Math.sin(th);
      const lump = 0.7 + 0.5 * (this.noise.noise3D(dx * 1.7, dy * 1.7, dz * 1.7) * 0.5 + 0.5);
      const radc = H * 0.2 * lump;
      c.tx = dx * radc; c.ty = this._clusterY + dy * radc; c.tz = dz * radc;
    }
  }

  update(dt, audio, palette, clock) {
    this.t += dt;
    const H = this._H;
    const beatsF = clock.beats + clock.beatPhase;

    // drop follower (no audio.drop exists; replicate Tunnel's three lines)
    this._energy += (audio.level - this._energy) * 0.1;
    const surge = audio.level - this._energy;
    this._drop = Math.max(this._drop - dt * 1.5, surge > 0.12 ? 1 : 0);

    // re-entry resync so stale beat anchors don't fire/step once-per-frame
    if (beatsF - this._camSecStart > SEC_BEATS * 2 || beatsF < this._camSecStart) this._camSecStart = beatsF;
    if (beatsF - this._lastBurst > 256 || beatsF < this._lastBurst) this._lastBurst = beatsF;

    this._updateCamera(dt, beatsF, clock);

    // form switch -> reflow active cubes to the new generator
    if (this.viewIndex !== this._lastView) {
      this._lastView = this.viewIndex;
      this._grid.fill(0); this._settledCount = 0;
      for (let i = 0; i < MAX_CUBES; i++) {
        const c = this.cubes[i];
        if (c.active && c.st !== ST_BURST) { c.st = ST_FALL; this._setTarget(c); }
      }
    }

    const q = clock.quality;
    const cap = Math.min(MAX_CUBES, Math.round(this.p('count') * q));
    const cluster = this.viewIndex === 1;
    const g = (cluster ? 0 : 2.0 * H) * this.p('fallSpeed') * (0.8 + audio.bass * 0.9);

    // spawn (only while building)
    if (this.phase === 'FALL') {
      this._spawnT -= dt;
      const rate = this.p('spawn') * (0.55 + audio.level * 1.6);
      if (this._spawnT <= 0 && this._activeCount < cap) { this._spawn(); this._spawnT = 1 / (2.4 * rate); }
      if (clock.beatJustWrapped && this._activeCount < cap) {
        const extra = Math.round(audio.beatHold * 3);
        for (let k = 0; k < extra; k++) this._spawn();
      }
    }

    // physics
    let active = 0, settled = 0;
    const homing = cluster ? 2.2 : 1.6;
    const baseSize = this.p('size') * H;        // live: Cube Size slider scales every cube each frame
    for (let i = 0; i < MAX_CUBES; i++) {
      const c = this.cubes[i];
      if (!c.active) continue;
      active++;
      c.size = baseSize * c.sizeMul;            // instant resize (no respawn needed)
      if (c.land > 0) c.land *= Math.pow(0.02, dt);

      if (c.st === ST_FALL) {
        c.rx += c.wx * dt; c.ry += c.wy * dt; c.rz += c.wz * dt;
        if (cluster) {
          const k = Math.min(1, dt * homing);
          c.x += (c.tx - c.x) * k; c.y += (c.ty - c.y) * k; c.z += (c.tz - c.z) * k;
          const dx = c.x - c.tx, dy = c.y - c.ty, dz = c.z - c.tz;
          if (dx * dx + dy * dy + dz * dz < (c.size * 0.7) * (c.size * 0.7)) {
            c.st = ST_SETTLED; c.land = 1; c.wx *= 0.2; c.wy *= 0.2; c.wz *= 0.2; settled++;
          }
        } else {
          c.vy += g * dt; c.y += c.vy * dt;
          const k = Math.min(1, dt * homing);
          c.x += (c.tx - c.x) * k; c.z += (c.tz - c.z) * k;
          const cell = this._cell(c.x, c.z);
          const restY = this._floorY - this._grid[cell] - c.size;
          if (c.y >= restY) {
            c.y = restY; c.vy = 0; c.st = ST_SETTLED; c.land = 1; settled++;
            this._grid[cell] += c.size * 1.4;            // overlap 0.7 -> irregular pile
            c.rx = Math.round(c.rx / HALF_PI) * HALF_PI + rand(-0.12, 0.12);
            c.ry = Math.round(c.ry / HALF_PI) * HALF_PI + rand(-0.12, 0.12);
            c.rz = rand(-0.1, 0.1); c.wx = c.wy = c.wz = 0;
          }
        }
      } else if (c.st === ST_SETTLED) {
        settled++;
        if (cluster) { c.rx += c.wx * dt; c.ry += c.wy * dt; c.rz += c.wz * dt; }
        if (clock.beatJustWrapped) c.land = Math.max(c.land, 0.25 + audio.beatHold * 0.4);
      } else { // ST_BURST
        c.vy += g * dt; c.x += c.vx * dt; c.y += c.vy * dt; c.z += c.vz * dt;
        c.rx += c.wx * dt; c.ry += c.wy * dt; c.rz += c.wz * dt;
        const lim = 1.4 * H;
        if (c.x < -lim || c.x > lim || c.z < -lim || c.z > lim || c.y > lim || c.y < -1.7 * H) c.active = false;
      }
    }
    this._activeCount = active; this._settledCount = settled;

    // --- burst triggers (hybrid: drop/strong-beat + safety + manual), pile-gated ---
    const formed = settled >= 0.4 * Math.max(1, active) && settled >= 6;
    if (this.phase === 'FALL') {
      const cooldown = 4;
      const onDrop = clock.beatJustWrapped && audio.beatHold > 0.6 && this._drop > 0.5;
      const safety = (beatsF - this._lastBurst) >= BAR * this.p('burstBars') || active >= cap;
      if (formed && (beatsF - this._lastBurst) >= cooldown && (onDrop || safety)) this._burst(beatsF, audio);
    }
    const bn = this.p('burstNow') > 0.5;
    if (bn && !this._lastBurstNow && this.phase === 'FALL' && active > 0) this._burst(beatsF, audio);
    this._lastBurstNow = bn;

    // --- reset to FALL once the field clears (or a hard timeout) -> seamless loop ---
    if (this.phase === 'BURST' && (active === 0 || (beatsF - this._lastBurst) >= 16)) {
      this.phase = 'FALL'; this._grid.fill(0); this._settledCount = 0;
    }
  }

  _burst(beatsF, audio) {
    this.phase = 'BURST'; this._lastBurst = beatsF; this._grid.fill(0);
    const H = this._H, cy = this.viewIndex === 1 ? this._clusterY : this._floorY * 0.4;
    const pw = this.p('burstPow') * (1 + 0.8 * this._drop);
    for (let i = 0; i < MAX_CUBES; i++) {
      const c = this.cubes[i];
      if (!c.active) continue;
      c.st = ST_BURST;
      let dx = c.x, dy = c.y - cy, dz = c.z;
      const len = Math.hypot(dx, dy, dz) || 0.001;
      const sp = Math.min(1.2 * H, (0.45 + 0.4 * rand()) * H * pw); // capped: can't cross +F in a frame
      c.vx = (dx / len) * sp; c.vz = (dz / len) * sp;
      c.vy = (dy / len) * sp - (0.45 + 0.3 * rand()) * H * pw;       // up-kick (up = -y)
      c.wx = rand(-7, 7); c.wy = rand(-7, 7); c.wz = rand(-7, 7);
    }
  }

  _updateCamera(dt, beatsF, clock) {
    if (this.p('autocam') >= 0.5) {
      this._orbit += dt * 0.06 * (1 + 0.5 * this._drop);
      const wobY = this.noise.noise2D(this.t * 0.05, 11) * 0.22;
      const wobP = this.noise.noise2D(this.t * 0.04, 4.2) * 0.10;
      if (beatsF - this._camSecStart >= SEC_BEATS) {
        this._camSecStart += SEC_BEATS;
        let idx = Math.floor((this.noise.noise2D(beatsF * 0.13, 91) * 0.5 + 0.5) * VANTAGES.length);
        idx = clamp(idx, 0, VANTAGES.length - 1);
        if (idx === this._vIdx) idx = (idx + 1) % VANTAGES.length;     // never repeat
        this._vIdx = idx;
        this._orbit += VANTAGES[idx].k;                                // re-aim (eased below)
        this._pitchTarget = VANTAGES[idx].pitch;
      }
      const tgtYaw = this._orbit + wobY;
      const tgtPitch = clamp(this._pitchTarget + wobP, 0.08, 0.36);
      this._camYaw += (tgtYaw - this._camYaw) * Math.min(1, dt * 6);
      this._camPitch += (tgtPitch - this._camPitch) * Math.min(1, dt * 6);
    } else {
      // manual: glide toward the slider (no snap), hold a gentle pitch
      const tgt = this.p('camYaw');
      this._camYaw += (tgt - this._camYaw) * Math.min(1, dt * 4);
      this._camPitch += (0.16 - this._camPitch) * Math.min(1, dt * 4);
      this._orbit = this._camYaw;
    }
  }

  draw(ctx, alpha) {
    const A = alpha;
    const H = this._H, F = FOCAL * H, q = this.clock.quality;
    const audio = this.audio;
    const beatHold = audio ? audio.beatHold : 0;
    const treble = audio ? audio.treble : 0;

    // camera basis (+ subtle beat micro-shake at the translate step only)
    const ccy = Math.cos(this._camYaw), scy = Math.sin(this._camYaw);
    const ccp = Math.cos(this._camPitch), scp = Math.sin(this._camPitch);
    const shake = beatHold * H * 0.004;
    const cx = this.w * 0.5 + this.noise.noise2D(this.t * 4, 7) * shake;
    const cy = this.h * 0.5 + this.noise.noise2D(this.t * 4, 19) * shake;

    // monochrome tone table (bg->fg blend) rebuilt per frame; cache-friendly
    const bg = this.palette.bg, fg = this.palette.fg;
    const lightP = this.p('light');
    for (let i = 0; i < NTONE; i++) {
      this._toneCss[i] = rgbCss(lerpRgb(bg, fg, i / (NTONE - 1), this._tmpRgb));
    }
    const edgeCss = this.palette.fgCss();

    ctx.globalCompositeOperation = 'source-over';
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';

    // floor grid (Mound only). Split into a FAR half (drawn now, behind the
    // pile) and a NEAR half (drawn after the cubes) so the grid correctly
    // passes IN FRONT of the pile's base — the cubes then read as resting ON it
    // instead of the grid bleeding through them at every height.
    const moundFloor = this.viewIndex === 0 && this.p('floor') >= 0.5;
    if (moundFloor) this._drawFloor(ctx, A, ccy, scy, ccp, scp, F, cx, cy, false);

    const mode = this.modeIndex;
    const wantFaces = mode !== 1;

    // --- project all active cubes into scratch buffers (allocation-free) ---
    let fc = 0;
    for (let i = 0; i < MAX_CUBES; i++) {
      const c = this.cubes[i];
      if (!c.active) continue;
      const s = c.size;
      const cxr = Math.cos(c.rx), sxr = Math.sin(c.rx);
      const cyr = Math.cos(c.ry), syr = Math.sin(c.ry);
      const czr = Math.cos(c.rz), szr = Math.sin(c.rz);
      // R = Rz * Ry * Rx (row-major)
      const m0 = czr * cyr, m1 = czr * syr * sxr - szr * cxr, m2 = czr * syr * cxr + szr * sxr;
      const m3 = szr * cyr, m4 = szr * syr * sxr + czr * cxr, m5 = szr * syr * cxr - czr * sxr;
      const m6 = -syr, m7 = cyr * sxr, m8 = cyr * cxr;
      const base = i * 8;
      // vertices
      for (let v = 0; v < 8; v++) {
        const ux = CUBE_V[v][0], uy = CUBE_V[v][1], uz = CUBE_V[v][2];
        const lx = (m0 * ux + m1 * uy + m2 * uz) * s + c.x;
        const ly = (m3 * ux + m4 * uy + m5 * uz) * s + c.y;
        const lz = (m6 * ux + m7 * uy + m8 * uz) * s + c.z;
        const X = lx * ccy - lz * scy;
        const Z = lx * scy + lz * ccy;
        const Y = ly * ccp - Z * scp;
        const Z2 = ly * scp + Z * ccp;
        const f = F / (F - Z2);
        this._pvx[base + v] = cx + X * f;
        this._pvy[base + v] = cy + Y * f;
        this._pvf[base + v] = f;
      }
      // cube-center camera z (depth ordering / culling)
      const Zc = c.x * scy + c.z * ccy;
      const czCenter = c.y * scp + Zc * ccp;
      this._cubeCz[i] = czCenter;

      // faces: world normal -> shading (stable) + camera-z of normal -> cull
      for (let f = 0; f < 6; f++) {
        const fn = CUBE_F[f].n;
        const wnx = m0 * fn[0] + m1 * fn[1] + m2 * fn[2];
        const wny = m3 * fn[0] + m4 * fn[1] + m5 * fn[2];
        const wnz = m6 * fn[0] + m7 * fn[1] + m8 * fn[2];
        const Zn = wnx * scy + wnz * ccy;
        const camNz = wny * scp + Zn * ccp;     // camera-space normal z
        const isFront = camNz > 0;
        this._front[i * 6 + f] = isFront ? 1 : 0;
        if (!wantFaces || !isFront) continue;

        // cube-center camera-z (linear, non-diverging) is a stable sort key
        const cz = czCenter;
        if (cz >= F * 0.92) continue;

        const ndl = Math.max(0, wnx * LNX + wny * LNY + wnz * LNZ);
        let shadeT = 0.38 + 0.62 * ndl * (0.5 + 0.5 * lightP);
        const depthCue = clamp(map(czCenter, -0.5 * H, 0.5 * H, 0.72, 1.0), 0.7, 1.0);
        shadeT = clamp(shadeT * depthCue * (0.9 + 0.18 * c.shadeBias) + 0.4 * c.land, 0, 1);

        this._fSlot[fc] = i;
        this._fIdx[fc] = f;
        this._fCz[fc] = cz;
        this._fBucket[fc] = Math.round(shadeT * (NTONE - 1));
        fc++;
      }
    }

    if (mode === 1) {
      this._drawWire(ctx, A, beatHold);
      if (moundFloor) this._drawFloor(ctx, A, ccy, scy, ccp, scp, F, cx, cy, true);
      return;
    }

    // sort faces far -> near (ascending camera-z; camera sits at +F)
    const order = this._fOrder; order.length = fc;
    for (let i = 0; i < fc; i++) order[i] = i;
    order.sort((a, b) => (this._fCz[a] - this._fCz[b]) || (a - b));

    // pass 1: fills (single globalAlpha; fillStyle switches only on bucket change)
    ctx.globalAlpha = A;
    let lastB = -1;
    const pvx = this._pvx, pvy = this._pvy;
    for (let oi = 0; oi < fc; oi++) {
      const rec = order[oi];
      const b = this._fBucket[rec];
      if (b !== lastB) { ctx.fillStyle = this._toneCss[b]; lastB = b; }
      const slot = this._fSlot[rec] * 8;
      const id = CUBE_F[this._fIdx[rec]].idx;
      ctx.beginPath();
      ctx.moveTo(pvx[slot + id[0]], pvy[slot + id[0]]);
      ctx.lineTo(pvx[slot + id[1]], pvy[slot + id[1]]);
      ctx.lineTo(pvx[slot + id[2]], pvy[slot + id[2]]);
      ctx.lineTo(pvx[slot + id[3]], pvy[slot + id[3]]);
      ctx.closePath();
      ctx.fill();
    }

    // pass 2: bright edges (Hybrid only; skipped under load)
    if (mode === 0 && q > 0.6) {
      ctx.globalAlpha = clamp(0.7 + 0.3 * beatHold, 0, 1) * A;
      ctx.strokeStyle = edgeCss;
      const pvf = this._pvf;
      for (let oi = 0; oi < fc; oi++) {
        const rec = order[oi];
        const slot = this._fSlot[rec] * 8;
        const id = CUBE_F[this._fIdx[rec]].idx;
        const fw = (pvf[slot + id[0]] + pvf[slot + id[2]]) * 0.5;
        ctx.lineWidth = Math.max(0.7, 1.1 * fw);
        ctx.beginPath();
        ctx.moveTo(pvx[slot + id[0]], pvy[slot + id[0]]);
        ctx.lineTo(pvx[slot + id[1]], pvy[slot + id[1]]);
        ctx.lineTo(pvx[slot + id[2]], pvy[slot + id[2]]);
        ctx.lineTo(pvx[slot + id[3]], pvy[slot + id[3]]);
        ctx.closePath();
        ctx.stroke();
      }
    }
    // near half of the floor — drawn OVER the front cubes so the grid reads as
    // passing in front of the pile's base (correct ground contact).
    if (moundFloor) this._drawFloor(ctx, A, ccy, scy, ccp, scp, F, cx, cy, true);
    ctx.globalAlpha = A;
  }

  _drawWire(ctx, A, beatHold) {
    // sort cubes far -> near, draw only edges that touch a front face
    const ord = this._cubeOrder; ord.length = 0;
    for (let i = 0; i < MAX_CUBES; i++) if (this.cubes[i].active) ord.push(i);
    ord.sort((a, b) => this._cubeCz[a] - this._cubeCz[b]);
    ctx.strokeStyle = this.palette.fgCss();
    const pvx = this._pvx, pvy = this._pvy, pvf = this._pvf;
    for (let oi = 0; oi < ord.length; oi++) {
      const i = ord[oi], slot = i * 8, fb = i * 6;
      for (let e = 0; e < 12; e++) {
        const fs = EDGE_FACES[e];
        const vis = this._front[fb + fs[0]] || this._front[fb + fs[1]];
        if (!vis) continue;
        const a = CUBE_E[e][0], b = CUBE_E[e][1];
        const fw = (pvf[slot + a] + pvf[slot + b]) * 0.5;
        ctx.globalAlpha = clamp(0.6 + 0.4 * beatHold, 0, 1) * A * clamp(fw, 0.6, 1.3);
        ctx.lineWidth = Math.max(0.7, 1.0 * fw);
        ctx.beginPath();
        ctx.moveTo(pvx[slot + a], pvy[slot + a]);
        ctx.lineTo(pvx[slot + b], pvy[slot + b]);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = A;
  }

  // Floor grid for Mound. Drawn in two passes split at the pile-base center:
  //   near=false -> only the half farther than the center (behind the pile)
  //   near=true  -> only the half nearer than the center (in front of the pile)
  // The grid is clipped to a disc that fades out past the pile footprint (no
  // square "floating mat" apron) and brightened where the cubes actually rest.
  _drawFloor(ctx, A, ccy, scy, ccp, scp, F, cx, cy, near) {
    const y = this._floorY, R = this._R;
    const discR = R * 0.94;        // circular extent — apron melts into black
    const contactR = R * 0.6;      // pile footprint: brightest, the contact zone
    const n = 6, step = R / n;
    const Z2c = y * scp;           // camera-z of the pile-base center = split plane
    ctx.strokeStyle = rgbCss(lerpRgb(this.palette.bg, this.palette.fg, 0.36, this._tmpRgb));
    ctx.lineWidth = 0.7;
    const p0 = [0, 0, 0], p1 = [0, 0, 0];
    const proj = (wx, wz, out) => {
      const X = wx * ccy - wz * scy;
      const Z = wx * scy + wz * ccy;
      const Y = y * ccp - Z * scp;
      const Z2 = y * scp + Z * ccp;
      const f = F / (F - Z2);
      out[0] = cx + X * f; out[1] = cy + Y * f; out[2] = f;
    };
    // Draw the portion of segment (x0,z0)->(x1,z1) that lies on the requested
    // side of the split plane, with a radial fade + contact boost.
    const seg = (x0, z0, x1, z1) => {
      const za = Z2c + (x0 * scy + z0 * ccy) * ccp;
      const zb = Z2c + (x1 * scy + z1 * ccy) * ccp;
      const da = za - Z2c, db = zb - Z2c;       // >0 => nearer than the center
      const aIn = near ? da >= 0 : da < 0;
      const bIn = near ? db >= 0 : db < 0;
      if (!aIn && !bIn) return;
      let ta = 0, tb = 1;
      if (aIn !== bIn) { const tc = da / (da - db); if (aIn) tb = tc; else ta = tc; }
      const sx0 = x0 + (x1 - x0) * ta, sz0 = z0 + (z1 - z0) * ta;
      const sx1 = x0 + (x1 - x0) * tb, sz1 = z0 + (z1 - z0) * tb;
      const rad = Math.hypot((sx0 + sx1) * 0.5, (sz0 + sz1) * 0.5);
      if (rad > discR) return;
      const rf = 1 - smoothstep(contactR, discR, rad);   // fade out past footprint
      if (rf <= 0.002) return;
      const boost = lerp(1.5, 1.0, smoothstep(0, contactR, rad)); // anchor contact
      proj(sx0, sz0, p0); proj(sx1, sz1, p1);
      const depth = clamp((p0[2] + p1[2]) * 0.5, 0.5, 1.3);
      ctx.globalAlpha = clamp(0.42 * A * rf * boost * depth, 0, 1);
      ctx.beginPath(); ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]); ctx.stroke();
    };
    for (let g = -n; g <= n; g++) {
      const c = g * step;
      if (Math.abs(c) > discR) continue;
      const half = Math.sqrt(discR * discR - c * c);   // clip lines to the disc
      seg(c, -half, c, half);   // lines parallel to z
      seg(-half, c, half, c);   // lines parallel to x
    }
    ctx.globalAlpha = A;
  }
}
