import { clamp } from '../../lib/math.js';

// The ONLY place audio touches the dance. Audio sets GAINS, fires EVENTS, and
// biases PHRASE selection — it is never written into raw joint sines. One mapper
// per scene; its output is passed read-only to every rig.
export class AudioMapper {
  constructor() {
    this.energy = 0;
    this.lastE = 0;
    this.bounceImpulse = 0;   // RENDERED bounce (smoothed follower)
    this._bounceTarget = 0;   // impulse kick target (decays per beat)
    this._bounceVel = 0;      // follower velocity (critically damped)
    this.drop = 0;
    this._out = {};
  }

  // beatTick = internal clock wrap, so the figure grooves even with no mic.
  update(dt, audio, beatTick) {
    // Energy with memory: fast attack, slow release (good for drop sensing and
    // for not letting the gains flicker).
    const tgtE = clamp(audio.level * 1.2, 0, 1);
    this.energy += (tgtE - this.energy) * (tgtE > this.energy ? 0.25 : 0.025);
    const e = this.energy;

    // Bounce: a punchy dip on every beat. The kick lands on a decaying TARGET;
    // the RENDERED bounceImpulse is a critically-damped follower of that target, so
    // it rises as a smooth hop (zero-velocity start) instead of stepping up in a
    // single frame. The old `+= power` made the figure's vertical translate jump
    // ~12-31px in one frame on every beat = the jerky, nausea-inducing pop.
    if (audio.beat || beatTick) {
      const power = audio.beat ? 0.9 + audio.bass * 0.7 : 0.5;
      this._bounceTarget = Math.min(1.5, this._bounceTarget + power);
    }
    this._bounceTarget *= Math.exp(-dt / 0.16);
    const cdt = dt < 1 / 30 ? dt : 1 / 30;     // bound stall-frame impulses
    const W = 24;                              // rad/s: ~70ms rise, settles within the beat
    const sub = Math.max(1, Math.ceil(cdt * 120));
    const h = cdt / sub;
    for (let i = 0; i < sub; i++) {
      const a = W * W * (this._bounceTarget - this.bounceImpulse) - 2 * W * this._bounceVel;
      this._bounceVel += a * h;
      this.bounceImpulse += this._bounceVel * h;
    }
    if (this.bounceImpulse < 0) { this.bounceImpulse = 0; this._bounceVel = 0; }

    // Drop: a sharp energy jump with low-end present.
    const dE = e - this.lastE;
    this.lastE = e;
    if (dE > 0.22 && audio.bass > 0.4) this.drop = 1;
    this.drop *= Math.exp(-dt / 0.6);

    // Micro-accent: tiny treble-driven head/wrist motion, HARD-GATED on the mic
    // being live and treble above a noise floor so FFT noise can't buzz the head.
    const micro = (audio.ready && audio.treble > 0.08) ? Math.min(audio.treble * 0.06, 0.05) : 0;

    const o = this._out;
    o.energy = e;
    o.poseAmp = e < 0.06 ? 0.25 : clamp(0.5 + 0.9 * e, 0.5, 1.3);
    o.weightAmp = 0.12 + 0.1 * e;
    o.bounceImpulse = Math.min(1.2, this.bounceImpulse);
    o.drop = this.drop > 0.5;
    o.micro = micro;
    o.ready = audio.ready;
    return o;
  }
}
