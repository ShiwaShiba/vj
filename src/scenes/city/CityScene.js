import * as THREE from '../../vendor/three.module.js';
import { Scene } from '../Scene.js';
import { createCityCore } from '../../cityproto/cityCore.js';
import { createSceneAudioAdapter } from '../../cityproto/sceneAudioAdapter.js';

export class CityScene extends Scene {
  constructor() {
    super('city', '国立シティ');
    this.trail = 1;
    this._core = null; this._renderer = null; this._adapter = null;
    this._ready = false; this._loading = null; this._cityGl = null; this._now = 0;
  }
  _ensureCore() {
    if (this._core) return;
    this._cityGl = document.getElementById('city-gl');
    this._renderer = new THREE.WebGLRenderer({ canvas: this._cityGl, antialias: true });
    this._renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this._renderer.setClearColor(0x07080a, 1);
    this._core = createCityCore({ THREE, renderer: this._renderer });
    this._adapter = createSceneAudioAdapter();
    this._core.resize(this.w || innerWidth, this.h || innerHeight);
    this._core.applyCamera();
  }
  preload() {
    this._ensureCore();
    if (!this._loading) this._loading = this._core.load(() => {}).then(() => {
      this._core.goLive(this._adapter); this._ready = true;
    }).catch((e) => console.error('[city] preload failed', e));
    return this._loading;
  }
  init(ctx, w, h) { this.w = w; this.h = h; this._ensureCore(); this.preload(); }
  onResize(w, h) { this.w = w; this.h = h; if (this._core) this._core.resize(w, h); }
  update(dt, audio, palette, clock) {
    this._now += dt * 1000;
    if (!this._ready || !this._core) return;
    this._adapter.update(audio, clock);
    this._core.update(dt, this._now, { audioState: audio, driver: this._adapter, live: true, intro: false });
  }
  draw(ctx, alpha) {
    if (!this._cityGl) return;
    if (!this._ready) { this._cityGl.style.opacity = 0; return; }
    this._core.render();
    this._cityGl.style.opacity = String(alpha);
  }
  dispose() {
    if (this._cityGl) this._cityGl.style.opacity = 0;
    if (this._core) this._core.dispose();
    if (this._renderer) this._renderer.dispose();
  }
}
