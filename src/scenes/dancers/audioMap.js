import { clamp } from '../../lib/math.js';

// The ONLY place audio touches the dance. Audio sets GAINS, fires EVENTS, and
// biases PHRASE selection — it is never written into raw joint sines. One mapper
// per scene; its output is passed read-only to every rig.
export class AudioMapper {
  constructor() {
    this.energy = 0;
    this.lastE = 0;
    this.bounceImpulse = 0;
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

    // Bounce impulse: a punchy dip on every beat, decaying cleanly per beat.
    if (audio.beat || beatTick) {
      const power = audio.beat ? 0.9 + audio.bass * 0.7 : 0.5;
      this.bounceImpulse = Math.min(1.5, this.bounceImpulse + power);
    }
    this.bounceImpulse *= Math.exp(-dt / 0.16);

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
