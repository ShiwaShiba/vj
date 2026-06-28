import assert from 'node:assert';
import { test } from 'node:test';
import { RemoteAudio } from '../../src/sync/RemoteAudio.js';
import {
  buildFrame, applyFrame, buildControlSnapshot, applyControlSnapshot, controlsEqual,
} from '../../src/sync/snapshot.js';

function fakeAudioState() {
  return {
    ready: true, level: 0.3, bass: 0.5, mid: 0.2, treble: 0.1,
    beat: true, beatHold: 0.7, bpm: 128,
    spectrum: new Uint8Array([1, 2, 3, 4]),
    waveform: new Uint8Array([9, 8, 7]),
  };
}

// 操作側オブジェクトの最小フェイク。CityScene を模した onChange 付き scene を含む。
function fakeWorld() {
  const shotCalls = [], scopeCalls = [];
  const city = {
    id: 'city', name: '国立シティ', modeIndex: 0, modes: null,
    modeGroups: [
      { key: 'shotEnabled', label: 'カメラ', options: ['A', 'B'], index: 0 },
      { key: 'scopeMode', label: 'SCOPE', options: ['x', 'y', 'z'], index: 0 },
    ],
    params: {
      blend: { value: 0.18, min: 0, max: 1, step: 0.02, label: 'b', onChange: (v) => shotCalls.push(v) },
      scopeMix: { value: 1, min: 0, max: 1, step: 0.02, label: 's', onChange: (v) => scopeCalls.push(v) },
    },
    setMode(i) { this.modeIndex = i; },
    setModeGroup(key, i) { const g = this.modeGroups.find((x) => x.key === key); if (g) g.index = i; },
  };
  const dancers = { id: 'dancers', name: 'D', modeIndex: 0, modes: null, modeGroups: null, params: {} };
  const scenes = {
    byId: { city, dancers }, next: null, _active: dancers,
    activeId() { return this._active.id; },
    currentScene() { return this.next || this._active; },
    goto(id) { this.next = this.byId[id]; },
  };
  const pal = {
    index: 0, brightness: 1, contrast: 1, accentStrength: 1, invert: false,
    set(i) { this.index = i; }, setBrightness(v) { this.brightness = v; },
    setContrast(v) { this.contrast = v; }, setAccentStrength(v) { this.accentStrength = v; },
    setInvert(v) { this.invert = v; },
  };
  const overlay = { hud: false, grain: false, scanlines: false, vignette: false };
  return { scenes, palette: pal, overlay, city, shotCalls, scopeCalls };
}

test('buildFrame→applyFrame で typed array を含め往復一致', () => {
  const f = buildFrame(fakeAudioState());
  const r = new RemoteAudio();
  applyFrame(f, r);
  assert.strictEqual(r.state.bpm, 128);
  assert.strictEqual(r.state.beat, true);
  assert.deepStrictEqual(r.state.spectrum, new Uint8Array([1, 2, 3, 4]));
  assert.deepStrictEqual(r.state.waveform, new Uint8Array([9, 8, 7]));
});

test('buildControlSnapshot は currentScene の id/modeGroups/params を読む', () => {
  const w = fakeWorld();
  w.scenes.next = w.city; // city を選択中
  const snap = buildControlSnapshot(w);
  assert.strictEqual(snap.sceneId, 'city');
  assert.deepStrictEqual(snap.modeGroups, { shotEnabled: 0, scopeMode: 0 });
  assert.deepStrictEqual(snap.params, { blend: 0.18, scopeMix: 1 });
  assert.strictEqual(snap.palette.index, 0);
  assert.strictEqual(snap.overlay.grain, false);
});

test('applyControlSnapshot は city へ goto し modeGroups/params.onChange を駆動', () => {
  const w = fakeWorld(); // active=dancers
  const snap = {
    sceneId: 'city', modeIndex: 0, viewIndex: null,
    modeGroups: { shotEnabled: 1, scopeMode: 2 },
    params: { blend: 0.5, scopeMix: 0.25 },
    palette: { index: 3, brightness: 1.2, contrast: 0.8, accentStrength: 0.4, invert: true },
    overlay: { hud: true, grain: true, scanlines: false, vignette: true },
  };
  applyControlSnapshot(snap, w);
  assert.strictEqual(w.scenes.next.id, 'city');                 // goto された
  assert.strictEqual(w.city.modeGroups[0].index, 1);            // setModeGroup
  assert.strictEqual(w.city.modeGroups[1].index, 2);
  assert.deepStrictEqual(w.shotCalls, [0.5]);                   // params.onChange 駆動
  assert.deepStrictEqual(w.scopeCalls, [0.25]);
  assert.strictEqual(w.city.params.blend.value, 0.5);           // value も反映
  assert.strictEqual(w.palette.index, 3);
  assert.strictEqual(w.palette.invert, true);
  assert.strictEqual(w.overlay.vignette, true);
});

test('controlsEqual は値差を検出', () => {
  const w = fakeWorld(); w.scenes.next = w.city;
  const a = buildControlSnapshot(w);
  const b = buildControlSnapshot(w);
  assert.ok(controlsEqual(a, b));
  w.city.params.blend.value = 0.9;
  const c = buildControlSnapshot(w);
  assert.ok(!controlsEqual(a, c));
  assert.ok(!controlsEqual(a, null));
});
