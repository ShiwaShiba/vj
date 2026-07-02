import { Scene } from '../Scene.js';
import { DancerRig } from './DancerRig.js';
import { MODES, MODE_FAVORED, MODE_STYLE, MODE_RARE } from './moves.js';
import { AudioMapper } from './audioMap.js';

// Fixed camera presets (button-cycled): how the whole crowd is viewed. yaw about
// the vertical axis, pitch about the horizontal (overhead).
const VIEWS = [
  { name: 'FRONT', yaw: 0.0, pitch: 0.06 },
  { name: '3/4', yaw: 0.62, pitch: 0.10 },
  { name: 'SIDE', yaw: 1.35, pitch: 0.05 },
  { name: 'TOP', yaw: 0.28, pitch: 0.55 },
];

// The headline scene: Kraftwerk-style mannequin(s) dancing by POSE-TO-POSE
// choreography (Layer A: per-dancer Choreographer snaps a spring bank to held
// poses on the beat grid, with follow-through) + a continuous GROOVE layer
// (Layer B). Audio only sets gains / fires events / biases phrase choice.
export class DancersScene extends Scene {
  constructor() {
    super('dancers', 'Dancers');
    this.trail = 0.8;   // bg clear amount; driven by the 'trail' param (1 - persistence)
    this.modes = MODES.map((m) => ({ name: m.name }));
    // Camera viewpoint as a button group (parallel to modes).
    this.views = VIEWS.map((v) => ({ name: v.name }));
    this.viewIndex = 0;
    // Render style: pictogram (original Kraftwerk rods) vs graphic (brush-croquis
    // dancer). Same rig/choreography — only the renderer + proportions differ.
    this.modeGroups = [
      { key: 'style', label: 'STYLE', options: ['PICTO', 'GRAPHIC'], index: 0 },
    ];
    this._camYaw = VIEWS[0].yaw;
    this._camPitch = VIEWS[0].pitch;
    this.defineParam('count', 1, 1, 100, 1, 'Dancers');
    this.defineParam('size', 0.4, 0.2, 1, 0.05, 'Size');
    this.defineParam('spread', 1, 0, 2.5, 0.1, 'Spread');
    // Motion afterimage (persistence): 0 = crisp clear, higher = longer trails.
    // Drives this.trail (= 1 - persistence) each frame. Free perf-wise — it only
    // changes the per-frame background fill alpha, no extra drawing.
    this.defineParam('trail', 0.2, 0, 0.55, 0.05, 'Trail');
    this.rigs = [];
    this._builtFor = '';
    this._audioMap = new AudioMapper();
  }

  init(ctx, w, h) { super.init(ctx, w, h); this._build(); }
  onResize(w, h) { super.onResize(w, h); this._build(); }

  setView(i) { this.viewIndex = ((i % VIEWS.length) + VIEWS.length) % VIEWS.length; }

  _key() { return Math.round(this.p('count')) + ':' + this.p('size').toFixed(2); }

  _build() {
    const count = Math.round(this.p('count'));
    const size = this.p('size');
    this.rigs = [];

    if (count === 1) {
      const H = Math.min(this.h * 0.62, this.w * 0.95) * size;
      const rig = new DancerRig(this.w * 0.5, this.h * 0.43 + H * 0.5, H, 1);
      rig._alpha = 1;
      this.rigs.push(rig);
      this._builtFor = this._key();
      return;
    }

    // Depth-staggered grid: rows recede upward, smaller and dimmer toward the back
    // (Bauhaus/Kraftwerk orderly crowd). Built back-to-front so near figures paint
    // over far ones.
    const rows = Math.max(1, Math.min(7, Math.round(Math.sqrt(count / 2.2))));
    const perRow = Math.ceil(count / rows);
    // Assign counts per row (front rows full, last row takes the remainder).
    const rowCounts = [];
    let left = count;
    for (let r = 0; r < rows; r++) { const n = Math.min(perRow, left); rowCounts.push(n); left -= n; }

    // Pass 1: lay out each row's geometry (feet line + figure height). The raw feet
    // line runs 0.34h (back) .. 0.80h (front), which parks the prominent front row
    // near the BOTTOM of the frame — and a small crowd (1 row) sits entirely at
    // 0.80h. So we measure the crowd's true vertical span (back-row heads to
    // front-row feet) and, in pass 2, shift every row uniformly so that span's
    // midpoint lands on CROWD_CENTER_Y. Feet at groundY, figure extends up ~H
    // (see DancerRig: hip = groundY - legReach*H), and the hip anchor is placed in
    // screen space untouched by camera pitch/yaw — so this recenters every view.
    const CROWD_CENTER_Y = 0.47;
    const layout = [];
    let top = Infinity, bottom = -Infinity;
    for (let r = 0; r < rows; r++) {
      const t = rows > 1 ? r / (rows - 1) : 0;   // 0 front .. 1 back
      const depth = 1 - 0.52 * t;                // size/alpha falloff
      const n = rowCounts[r];
      const groundY = this.h * (0.80 - 0.46 * t);
      const cellW = this.w / (n + 1);
      const H = Math.min(this.h * 0.36, cellW * 1.7) * size * depth;
      const stagger = (r % 2 ? 0.22 : -0.22) * cellW;
      layout.push({ depth, n, groundY, cellW, H, stagger });
      if (groundY - H < top) top = groundY - H;   // highest head (back row)
      if (groundY > bottom) bottom = groundY;      // lowest feet (front row)
    }
    const offsetY = this.h * CROWD_CENTER_Y - (top + bottom) * 0.5;

    let seed = 1;
    for (let r = rows - 1; r >= 0; r--) {          // back (r large) first
      const L = layout[r];
      const groundY = L.groundY + offsetY;
      for (let c = 0; c < L.n; c++) {
        const x = L.cellW * (c + 1) + L.stagger;
        const rig = new DancerRig(x, groundY, L.H, seed++);
        rig._alpha = 0.45 + 0.55 * L.depth;        // back rows dimmer
        this.rigs.push(rig);
      }
    }
    this._builtFor = this._key();
  }

  update(dt, audio, palette, clock) {
    if (this._key() !== this._builtFor) this._build();
    this.trail = 1 - this.p('trail');   // afterimage amount (live slider)

    // Ease the camera toward the selected viewpoint so switches glide.
    const view = VIEWS[this.viewIndex];
    this._camYaw += (view.yaw - this._camYaw) * Math.min(1, dt * 6);
    this._camPitch += (view.pitch - this._camPitch) * Math.min(1, dt * 6);

    // CONTINUOUS beat counter (clock.beats is an integer; beatPhase is the sub-beat).
    const beatsF = clock.beats + clock.beatPhase;
    const gains = this._audioMap.update(dt, audio, clock.beatJustWrapped);

    const bpm = audio.bpm || 120;
    const band = bpm < 90 ? 'slow' : bpm > 140 ? 'fast' : 'mid';
    const bpmScale = band === 'fast' ? 1.3 : 1.0;

    const mode = MODES[this.modeIndex] || MODES[0];
    const style = MODE_STYLE[mode.name] || MODE_STYLE.Auto;
    let modeFavored = MODE_FAVORED[mode.name] || null;
    let modeRare = MODE_RARE[mode.name] || null;
    let poseAmp = gains.poseAmp * style.scale;

    // Quiet / mic-off: a deliberate low-amplitude living groove on the internal clock.
    if (!audio.ready && gains.energy < 0.06) {
      modeFavored = ['IDLE'];
      modeRare = null;
      poseAmp = Math.max(poseAmp, 0.35);
    }

    // The genre's gross-groove energy scales the audio-driven sway + bounce (and
    // with it the coupled knee dip): Krump/House move big, Minimal/Popping small.
    const weightAmp = gains.weightAmp * style.grooveMul;
    const bounceImpulse = gains.bounceImpulse * style.grooveMul;

    const styleIdx = this.mg('style');
    const spread = this.p('spread');
    for (let i = 0; i < this.rigs.length; i++) {
      this.rigs[i].style = styleIdx;
      // Per-dancer phase offset (floor keeps neighbours desynced even at spread=0)
      // + a tiny seeded amplitude jitter so a crowd never moves in lock-step.
      const offset = i * 0.2 * spread + i * 0.07;
      const jit = 0.92 + ((i * 2654435761) >>> 0) % 1000 / 1000 * 0.16;
      this.rigs[i].update(dt, {
        dt,
        beatsF: beatsF + offset,
        beatHold: audio.beatHold,
        poseAmp: poseAmp * jit,
        weightAmp,
        bounceImpulse,
        band,
        bpmScale,
        drop: gains.drop,
        modeFavored,
        modeRare,
        micro: gains.micro,
        // genre motion DNA (see MODE_STYLE)
        stepBeatsMul: style.stepBeatsMul,
        stiffMul: style.stiffMul,
        zetaMul: style.zetaMul,
        lagMul: style.lagMul,
        snapMul: style.snapMul,
        stanceBias: style.stanceBias,
      });
    }
  }

  draw(ctx, alpha) {
    const color = this.palette.fgCss();
    const cy = this._camYaw, cp = this._camPitch;
    for (let i = 0; i < this.rigs.length; i++) {
      this.rigs[i].draw(ctx, color, cy, cp, this.rigs[i]._alpha || 1);
    }
  }
}
