// src/scenes/yeast/YeastScene.js
// Scene adapter for the WebGL YEAST field. Mirrors OrbScene's opacity-composited pattern:
// a dedicated #yeast-gl canvas with a lazily-created WebGLRenderer, shown by writing
// canvas.style.opacity = alpha in draw() and 0 in onExit(). The PURE yeastDrive supplies
// cell geometry, aperiodic look-drift, and band smoothing; this adapter wires them to the core.
import * as THREE from '../../vendor/three.module.js';
import { Scene } from '../Scene.js';
import { createYeastCore } from './yeastCore.js';
import { YEAST, buildCells, cellFrame, driftFrame, bandUniforms } from './yeastDrive.js';

const TINT_MODES = ['auto', 'mono', 'slate'];   // modeGroup 'tint' index -> yeastDrive tintMode

export class YeastScene extends Scene {
  constructor() {
    super('yeast', 'YEAST');
    this._core = null; this._renderer = null; this._gl = null;
    this._state = buildCells(YEAST.COUNT, 7);                         // deterministic layout (seed 7)
    this._band = { swell: 0, flow: 0, shimmer: 0, loud: 0 };
    this._driftClock = 0;                                             // audio-advanced drift time
    // Named button-group (plain array, NOT a getter — base Scene ctor assigns modeGroups=null).
    this.modeGroups = [
      { label: '地色', key: 'tint', index: 0, options: ['オート', 'モノ', 'スレート'] },
    ];
    this.defineParam('density', 0.6, 0, 1, 0.02, '密度')
        .defineParam('size', 1.0, 0.6, 1.6, 0.01, 'サイズ')
        .defineParam('fusion', 0.5, 0, 1, 0.02, '融合')
        .defineParam('fill', 0.5, 0, 1, 0.02, '塗り')
        .defineParam('rim', 0.6, 0, 1, 0.02, 'リム')
        .defineParam('halo', 0.6, 0, 1, 0.02, 'ハロー')
        .defineParam('dof', 0.6, 0, 1, 0.02, '被写界深度')
        .defineParam('driftSpeed', 0.5, 0, 2, 0.02, '見た目ドリフト')
        .defineParam('budRate', 1.0, 0, 2, 0.02, '出芽率')
        .defineParam('flow', 1.0, 0, 2, 0.02, '回遊')
        .defineParam('audioGain', 1.1, 0, 2.5, 0.02, '音の深さ')
        .defineParam('bloom', 0.2, 0, 2, 0.02, 'ブルーム')
        .defineParam('exposure', 1.0, 0.4, 2.0, 0.02, '露光');
  }

  _ensureCore() {
    if (this._core) return;
    this._gl = document.getElementById('yeast-gl');
    this._renderer = new THREE.WebGLRenderer({ canvas: this._gl, antialias: true });
    this._renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this._renderer.setClearColor(0x000000, 1);
    this._core = createYeastCore({ THREE, renderer: this._renderer });
    this._core.resize(this.w || innerWidth, this.h || innerHeight);
  }

  init(ctx, w, h) { this.w = w; this.h = h; this._ensureCore(); this._core.resize(w, h); }
  onResize(w, h) { this.w = w; this.h = h; if (this._core) this._core.resize(w, h); }

  update(dt, audio, palette, clock) {
    if (!this._core) return;
    const t = clock ? clock.time : 0;
    const a = audio || {};
    const gain = this.p('audioGain');
    const band = bandUniforms(a, this._band, gain);
    // advance the drift clock by dt, sped by the driftSpeed slider and nudged forward on beats
    this._driftClock += dt * this.p('driftSpeed') * (1 + 1.2 * (a.beat || 0));

    // motion + budding (geometry) — reads audio for agitation/flow/bud-pop
    const budAudio = { bass: a.bass, mid: (a.mid || 0) * this.p('flow'), beat: (a.beat || 0) * this.p('budRate'), level: a.level };
    cellFrame(this._state, t, budAudio);

    // aperiodic look-drift; slider = center, drift = bounded offset around it
    const mode = TINT_MODES[this.mg('tint')];
    const dr = driftFrame(this._driftClock, a, mode);
    const off = (v, c, amp) => Math.max(0, Math.min(1, c + (v - 0.5) * 2 * amp));  // center c, ±amp
    const fusion = off(dr.fusion, this.p('fusion'), 0.35);
    const fill = off(dr.fill, this.p('fill'), 0.30);
    const rim = off(dr.rim, this.p('rim'), 0.30);
    const halo = off(dr.halo, this.p('halo'), 0.30);
    const density = off(dr.density, this.p('density'), 0.25);
    this._state.activeSlots = 2 * Math.max(8, Math.round(YEAST.COUNT * (0.45 + 0.55 * density)));

    this._core.setInstances(this._state);
    this._core.setUniforms({ uDof: this.p('dof'), uSizeR: this.p('size'),
      uSwell: band.swell, uShimmer: band.shimmer, uExposure: this.p('exposure') * (1 + 0.5 * band.loud) });
    this._core.setDrift({ fusion, fill, focusPlane: dr.focusPlane, rim, halo });
    this._core.setTint(dr.tint);
    if (palette && palette.fg) this._core.setMono(palette.fg);
    // adaptive: under low quality, dim bloom first (cheapest win)
    const q = clock && clock.quality != null ? clock.quality : 1;
    this._core.setBloom(this.p('bloom') * (0.6 + 0.8 * band.loud) * (q < 1 ? Math.max(0.4, q) : 1));
  }

  draw(ctx, alpha) {
    if (!this._gl || !this._core) return;
    this._core.render();
    this._gl.style.opacity = String(alpha);
  }

  onExit() { this._gl && (this._gl.style.opacity = 0); }
  dispose() {
    if (this._gl) this._gl.style.opacity = 0;
    if (this._core) this._core.dispose();
    if (this._renderer) this._renderer.dispose();
    this._core = null; this._renderer = null;
  }
}
