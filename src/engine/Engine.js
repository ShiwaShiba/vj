import { CONFIG } from '../config.js';
import { Overlay } from '../render/Overlay.js';

// The single requestAnimationFrame loop. Composes one frame:
//   audio -> clock -> palette -> active scene update -> draw -> overlay.
export class Engine {
  constructor({ canvas, audio, clock, scenes, palette }) {
    this.canvas = canvas;
    this.audio = audio;
    this.clock = clock;
    this.scenes = scenes;
    this.palette = palette;
    this.overlay = new Overlay();
    this.running = false;
    this.last = 0;

    // FPS + adaptive quality.
    this.fps = 60;
    this._frameTimes = [];
    this.qualityScale = 1; // scenes can read this to thin out work
    this._loop = this._loop.bind(this);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    requestAnimationFrame(this._loop);
  }

  _loop(now) {
    if (!this.running) return;
    const dt = Math.min(now - this.last, CONFIG.DT_CLAMP_MS) / 1000;
    this.last = now;
    const t0 = now;

    // --- update ---
    this.audio.update(now);
    this.clock.update(dt, this.audio.state.bpm, this.audio.state.beat);
    this.clock.quality = this.qualityScale;
    this.palette.update(dt);
    this.scenes.update(dt, this.audio.state, this.palette, this.clock);

    // --- draw ---
    const ctx = this.canvas.ctx;
    const w = this.canvas.w, h = this.canvas.h;
    this.scenes.drawFrame(ctx, w, h, this.palette, this.audio.state);

    const active = this.scenes.currentScene();
    this.overlay.draw(ctx, w, h, {
      palette: this.palette,
      audio: this.audio.state,
      clock: this.clock,
      fps: this.fps,
      sceneIndex: active ? this.scenes.scenes.indexOf(active) : 0,
      sceneName: active ? active.name : '',
      sceneMode: active ? active.modeName() : '',
      scene: active, // live scene instance: lets Overlay call drawHud + read projected anchors
    });

    // --- perf bookkeeping ---
    const work = performance.now() - t0;
    this._trackPerf(work, dt);

    if (CONFIG.DEBUG) this._drawDebug(ctx);

    requestAnimationFrame(this._loop);
  }

  _trackPerf(workMs, dt) {
    if (dt > 0) this.fps += (1 / dt - this.fps) * 0.1;
    this._frameTimes.push(workMs);
    if (this._frameTimes.length >= CONFIG.PERF_WINDOW) {
      let sum = 0;
      for (const t of this._frameTimes) sum += t;
      const avg = sum / this._frameTimes.length;
      this._frameTimes.length = 0;
      if (avg > CONFIG.PERF_BUDGET_MS && this.qualityScale > 0.5) {
        this.qualityScale = Math.max(0.5, this.qualityScale - 0.15);
      } else if (avg < CONFIG.PERF_BUDGET_MS * 0.6 && this.qualityScale < 1) {
        this.qualityScale = Math.min(1, this.qualityScale + 0.1);
      }
    }
  }

  _drawDebug(ctx) {
    const s = this.audio.state;
    ctx.save();
    ctx.setTransform(this.canvas.dpr, 0, 0, this.canvas.dpr, 0, 0);
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(8, 8, 230, 116);
    ctx.font = '12px monospace';
    ctx.fillStyle = '#0f0';
    const lines = [
      `fps ${this.fps.toFixed(0)}  q ${this.qualityScale.toFixed(2)}`,
      `bpm ${s.bpm.toFixed(0)}  phase ${this.clock.beatPhase.toFixed(2)}`,
      `lvl ${s.level.toFixed(2)} bass ${s.bass.toFixed(2)}`,
      `mid ${s.mid.toFixed(2)} treb ${s.treble.toFixed(2)}`,
      `beat ${s.beat ? '*' : ' '} hold ${s.beatHold.toFixed(2)}`,
      `scene ${this.scenes.activeName()}`,
    ];
    lines.forEach((l, i) => ctx.fillText(l, 14, 26 + i * 16));
    ctx.restore();
  }
}
