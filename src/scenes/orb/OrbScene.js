// src/scenes/orb/OrbScene.js
// Scene adapter for the WebGL Noise Orb. Mirrors CityScene's opacity-composited
// pattern: a dedicated #orb-gl canvas with a lazily-created WebGLRenderer, shown
// by writing canvas.style.opacity = alpha in draw() and 0 in onExit(). Params are
// plain sliders read every frame into uniforms (no onChange needed).
import * as THREE from '../../vendor/three.module.js';
import { Scene } from '../Scene.js';
import { createOrbCore } from './orbCore.js';

export class OrbScene extends Scene {
  constructor() {
    super('orb', 'Noise Orb');
    this._core = null; this._renderer = null; this._orbGl = null;
    this._rotY = 0;                                        // accumulated Y spin (clock.dt driven)
    this._burst = { t0: -99, n: 0, amp: 0, prevBass: 0 };  // burst state (T5)
    this._band = { bassSwell: 0, travelAmt: 0, treble: 0, exposureLoud: 0 }; // band smoothing (T5)
    this.defineParam('rotSpeed', 0.18, 0, 1.2, 0.01, '回転速度')
        .defineParam('morphSpeed', 0.45, 0, 1.5, 0.01, 'モーフ速度')
        .defineParam('noiseScale', 1.70, 0.6, 4.0, 0.01, 'ノイズ密度')
        .defineParam('displace', 0.42, 0, 0.9, 0.005, '変位')
        .defineParam('cellEdge', 0.55, 0, 1.0, 0.01, 'フィラメント')
        .defineParam('pointSize', 1.70, 0.5, 4.0, 0.05, 'グレイン')
        .defineParam('exposure', 1.15, 0.2, 2.5, 0.01, '露光')
        .defineParam('bloom', 1.05, 0, 2.0, 0.01, 'ブルーム')
        .defineParam('audioGain', 1.10, 0, 2.5, 0.01, '音の深さ');
  }

  _ensureCore() {
    if (this._core) return;
    this._orbGl = document.getElementById('orb-gl');
    this._renderer = new THREE.WebGLRenderer({ canvas: this._orbGl, antialias: true });
    this._renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this._renderer.setClearColor(0x000000, 1);
    this._core = createOrbCore({ THREE, renderer: this._renderer });
    this._core.resize(this.w || innerWidth, this.h || innerHeight);
  }

  init(ctx, w, h) { this.w = w; this.h = h; this._ensureCore(); this._core.resize(w, h); }
  onResize(w, h) { this.w = w; this.h = h; if (this._core) this._core.resize(w, h); }

  update(dt, audio, palette, clock) {
    if (!this._core) return;
    const t = clock ? clock.time : 0;
    this._rotY += dt * this.p('rotSpeed');
    this._core.rotate(Math.sin(t * 0.08) * 0.18, this._rotY); // gentle deterministic wobble + spin

    // --- T5 seam: audio -> uniforms goes here (bandUniforms / updateBurst / burstFrame / sweepFrame). ---
    this._core.setUniforms({
      uTime: t,
      uMorphSpeed: this.p('morphSpeed'), uNoiseScale: this.p('noiseScale'),
      uDisplace: this.p('displace'), uCellEdge: this.p('cellEdge'),
      uPointSize: this.p('pointSize'), uExposure: this.p('exposure'),
    });

    if (palette && palette.fg) this._core.setTint(palette.fg);
    this._core.setBloom(this.p('bloom'));
  }

  draw(ctx, alpha) {
    if (!this._orbGl || !this._core) return;
    this._core.render();
    this._orbGl.style.opacity = String(alpha);
  }

  onExit() { this._orbGl && (this._orbGl.style.opacity = 0); }
  dispose() {
    if (this._orbGl) this._orbGl.style.opacity = 0;
    if (this._core) this._core.dispose();
    if (this._renderer) this._renderer.dispose();
    this._core = null; this._renderer = null;
  }
}
