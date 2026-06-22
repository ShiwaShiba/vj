import { Scene } from '../Scene.js';
import { TWO_PI } from '../../lib/math.js';

// Dots tracing Lissajous / spirograph curves. Frequencies wobble with mids;
// dot size sparkles with treble and beats.
export class Lissajous extends Scene {
  constructor() {
    super('lissajous', 'Lissajous');
    this.trail = 0.22; // gentle trails
    this.modes = [{ name: 'Classic' }, { name: 'Spiro' }];
    this.defineParam('count', 280, 80, 700, 10, 'Dots');
    this.defineParam('a', 3, 1, 9, 1, 'Freq A');
    this.defineParam('b', 4, 1, 9, 1, 'Freq B');
    this.t = 0; this.level = 0; this.mid = 0; this.treble = 0; this.beat = 0;
  }
  update(dt, audio, palette, clock) {
    this.t = clock.time;
    this.level = audio.level; this.mid = audio.mid;
    this.treble = audio.treble; this.beat = audio.beatHold;
  }
  draw(ctx, alpha) {
    const n = Math.max(40, Math.round(this.p('count') * this.clock.quality));
    const cx = this.w / 2, cy = this.h / 2;
    const R = Math.min(this.w, this.h) * 0.42 * (0.7 + this.level * 0.5);
    const a = this.p('a') + (this.modeIndex ? this.mid * 2 : 0);
    const b = this.p('b');
    const delta = this.t * 0.4;
    const loops = this.modeIndex ? 3 : 1;
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < n; i++) {
      const u = (i / n) * TWO_PI * loops;
      const x = cx + Math.sin(a * u + delta) * R;
      const y = cy + Math.sin(b * u) * R;
      const rad = 1.4 + this.treble * 4 + this.beat * 3;
      ctx.fillStyle = this.palette.cssAt((i / n + this.t * 0.05) % 1);
      ctx.beginPath();
      ctx.arc(x, y, rad, 0, TWO_PI);
      ctx.fill();
    }
  }
}
