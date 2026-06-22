import { Scene } from '../Scene.js';
import { TWO_PI } from '../../lib/math.js';

// Orbiting blobs mirrored around N-fold radial symmetry. Classic hypnotic VJ
// mandala. Beats kick the blobs outward; rotation drifts with time.
export class Kaleidoscope extends Scene {
  constructor() {
    super('kaleido', 'Kaleidoscope');
    this.trail = 0.22;
    this.modes = [{ name: '6-fold' }, { name: '8-fold' }, { name: '12-fold' }];
    this.segCounts = [6, 8, 12];
    this.defineParam('blobs', 12, 4, 26, 1, 'Shapes');
    this.defineParam('range', 1, 0.4, 2.2, 0.1, 'Range');
    this.t = 0; this.level = 0; this.bass = 0; this.treble = 0; this.beat = 0;
  }
  update(dt, audio, palette, clock) {
    this.t = clock.time;
    this.level = audio.level; this.bass = audio.bass;
    this.treble = audio.treble; this.beat = audio.beatHold;
  }
  draw(ctx, alpha) {
    const cx = this.w / 2, cy = this.h / 2;
    const seg = this.segCounts[this.modeIndex];
    const step = TWO_PI / seg;
    const reach = Math.min(this.w, this.h) * 0.5 * this.p('range');
    const nb = Math.max(3, Math.round(this.p('blobs') * this.clock.quality));
    ctx.globalCompositeOperation = 'lighter';
    for (let s = 0; s < seg; s++) {
      for (let mir = 0; mir < 2; mir++) {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(s * step);
        if (mir) ctx.scale(1, -1);
        for (let i = 0; i < nb; i++) {
          const f = i / nb;
          const r = (0.1 + f * 0.9) * reach * (0.7 + this.bass * 0.5 + this.beat * 0.3);
          const a = Math.sin(this.t * (0.5 + f) + i) * 0.5 + f * 0.6;
          const x = Math.cos(a) * r;
          const y = Math.sin(a * 1.3 + this.t * 0.3) * r * 0.4;
          const rad = (3 + f * 10) * (0.6 + this.level * 0.9 + this.treble * 0.6);
          ctx.fillStyle = this.palette.cssAt((f + this.t * 0.06) % 1, 0.85);
          ctx.beginPath();
          ctx.arc(x, y, rad, 0, TWO_PI);
          ctx.fill();
        }
        ctx.restore();
      }
    }
  }
}
