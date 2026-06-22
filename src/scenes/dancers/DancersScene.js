import { Scene } from '../Scene.js';
import { CONFIG } from '../../config.js';
import { DancerRig } from './DancerRig.js';
import { MOVES } from './moves.js';
import { wrap01, TWO_PI } from '../../lib/math.js';

// The headline scene: N pictogram dancers, beat-synced, with per-dancer phase
// offsets that ripple a "wave" across the row. Modes select the dance move;
// mode 0 is Auto (cycles moves every few bars). Big bass hits spray confetti.
export class DancersScene extends Scene {
  constructor() {
    super('dancers', 'Dancers');
    this.trail = 0.9; // a whisper of motion blur, still crisp
    this.modes = [{ name: 'Auto' }, ...MOVES.map((m) => ({ name: m.name }))];
    this.defineParam('count', CONFIG.DANCER_COUNT, 3, CONFIG.DANCER_MAX, 1, 'Dancers');
    this.defineParam('spread', 1, 0, 2.5, 0.1, 'Wave');
    this.rigs = [];
    this._autoIdx = 0;
    this._autoBeat = 0;
    // confetti pool
    this.cmax = 240;
    this.cx = new Float32Array(this.cmax);
    this.cy = new Float32Array(this.cmax);
    this.cvx = new Float32Array(this.cmax);
    this.cvy = new Float32Array(this.cmax);
    this.cl = new Float32Array(this.cmax);
    this.cs = new Float32Array(this.cmax);
    this.cc = 0;
  }

  init(ctx, w, h) { super.init(ctx, w, h); this._build(); }
  onResize(w, h) { super.onResize(w, h); this._build(); }

  _build() {
    const count = Math.round(this.p('count'));
    const gap = this.w / (count + 1);
    const groundY = this.h * 0.82;
    const H = Math.min(this.h * 0.6, gap * 1.9);
    this.rigs = [];
    for (let i = 0; i < count; i++) {
      const rig = new DancerRig(gap * (i + 1), groundY, H);
      rig.setMove(this._currentMove());
      rig.mix = 1;
      this.rigs.push(rig);
    }
  }

  _currentMove() {
    return this.modeIndex === 0 ? MOVES[this._autoIdx] : MOVES[this.modeIndex - 1];
  }

  setMode(i) {
    super.setMode(i);
    const mv = this._currentMove();
    this.rigs.forEach((r) => r.setMove(mv));
  }

  _spawnConfetti(n, x, y) {
    for (let k = 0; k < n; k++) {
      const i = this.cc; this.cc = (this.cc + 1) % this.cmax;
      const a = Math.random() * TWO_PI;
      const sp = 120 + Math.random() * 320;
      this.cx[i] = x; this.cy[i] = y;
      this.cvx[i] = Math.cos(a) * sp;
      this.cvy[i] = Math.sin(a) * sp - 120;
      this.cl[i] = 1; this.cs[i] = Math.random();
    }
  }

  update(dt, audio, palette, clock) {
    const count = Math.round(this.p('count'));
    if (count !== this.rigs.length) this._build();

    // Auto-cycle moves.
    if (this.modeIndex === 0 && clock.beats - this._autoBeat >= 8) {
      this._autoBeat = clock.beats;
      this._autoIdx = (this._autoIdx + 1) % MOVES.length;
      const mv = MOVES[this._autoIdx];
      this.rigs.forEach((r) => r.setMove(mv));
    }

    const energy = 0.7 + audio.level * 0.7 + audio.beatHold * 0.5;
    const spread = this.p('spread');
    for (let i = 0; i < this.rigs.length; i++) {
      const ph = wrap01(clock.beatPhase + i * 0.1 * spread);
      this.rigs[i].update(dt, ph, energy, audio.beatHold);
    }

    // Confetti on strong bass beats.
    if (audio.beat && audio.bass > 0.45) {
      const r = this.rigs[Math.floor(Math.random() * this.rigs.length)] || { x: this.w / 2, groundY: this.h / 2 };
      this._spawnConfetti(Math.round(18 + audio.bass * 40), r.x, r.groundY - this.h * 0.35);
    }
    const drag = Math.pow(0.9, dt * 60);
    for (let i = 0; i < this.cmax; i++) {
      if (this.cl[i] <= 0) continue;
      this.cx[i] += this.cvx[i] * dt;
      this.cy[i] += this.cvy[i] * dt;
      this.cvy[i] += 520 * dt;
      this.cvx[i] *= drag;
      this.cl[i] -= dt * 0.8;
    }
  }

  draw(ctx, alpha) {
    // One flat colour for every dancer — stark pictogram silhouettes.
    const color = this.palette.fgCss();
    for (let i = 0; i < this.rigs.length; i++) this.rigs[i].draw(ctx, color);

    // Monochrome square "shatter" on big hits (data, not glitter).
    ctx.fillStyle = color;
    for (let i = 0; i < this.cmax; i++) {
      const lf = this.cl[i];
      if (lf <= 0) continue;
      const s = 2 + this.cs[i] * 3;
      ctx.globalAlpha = Math.min(1, lf);
      ctx.fillRect(this.cx[i] - s / 2, this.cy[i] - s / 2, s, s);
    }
    ctx.globalAlpha = 1;
  }
}
