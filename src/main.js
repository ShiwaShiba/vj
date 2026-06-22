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

const canvasEl = document.getElementById('stage');
const uiRoot = document.getElementById('ui');
const startEl = document.getElementById('start');
const startHint = document.getElementById('start-hint');

const audio = new AudioEngine();
const clock = new Clock();
const palette = new PaletteManager();
const scenes = new SceneManager(createScenes());

// Canvas resize never needs the ctx (set once via attach); it only relayouts.
const canvas = new Canvas(canvasEl, (w, h) => scenes.onResize(w, h));
scenes.attach(canvas.ctx, canvas.w, canvas.h);
scenes.start('dancers');

const engine = new Engine({ canvas, audio, clock, scenes, palette });

// Expose for debugging / verification from the console.
window.__vj = { engine, scenes, audio, palette, clock, canvas };

let started = false;
let controlPanel = null;
function startApp() {
  if (started) return;
  started = true;

  // Start visuals immediately so the app is responsive even if the mic
  // permission is slow or denied. Keep the mic request inside this gesture.
  startEl.classList.add('gone');
  controlPanel = new ControlPanel({ scenes, palette, audio, engine, canvasEl, root: uiRoot });
  window.__vj.controlPanel = controlPanel;
  engine.start();
  requestWakeLock();
  registerSW();

  if (!isWakeLockSupported()) {
    console.warn('Wake Lock unsupported; the screen may dim during a set.');
  }

  // Attempt mic capture (non-blocking). On failure, visuals keep running on
  // the internal clock; only the audio reactivity is missing.
  audio.start().catch((e) => {
    if (startHint) startHint.textContent = 'マイクを使えませんでした。映像は内部クロックで動きます。';
    controlPanel && controlPanel.markAudioUnavailable();
    console.warn('Microphone unavailable:', e);
  });
}

// Guard + { once } so the synthetic click after touchend can't double-fire.
startEl.addEventListener('click', startApp, { once: true });
startEl.addEventListener('touchend', (e) => { e.preventDefault(); startApp(); }, { passive: false, once: true });

// Stop scroll / pull-to-refresh / pinch-zoom over the canvas during a set.
canvasEl.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });

// Desktop: toggle the debug overlay with the D key.
window.addEventListener('keydown', (e) => {
  if (e.key === 'd' || e.key === 'D') CONFIG.DEBUG = !CONFIG.DEBUG;
});
