import { Scene } from '../Scene.js';
import { TWO_PI } from '../../lib/math.js';

// A grid of dots displaced by sine waves. Modes: vertical wave, radial ripple,
// and a swirling twist. Dot size pulses with bass and beats.
export class SineGrid extends Scene {
  constructor() {
    super('sineGrid', 'Sine Grid');
    this.trail = 1;
    this.modes = [{ name: 'Wave' }, { name: 'Ripple' }, { name: 'Twist' }];
    this.defineParam('density', 30, 12, 56, 1, 'Density');
    this.defineParam('speed', 1.4, 0.2, 4, 0.1, 'Speed');
    this.cols = 0; this.rows = 0; this.sp = 0; this.ox = 0; this.oy = 0;
    this.t = 0; this.level = 0; this.bass = 0; this.treble = 0;
  }
  init(ctx, w, h) { super.init(ctx, w, h); this._layout(); }
  onResize(w, h) { super.onResize(w, h); this._layout(); }
  _layout() {
    const cols = Math.round(this.p('density'));
    this.cols = cols;
    this.sp = this.w / cols;
    this.rows = Math.ceil(this.h / this.sp) + 1;
    this.ox = this.sp * 0.5;
    this.oy = (this.h - (this.rows - 1) * this.sp) * 0.5;
  }
  update(dt, audio, palette, clock) {
    if (Math.round(this.p('density')) !== this.cols) this._layout();
    this.t = clock.time;
    this.level = audio.level; this.bass = audio.bass; this.treble = audio.treble;
  }
  draw(ctx, alpha) {
    const { cols, rows, sp } = this;
    const cx = this.w / 2, cy = this.h / 2;
    const tt = this.t * this.p('speed');
    const mode = this.modeIndex;
    const baseR = sp * 0.16;
    const beat = this.audio ? this.audio.beatHold : 0;
    const step = Math.max(1, Math.round(2 - this.clock.quality)); // thin out under load
    for (let r = 0; r < rows; r += step) {
      for (let c = 0; c < cols; c += step) {
        let x = this.ox + c * sp;
        let y = this.oy + r * sp;
        let wave;
        if (mode === 0) {
          wave = Math.sin(c * 0.5 + tt * 2 + r * 0.3);
          y += wave * sp * 0.45 * (0.5 + this.level);
        } else if (mode === 1) {
          const dx = x - cx, dy = y - cy;
          const d = Math.sqrt(dx * dx + dy * dy);
          wave = Math.sin(d * 0.03 - tt * 3);
          const k = 1 + wave * 0.18 * (0.5 + this.bass);
          x = cx + dx * k; y = cy + dy * k;
        } else {
          const dx = x - cx, dy = y - cy;
          const d = Math.sqrt(dx * dx + dy * dy);
          const ang = Math.atan2(dy, dx) + Math.sin(d * 0.01 - tt) * 0.6 * (0.4 + this.bass);
          x = cx + Math.cos(ang) * d; y = cy + Math.sin(ang) * d;
          wave = Math.sin(d * 0.02 - tt * 2);
        }
        const tcol = (c / cols + r / rows) * 0.5;
        const rad = baseR * (0.55 + (wave * 0.5 + 0.5) * 0.9 + this.bass * 0.8 + beat * 0.5);
        ctx.fillStyle = this.palette.cssAt((tcol + this.treble * 0.2) % 1);
        ctx.beginPath();
        ctx.arc(x, y, Math.max(0.5, rad), 0, TWO_PI);
        ctx.fill();
      }
    }
  }
}
