import { rgbCss } from '../lib/math.js';

// Minimal-techno post layer drawn on top of every frame: film grain, vignette,
// a hairline calibration frame with registration marks, and a monospaced data
// HUD (scene id, BPM, timecode, level meters). This is what carries the
// Ryoji Ikeda / Raster-Noton feel.
export class Overlay {
  constructor() {
    this.grain = true;
    this.scanlines = false;
    this.hud = true;
    this.vignette = true;
    this._grainTile = this._makeGrain(256);
    this._scanTile = this._makeScan();
  }

  _makeGrain(size) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    const img = g.createImageData(size, size);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const v = Math.random() * 255;
      d[i] = d[i + 1] = d[i + 2] = v;
      d[i + 3] = Math.random() * 255; // varied alpha = sparse grain
    }
    g.putImageData(img, 0, 0);
    return c;
  }

  _makeScan() {
    const c = document.createElement('canvas');
    c.width = 4; c.height = 4;
    const g = c.getContext('2d');
    g.fillStyle = 'rgba(0,0,0,0.6)';
    g.fillRect(0, 3, 4, 1);
    return c;
  }

  toggle(key) { if (key in this) { this[key] = !this[key]; return this[key]; } return false; }

  draw(ctx, w, h, info) {
    const { palette } = info;
    ctx.save();

    if (this.vignette) {
      const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.72);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(0,0,0,0.55)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }

    if (this.grain) {
      ctx.globalAlpha = 0.06;
      const ox = -Math.random() * 256;
      const oy = -Math.random() * 256;
      for (let x = ox; x < w; x += 256) for (let y = oy; y < h; y += 256) ctx.drawImage(this._grainTile, x, y);
      ctx.globalAlpha = 1;
    }

    if (this.scanlines) {
      const p = ctx.createPattern(this._scanTile, 'repeat');
      ctx.fillStyle = p;
      ctx.fillRect(0, 0, w, h);
    }

    if (this.hud) this._drawHud(ctx, w, h, info);

    ctx.restore();
  }

  _drawHud(ctx, w, h, info) {
    const { palette, audio, clock, fps, sceneIndex, sceneName, sceneMode } = info;
    const fg = rgbCss(palette.fg);
    const accent = rgbCss(palette.accent);
    const dim = rgbCss(palette.fg, 0.42);
    const pad = 16;
    const hasLS = 'letterSpacing' in ctx;

    ctx.textBaseline = 'alphabetic';

    // Hairline calibration frame + corner registration marks.
    ctx.strokeStyle = dim;
    ctx.lineWidth = 1;
    ctx.strokeRect(pad - 0.5, pad - 0.5, w - pad * 2 + 1, h - pad * 2 + 1);
    const m = 9;
    const corners = [[pad, pad, 1, 1], [w - pad, pad, -1, 1], [pad, h - pad, 1, -1], [w - pad, h - pad, -1, -1]];
    ctx.beginPath();
    for (const [cx, cy, sx, sy] of corners) {
      ctx.moveTo(cx, cy + sy * m); ctx.lineTo(cx, cy); ctx.lineTo(cx + sx * m, cy);
    }
    ctx.stroke();

    if (hasLS) ctx.letterSpacing = '2px';
    const big = "13px ui-monospace, 'SF Mono', Menlo, monospace";
    const sm = "11px ui-monospace, 'SF Mono', Menlo, monospace";

    // Top-left: scene id + name (offset past the menu handle).
    const idx = String((sceneIndex ?? 0) + 1).padStart(2, '0');
    ctx.font = big;
    ctx.textAlign = 'left';
    ctx.fillStyle = fg;
    ctx.fillText(`${idx} ${(sceneName || '').toUpperCase()}`, 78, 34);
    ctx.font = sm;
    ctx.fillStyle = dim;
    if (sceneMode) ctx.fillText(`▸ ${sceneMode.toUpperCase()}`, 78, 52);

    // Top-right: BPM + timecode.
    ctx.textAlign = 'right';
    ctx.font = big;
    ctx.fillStyle = fg;
    ctx.fillText(`${(audio.bpm || 0).toFixed(1)} BPM`, w - pad - 6, 34);
    ctx.font = sm;
    ctx.fillStyle = dim;
    ctx.fillText(this._tc(clock.time), w - pad - 6, 52);

    // Beat indicator (top center).
    const bs = 9;
    ctx.fillStyle = audio.beatHold > 0.25 ? accent : dim;
    ctx.fillRect(w / 2 - bs / 2, pad + 6, bs, bs);

    // Bottom-left: level meters.
    ctx.textAlign = 'left';
    ctx.font = sm;
    ctx.fillStyle = dim;
    ctx.fillText(audio.ready ? 'MIC' : 'MIC OFF', 24, h - 26);
    this._meter(ctx, 64, h - 34, 120, 8, audio.level, fg, dim);
    this._bands(ctx, 200, h - 34, audio, accent, dim);

    // Bottom-right: palette + fps.
    ctx.textAlign = 'right';
    ctx.fillStyle = dim;
    ctx.fillText(`${palette.name} · ${Math.round(fps)}FPS`, w - pad - 6, h - 26);

    if (hasLS) ctx.letterSpacing = '0px';
  }

  _meter(ctx, x, y, w, h, v, fg, dim) {
    ctx.strokeStyle = dim;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w, h);
    ctx.fillStyle = fg;
    ctx.fillRect(x + 1, y + 1, Math.max(0, Math.min(1, v)) * (w - 2), h - 2);
  }

  _bands(ctx, x, y, audio, accent, dim) {
    const labels = [['L', audio.bass], ['M', audio.mid], ['H', audio.treble]];
    ctx.textAlign = 'left';
    labels.forEach((b, i) => {
      const bx = x + i * 30;
      ctx.fillStyle = b[1] > 0.45 ? accent : dim;
      ctx.fillRect(bx, y, 8, 8);
      ctx.fillStyle = dim;
      ctx.fillText(b[0], bx + 12, y + 8);
    });
  }

  _tc(t) {
    const f = Math.floor((t % 1) * 30);
    const s = Math.floor(t) % 60;
    const m = Math.floor(t / 60) % 60;
    const h = Math.floor(t / 3600);
    const p = (n) => String(n).padStart(2, '0');
    return `${p(h)}:${p(m)}:${p(s)}:${p(f)}`;
  }
}
