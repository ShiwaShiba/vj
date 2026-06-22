import { CONFIG } from '../config.js';

// Owns the <canvas>, sizes it for retina (DPR capped), and handles resize.
// Drawing is done in CSS pixels (the context is pre-scaled by DPR).
export class Canvas {
  constructor(canvasEl, onResize) {
    this.el = canvasEl;
    this.ctx = canvasEl.getContext('2d', { alpha: false, desynchronized: true }) || canvasEl.getContext('2d');
    this.onResize = onResize;
    this.w = 0;
    this.h = 0;
    this.dpr = 1;
    this._timer = 0;

    this.resize();
    const deb = () => {
      clearTimeout(this._timer);
      this._timer = setTimeout(() => this.resize(), 150);
    };
    window.addEventListener('resize', deb);
    window.addEventListener('orientationchange', deb);
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, CONFIG.MAX_DPR);
    // Never let zero dimensions reach scenes (would cause /0 -> Infinity loops).
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    this.dpr = dpr;
    this.w = w;
    this.h = h;
    this.el.width = Math.max(1, Math.round(w * dpr));
    this.el.height = Math.max(1, Math.round(h * dpr));
    this.el.style.width = w + 'px';
    this.el.style.height = h + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // so we can draw in CSS px
    if (this.onResize) this.onResize(w, h);
  }
}
