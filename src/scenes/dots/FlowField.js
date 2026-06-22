import { Scene } from '../Scene.js';
import { TWO_PI, wrap01 } from '../../lib/math.js';
import { SimplexNoise } from '../../lib/noise.js';

// Particles drift through an evolving simplex-noise flow field. Trails make it
// liquid. Bass widens the field's influence; speed rises with level.
export class FlowField extends Scene {
  constructor() {
    super('flowField', 'Flow Field');
    this.trail = 0.12; // strong trails for silky streaks
    this.modes = [{ name: 'Streams' }, { name: 'Swarm' }];
    this.defineParam('count', 1400, 300, 2600, 100, 'Particles');
    this.defineParam('scale', 0.0024, 0.0008, 0.006, 0.0002, 'Field Scale');
    this.noise = new SimplexNoise(7);
    this.px = null; this.py = null;
    this.t = 0; this.level = 0; this.bass = 0; this.treble = 0;
  }
  init(ctx, w, h) { super.init(ctx, w, h); this._spawn(); }
  onResize(w, h) { super.onResize(w, h); this._spawn(); }
  _spawn() {
    const n = 2600;
    this.px = new Float32Array(n);
    this.py = new Float32Array(n);
    for (let i = 0; i < n; i++) { this.px[i] = Math.random() * this.w; this.py[i] = Math.random() * this.h; }
  }
  update(dt, audio, palette, clock) {
    this.t = clock.time;
    this.level = audio.level; this.bass = audio.bass; this.treble = audio.treble;
    const n = Math.max(300, Math.round(this.p('count') * clock.quality));
    this.n = n;
    const sc = this.p('scale');
    const speed = (0.8 + this.level * 4 + this.bass * 3) * (this.modeIndex ? 1.6 : 1) * 60 * dt;
    const zt = this.t * 0.12;
    for (let i = 0; i < n; i++) {
      const ang = this.noise.noise3D(this.px[i] * sc, this.py[i] * sc, zt) * TWO_PI * 2;
      this.px[i] += Math.cos(ang) * speed;
      this.py[i] += Math.sin(ang) * speed;
      // wrap around edges
      if (this.px[i] < 0) this.px[i] += this.w; else if (this.px[i] >= this.w) this.px[i] -= this.w;
      if (this.py[i] < 0) this.py[i] += this.h; else if (this.py[i] >= this.h) this.py[i] -= this.h;
    }
  }
  draw(ctx, alpha) {
    const n = this.n || 0;
    const rad = 1.1 + this.bass * 2.4;
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < n; i++) {
      const t = wrap01(i / n + this.t * 0.03);
      ctx.fillStyle = this.palette.cssAt(t);
      ctx.beginPath();
      ctx.arc(this.px[i], this.py[i], rad, 0, TWO_PI);
      ctx.fill();
    }
  }
}
