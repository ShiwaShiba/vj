import { Scene } from '../Scene.js';
import { rgbCss, TWO_PI } from '../../lib/math.js';
import { SimplexNoise } from '../../lib/noise.js';

// Time-domain waveform. Modes: horizontal scope, circular scope, XY (the
// waveform plotted against a delayed copy of itself for Lissajous-like loops).
//
// XY is the headline mode. Beyond gain/range it exposes parameter-driven
// variation: Phase (the self-correlation lag = the loop SHAPE), Flip (mirror
// one axis = reverse the bass diagonal UL/LR <-> LL/UR), a Drive band selector
// (BASS / TREBLE / LEVEL drives the breathing scale; small bands lifted by a
// gamma so treble — which rarely peaks — still reads), and Rotate (spin the
// whole figure). Spin has an explicit OFF/ON toggle so stopping the rotation is
// one tap (no hunting for slider-zero), and the Rotate slider has a centre
// dead-zone so its middle is a reliable "stopped" position on a touchscreen.
// Auto wanders all of these hands-off, fully deterministic from clock
// time/beats (no Math.random/Date), so an unattended scope keeps evolving.
//
// Sphere is a 3D mode: waveform geometry built on a unit sphere, rotated
// (reusing the same Spin/Rotate/Auto rotation that drives XY) and projected
// orthographically to Canvas-2D — no 3D library. A fixed tilt plus per-segment
// depth dimming (the back of the sphere fades out) sells the volume while
// staying mono. Its Form sub-toggle picks GLOBE (stacked latitude rings), WRAP
// (one waveform spiralled pole-to-pole) or LISSA (XY's self-correlation in 3D).
const SPHERE_TILT = 0.42; // fixed X-axis tilt, rad — keeps the pole off dead-centre
const SPHERE_COS_TILT = Math.cos(SPHERE_TILT);
const SPHERE_SIN_TILT = Math.sin(SPHERE_TILT);

// ── TERRAIN = "Noise Blob" ──────────────────────────────────────────────────
// A glowing off-white organic blob: a dense Fibonacci point cloud on a sphere
// whose surface is pushed out by FBM (the big organic shape) + a Worley cell
// network. F2-F1 is ~0 exactly on the Voronoi boundaries → THIN bright cell
// walls with dark cell craters (the signature). Soft additive sprites,
// brightness-culled so the walls concentrate, slow rotation + breathing morph +
// treble grain-shimmer, an offscreen bloom halo. Mono, additive, deterministic
// (seeded simplex + sin-hash worley, clock-driven; no Math.random/Date).
// Ported 1:1 from the user-approved shots/blob-proto.html look.
const BLOB_COUNT = 70000;   // Fibonacci points (perf-tuned for the live app)
const BLOB_EDGEW = 0.17;    // Voronoi wall thickness (F2-F1 band)
const BLOB_CULL = 0.055;    // drop dots dimmer than this → dark craters, solid walls, tighter rim (less dust), fewer draws
const BLOB_SCALE = 0.5;     // render the cloud to a half-res offscreen (4× cheaper bloom; the upscale softens the grain)
let _wF1 = 0, _wF2 = 0;
function _fract(v) { return v - Math.floor(v); }
function _smoothstep(a, b, x) { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
function _clampv(v, a, b) { return v < a ? a : v > b ? b : v; }
// fast integer hash → a 0..1 feature-point offset (no Math.sin: the sin-hash the
// proto used costs ~3M sin/frame at this point count, far too slow live). The
// cell pattern is statistical, so swapping the hash keeps the approved foam look.
function _hash01(x, y, z, c) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(z | 0, 1274126177) + Math.imul(c | 0, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
// two nearest feature-point distances (3×3×3). F2-F1 ≈ 0 on the Voronoi
// boundaries → the thin bright cell-wall network; large inside cells → craters.
function _worley2(px, py, pz) {
  const ipx = Math.floor(px), ipy = Math.floor(py), ipz = Math.floor(pz);
  const fpx = px - ipx, fpy = py - ipy, fpz = pz - ipz;
  let f1 = 1e9, f2 = 1e9;
  for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) {
    const hx = ipx + x, hy = ipy + y, hz = ipz + z;
    const rx = x + _hash01(hx, hy, hz, 0) - fpx;
    const ry = y + _hash01(hx, hy, hz, 1) - fpy;
    const rz = z + _hash01(hx, hy, hz, 2) - fpz;
    const dd = rx * rx + ry * ry + rz * rz;
    if (dd < f1) { f2 = f1; f1 = dd; } else if (dd < f2) { f2 = dd; }
  }
  _wF1 = Math.sqrt(f1); _wF2 = Math.sqrt(f2);
}

// Rare HELIX-ONLY accents (never on other spreads): a SHELL bloom — a waveform
// sphere swelling out past the coil, then fading — and a coil XY-VIBRATION — the
// whole coil swaying in a 3:2 Lissajous (the XY scope pattern), the figure
// undulating then settling. A single timer ALTERNATES between the two so each
// stays a distinct, sparse event (NOT per-beat). It advances only while HELIX is
// the active spread; a bass rising-edge fires the next accent so it lands on a
// hit; a fallback fires it anyway if the music never spikes. Deterministic.
const ACCENT_COOLDOWN = 13;  // s — gap between HELIX accents (alternating → each kind ~2× rarer)
const ACCENT_FALLBACK = 30;  // s — armed-but-silent this long → fire anyway
const ACCENT_BASS_HI = 0.72; // a bass rising-edge above this = the "hit" that fires the next accent
const SHELL_LIFE = 2.1;      // s — shell-bloom envelope (fast swell, slow fade)
const VIBE_LIFE = 1.6;       // s — coil-sway envelope (fast swell, slow fade)
const VIBE_FREQ = 3.2;       // rad/s — base rate of the Lissajous sway (×3 / ×2 on the two axes)
const VIBE_WAVES = 2.5;      // Lissajous-phase wavelengths along the coil (the undulation count)
const VIBE_AMP = 0.32;       // peak sway as a fraction of the figure scale

export class Oscilloscope extends Scene {
  constructor() {
    super('scope', 'Oscilloscope');
    this.trail = 0.3;
    this.modes = [{ name: 'Line' }, { name: 'Circle' }, { name: 'XY' }, { name: 'Sphere' }];
    this.defineParam('thickness', 3, 0.25, 8, 0.25, 'Thickness'); // base width; min low enough for hairline strokes
    this.defineParam('react', 3, 0, 10, 0.5, 'React'); // px the line grows at full level — audio→width balance
    this.defineParam('gain', 1, 0.3, 3, 0.1, 'Gain');
    this.defineParam('range', 1, 0.4, 2.2, 0.1, 'Range');
    // XY / Sphere levers (no effect in Line/Circle).
    this.defineParam('phase', 8, 1, 64, 1, 'Phase');     // self-correlation lag = loop shape (XY + Sphere/LISSA)
    this.defineParam('rotate', 0, -0.5, 0.5, 0.02, 'Rotate'); // spin rev/s — XY figure or Sphere self-rotation (centre dead-zone)
    this.defineParam('drive', 0.6, 0, 1.5, 0.05, 'Drive');    // band-driven breathing depth
    this.defineParam('density', 9, 3, 24, 1, 'Density');      // Sphere only: GLOBE ring count / WRAP winding count / HELIX coil turns
    this.defineParam('core', 0.12, 0, 0.45, 0.01, 'Core');    // LISSA: central nucleus scale; HELIX: vertical Line-scope waveform amplitude (0 = off)
    this.defineParam('count', 1, 1, 10, 1, 'Count');          // RIBBON only: on-screen copies of the figure, grid-laid (like more dancers)
    // Button groups (rendered by ControlPanel; mainly meaningful in XY/Sphere).
    // Spin OFF freezes the figure/sphere instantly regardless of the Rotate slider.
    this.modeGroups = [
      { key: 'drive', label: 'Drive', options: ['BASS', 'TREBLE', 'LEVEL'], index: 0 },
      { key: 'flip', label: 'Flip', options: ['OFF', 'ON'], index: 0 },
      { key: 'spin', label: 'Spin', options: ['OFF', 'ON'], index: 1 },
      { key: 'sphere', label: 'Form', options: ['GLOBE', 'WRAP', 'LISSA', 'TERRAIN'], index: 0 },
      { key: 'spread', label: 'Spread', options: ['LISSA', 'SPHERE', 'TOROID', 'QUAD', 'RIBBON', 'HELIX'], index: 0 },
      { key: 'auto', label: 'Auto', options: ['OFF', 'ON'], index: 0 },
    ];
    this._spin = 0; // accumulated rotation, radians
    this._accentT = -1;      // scheduler clock for HELIX rare accents (<0 = re-arm on entering HELIX)
    this._accentKind = 1;    // alternates 0/1 → shell vs vibration, so each stays a distinct rare event
    this._shellFireT = -100; // clock time the shell bloom last fired (far past = not playing)
    this._vibeFireT = -100;  // clock time the coil vibration last fired (far past = not playing)
    this._prevBass = 0;      // previous-frame bass, for rising-edge (hit) detection
    this._noise = new SimplexNoise(7); // TERRAIN surface texture (deterministic, seeded)
    // TERRAIN "Noise Blob" lazy caches (built on first draw): Fibonacci point
    // directions + per-point seed + structural radius/brightness caches, and a
    // half-res offscreen buffer for the bloom composite (resized with the canvas).
    this._blobDir = null; this._blobSeed = null;
    this._blobOC = null; this._blobOCtx = null; this._blobW = 0; this._blobH = 0;
  }

  update(dt, audio, palette, clock) {
    this.wave = audio.waveform;
    this.level = audio.level;
    this.bass = audio.bass;
    this.mid = audio.mid;
    this.treble = audio.treble;
    this.t = clock.time;
    this.beats = clock.beats;
    // TERRAIN (Sphere → Form TERRAIN) renders a fresh point-cloud blob with its
    // own bloom each frame, so it wants a full clear (no smear); every other form
    // keeps the filament motion-trails. SceneManager reads this.trail after update.
    this.trail = (this.modeIndex === 3 && this.mg('sphere') === 3) ? 1 : 0.3;

    // Rotation: manual slider, OR a slow bold wander when Auto is on. Band is
    // intentionally NOT mixed into spin — Drive drives the scale, Rotate the
    // spin — so each lever stays predictable. Auto is the master override; below
    // it, Spin OFF freezes the figure and the Rotate slider has a centre
    // dead-zone so its middle reliably means "stopped" on a touchscreen.
    let spinRate;
    if (this.mg('auto') === 1) {
      spinRate = 0.05 + 0.035 * Math.sin(this.t * 0.045 * TWO_PI); // ~0.015..0.085 rev/s
    } else if (this.mg('spin') === 1) {
      let r = this.p('rotate'); // rev/s
      if (Math.abs(r) < 0.03) r = 0; // centre dead-zone (catches 0 and ±one step)
      spinRate = r;
    } else {
      spinRate = 0; // Spin OFF — frozen wherever it is, slider ignored
    }
    this._spin = (this._spin + dt * spinRate * TWO_PI) % TWO_PI;

    // Rare HELIX-only accents (shell bloom + coil XY-vibration) — see ACCENT_*/
    // VIBE_* and _drawSphere. One timer alternates between the two so each stays a
    // distinct rare event; it only advances while HELIX is the active spread and
    // fires on a bass hit (cooldown-gated, with a silent fallback). Deterministic.
    const hit = this.bass > ACCENT_BASS_HI && this._prevBass <= ACCENT_BASS_HI;
    if (this._effSpread() === 5) {
      if (this._accentT < 0) this._accentT = this.t; // arm on entering HELIX
      const since = this.t - this._accentT;
      if (since > ACCENT_COOLDOWN && (hit || since > ACCENT_FALLBACK)) {
        this._accentT = this.t;
        this._accentKind ^= 1; // alternate: shell ↔ vibration (deterministic, no RNG)
        if (this._accentKind) this._vibeFireT = this.t; else this._shellFireT = this.t;
      }
    } else {
      this._accentT = -1; // re-arm next time HELIX becomes active
    }
    this._prevBass = this.bass;
  }

  // Effective XY controls. Auto overrides the manual values with deterministic
  // time/beat functions so the figure evolves on its own.
  _effPhase() {
    if (this.mg('auto') === 1) {
      // sweep 4..60 over ~12.5s — bold range, slow period
      return 4 + (Math.sin(this.t * 0.08 * TWO_PI) * 0.5 + 0.5) * 56;
    }
    return this.p('phase');
  }
  _effFlip() {
    if (this.mg('auto') === 1) return Math.floor(this.beats / 16) % 2 === 1; // flip every 4 bars
    return this.mg('flip') === 1;
  }
  _effBandIndex() {
    if (this.mg('auto') === 1) return Math.floor(this.beats / 32) % 3; // cycle every 8 bars
    return this.mg('drive');
  }
  _driveEnergy() {
    const idx = this._effBandIndex();
    const raw = idx === 0 ? this.bass : idx === 1 ? this.treble : this.level;
    const b = raw < 0 ? 0 : raw > 1 ? 1 : raw;
    return Math.pow(b, 0.6); // lift small bands so treble still reads
  }

  // Spread mode for LISSA: 0 raw self-correlation, 1 sphere, 2 toroid, 3 quad,
  // 4 ribbon (a twisting foil body on the centreline), 5 helix (QUAD's open
  // phase-portrait extruded along a time axis into a coil).
  // Auto walks through them irregularly (deterministic — varied order + dwell).
  _effSpread() {
    if (this.mg('auto') === 1) {
      const order = [1, 2, 4, 0, 3, 5, 2, 4, 1, 5, 3, 0];
      const k = (((Math.floor(this.beats / 11 + 0.6 * Math.sin(this.beats * 0.17))) % order.length) + order.length) % order.length;
      return order[k];
    }
    return this.mg('spread');
  }

  // Map a waveform window to a 3D point per the spread mode. Modes 1-3 break the
  // bass diagonal-collapse of raw self-correlation (mode 0) into real volume;
  // mode 5 (helix) extrudes the open phase-portrait along a time axis (a coil).
  // All normalised to ~unit extent so they swap without resizing the figure.
  _spreadPoint(w, i, lag, s, flip, N, mode) {
    const a = (w[i] - 128) / 128;
    if (mode === 1) { // SPHERE — two samples drive sphere angles, third the radius
      const th = a * Math.PI * 0.95;
      const ph = ((w[i + lag] - 128) / 128) * Math.PI * 0.95 * flip;
      const r = s * (0.55 + 0.45 * Math.abs((w[i + 2 * lag] - 128) / 128));
      return [r * Math.cos(th) * Math.cos(ph), r * Math.sin(th), r * Math.cos(th) * Math.sin(ph)];
    }
    if (mode === 2) { // TOROID — index sweeps a ring, samples drive the tube
      const u = (i / N) * TWO_PI * 3;
      const rr = 0.30 * s + a * s * 0.34;
      const v = ((w[i + lag] - 128) / 128) * Math.PI * flip;
      const ring = 0.36 * s + rr * Math.cos(v);
      return [ring * Math.cos(u), rr * Math.sin(v), ring * Math.sin(u)];
    }
    if (mode === 3) { // QUAD — a large decorrelating lag opens the diagonal to a loop
      const q = Math.max(1, Math.round(lag * 4)) % N;
      const b = ((w[(i + q) % N] - 128) / 128) * flip;
      const c = (w[(i + lag) % N] - 128) / 128;
      return [a * s, b * s, c * s];
    }
    if (mode === 5) { // HELIX — QUAD's honest self-correlation swept up a winding frame: each point is displaced radially, tangentially AND axially by the honest samples, so QUAD's small irregular wander (小刻みな不規則) rides a vertical coil around the central rod instead of being a sterile geometric spring
      const turns = Math.max(2, Math.round(this.p('density'))); // windings over the strand — live via the Density slider (inert in other LISSA spreads)
      const q = Math.max(1, Math.round(lag * 4)) % N;          // a large decorrelating lag (as in QUAD) → coarse irregular structure
      const g = (w[(i + 5) % N] - 128) / 128;                  // a near-adjacent sample → high-frequency FINE grain (the 小刻み detail)
      const b = ((w[(i + q) % N] - 128) / 128) * flip;         // QUAD decorrelated partner
      const c = (w[(i + lag) % N] - 128) / 128;                // QUAD near partner
      const wnd = (i / N) * TWO_PI * turns;                    // winding angle climbs with the index (the vertical coil)
      const cw = Math.cos(wnd), sw = Math.sin(wnd);
      const radial = 0.50 + 0.48 * a + 0.16 * g;               // honest radius wander (coarse a + fine g) about a mean — can cross the axis like QUAD
      const tang = 0.46 * b + 0.14 * g;                        // honest tangential push → loops bunch / cross irregularly
      const y = ((i / N) - 0.5) * 2.0 + 0.42 * c + 0.06 * g;   // climb + honest axial wander (uneven, organic spacing)
      return [(radial * cw - tang * sw) * s, y * s, (radial * sw + tang * cw) * s];
    }
    // LISSA — raw self-correlation (three delayed copies)
    return [a * s, ((w[i + lag] - 128) / 128) * s * flip, ((w[i + 2 * lag] - 128) / 128) * s];
  }

  draw(ctx, alpha) {
    const wave = this.wave;
    if (!wave || !wave.length) return;
    const mode = this.modeIndex;
    const gain = this.p('gain');
    const range = this.p('range');
    // Width = fixed base + audio-driven growth. React sets how many px full
    // level adds, so the user balances how strongly volume thickens the stroke
    // (0 = constant width, up to a wide reactive swing).
    ctx.lineWidth = this.p('thickness') + this.level * this.p('react');
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.globalCompositeOperation = 'lighter';
    const step = Math.max(1, Math.floor(wave.length / 512));

    if (mode === 0) {
      ctx.strokeStyle = rgbCss(this.palette.colorAt((this.t * 0.1) % 1));
      ctx.beginPath();
      const cy = this.h / 2;
      for (let i = 0, k = 0; i < wave.length; i += step, k++) {
        const x = (i / (wave.length - 1)) * this.w;
        const y = cy + ((wave[i] - 128) / 128) * this.h * 0.4 * gain * range;
        if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    } else if (mode === 1) {
      const cx = this.w / 2, cy = this.h / 2;
      const r0 = Math.min(this.w, this.h) * 0.25 * range;
      ctx.strokeStyle = rgbCss(this.palette.colorAt((this.t * 0.1) % 1));
      ctx.beginPath();
      let first = true;
      const N = Math.floor(wave.length / step);
      for (let i = 0, k = 0; i < wave.length; i += step, k++) {
        const a = (k / N) * TWO_PI;
        const r = r0 + ((wave[i] - 128) / 128) * r0 * 0.9 * gain;
        const x = cx + Math.cos(a) * r;
        const y = cy + Math.sin(a) * r;
        if (first) { ctx.moveTo(x, y); first = false; } else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.stroke();
    } else if (mode === 2) {
      const cx = this.w / 2, cy = this.h / 2;
      // Band breathes the figure; Drive sets how strongly.
      const band = this._driveEnergy();
      const s = Math.min(this.w, this.h) * 0.42 * gain * range * (1 + this.p('drive') * band * 0.9);
      const lag = Math.max(1, Math.round(this._effPhase())) * step;
      const flip = this._effFlip() ? -1 : 1;
      const cosA = Math.cos(this._spin), sinA = Math.sin(this._spin);
      ctx.strokeStyle = rgbCss(this.palette.colorAt((this.t * 0.1) % 1));
      ctx.beginPath();
      let first = true;
      for (let i = 0; i + lag < wave.length; i += step) {
        const px = ((wave[i] - 128) / 128) * s;
        const py = ((wave[i + lag] - 128) / 128) * s * flip;
        const x = cx + px * cosA - py * sinA;
        const y = cy + px * sinA + py * cosA;
        if (first) { ctx.moveTo(x, y); first = false; } else ctx.lineTo(x, y);
      }
      ctx.stroke();
    } else {
      this._drawSphere(ctx, wave, step, gain, range, alpha);
    }
  }

  // Sphere (mode 3): waveform geometry on a unit sphere, rotated by the shared
  // spin and projected to 2D. Depth dims the back so it reads as a volume. The
  // Form sub-toggle picks GLOBE / WRAP / LISSA. Deterministic (no Math.random/Date).
  _drawSphere(ctx, wave, step, gain, range, alpha) {
    const cx = this.w / 2, cy = this.h / 2;
    const R = Math.min(this.w, this.h) * 0.34 * range; // sphere radius, px
    const band = this._driveEnergy();
    const amp = 0.2 * gain * (1 + this.p('drive') * band * 0.9); // radial waveform displacement
    const cosA = Math.cos(this._spin), sinA = Math.sin(this._spin);
    const ct = SPHERE_COS_TILT, st = SPHERE_SIN_TILT;
    const N = wave.length;

    // Rotate a unit-sphere point around Y (spin) then tilt around X, and project
    // orthographically. depth (rotated z, -1..1) drives back-to-front dimming.
    const project = (ux, uy, uz) => {
      const rx = ux * cosA + uz * sinA;
      const rz = -ux * sinA + uz * cosA;
      const ty = uy * ct - rz * st;
      const tz = uy * st + rz * ct;
      return { sx: cx + rx * R, sy: cy - ty * R, depth: tz };
    };
    ctx.strokeStyle = rgbCss(this.palette.colorAt((this.t * 0.1) % 1));
    // Stroke a polyline segment-by-segment so each segment's depth sets its alpha
    // (the back of the sphere fades out). alpha = crossfade base × intensity ×
    // depth factor — intensity dims a faint reference layer under a bright one.
    const strokeSegs = (pts, intensity = 1) => {
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i];
        const d = (a.depth + b.depth) * 0.5;
        ctx.globalAlpha = alpha * intensity * (0.2 + 0.8 * (d * 0.5 + 0.5));
        ctx.beginPath();
        ctx.moveTo(a.sx, a.sy);
        ctx.lineTo(b.sx, b.sy);
        ctx.stroke();
      }
    };
    const form = this.mg('sphere');
    if (form === 0) {
      // GLOBE — stacked latitude rings, each a circular waveform scope.
      const rings = Math.round(this.p('density'));
      const M = 48;
      for (let r = 0; r < rings; r++) {
        const lat = -Math.PI / 2 + Math.PI * ((r + 0.5) / rings);
        const cosLat = Math.cos(lat), sinLat = Math.sin(lat);
        const pts = [];
        for (let m = 0; m <= M; m++) {
          const f = m / M;
          const lon = f * TWO_PI;
          const wi = (Math.floor(f * (N - 1)) + r * 37) % N;
          const rad = 1 + ((wave[wi] - 128) / 128) * amp;
          pts.push(project(cosLat * Math.cos(lon) * rad, sinLat * rad, cosLat * Math.sin(lon) * rad));
        }
        strokeSegs(pts);
      }
    } else if (form === 1) {
      // WRAP — one waveform spiralled pole-to-pole around the sphere.
      const windings = Math.round(this.p('density'));
      const STEPS = 360;
      const pts = [];
      for (let i = 0; i <= STEPS; i++) {
        const f = i / STEPS;
        const lat = -Math.PI / 2 + Math.PI * f;
        const lon = f * windings * TWO_PI;
        const cosLat = Math.cos(lat);
        const wi = Math.floor(f * (N - 1));
        const rad = 1 + ((wave[wi] - 128) / 128) * amp;
        pts.push(project(cosLat * Math.cos(lon) * rad, Math.sin(lat) * rad, cosLat * Math.sin(lon) * rad));
      }
      strokeSegs(pts);
    } else if (form === 3) {
      // TERRAIN — the "Noise Blob": a glowing point-cloud globe whose surface is a
      // Worley cell-wall network (bright walls, dark craters) over an FBM shape.
      // BASS swells it, MID flares the walls, TREBLE shimmers. See _drawSphereTerrain.
      this._drawSphereTerrain(ctx, wave, N, R, band, alpha, project);
    } else {
      // LISSA — XY's self-correlation in 3D, expanding wide and breathing with
      // the drive band. The point mapping has 6 Spread modes (Spread group):
      // LISSA (raw self-correlation), SPHERE, TOROID, QUAD, RIBBON, HELIX —
      // modes 1-3 break the bass diagonal-collapse into real 3D volume; RIBBON
      // gives the self-correlation centreline a twisting foil body; HELIX
      // extrudes the open phase-portrait along a time axis into a coil; Auto
      // walks through them irregularly. The CORE is the SAME figure+spread scaled down to the centre
      // with a tighter lag: a concentrated nucleus sharing the live waveform,
      // rotation, depth and spread — so core + outer read as ONE object. Core
      // slider sets the nucleus scale (0 = off; RIBBON ignores core).
      const reach = gain * (1.15 + this.p('drive') * band * 1.1); // wide, audio-breathing extent
      const lag = Math.max(1, Math.round(this._effPhase())) * step;
      const flip = this._effFlip() ? -1 : 1;
      const spread = this._effSpread();
      if (spread === 4) {
        // RIBBON — the self-correlation centreline given a twisting foil body: a
        // flat band offset ± a width vector that rotates along the strand, so it
        // shows its face (bright) then its edge (thin/dim). Width breathes with
        // the drive band. Mono throughout — only brightness sells the 3D.
        const colorCss = rgbCss(this.palette.colorAt((this.t * 0.1) % 1));
        // z of a direction along the view/depth axis (same rotation as project),
        // |.| = how face-on a ribbon segment is to the viewer.
        const dirDepth = (nx, ny, nz) => { const rz = -nx * sinA + nz * cosA; return ny * st + rz * ct; };
        const count = Math.max(1, Math.round(this.p('count')));
        this._drawRibbon(ctx, wave, step, N, reach, lag, flip, alpha, project, dirDepth, band, colorCss, count);
      } else {
        // HELIX coil XY-VIBRATION (rare accent, HELIX only): the coil SWAYS in a 3:2
        // Lissajous — the XY scope pattern — its x and z displaced by two sines in a
        // 3:2 frequency ratio, with the Lissajous phase travelling along the strand so
        // the column undulates. Swells in then settles over VIBE_LIFE. The central
        // scope spine (_drawHelixScope) is left steady, so the coil sways around it.
        const vibeAge = this.t - this._vibeFireT;
        const vibeEnv = (spread === 5 && vibeAge >= 0 && vibeAge < VIBE_LIFE)
          ? Math.min(1, vibeAge / 0.1) * Math.pow(1 - vibeAge / VIBE_LIFE, 1.4) : 0;
        // Same figure+spread at any scale/lag — core and outer share it.
        const drawFig = (scale, lg, intensity) => {
          const pts = [];
          for (let i = 0; i + 2 * lg < N; i += step) {
            const p = this._spreadPoint(wave, i, lg, scale, flip, N, spread);
            if (vibeEnv > 0) { // sway in a 3:2 Lissajous (patternXY); louder = wider
              const ph = (i / N) * TWO_PI * VIBE_WAVES;                  // phase travels along the coil
              const va = vibeEnv * VIBE_AMP * scale * (0.55 + 0.45 * band);
              p[0] += Math.sin(this.t * VIBE_FREQ * 3 + ph) * va;        // x axis at ×3
              p[2] += Math.sin(this.t * VIBE_FREQ * 2 + ph + 1.3) * va;  // z axis at ×2 → 3:2 figure
            }
            pts.push(project(p[0], p[1], p[2]));
          }
          strokeSegs(pts, intensity);
        };
        const coreR = this.p('core');
        if (spread === 5) {
          // HELIX — the core is a VERTICAL Line-oscilloscope (the raw live
          // waveform as the central spine), not a mini-coil: the irregular coil
          // winds around a readable scope. Core slider = its waveform amplitude.
          if (coreR > 0.005) this._drawHelixScope(ctx, wave, N, step, reach, R, alpha, project);
        } else if (coreR > 0.005) {
          const coreScale = coreR * (1 + this.p('drive') * band * 0.6); // breathe in sync with outer
          const coreLag = Math.max(1, Math.round(lag * 0.4)); // tighter knot = a dense heart
          drawFig(coreScale, coreLag, 0.95);
        }
        drawFig(reach, lag, 1);
        // Rare SPHERE-shell accent — HELIX ONLY (see update()/ACCENT_*).
        if (spread === 5) {
          const shellAge = this.t - this._shellFireT;
          if (shellAge >= 0 && shellAge < SHELL_LIFE) {
            this._drawShellAccent(ctx, wave, N, reach, shellAge, band, alpha, project);
          }
        }
      }
    }
    ctx.globalAlpha = alpha; // restore for anything drawn after
  }

  // HELIX core: a Line-mode oscilloscope stood VERTICAL down the coil's axis —
  // the raw live waveform as the central spine, displaced sideways (screen-x) by
  // each sample, spanning the coil's axial extent (±1.2·reach, the "size" kept
  // from the old rod). The irregular QUAD coil winds around this readable scope.
  // Core slider = the waveform amplitude (0 = off); Thickness = its width. Two
  // passes: a soft halo under a crisp trace. Drawn in screen space so it stays a
  // clean vertical scope as the coil spins (the 3D axis projects to this same
  // vertical line at centre). Mono, additive, deterministic.
  _drawHelixScope(ctx, wave, N, step, reach, R, alpha, project) {
    const top = project(0, 1.2 * reach, 0);
    const bot = project(0, -1.2 * reach, 0);
    const dx = top.sx - bot.sx, dy = top.sy - bot.sy;     // the projected axis (≈ vertical)
    const amp = R * 0.9 * this.p('core');                 // wiggle amplitude (px) — Core adjusts the waveform
    const pts = [];
    for (let i = 0; i < N; i += step) {
      const f = i / (N - 1);
      const d = ((wave[i] - 128) / 128) * amp;
      pts.push([bot.sx + dx * f + d, bot.sy + dy * f]);   // along the axis, displaced sideways by the sample
    }
    const trace = () => { ctx.beginPath(); for (let k = 0; k < pts.length; k++) { const p = pts[k]; if (k) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); } ctx.stroke(); };
    ctx.save();
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    const baseW = Math.max(1, this.p('thickness') * 0.5);
    ctx.lineWidth = baseW + 2.4; ctx.globalAlpha = alpha * 0.10; trace(); // soft halo
    ctx.lineWidth = baseW; ctx.globalAlpha = alpha * 0.8; trace();         // crisp trace
    ctx.restore();
  }

  // Rare SPHERE-shell accent (HELIX only): a waveform sphere that blooms over the
  // HELIX coil on a hit, then fades (see ACCENT_*/SHELL_LIFE + update()). Globe-style
  // latitude rings whose radius is relieved by the live waveform — reads instantly
  // as a sphere and never collapses when quiet (unlike the angle-mapped SPHERE
  // spread, which folds to a dot on a flat wave). It SWELLS outward past the
  // figure (a shockwave shell) and fades over SHELL_LIFE. Faint, additive,
  // depth-dimmed, mono. Shares the figure's spin/tilt via project. Deterministic.
  _drawShellAccent(ctx, wave, N, reach, age, band, alpha, project) {
    const f = age / SHELL_LIFE;                                 // 0..1 over the bloom
    const env = Math.min(1, age / 0.14) * Math.pow(1 - f, 1.5); // fast swell, slow fade
    if (env <= 0.002) return;
    // Halo radius tracks the figure scale (`reach`) so the shell ENCLOSES it on
    // every spread — even the tall HELIX coil — then swells outward past it as the
    // bloom ages (a shockwave shell), with a touch of drive-band breath.
    const baseR = reach * (1.06 + 0.32 * f) * (1 + 0.10 * this.p('drive') * band);
    const amp = 0.13;                                           // waveform relief on the shell
    const rings = 6, M = 60;
    ctx.save();
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(0.75, this.p('thickness') * 0.45);
    for (let r = 0; r < rings; r++) {
      const lat = -Math.PI / 2 + Math.PI * ((r + 0.5) / rings);
      const cosLat = Math.cos(lat), sinLat = Math.sin(lat);
      let prev = null;
      for (let m = 0; m <= M; m++) {
        const g = m / M, lon = g * TWO_PI;
        const wi = (Math.floor(g * (N - 1)) + r * 53) % N;
        const rad = baseR * (1 + ((wave[wi] - 128) / 128) * amp);
        const p = project(cosLat * Math.cos(lon) * rad, sinLat * rad, cosLat * Math.sin(lon) * rad);
        if (prev) {
          const d = (prev.depth + p.depth) * 0.5;
          ctx.globalAlpha = alpha * env * (0.20 + 0.56 * (d * 0.5 + 0.5)); // faint, back dimmer
          ctx.beginPath(); ctx.moveTo(prev.sx, prev.sy); ctx.lineTo(p.sx, p.sy); ctx.stroke();
        }
        prev = p;
      }
    }
    ctx.restore();
  }

  // RIBBON spread (Sphere/LISSA form, spread index 4). Draws `count` on-screen
  // COPIES of the whole figure (Count slider, 1..10) laid out in an adaptive
  // grid — like putting more dancers on the stage. The centreline is the QUAD
  // self-correlation (spread mode 3) — its large decorrelating lag opens the
  // bass diagonal-collapse, so the band stays an OPEN loop at any Phase (raw
  // mode-0 collapses to a smear at small lag). Each copy gets a small twist +
  // lag offset so the troupe feels alive rather than photocopied. Each segment
  // is a flat quad offset ± a unit width vector Wv that twists along the strand;
  // the ribbon normal cross(T,Wv) rotated into view space gives a face-on-ness
  // 0..1 whose SQUARE drives brightness — white only on truly face-on facets,
  // killing the edge-on wash that blows out under additive blending. Overall
  // brightness fades with waveform amplitude (vis) so a quiet, collapsed figure
  // doesn't pile into a white blob. Width swells with the drive band (Thickness
  // sets the rest width); depth dims the back. Deterministic (clock time only).
  _drawRibbon(ctx, wave, step, N, reach, lag, flip, alpha, project, dirDepth, band, colorCss, count) {
    const ntw = 5.0;                       // twist turns over the whole strand
    const stepR = step * 2;                // coarse sample → smooth foil (less tangent jitter)
    const halfW = reach * (0.012 * this.p('thickness') + 0.05 * this.p('drive') * band);
    // The figure extent ∝ waveform amplitude, so a quiet mic collapses it to a
    // few pixels where additive blending piles every segment into a white blob.
    // Fade the whole figure with the signal: quiet → dim & small, loud → open
    // & bright (honest — louder still grows AND brightens it).
    let pk = 0;
    for (let i = 0; i < N; i += stepR * 3) { const dv = wave[i] - 128, ad = dv < 0 ? -dv : dv; if (ad > pk) pk = ad; }
    const vis = Math.min(1, 0.06 + 1.3 * (pk / 128));
    // COUNT = on-screen copies of the whole figure (like more dancers), laid out
    // in an adaptive grid; the last partial row is centred. cx0/cy0 is the shared
    // projection centre — each copy remaps its projected screen coords into a cell.
    const cols = Math.ceil(Math.sqrt(count));
    const rows = Math.ceil(count / cols);
    const cx0 = this.w / 2, cy0 = this.h / 2;
    const sf = count === 1 ? 1 : 0.85 / Math.max(cols, rows);
    ctx.fillStyle = colorCss;
    ctx.strokeStyle = colorCss;
    ctx.lineWidth = 1.1;
    for (let cIdx = 0; cIdx < count; cIdx++) {
      const gy = (cIdx / cols) | 0, gx = cIdx % cols;
      const itemsInRow = gy === rows - 1 ? count - gy * cols : cols;
      const icx = this.w * (gx + 0.5 + (cols - itemsInRow) * 0.5) / cols;
      const icy = this.h * (gy + 0.5) / rows;
      const twPhase = this.t * 0.8 + cIdx * 0.7;        // per-copy facet offset
      // small per-copy lag offset (centred on lag) = a slightly different pose
      const lagC = Math.max(1, Math.round(lag * (1 + 0.12 * (cIdx - (count - 1) * 0.5))));
      if (2 * lagC >= N) continue;
      const C = [];
      for (let i = 0; i + 2 * lagC < N; i += stepR) {
        C.push(this._spreadPoint(wave, i, lagC, reach, flip, N, 3));
      }
      const M = C.length;
      if (M < 2) continue;
      for (let k = 0; k < M - 1; k++) {
        const a = C[k], b = C[k + 1];
        let tx = b[0] - a[0], ty = b[1] - a[1], tz = b[2] - a[2];
        const tl = Math.hypot(tx, ty, tz);
        if (tl < 1e-6) continue;
        tx /= tl; ty /= tl; tz /= tl;
        // reference axis (swap near-parallel) → an in-plane basis (n0, b0) ⟂ T
        let rfx = 0, rfy = 0, rfz = 1;
        if (Math.abs(tz) > 0.9) { rfy = 1; rfz = 0; }
        let n0x = ty * rfz - tz * rfy, n0y = tz * rfx - tx * rfz, n0z = tx * rfy - ty * rfx;
        const nl = Math.hypot(n0x, n0y, n0z) || 1;
        n0x /= nl; n0y /= nl; n0z /= nl;
        const b0x = ty * n0z - tz * n0y, b0y = tz * n0x - tx * n0z, b0z = tx * n0y - ty * n0x;
        // width vector twists around the tangent along the strand
        const phi = (k / (M - 1)) * TWO_PI * ntw + twPhase;
        const cph = Math.cos(phi), sph = Math.sin(phi);
        const wvx = cph * n0x + sph * b0x, wvy = cph * n0y + sph * b0y, wvz = cph * n0z + sph * b0z;
        // ribbon normal = T × Wv; its view-axis component = face-on-ness
        const rnx = ty * wvz - tz * wvy, rny = tz * wvx - tx * wvz, rnz = tx * wvy - ty * wvx;
        const fc = dirDepth(rnx, rny, rnz);
        const face = fc * fc;              // square → white only on truly face-on facets
        const P0 = project(a[0] + wvx * halfW, a[1] + wvy * halfW, a[2] + wvz * halfW);
        const P1 = project(a[0] - wvx * halfW, a[1] - wvy * halfW, a[2] - wvz * halfW);
        const P2 = project(b[0] - wvx * halfW, b[1] - wvy * halfW, b[2] - wvz * halfW);
        const P3 = project(b[0] + wvx * halfW, b[1] + wvy * halfW, b[2] + wvz * halfW);
        // remap each projected point into this copy's grid cell
        const x0 = icx + (P0.sx - cx0) * sf, y0 = icy + (P0.sy - cy0) * sf;
        const x1 = icx + (P1.sx - cx0) * sf, y1 = icy + (P1.sy - cy0) * sf;
        const x2 = icx + (P2.sx - cx0) * sf, y2 = icy + (P2.sy - cy0) * sf;
        const x3 = icx + (P3.sx - cx0) * sf, y3 = icy + (P3.sy - cy0) * sf;
        const d = (P0.depth + P2.depth) * 0.5;
        const depthFac = 0.4 + 0.6 * (d * 0.5 + 0.5); // back of the figure recedes
        // filled foil — faint baseline so overlaps don't wash to white; the body
        // only brightens as its face turns to the viewer
        ctx.globalAlpha = alpha * vis * (0.015 + 0.26 * face) * depthFac;
        ctx.beginPath();
        ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineTo(x3, y3);
        ctx.closePath(); ctx.fill();
        // bright edges trace the two rails of the band
        ctx.globalAlpha = alpha * vis * (0.04 + 0.36 * face) * depthFac;
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x3, y3); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      }
    }
  }

  // Lazily build the Fibonacci point directions (jittered off the spiral so the
  // lattice never shows) + per-point seed + the structural radius/brightness
  // caches, and the half-res offscreen bloom buffer (rebuilt when the canvas
  // resizes). Deterministic — offsets use a fixed integer hash, not Math.random.
  _ensureBlob() {
    if (!this._blobDir) {
      const NB = BLOB_COUNT;
      this._blobDir = new Float32Array(NB * 3);
      this._blobSeed = new Float32Array(NB);
      this._blobRad = new Float32Array(NB);   // cached structural radius (amortised noise)
      this._blobBri = new Float32Array(NB);   // cached structural brightness (pre fade/expo/audio)
      this._blobCursor = 0;                   // round-robin recompute cursor
      this._blobPrimed = false;               // false → first frame recomputes ALL points
      const golden = Math.PI * (3 - Math.sqrt(5));
      const JIT = 0.5 * Math.sqrt(4 * Math.PI / NB); // ~½ point spacing → breaks the spiral lattice but keeps walls tight
      for (let i = 0; i < NB; i++) {
        const y = 1 - (i / (NB - 1)) * 2, r = Math.sqrt(Math.max(0, 1 - y * y)), th = golden * i;
        // jitter each Fibonacci point off the regular spiral so the cloud reads
        // as organic dust, not a visible mesh (deterministic hash, fixed once).
        let vx = Math.cos(th) * r + (_hash01(i, 0, 0, 7) - 0.5) * JIT;
        let vy = y + (_hash01(i, 0, 0, 8) - 0.5) * JIT;
        let vz = Math.sin(th) * r + (_hash01(i, 0, 0, 9) - 0.5) * JIT;
        const inv = 1 / Math.sqrt(vx * vx + vy * vy + vz * vz);
        this._blobDir[i * 3] = vx * inv;
        this._blobDir[i * 3 + 1] = vy * inv;
        this._blobDir[i * 3 + 2] = vz * inv;
        this._blobSeed[i] = _hash01(i, 0, 0, 5);
      }
    }
    if (!this._blobOC || this._blobW !== this.w || this._blobH !== this.h) {
      this._blobOC = document.createElement('canvas');
      this._blobOC.width = Math.max(1, Math.round(this.w * BLOB_SCALE));
      this._blobOC.height = Math.max(1, Math.round(this.h * BLOB_SCALE));
      this._blobOCtx = this._blobOC.getContext('2d');
      this._blobW = this.w; this._blobH = this.h;
    }
  }

  // TERRAIN — the "Noise Blob". A Fibonacci point cloud whose surface is pushed
  // out by FBM + a Worley cell-wall network (F2-F1 → thin bright Voronoi walls,
  // dark craters). Each band is visibly distinct: BASS swells the whole blob,
  // MID flares the cell walls, TREBLE adds a fast grain shimmer. Rendered to an
  // offscreen then composited with a soft additive bloom. Mono, deterministic.
  // (wave/N/band unused — the blob is driven by the honest FFT bands + clock.)
  _drawSphereTerrain(ctx, wave, N, R, band, alpha, project) {
    this._ensureBlob();
    const oc = this._blobOC, octx = this._blobOCtx;
    const S = BLOB_SCALE;                        // offscreen render scale (half-res)
    octx.clearRect(0, 0, oc.width, oc.height);
    octx.globalCompositeOperation = 'lighter';
    octx.fillStyle = '#fff';                     // points drawn white, tinted to palette after

    const driveAmt = this.p('drive'), gain = this.p('gain'), thick = this.p('thickness');
    const dens = Math.max(3, Math.round(this.p('density'))), coreP = this.p('core');
    const eBass = this.bass, eMid = this.mid, eTre = this.treble;
    const loud = Math.max(this.level, eBass, eMid, eTre);
    // Reference params, mapped onto the existing levers so the panel stays usable:
    const noiseScale = 1.2 + dens * 0.10;        // Density → cell count   (≈2.1 @ default 9)
    const displace = 0.26 + gain * 0.30;         // Gain → lumpiness depth (2× authority; ≈0.56 @ default 1)
    const cellEdge = 0.7 * (1 + eMid * 0.7);     // MID → cell-wall flare
    const audioGain = driveAmt * 1.8;            // Drive → audio depth    (≈1.08 @ default 0.6)
    const audioPush = eBass * audioGain;         // BASS → radial swell
    const bloomStr = 0.7 + coreP * 2.2;          // Core → bloom strength  (≈0.96 @ default 0.12)
    const exposure = 1.35 * (1 + 0.25 * loud);   // overall brightness breath
    const pointSize = (1.4 + thick * 0.22) * 0.95; // Thickness → grain size
    const t = this.t * 0.45;                     // continuous breathing-morph flow
    const fast = this.t * 4.0;                   // treble fine-crackle flow
    const tre = eTre;
    const wob = Math.sin(this.t * 0.08) * 0.18;  // gentle anti-turntable nod (around X)
    const cosW = Math.cos(wob), sinW = Math.sin(wob);
    const noise = this._noise, dir = this._blobDir, seedA = this._blobSeed;
    const NB = BLOB_COUNT, szK = R / 300;

    // ── amortised recompute: the FBM + Worley field is the slow "breathing", so
    // refresh only 1/REFRESH of the cloud per frame (all of it on the first
    // frame) and cache structural radius + brightness. The draw below just
    // re-projects (cheap) so spin stays smooth while the surface still evolves.
    // The bass swell is applied live in the draw, so beats still punch instantly.
    const REFRESH = 4;
    const rad = this._blobRad, bri = this._blobBri;
    const chunk = this._blobPrimed ? Math.ceil(NB / REFRESH) : NB;
    let cur = this._blobCursor;
    for (let c = 0; c < chunk; c++) {
      const i = cur; cur = cur + 1 >= NB ? 0 : cur + 1;
      const dx = dir[i * 3], dy = dir[i * 3 + 1], dz = dir[i * 3 + 2];
      const spx = dx * noiseScale, spy = dy * noiseScale, spz = dz * noiseScale;
      // FBM (3 octaves) — the big organic shape, flowing over time
      let f = 0, a = 0.5, nx = spx, ny = spy, nz = spz + t;
      for (let o = 0; o < 3; o++) { f += a * noise.noise3D(nx, ny, nz); nx *= 2; ny *= 2; nz *= 2; a *= 0.5; }
      // Worley cell walls (F2-F1 ≈ 0 on boundaries) → thin bright Voronoi network
      _worley2(spx * 1.45 + t * 0.6, spy * 1.45 + t * 0.6, spz * 1.45 + t * 0.6);
      const wall = 1 - _smoothstep(0, BLOB_EDGEW, _wF2 - _wF1);
      const disp = f * 0.45 + wall * cellEdge * 0.7;          // gentler big-shape → rounder silhouette
      let radius = 1 + displace * disp;
      // TREBLE — fine, fast radial crackle (high-freq), read as a shimmer
      if (tre > 0.001) radius += tre * 0.05 * noise.noise3D(dx * 9 + fast, dy * 9 - fast, dz * 9 + fast * 0.7);
      rad[i] = radius;
      const seed = seedA[i];
      let bb = (0.05 + 1.7 * wall * cellEdge + 0.28 * Math.max(disp, 0)) * (0.8 + 0.6 * seed);
      if (tre > 0.001) { const sp = noise.noise3D(dx * 7 - fast, dy * 7 + fast, dz * 7); bb *= 1 + tre * 0.7 * sp; }
      bri[i] = bb;
    }
    this._blobCursor = cur;
    this._blobPrimed = true;

    // ── per-frame draw: cheap re-projection of every cached point + live swell ──
    const swell = audioPush * 0.14, briBoost = (1 + audioPush * 0.8) * exposure; // swell = bass spatial push (range halved); briBoost keeps the beat-brightness punch
    const preCull = BLOB_CULL / (1.2 * briBoost);             // max fade factor ≈1.2 → skip definite craters before projecting
    for (let i = 0; i < NB; i++) {
      if (bri[i] < preCull) continue;                          // pre-cull dark craters (skip projection entirely)
      const dx = dir[i * 3], dy = dir[i * 3 + 1], dz = dir[i * 3 + 2];
      const radius = rad[i] + swell;
      const px0 = dx * radius, py0 = dy * radius, pz0 = dz * radius;
      // gentle wobble (around X) before the shared spin/tilt projection
      const pr = project(px0, py0 * cosW - pz0 * sinW, py0 * sinW + pz0 * cosW);
      const depthFade = _clampv(0.55 + 0.45 * (radius - 0.8), 0.3, 1.2);
      const viewFade = 0.5 + 0.5 * (pr.depth * 0.5 + 0.5);   // back dims → reads as a globe
      const bright = bri[i] * depthFade * viewFade * briBoost;
      if (bright < BLOB_CULL) continue;                       // cull dim cell interiors
      const szs = pointSize * (0.7 + 0.6 * seedA[i]) * szK * S; // point half-size in half-res space
      octx.globalAlpha = bright < 2 ? bright * 0.20 : 0.40;    // faint solid squares; overlap builds the glow
      // fillRect (not drawImage) — ~2× the throughput; the half-res upscale + the
      // bloom blur soften the squares back into soft dusty grains.
      octx.fillRect(pr.sx * S - szs, pr.sy * S - szs, szs * 2, szs * 2);
    }
    octx.globalAlpha = 1;
    // tint the white blob to the palette's brightest colour (ramp[0]: white in
    // MONO). A FIXED phase, not the cycling colorAt the line forms use — that
    // ramp dips through mid-greys and would dim/flicker the whole volume.
    octx.globalCompositeOperation = 'source-atop';
    octx.fillStyle = rgbCss(this.palette.colorAt(0));
    octx.fillRect(0, 0, oc.width, oc.height);
    octx.globalCompositeOperation = 'source-over';
    // composite the half-res buffer onto the main canvas, upscaled (the upscale
    // softens the grain), with two blurred copies under a crisp one = bloom halo.
    const bBig = Math.max(1, Math.round(R * 0.042 * bloomStr));   // tightened halo (was 0.052) → crisper silhouette, less fog
    const bMid = Math.max(1, Math.round(R * 0.015 * bloomStr));
    const W = this.w, H = this.h;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = alpha * 0.50; ctx.filter = `blur(${bBig}px)`; ctx.drawImage(oc, 0, 0, W, H);
    ctx.globalAlpha = alpha * 0.65; ctx.filter = `blur(${bMid}px)`; ctx.drawImage(oc, 0, 0, W, H);
    ctx.filter = 'none'; ctx.globalAlpha = alpha; ctx.drawImage(oc, 0, 0, W, H);
    ctx.restore();
  }
}
