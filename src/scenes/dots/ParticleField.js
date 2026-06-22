import { Scene } from '../Scene.js';
import { TWO_PI } from '../../lib/math.js';

// A pooled particle system. Beats spawn bursts; a continuous trickle keeps it
// alive. Bass swells particle size, level raises emission, treble adds sparkle.
// RANGE widens the whole effect from a tight central cluster out to full-bleed;
// the Field mode fills the screen with a drifting, audio-reactive haze.
export class ParticleField extends Scene {
  constructor() {
    super('particles', 'Particles');
    this.trail = 0.18;
    this.modes = [{ name: 'Burst' }, { name: 'Fountain' }, { name: 'Field' }];
    this.defineParam('range', 1.3, 0.3, 3, 0.1, 'Range');
    this.defineParam('gravity', 40, -200, 320, 10, 'Gravity');
    this.defineParam('emission', 1, 0.2, 3, 0.1, 'Emission');
    this.max = 2000;
    this.x = new Float32Array(this.max);
    this.y = new Float32Array(this.max);
    this.vx = new Float32Array(this.max);
    this.vy = new Float32Array(this.max);
    this.life = new Float32Array(this.max);
    this.seed = new Float32Array(this.max);
    this.cursor = 0;
    this._emitAcc = 0;
    this._alive = 0;
  }
  // Launch n particles from (cx,cy) outward. originR scatters the start point so
  // it isn't a single pixel; baseSpeed is px/s (already screen/range scaled).
  _spawn(n, cx, cy, baseSpeed, biasY, originR) {
    for (let k = 0; k < n; k++) {
      const i = this.cursor; this.cursor = (this.cursor + 1) % this.max;
      const a = Math.random() * TWO_PI;
      const sp = baseSpeed * (0.4 + Math.random());
      this.vx[i] = Math.cos(a) * sp;
      this.vy[i] = Math.sin(a) * sp - biasY;
      const oa = Math.random() * TWO_PI, orr = Math.random() * originR;
      this.x[i] = cx + Math.cos(oa) * orr;
      this.y[i] = cy + Math.sin(oa) * orr;
      this.life[i] = 1;
      this.seed[i] = Math.random();
    }
  }
  // Seed one particle anywhere on screen for the ambient Field mode.
  _spawnField(spreadX, spreadY, drift) {
    const i = this.cursor; this.cursor = (this.cursor + 1) % this.max;
    this.x[i] = this.w / 2 + (Math.random() - 0.5) * spreadX;
    this.y[i] = this.h / 2 + (Math.random() - 0.5) * spreadY;
    const a = Math.random() * TWO_PI;
    const sp = drift * (0.3 + Math.random());
    this.vx[i] = Math.cos(a) * sp;
    this.vy[i] = Math.sin(a) * sp;
    this.life[i] = 0.6 + Math.random() * 0.4;
    this.seed[i] = Math.random();
  }
  update(dt, audio, palette, clock) {
    this.bass = audio.bass;
    const range = this.p('range');
    const S = Math.min(this.w, this.h);
    const q = clock.quality || 1;
    const cx = this.w / 2;
    const mode = this.modeIndex;            // 0 Burst, 1 Fountain, 2 Field
    if (mode === 2) {
      // Ambient: keep a steady, screen-filling population topped up each frame.
      const spreadX = this.w * Math.min(1, range), spreadY = this.h * Math.min(1, range);
      const drift = S * 0.05 * (0.6 + range);
      const target = Math.min(this.max, Math.round(1000 * Math.min(1.5, range) * q));
      this._emitAcc += dt * (90 + audio.level * 320) * this.p('emission');
      let guard = this.max;
      while (this._emitAcc >= 1 && this._alive < target && guard-- > 0) {
        this._emitAcc -= 1; this._spawnField(spreadX, spreadY, drift); this._alive++;
      }
      if (this._emitAcc > 4) this._emitAcc = 4;
    } else {
      const fountain = mode === 1;
      const cy = fountain ? this.h * 0.92 : this.h / 2;
      const burst = S * (fountain ? 1.05 : 0.85) * range;
      const trickle = S * (fountain ? 0.85 : 0.5) * range;
      const originR = S * 0.12 * range;
      if (audio.beat) {
        this._spawn(Math.round(40 + audio.bass * 160), cx, cy, burst, fountain ? burst * 0.9 : 0, originR);
      }
      this._emitAcc += dt * (16 + audio.level * 140) * this.p('emission');
      while (this._emitAcc >= 1) {
        this._emitAcc -= 1; this._spawn(1, cx, cy, trickle, fountain ? trickle * 1.1 : 0, originR);
      }
    }
    // Physics. Lighter drag + longer life (both scaled by range) let particles
    // travel far enough to fill the screen instead of dying in a central puff.
    const g = mode === 2 ? this.p('gravity') * 0.1 : this.p('gravity');
    const drag = Math.pow(mode === 2 ? 0.9 : 0.95, dt * 60);
    const decay = (mode === 2 ? 0.3 : 0.5) / Math.max(0.6, Math.min(1.7, range));
    let alive = 0;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      this.x[i] += this.vx[i] * dt;
      this.y[i] += this.vy[i] * dt;
      this.vy[i] += g * dt;
      this.vx[i] *= drag; this.vy[i] *= drag;
      this.life[i] -= dt * decay;
      if (this.life[i] > 0) alive++;
    }
    this._alive = alive;
  }
  draw(ctx, alpha) {
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < this.max; i++) {
      const lf = this.life[i];
      if (lf <= 0) continue;
      const rad = (0.8 + this.seed[i] * 2.4) * (0.7 + this.bass * 1.6) * (0.4 + lf * 0.8);
      ctx.fillStyle = this.palette.cssAt(this.seed[i], Math.min(1, lf));
      ctx.beginPath();
      ctx.arc(this.x[i], this.y[i], rad, 0, TWO_PI);
      ctx.fill();
    }
  }
}
