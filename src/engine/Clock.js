// Tracks elapsed time and a continuous beat phase (0..1 per beat).
// Dancers and pulsing visuals read beatPhase so motion stays smooth even
// when raw onset detection wobbles.
export class Clock {
  constructor() {
    this.time = 0; // seconds since start
    this.dt = 0;
    this.bpm = 120;
    this.beatPhase = 0; // 0..1, ramps each beat
    this.beats = 0; // total beats elapsed (phase wraps)
    this.beatJustWrapped = false;
    this.quality = 1; // adaptive-quality scale (set by Engine, read by scenes)
  }

  update(dt, bpm, beatEvent) {
    this.dt = dt;
    this.time += dt;
    this.bpm += (bpm - this.bpm) * 0.1; // ease toward new estimate
    const rate = this.bpm / 60; // beats per second

    this.beatPhase += rate * dt;
    this.beatJustWrapped = false;
    while (this.beatPhase >= 1) {
      this.beatPhase -= 1;
      this.beats++;
      this.beatJustWrapped = true;
    }

    // Softly resync to a detected onset so we lock to the music.
    if (beatEvent) {
      if (this.beatPhase > 0.5) this.beatPhase += (1 - this.beatPhase) * 0.5;
      else this.beatPhase -= this.beatPhase * 0.5;
    }
  }
}
