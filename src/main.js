/*!
 * VJ — https://github.com/ShiwaShiba/vj
 * Copyright (c) 2026 ShiwaShiba. All rights reserved.
 * Proprietary & confidential. No license is granted — see LICENSE.
 * Unauthorized copying, modification, or redistribution is prohibited.
 */
import { CONFIG } from './config.js';
import { Canvas } from './engine/Canvas.js';
import { Clock } from './engine/Clock.js';
import { Engine } from './engine/Engine.js';
import { AudioEngine } from './audio/AudioEngine.js';
import { PaletteManager } from './color/PaletteManager.js';
import { SceneManager } from './scenes/SceneManager.js';
import { createScenes } from './scenes/registry.js';
import { ControlPanel } from './ui/ControlPanel.js';
import { requestWakeLock, isWakeLockSupported } from './platform/wakelock.js';
import { registerSW } from './platform/pwa.js';
import { RemoteAudio } from './sync/RemoteAudio.js';
import { createOperatorLink, createOutputLink } from './sync/link.js';
import { applyControlSnapshot } from './sync/snapshot.js';
import { toggleFullscreen } from './platform/fullscreen.js';

const ROLE = new URLSearchParams(location.search).get('role');
const IS_OUTPUT = ROLE === 'output';

const canvasEl = document.getElementById('stage');
const uiRoot = document.getElementById('ui');
const startEl = document.getElementById('start');
const startHint = document.getElementById('start-hint');

// output はマイク/AudioContext を持たない RemoteAudio（受信フレーム駆動）。
const audio = IS_OUTPUT ? new RemoteAudio() : new AudioEngine();
const clock = new Clock();
const palette = new PaletteManager();
const scenes = new SceneManager(createScenes());

const canvas = new Canvas(canvasEl, (w, h) => scenes.onResize(w, h));
scenes.attach(canvas.ctx, canvas.w, canvas.h);
scenes.start('scope');

const engine = new Engine({ canvas, audio, clock, scenes, palette });
window.__vj = { engine, scenes, audio, palette, clock, canvas, role: IS_OUTPUT ? 'output' : 'operator' };

if (IS_OUTPUT) startOutput();
else initOperator();

// --- 出力ウィンドウ: パネル/スタート/マイク無し。受信状態でクリーン描画。---
function startOutput() {
  startEl.classList.add('gone');
  engine.start();

  // city を先読みして WebGL コアを先行生成。以後の city 操作（setShot/setScope）が
  // shotOpts/scopeOpts に蓄積され、load 完了時にそのまま適用される。
  const cityScene = scenes.byId['city'];
  if (cityScene && cityScene.preload) cityScene.preload();

  const targets = { scenes, palette, overlay: engine.overlay };
  let lastControl = null;
  const link = createOutputLink({
    remoteAudio: audio,
    controlTargets: targets,
    onControl: (snap) => { lastControl = snap; applyControlSnapshot(snap, targets); },
  });
  // シーンが（再）init されるたびに最新 control を冪等再適用＝cityCore 再生成時のノブ復元。
  scenes.onChange = () => { if (lastControl) applyControlSnapshot(lastControl, targets); };
  link.hello();
  window.__vj.link = link;

  requestWakeLock();
  registerSW();

  // 全画面は本ウィンドウ自身のジェスチャが要る。クリック or F で全画面。
  const hint = document.createElement('div');
  hint.id = 'output-hint';
  hint.textContent = 'クリックで全画面 / CLICK FOR FULLSCREEN';
  hint.style.cssText = 'position:fixed;left:50%;bottom:6%;transform:translateX(-50%);' +
    'font:12px/1.4 monospace;color:rgba(255,255,255,.5);letter-spacing:.1em;' +
    'pointer-events:none;z-index:2;';
  document.body.appendChild(hint);
  // クリックは「全画面へ入る」のみ（誤クリックで投影が抜けないように）。明示的な解除は Esc / F キー。
  const enterFs = () => {
    if (!document.fullscreenElement && !document.webkitFullscreenElement) toggleFullscreen(document.documentElement);
    hint.classList.add('gone');
  };
  const toggleFs = () => { toggleFullscreen(document.documentElement); hint.classList.add('gone'); };
  document.addEventListener('click', enterFs);
  window.addEventListener('keydown', (e) => { if (e.key === 'f' || e.key === 'F') toggleFs(); });
}

// --- 操作ウィンドウ: 従来フロー＋状態配信。---
function initOperator() {
  let started = false;
  let controlPanel = null;
  function startApp() {
    if (started) return;
    started = true;

    startEl.classList.add('gone');
    controlPanel = new ControlPanel({ scenes, palette, audio, engine, canvasEl, root: uiRoot });
    window.__vj.controlPanel = controlPanel;
    engine.start();

    const cityScene = scenes.byId['city'];
    if (cityScene && cityScene.preload) cityScene.preload();

    // 出力ウィンドウへ状態を配信（開いていなくても安全・後から開いても hello で即同期）。
    const link = createOperatorLink({
      audioState: audio.state,
      controlSources: { scenes, palette, overlay: engine.overlay },
      onOutputConnected: () => controlPanel && controlPanel.markOutputConnected(),
    });
    link.start();
    window.__vj.link = link;

    requestWakeLock();
    registerSW();
    if (!isWakeLockSupported()) console.warn('Wake Lock unsupported; the screen may dim during a set.');

    audio.start().catch((e) => {
      if (startHint) startHint.textContent = 'マイクを使えませんでした。映像は内部クロックで動きます。';
      controlPanel && controlPanel.markAudioUnavailable();
      console.warn('Microphone unavailable:', e);
    });
  }

  startEl.addEventListener('click', startApp, { once: true });
  startEl.addEventListener('touchend', (e) => { e.preventDefault(); startApp(); }, { passive: false, once: true });
  canvasEl.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
  window.addEventListener('keydown', (e) => { if (e.key === 'd' || e.key === 'D') CONFIG.DEBUG = !CONFIG.DEBUG; });
}
