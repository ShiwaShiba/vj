import { Scene } from '../Scene.js';
import { TWO_PI } from '../../lib/math.js';

// A pooled particle system. Beats spawn bursts; a continuous trickle keeps it
// alive. Bass swells particle size, level raises emission, treble adds sparkle.
export class ParticleField extends Scene {
  constructor() {
    super('particles', 'Particles');
    this.trail = 0.18;
    this.modes = [{ name: 'Burst' }, { name: 'Fountain' }];
    this.defineParam('gravity', 60, -200, 320, 10, 'Gravity');
    this.defineParam('emission', 1, 0.2, 3, 0.1, 'Emission');
    this.max = 1500;
    this.x = new Float32Array(this.max);
    this.y = new Float32Array(this.max);
    this.vx = new Float32Array(this.max);
    this.vy = new Float32Array(this.max);
    this.life = new Float32Array(this.max);
    this.seed = new Float32Array(this.max);
    this.cursor = 0;
    this._emitAcc = 0;
  }
  _spawn(n, cx, cy, baseSpeed, biasY) {
    for (let k = 0; k < n; k++) {
      const i = this.cursor; this.cursor = (this.cursor + 1) % this.max;
      const a = Math.random() * TWO_PI;
      const sp = baseSpeed * (0.4 + Math.random());
      this.vx[i] = Math.cos(a) * sp;
      this.vy[i] = Math.sin(a) * sp - biasY;
      this.x[i] = cx; this.y[i] = cy;
      this.life[i] = 1;
      this.seed[i] = Math.random();
    }
  }
  update(dt, audio, palette, clock) {
    this.bass = audio.bass;
    const fountain = this.modeIndex === 1;
    const cx = this.w / 2;
    const cy = fountain ? this.h * 0.92 : this.h / 2;
    if (audio.beat) {
      this._spawn(Math.round(40 + audio.bass * 160), cx, cy, fountain ? 320 : 260, fountain ? 360 : 0);
    }
    this._emitAcc += dt * (16 + audio.level * 140) * this.p('emission');
    while (this._emitAcc >= 1) {
      this._emitAcc -= 1;
      this._spawn(1, cx, cy, fountain ? 280 : 180, fountain ? 320 : 0);
    }
    const g = this.p('gravity');
    const drag = Math.pow(0.86, dt * 60);
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      this.x[i] += this.vx[i] * dt;
      this.y[i] += this.vy[i] * dt;
      this.vy[i] += g * dt;
      this.vx[i] *= drag; this.vy[i] *= drag;
      this.life[i] -= dt * 0.6;
    }
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
