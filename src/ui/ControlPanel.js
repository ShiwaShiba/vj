import { createSceneGrid } from './SceneGrid.js';
import { createSlider } from './Sliders.js';
import { createToggle, createButton } from './Toggles.js';
import { PALETTES } from '../color/palettes.js';
import { rgbCss } from '../lib/math.js';
import { toggleFullscreen, isFullscreenSupported } from '../platform/fullscreen.js';

// Overlay control panel. Opens on load and stays open until the user closes it
// with the handle (≡) — no timed auto-hide. Wires the touch UI to the live engine
// objects passed in via `ctx` = { scenes, palette, audio, engine, canvasEl, root }.
export class ControlPanel {
  constructor(ctx) {
    this.ctx = ctx;
    this._groupState = {}; // (sceneId:groupKey) -> 'open' | 'collapsed'; 手動開閉を rebuild を跨いで保持
    this._build();
    // Open on load; from here only the handle (≡) opens/closes it.
    this.show();
  }

  _section(title, content) {
    const sec = document.createElement('div');
    sec.className = 'vj-section';
    const h = document.createElement('div');
    h.className = 'vj-section-title';
    h.textContent = title;
    sec.appendChild(h);
    sec.appendChild(content);
    return sec;
  }

  _build() {
    const root = this.ctx.root;

    this.handle = document.createElement('button');
    this.handle.className = 'vj-handle';
    this.handle.textContent = '≡';
    this.handle.addEventListener('click', () => this.toggle());
    root.appendChild(this.handle);

    this.panel = document.createElement('div');
    this.panel.className = 'vj-panel';
    root.appendChild(this.panel);

    // Scenes
    this.grid = createSceneGrid(this.ctx.scenes.scenes, (id) => this.ctx.scenes.goto(id));
    this.panel.appendChild(this._section('SCENES', this.grid.el));

    // Color palettes
    const pal = document.createElement('div');
    pal.className = 'vj-palettes';
    PALETTES.forEach((p, i) => {
      const sw = document.createElement('button');
      sw.className = 'vj-swatch';
      const a = rgbCss(p.ramp[0]);
      const b = rgbCss(p.ramp[Math.min(2, p.ramp.length - 1)]);
      const c = rgbCss(p.ramp[p.ramp.length - 1]);
      sw.style.background = `linear-gradient(135deg, ${a}, ${b}, ${c})`;
      sw.title = p.name;
      sw.addEventListener('click', () => this.ctx.palette.set(i));
      pal.appendChild(sw);
    });
    // Live palette adjustments (minimal-techno safe: no hue wheel).
    const pm = this.ctx.palette;
    const colorBox = document.createElement('div');
    colorBox.appendChild(pal);
    const adj = document.createElement('div');
    adj.className = 'vj-sliders';
    adj.appendChild(createSlider('Brightness', { value: pm.brightness, min: 0.5, max: 1.5, step: 0.02 }, (v) => pm.setBrightness(v)));
    adj.appendChild(createSlider('Contrast', { value: pm.contrast, min: 0.5, max: 2, step: 0.02 }, (v) => pm.setContrast(v)));
    adj.appendChild(createSlider('Accent', { value: pm.accentStrength, min: 0, max: 1, step: 0.05 }, (v) => pm.setAccentStrength(v)));
    colorBox.appendChild(adj);
    const cr = document.createElement('div');
    cr.className = 'vj-row';
    cr.appendChild(createToggle('INVERT', pm.invert, (v) => pm.setInvert(v)).el);
    colorBox.appendChild(cr);
    this.panel.appendChild(this._section('COLOR', colorBox));

    // Per-scene controls (rebuilt on scene change)
    this.sceneControls = document.createElement('div');
    this.sceneControls.className = 'vj-section';
    this.panel.appendChild(this.sceneControls);

    // Perform row
    const tr = document.createElement('div');
    tr.className = 'vj-row';
    this.loopToggle = createToggle('LOOP', false, (v) => this.ctx.scenes.setLoop(v));
    tr.appendChild(this.loopToggle.el);
    tr.appendChild(createButton('PATTERN', () => { this.ctx.scenes.cycleMode(); this._rebuildSceneControls(); }));
    this.beatToggle = createToggle('TAP TEMPO', false, (v) => this.ctx.audio.setBeatSource(v ? 'tap' : 'auto'));
    tr.appendChild(this.beatToggle.el);
    tr.appendChild(createButton('TAP', () => this.ctx.audio.tap(performance.now())));
    if (isFullscreenSupported()) tr.appendChild(createButton('FULL', () => toggleFullscreen(this.ctx.canvasEl)));
    // 出力ウィンドウ（クリーン投影用）を開く。クリック=ジェスチャでポップアップブロック回避。
    tr.appendChild(createButton('出力を開く', () => window.open('?role=output', 'vj-output')));
    this.outputStatus = document.createElement('span');
    this.outputStatus.className = 'vj-output-status';
    this.outputStatus.textContent = '出力:未接続';
    tr.appendChild(this.outputStatus);
    this.panel.appendChild(this._section('PERFORM', tr));

    // Audio sensitivity
    const sr = document.createElement('div');
    sr.className = 'vj-sliders';
    sr.appendChild(createSlider('Sensitivity', { value: this.ctx.audio.sensitivity, min: 0.3, max: 4, step: 0.05 }, (v) => this.ctx.audio.setSensitivity(v)));
    this.audioSection = this._section('AUDIO', sr);
    this.panel.appendChild(this.audioSection);

    // View / post-processing toggles.
    const ov = this.ctx.engine.overlay;
    const vr = document.createElement('div');
    vr.className = 'vj-row';
    vr.appendChild(createToggle('HUD', ov.hud, (v) => { ov.hud = v; }).el);
    vr.appendChild(createToggle('GRAIN', ov.grain, (v) => { ov.grain = v; }).el);
    vr.appendChild(createToggle('SCAN', ov.scanlines, (v) => { ov.scanlines = v; }).el);
    vr.appendChild(createToggle('VIGNETTE', ov.vignette, (v) => { ov.vignette = v; }).el);
    this.panel.appendChild(this._section('VIEW', vr));

    // React to scene changes for grid highlight + control rebuild.
    this.ctx.scenes.onChange = (id) => { this.grid.setActive(id); this._rebuildSceneControls(); };
    this.grid.setActive(this.ctx.scenes.activeId());
    this._rebuildSceneControls();
  }

  _rebuildSceneControls() {
    const scene = this.ctx.scenes.currentScene();
    const c = this.sceneControls;
    while (c.firstChild) c.removeChild(c.firstChild);
    if (!scene) return;
    const title = document.createElement('div');
    title.className = 'vj-section-title';
    title.textContent = 'PATTERN / PARAMS';
    c.appendChild(title);

    if (scene.modes) {
      const row = document.createElement('div');
      row.className = 'vj-row vj-modes';
      scene.modes.forEach((m, i) => {
        const b = document.createElement('button');
        b.className = 'vj-btn small' + (i === scene.modeIndex ? ' active' : '');
        b.textContent = m.name;
        b.addEventListener('click', () => { scene.setMode(i); this._rebuildSceneControls(); });
        row.appendChild(b);
      });
      c.appendChild(row);
    }

    // Optional camera-view button group (e.g. Dancers: FRONT / 3-4 / SIDE / TOP).
    if (scene.views && scene.setView) {
      const vrow = document.createElement('div');
      vrow.className = 'vj-row vj-modes';
      scene.views.forEach((v, i) => {
        const b = document.createElement('button');
        b.className = 'vj-btn small' + (i === scene.viewIndex ? ' active' : '');
        b.textContent = v.name;
        b.addEventListener('click', () => { scene.setView(i); this._rebuildSceneControls(); });
        vrow.appendChild(b);
      });
      c.appendChild(vrow);
    }

    // Accordion for scenes that declare controlGroups (Oscilloscope); every other
    // scene keeps the generic flat layout below (unchanged).
    if (scene.controlGroups && scene.isGroupActive) {
      this._renderAccordion(scene, c);
    } else {
      if (scene.modeGroups && scene.setModeGroup) {
        for (const g of scene.modeGroups) c.appendChild(this._modeGroupRow(scene, g));
      }
      const sliders = document.createElement('div');
      sliders.className = 'vj-sliders';
      for (const key in scene.params) {
        const entry = scene.params[key];
        sliders.appendChild(createSlider(entry.label, entry, (v) => { entry.value = v; if (entry.onChange) entry.onChange(v); }));
      }
      c.appendChild(sliders);
    }
  }

  // A single-select modeGroup row (label + option buttons). Shared by the flat
  // layout and the accordion so both render identically.
  _modeGroupRow(scene, g) {
    const grow = document.createElement('div');
    grow.className = 'vj-row vj-modes';
    const lab = document.createElement('span');
    lab.className = 'vj-mg-label';
    lab.textContent = g.label;
    grow.appendChild(lab);
    g.options.forEach((name, i) => {
      const b = document.createElement('button');
      b.className = 'vj-btn small' + (i === g.index ? ' active' : '');
      b.textContent = name;
      b.addEventListener('click', () => { scene.setModeGroup(g.key, i); this._rebuildSceneControls(); });
      grow.appendChild(b);
    });
    return grow;
  }

  // Collapsible groups: headers always present (導線), dormant dimmed, inactive
  // items dimmed but still interactive. Collapse state persists across rebuilds.
  _renderAccordion(scene, c) {
    for (const group of scene.controlGroups) {
      const active = scene.isGroupActive(group.key);
      const stKey = scene.id + ':' + group.key;
      const stored = this._groupState[stKey];
      const collapsed = stored === undefined ? !active : stored === 'collapsed';

      const header = document.createElement('button');
      header.className = 'vj-acc-header' + (active ? '' : ' dormant');
      header.textContent = (collapsed ? '▸ ' : '▾ ') + group.label;
      header.addEventListener('click', () => {
        this._groupState[stKey] = collapsed ? 'open' : 'collapsed';
        this._rebuildSceneControls();
      });
      c.appendChild(header);
      if (collapsed) continue;

      const body = document.createElement('div');
      body.className = 'vj-acc-body';
      for (const item of group.items) {
        const el = this._renderItem(scene, item);
        if (!el) continue;
        if (!scene.isControlActive(item.t, item.k)) el.classList.add('inactive');
        body.appendChild(el);
      }
      c.appendChild(body);
    }
  }

  _renderItem(scene, item) {
    if (item.t === 'p') {
      const entry = scene.params[item.k];
      if (!entry) return null;
      return createSlider(entry.label, entry, (v) => { entry.value = v; if (entry.onChange) entry.onChange(v); });
    }
    if (item.t === 'g') {
      const g = scene.modeGroups && scene.modeGroups.find((x) => x.key === item.k);
      return g ? this._modeGroupRow(scene, g) : null;
    }
    if (item.t === 'm' && item.k === 'autoArm') return this._autoArmRow(scene);
    return null;
  }

  // The Auto "動かす軸" multi-select: one toggle per armable axis in this mode.
  _autoArmRow(scene) {
    const row = document.createElement('div');
    row.className = 'vj-row vj-modes';
    const lab = document.createElement('span');
    lab.className = 'vj-mg-label';
    lab.textContent = '動かす軸';
    row.appendChild(lab);
    const AXES = [['phase', 'Phase'], ['flip', 'Flip'], ['band', 'Band'], ['spread', 'Spread'], ['rot', '回転']];
    for (const [k, label] of AXES) {
      if (!scene.canArm(k)) continue;
      const b = document.createElement('button');
      b.className = 'vj-btn small' + (scene.autoArm[k] ? ' active' : '');
      b.textContent = label;
      b.addEventListener('click', () => { scene.toggleArm(k); this._rebuildSceneControls(); });
      row.appendChild(b);
    }
    return row;
  }

  markAudioUnavailable() {
    if (this.audioSection) {
      this.audioSection.classList.add('vj-disabled');
      const t = this.audioSection.querySelector('.vj-section-title');
      if (t) t.textContent = 'AUDIO — MIC OFF';
    }
  }

  markOutputConnected() {
    if (this.outputStatus) {
      this.outputStatus.textContent = '出力:接続';
      this.outputStatus.classList.add('connected');
    }
  }

  // No timed auto-hide: show()/hide()/toggle() are driven only by the handle (≡).
  show() {
    this.panel.classList.remove('hidden');
  }
  hide() {
    this.panel.classList.add('hidden');
  }
  toggle() {
    if (this.panel.classList.contains('hidden')) this.show();
    else this.hide();
  }
}
