import { SpringBank } from './spring.js';
import { POSES, REST, scalePoseFromRest, PHRASES, phrasesForBand, SNAP_DOFS } from './poses.js';

// Per-dancer pose clock (Layer A). Walks a phrase's steps on the beat grid and
// retargets the SpringBank ONLY at step boundaries — that single-update-per-step
// is what kills the per-frame jitter. Each rig owns one Choreographer, so 1..8
// dancers stay independent (own phrase, own phase, own rotation seed).
export class Choreographer {
  constructor(seed = 1) {
    this.bank = new SpringBank(REST);
    this._seed = seed;
    this._rot = (seed * 7) | 0;     // rotation counter -> phrase desync across dancers
    this._phraseId = null;
    this._phrase = null;
    this._idx = 0;
    this._stepStart = 0;
    this._inited = false;
    this._tmp = {};
  }

  // ctrl = { dt, beatsF, poseAmp, band, bpmScale, drop, modeFavored }
  update(ctrl) {
    const beatsF = ctrl.beatsF;

    if (!this._inited) {
      this._inited = true;
      this._stepStart = beatsF;
      this._pickPhrase(ctrl);
      this._idx = 0;
      this._retarget(ctrl);
    }

    // A detected drop preempts the current phrase with CONTRACT -> RELEASE_UP.
    if (ctrl.drop && this._phraseId !== 'DROP') {
      this._phraseId = 'DROP';
      this._phrase = PHRASES.DROP;
      this._idx = 0;
      this._stepStart = beatsF;
      this._retarget(ctrl);
    }

    // Advance across any step boundaries crossed since last frame.
    let guard = 0;
    while (beatsF - this._stepStart >= this._curStep().beats && guard++ < 16) {
      this._stepStart += this._curStep().beats;
      this._idx++;
      if (this._idx >= this._phrase.length) {
        this._pickPhrase(ctrl);
        this._idx = 0;
      }
      this._retarget(ctrl);
    }

    this.bank.setBpmScale(ctrl.bpmScale);
    this.bank.step(ctrl.dt);
  }

  _curStep() { return this._phrase[this._idx]; }

  _pickPhrase(ctrl) {
    const pool = phrasesForBand(ctrl.band, ctrl.modeFavored);
    this._rot = (this._rot + 1) | 0;
    const n = pool.length;
    let id = pool[((this._rot % n) + n) % n];
    if (id === this._phraseId && n > 1) {
      id = pool[(((this._rot + 1) % n) + n) % n]; // avoid immediate repeat
    }
    this._phraseId = id;
    this._phrase = PHRASES[id];
  }

  _retarget(ctrl) {
    const step = this._curStep();
    const scaled = scalePoseFromRest(POSES[step.p], ctrl.poseAmp, this._tmp);
    this.bank.retarget(scaled, step.snap ? SNAP_DOFS : null);
  }
}
