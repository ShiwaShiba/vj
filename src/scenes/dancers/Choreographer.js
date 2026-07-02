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
    // Rare-phrase cooldown: accumulates real seconds; a rare showcase is injected only when
    // it elapses, so each distinct rare pose surfaces ~once per minute. Seed-desynced start
    // + per-pick jitter so a crowd doesn't fire rares in lock-step.
    this._rareTimer = (seed * 7.3) % 25;
    this._rarePeriod = 55;
    this._rareIdx = seed | 0;
  }

  // ctrl = { dt, beatsF, poseAmp, band, bpmScale, drop, modeFavored }
  update(ctrl) {
    const beatsF = ctrl.beatsF;
    this._rareTimer += ctrl.dt || 0;

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

    // Advance across any step boundaries crossed since last frame. The genre's
    // stepBeatsMul stretches/compresses how long each pose is held (Flex sustains,
    // House snaps fast) without touching the groove pulse, which still rides the
    // real beat counter.
    const sbm = ctrl.stepBeatsMul || 1;
    let guard = 0;
    while (beatsF - this._stepStart >= this._curStep().beats * sbm && guard++ < 16) {
      this._stepStart += this._curStep().beats * sbm;
      this._idx++;
      if (this._idx >= this._phrase.length) {
        this._pickPhrase(ctrl);
        this._idx = 0;
      }
      this._retarget(ctrl);
    }

    this.bank.setStyle(ctrl.bpmScale, ctrl.stiffMul, ctrl.zetaMul, ctrl.lagMul, ctrl.snapMul);
    this.bank.step(ctrl.dt);
  }

  _curStep() { return this._phrase[this._idx]; }

  _pickPhrase(ctrl) {
    // Occasionally inject a RARE showcase phrase (round-robin through the mode's rare pool),
    // gated by a cooldown so each distinct rare pose appears roughly once per minute. A mode
    // with N rares shares the minute (period = ~1min / N) and rounds through them in turn.
    const rare = ctrl.modeRare;
    if (rare && rare.length && this._rareTimer >= this._rarePeriod) {
      this._rareTimer = 0;
      this._rarePeriod = (54 + Math.random() * 12) / rare.length;   // ~1 min per distinct rare
      const id = rare[((this._rareIdx % rare.length) + rare.length) % rare.length];
      this._rareIdx = (this._rareIdx + 1) | 0;
      if (PHRASES[id]) { this._phraseId = id; this._phrase = PHRASES[id]; return; }
    }
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
