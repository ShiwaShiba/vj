import { Scene } from '../Scene.js';
import { rgbCss, TWO_PI } from '../../lib/math.js';

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
    this.defineParam('density', 9, 3, 24, 1, 'Density');      // Sphere only: GLOBE ring count / WRAP winding count
    this.defineParam('core', 0.12, 0, 0.45, 0.01, 'Core');    // LISSA only: central nucleus-sphere radius (0 = off)
    // Button groups (rendered by ControlPanel; mainly meaningful in XY/Sphere).
    // Spin OFF freezes the figure/sphere instantly regardless of the Rotate slider.
    this.modeGroups = [
      { key: 'drive', label: 'Drive', options: ['BASS', 'TREBLE', 'LEVEL'], index: 0 },
      { key: 'flip', label: 'Flip', options: ['OFF', 'ON'], index: 0 },
      { key: 'spin', label: 'Spin', options: ['OFF', 'ON'], index: 1 },
      { key: 'sphere', label: 'Form', options: ['GLOBE', 'WRAP', 'LISSA'], index: 0 },
      { key: 'auto', label: 'Auto', options: ['OFF', 'ON'], index: 0 },
    ];
    this._spin = 0; // accumulated rotation, radians
  }

  update(dt, audio, palette, clock) {
    this.wave = audio.waveform;
    this.level = audio.level;
    this.bass = audio.bass;
    this.treble = audio.treble;
    this.t = clock.time;
    this.beats = clock.beats;

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
    // Compact wireframe nucleus sphere of the given radius (unit fraction),
    // drawn at the centre as the LISSA core. It's ALIVE, not a frozen prop: a
    // steady self-spin independent of the Rotate slider, a breathe that pulses
    // its size with level (plus a faint idle pulse so it moves even in silence),
    // and a waveform ripple that shimmers across its surface. Latitude rings +
    // meridians; depth dimming makes the little ball read as solid. Deterministic
    // (self-spin/idle pulse from clock time — no Math.random/Date).
    const coreSphere = (radius, intensity) => {
      const M = 36, latRings = 4, meridians = 6, P = 26;
      const cs = this.t * 0.28 * TWO_PI;          // ~0.28 rev/s steady self-spin
      const cc = Math.cos(cs), sc = Math.sin(cs);
      const pulse = radius * (1 + 0.45 * this.level + 0.05 * Math.sin(this.t * 1.7)); // breathe
      // local Y-spin (core's own rotation) then the shared scene projection
      const spun = (ux, uy, uz) => project(ux * cc + uz * sc, uy, -ux * sc + uz * cc);
      for (let r = 1; r <= latRings; r++) {
        const lat = -Math.PI / 2 + Math.PI * (r / (latRings + 1));
        const cosLat = Math.cos(lat), sinLat = Math.sin(lat);
        const pts = [];
        for (let m = 0; m <= M; m++) {
          const f = m / M, lon = f * TWO_PI;
          const wi = (Math.floor(f * (N - 1)) + r * 53) % N;
          const rr = pulse * (1 + ((wave[wi] - 128) / 128) * 0.10); // surface ripple
          pts.push(spun(cosLat * Math.cos(lon) * rr, sinLat * rr, cosLat * Math.sin(lon) * rr));
        }
        strokeSegs(pts, intensity);
      }
      for (let k = 0; k < meridians; k++) {
        const lon = (k / meridians) * TWO_PI;
        const pts = [];
        for (let j = 0; j <= P; j++) {
          const f = j / P, lat = -Math.PI / 2 + Math.PI * f;
          const cosLat = Math.cos(lat);
          const wi = (Math.floor(f * (N - 1)) + k * 71) % N;
          const rr = pulse * (1 + ((wave[wi] - 128) / 128) * 0.10);
          pts.push(spun(cosLat * Math.cos(lon) * rr, Math.sin(lat) * rr, cosLat * Math.sin(lon) * rr));
        }
        strokeSegs(pts, intensity);
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
    } else {
      // LISSA — a small nucleus sphere at the CENTRE is the core (size set by the
      // Core slider, 0 = off), with XY's self-correlation expanding AROUND it in
      // 3D (three delayed waveform copies). The effect reaches well past the core
      // and breathes with the drive band, so its range is wide.
      const coreR = this.p('core');
      if (coreR > 0.005) coreSphere(coreR, 0.7);
      const reach = gain * (1.15 + this.p('drive') * band * 1.1); // wide, audio-breathing extent
      const lag = Math.max(1, Math.round(this._effPhase())) * step;
      const flip = this._effFlip() ? -1 : 1;
      const pts = [];
      for (let i = 0; i + 2 * lag < N; i += step) {
        const ux = ((wave[i] - 128) / 128) * reach;
        const uy = ((wave[i + lag] - 128) / 128) * reach * flip;
        const uz = ((wave[i + 2 * lag] - 128) / 128) * reach;
        pts.push(project(ux, uy, uz));
      }
      strokeSegs(pts);
    }
    ctx.globalAlpha = alpha; // restore for anything drawn after
  }
}
