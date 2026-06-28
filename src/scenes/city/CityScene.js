import * as THREE from '../../vendor/three.module.js';
import { Scene } from '../Scene.js';
import { createCityCore } from '../../cityproto/cityCore.js';
import { createSceneAudioAdapter } from '../../cityproto/sceneAudioAdapter.js';
import { applyCityColorGroup } from '../../cityproto/cityColorControls.js';

// Discrete control vocabularies, mirroring the CAM/SCOPE HUDs of the standalone city-proto.html
// so the touch panel exposes the same knobs (the standalone drove these via window.__proto/keys).
const SWITCH_BARS = [1, 2, 4, 8];
const SCOPE_MODES = ['breathing', 'scanbar', 'bloom', 'radar', 'eq', 'matrix', 'gravity'];
const SCOPE_MODES_JA = ['呼吸', '走査', '開花', 'レーダー', 'EQ', '二値', '重力'];
const SCOPE_SPATIAL = ['rings', 'avenue', 'both'];
const SCOPE_SPATIAL_JA = ['同心円', '並木', '両方'];

export class CityScene extends Scene {
  constructor() {
    super('city', '国立シティ');
    this.trail = 1;
    this._core = null; this._renderer = null; this._adapter = null;
    this._ready = false; this._loading = null; this._cityGl = null; this._now = 0;

    // Per-scene touch controls surfaced into the main ControlPanel, mirroring the CAM/SCOPE HUDs
    // of the standalone city-proto.html. Defaults mirror cityCore's (defaultShotConfig /
    // defaultScopeConfig) so the panel reflects the live state on open.
    // Named button-groups (discrete). Plain array (NOT a getter) — the base Scene constructor
    // assigns `this.modeGroups = null`, so a getter-only accessor here would throw on super().
    // Base setModeGroup() maintains each group's `index`; we override only to also drive the core.
    this.modeGroups = [
      { label: 'カメラ', key: 'shotEnabled', index: 0, options: ['ビート連動', '固定'] },
      { label: '切替間隔', key: 'switchBars', index: 1, options: ['1小節', '2小節', '4小節', '8小節'] },
      { label: '建物連動', key: 'scopeEnabled', index: 0, options: ['ON', 'OFF'] },
      { label: 'SCOPE', key: 'scopeMode', index: 0, options: SCOPE_MODES_JA },
      { label: '空間', key: 'scopeSpatial', index: 0, options: SCOPE_SPATIAL_JA },
      { label: '色', key: 'cityColor', index: 0, options: ['モノ', '季節色'] },
      { label: '季節', key: 'citySeason', index: 0, options: ['春', '夏', '秋', '冬'] },
      { label: '色変種', key: 'cityVariant', index: 0, options: ['現行', '淡', '中'] },
      { label: '冬ストロボ', key: 'cityStrobe', index: 0, options: ['OFF', 'ON'] },
    ];
    // Continuous sliders. onChange pushes straight into the core's live setters (no-op until load,
    // where shotOpts/scopeOpts persist the pre-load value, so dragging during load is safe).
    this.params = {
      blend:     { label: 'CAMブレンド', value: 0.18, min: 0, max: 1.2, step: 0.02, onChange: (v) => this._core && this._core.setShot({ blendSec: v }) },
      avenue:    { label: 'アップ比率', value: 0.5, min: 0, max: 1, step: 0.05, onChange: (v) => this._core && this._core.setShot({ avenueRatio: v }) },
      travel:    { label: '前進(小=速)', value: 16, min: 6, max: 32, step: 1, onChange: (v) => this._core && this._core.setShot({ travelBars: v }) },
      orbit:     { label: '俯瞰の動き', value: 0.4, min: 0, max: 1, step: 0.02, onChange: (v) => this._core && this._core.setShot({ orbitRate: v * 0.05, breatheAmp: v * 0.12 }) },
      near:      { label: '俯瞰ニア比率', value: 0.25, min: 0, max: 1, step: 0.05, onChange: (v) => this._core && this._core.setShot({ nearRatio: v }) },
      scopeMix:  { label: 'SCOPE強さ', value: 1, min: 0, max: 1, step: 0.02, onChange: (v) => this._core && this._core.setScope({ mix: v }) },
      scopeA:    { label: 'SCOPE A比率', value: 0, min: 0, max: 1, step: 0.02, onChange: (v) => this._core && this._core.setScope({ aRatio: v }) },
    };
  }

  // Apply a button-group change: let the base update the group index (with wraparound), then push
  // the resulting selection into the core's live setters (CAM 俯瞰⇔アップ + SCOPE 建物連動).
  setModeGroup(key, i) {
    super.setModeGroup(key, i);
    const idx = this.mg(key);
    const c = this._core; if (!c) return;
    if (key === 'shotEnabled') c.setShot({ enabled: idx === 0 });
    else if (key === 'switchBars') c.setShot({ switchBars: SWITCH_BARS[idx] });
    else if (key === 'scopeEnabled') c.setScope({ enabled: idx === 0 });
    else if (key === 'scopeMode') c.setScope({ mode: SCOPE_MODES[idx] });
    else if (key === 'scopeSpatial') c.setScope({ spatial: SCOPE_SPATIAL[idx] });
    else applyCityColorGroup(key, idx, { core: c, adapter: this._adapter });
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
      // パネル既定の「動き」を core へ反映（モジュール既定0=固定に対する CityScene の opt-in）。
      this._core.setShot({
        orbitRate: this.params.orbit.value * 0.05,
        breatheAmp: this.params.orbit.value * 0.12,
        nearRatio: this.params.near.value,
      });
    }).catch((e) => console.error('[city] preload failed', e));
    return this._loading;
  }
  init(ctx, w, h) {
    this.w = w; this.h = h;
    this._ensureCore();
    // The core may have been created at preload() time with the startup viewport. Re-sync to the
    // CURRENT size whenever the scene is (re)inited — a resize while city was inactive/uninited
    // never reaches it (SceneManager.onResize only fans out to inited scenes).
    this._core.resize(w, h); this._core.applyCamera();
    this.preload();
  }
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
  onExit() { this._cityGl && (this._cityGl.style.opacity = 0); }
  dispose() {
    if (this._cityGl) this._cityGl.style.opacity = 0;
    if (this._core) this._core.dispose();
    if (this._renderer) this._renderer.dispose();
    this._core = null; this._renderer = null; this._ready = false;
  }
}
