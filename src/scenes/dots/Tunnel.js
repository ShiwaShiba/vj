import { Scene } from '../Scene.js';
import { TWO_PI, wrap01 } from '../../lib/math.js';

// Concentric rings of dots accelerating outward like a tunnel/vortex.
// Scroll speed surges with level; rotation twists with bass.
export class Tunnel extends Scene {
  constructor() {
    super('tunnel', 'Tunnel');
    this.trail = 0.3;
    this.modes = [{ name: 'Spiral' }, { name: 'Rings' }];
    this.defineParam('rings', 26, 12, 44, 1, 'Rings');
    this.defineParam('dots', 28, 10, 60, 1, 'Dots/Ring');
    this.t = 0; this.level = 0; this.bass = 0; this.beat = 0;
  }
  update(dt, audio, palette, clock) {
    this.t += dt * (0.3 + audio.level * 1.1 + audio.beatHold * 0.6);
    this.bass = audio.bass; this.beat = audio.beatHold; this.level = audio.level;
  }
  draw(ctx, alpha) {
    const cx = this.w / 2, cy = this.h / 2;
    const maxR = Math.hypot(this.w, this.h) * 0.55;
    const q = this.clock.quality;
    const rings = Math.max(6, Math.round(this.p('rings') * q));
    const dots = Math.max(4, Math.round(this.p('dots') * q));
    const spiral = this.modeIndex === 0;
    ctx.globalCompositeOperation = 'lighter';
    for (let k = 0; k < rings; k++) {
      const depth = wrap01(k / rings + this.t * 0.25);
      const radius = depth * depth * maxR;
      if (radius < 2) continue;
      const size = (0.5 + depth * 3.4) * (0.7 + this.bass * 1.4);
      const rot = this.t * 0.6 + (spiral ? depth * 4 : 0) + this.bass * 0.8;
      ctx.fillStyle = this.palette.cssAt(wrap01(depth + this.t * 0.05), Math.min(1, 0.2 + depth));
      for (let j = 0; j < dots; j++) {
        const a = (j / dots) * TWO_PI + rot;
        const x = cx + Math.cos(a) * radius;
        const y = cy + Math.sin(a) * radius;
        ctx.beginPath();
        ctx.arc(x, y, size, 0, TWO_PI);
        ctx.fill();
      }
    }
  }
}
