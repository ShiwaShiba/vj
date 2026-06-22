import { CONFIG } from '../config.js';
import { rgbCss, lerp } from '../lib/math.js';

// Manages the active scene, crossfade transitions, and the auto-pilot loop.
// Maps the three UI verbs:
//   switch scene         -> goto(id)
//   switch action pattern -> cycleMode()  (per-scene mode)
//   loop                 -> setLoop(true)  (auto-advance scenes/palettes)
export class SceneManager {
  constructor(scenes) {
    this.scenes = scenes;
    this.byId = {};
    scenes.forEach((s) => (this.byId[s.id] = s));
    this.ctx = null;
    this.w = 0;
    this.h = 0;
    this.active = null;
    this.next = null;
    this.fade = 1; // 0..1 crossfade progress toward `next`
    this.fadeDur = CONFIG.CROSSFADE_MS / 1000;
    this._inited = new Set();
    this.loop = false;
    this._lastAutoBeat = 0;
    this.clockBeats = 0;
    this.onChange = null; // callback(activeId) for UI sync
  }

  attach(ctx, w, h) { this.ctx = ctx; this.w = w; this.h = h; }

  _ensureInit(scene) {
    if (!this._inited.has(scene)) {
      scene.init(this.ctx, this.w, this.h);
      this._inited.add(scene);
    }
  }

  start(id) {
    const s = this.byId[id] || this.scenes[0];
    this._ensureInit(s);
    this.active = s;
    this.next = null;
    this.fade = 1;
    if (this.onChange) this.onChange(s.id);
  }

  goto(id) {
    const s = this.byId[id];
    if (!s || s === this.active || s === this.next) return;
    this._ensureInit(s);
    this.next = s;
    this.fade = 0;
    if (this.onChange) this.onChange(s.id);
  }

  gotoIndex(i) {
    const n = this.scenes.length;
    this.goto(this.scenes[((i % n) + n) % n].id);
  }

  cycleMode() {
    const s = this.next || this.active;
    if (s && s.modes) s.setMode(s.modeIndex + 1);
  }

  setLoop(on) { this.loop = on; this._lastAutoBeat = this.clockBeats || 0; }

  onResize(w, h) {
    this.w = w;
    this.h = h;
    this._inited.forEach((s) => s.onResize(w, h));
  }

  activeId() { return (this.active && this.active.id) || null; }
  activeName() { return (this.next || this.active)?.name || ''; }
  currentScene() { return this.next || this.active; }

  update(dt, audio, palette, clock) {
    this.clockBeats = clock.beats;
    if (this.next) {
      this.fade += dt / this.fadeDur;
      if (this.fade >= 1) {
        this.active = this.next;
        this.next = null;
        this.fade = 1;
      }
    }
    for (const s of [this.active, this.next]) {
      if (!s) continue;
      s.audio = audio;
      s.palette = palette;
      s.clock = clock;
      s.update(dt, audio, palette, clock);
    }

    if (this.loop && clock.beats - this._lastAutoBeat >= CONFIG.AUTO_ADVANCE_BEATS) {
      this._lastAutoBeat = clock.beats;
      const idx = this.scenes.indexOf(this.active);
      this.gotoIndex(idx + 1);
      if (Math.random() < 0.5) palette.next();
    }
  }

  drawFrame(ctx, w, h, palette, audio) {
    // Background / motion trails. Blend the two scenes' trail amounts during a
    // crossfade so low-trail scenes don't get abruptly cleared.
    const trail = this.next
      ? lerp(this.active ? this.active.trail : 1, this.next.trail, this.fade)
      : this.active ? this.active.trail : 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = rgbCss(palette.bg, trail);
    ctx.fillRect(0, 0, w, h);

    if (this.active) this._drawScene(ctx, this.active, this.next ? 1 - this.fade : 1);
    if (this.next) this._drawScene(ctx, this.next, this.fade);

    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  _drawScene(ctx, scene, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;
    scene.draw(ctx, alpha);
    ctx.restore();
  }
}
