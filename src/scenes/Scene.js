// Base class / contract for every visual. Scenes are isolated: they depend
// only on Scene, lib/*, and the audio/palette/clock handed to them.
//
//   update(dt, audio, palette, clock)  -> advance logic, NO drawing
//   draw(ctx, alpha)                   -> render only (alpha = crossfade)
//
// The SceneManager stashes `this.audio`, `this.palette`, `this.clock` before
// each update so draw() can read them without extra plumbing.
export class Scene {
  constructor(id, name) {
    this.id = id;
    this.name = name;
    this.w = 0;
    this.h = 0;
    this.trail = 1; // background clear amount: 1 = full clear, <1 = motion trails
    this.params = {}; // { key: { value, min, max, step, label } }
    this.modes = null; // optional list of { name }
    this.modeIndex = 0;
    this.modeGroups = null; // optional named button-groups: [{ key, label, options:[string], index }]
    // Filled in by SceneManager each frame:
    this.audio = null;
    this.palette = null;
    this.clock = null;
  }

  init(ctx, w, h) { this.w = w; this.h = h; }
  onResize(w, h) { this.w = w; this.h = h; }
  update(dt, audio, palette, clock) {}
  draw(ctx, alpha) {}
  drawHud(ctx, w, h, info) {} // optional per-scene HUD, drawn over the generic overlay HUD
  dispose() {}

  defineParam(key, value, min, max, step, label) {
    this.params[key] = { value, min, max, step, label: label || key };
    return this;
  }
  p(key) { const e = this.params[key]; return e ? e.value : undefined; }

  setMode(i) {
    if (!this.modes || !this.modes.length) return;
    this.modeIndex = ((i % this.modes.length) + this.modes.length) % this.modes.length;
  }
  modeName() { return this.modes ? this.modes[this.modeIndex].name : ''; }

  setModeGroup(key, i) {
    const g = this.modeGroups && this.modeGroups.find((x) => x.key === key);
    if (!g) return;
    g.index = ((i % g.options.length) + g.options.length) % g.options.length;
  }
  mg(key) {
    const g = this.modeGroups && this.modeGroups.find((x) => x.key === key);
    return g ? g.index : 0;
  }
}
