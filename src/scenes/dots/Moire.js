import { Scene } from '../Scene.js';
import { TWO_PI } from '../../lib/math.js';

// Two overlapping dot grids; one rotates or shifts over time and with bass,
// producing shimmering interference patterns.
export class Moire extends Scene {
  constructor() {
    super('moire', 'Moiré');
    this.trail = 1;
    this.modes = [{ name: 'Rotate' }, { name: 'Shift' }];
    this.defineParam('spacing', 22, 16, 44, 1, 'Spacing');
    this.t = 0; this.bass = 0; this.level = 0;
  }
  update(dt, audio, palette, clock) {
    this.t = clock.time; this.bass = audio.bass; this.level = audio.level;
  }
  draw(ctx, alpha) {
    // Larger spacing under load = fewer dots (adaptive quality).
    const sp = Math.max(8, this.p('spacing') / this.clock.quality);
    const cx = this.w / 2, cy = this.h / 2;
    const c1 = this.palette.cssAt(0.2);
    const c2 = this.palette.cssAt(0.72);
    const rad = sp * 0.17 * (1 + this.bass * 0.6);
    ctx.globalCompositeOperation = 'lighter';
    this._grid(ctx, sp, 0, 0, c1, rad);
    if (this.modeIndex === 0) {
      const ang = Math.sin(this.t * 0.2) * 0.1 + this.bass * 0.14 + this.t * 0.02;
      ctx.save();
      ctx.translate(cx, cy); ctx.rotate(ang); ctx.translate(-cx, -cy);
      this._grid(ctx, sp, 0, 0, c2, rad);
      ctx.restore();
    } else {
      const off = Math.sin(this.t * 0.6) * sp * 0.5 + this.bass * sp;
      this._grid(ctx, sp, off, off * 0.45, c2, rad);
    }
  }
  _grid(ctx, sp, ox, oy, colStr, rad) {
    ctx.fillStyle = colStr;
    const cols = Math.ceil(this.w / sp) + 2;
    const rows = Math.ceil(this.h / sp) + 2;
    for (let r = 0; r < rows; r++) {
      const y = (r * sp + oy) % (this.h + sp) - sp;
      for (let c = 0; c < cols; c++) {
        const x = (c * sp + ox) % (this.w + sp) - sp;
        ctx.beginPath();
        ctx.arc(x, y, rad, 0, TWO_PI);
        ctx.fill();
      }
    }
  }
}
