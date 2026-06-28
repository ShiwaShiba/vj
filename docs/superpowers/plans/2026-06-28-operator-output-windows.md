# 操作／出力 二画面VJ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 一般的なVJソフトと同じ「操作画面を客先に見せず、クリーンな映像だけを別画面に投影する」二画面モデルを、PC/Mac の拡張ディスプレイ運用で実現する（サーバー不要・GitHub Pages のまま）。

**Architecture:** 1つのURLフラグ `?role=output` で同一コードを operator/output に分岐。両ウィンドウは同一ブラウザ・同一オリジンの `BroadcastChannel('vj')` で同期する。operator は自前 rAF で `frame`（音）と `control`（操作）を配信し、output は受信して既存 `Engine` ループで同じシーンを描画する。`Engine`・シーン・glb は一切改変しない（通信＋役割層のみを追加）。

**Tech Stack:** buildless ES modules, Canvas2D + WebGL（vendored three）, `BroadcastChannel`, `node --test`, ヘッドレス Chrome（CDP, `.superpowers/sdd/devshot/shot.mjs`）。

## Global Constraints

これらは全タスクの要件に暗黙に含まれる（spec からの逐語）:
- mono 単色のみ・strobe ≤3Hz・決定論（hash01 のみ・`Math.random()`/`Date` 不使用）。
- `dist/city.glb`・`dist/city.manifest.json` は byte 不変（再ベイク無し）。
- dancers・dots 既存シーンは不変。映像・シーンのコードは無改変。`src/engine/Engine.js` は無改変。
- iPad は従来通り単体動作のまま（本作業の output 分岐は PC/Mac 運用のみ対象）。iPad PWA / buildless ESM / three vendored を維持。
- 役割は `?role=output` フラグ。通信は `BroadcastChannel('vj')` のみ（WebRTC/WebSocket/バックエンド禁止）。
- operator は送信のみ・output は受信のみ（双方向エコー/ループを作らない）。
- 既存テスト（190）green を維持。テストは `node --test`、DOM 非依存の純粋関数を対象にする。
- 全コメント・UI 文言は日本語主体（既存コードに合わせる）。

---

## File Structure

**新規（薄い「通信＋役割」層）:**
- `src/sync/RemoteAudio.js` — output 用の音源スタブ。`AudioEngine` と同形の `.state` を持ち `update()` は no-op。受信フレームで `.state` を上書きされる。
- `src/sync/snapshot.js` — 純粋関数群（DOM/THREE/BroadcastChannel 非依存）: `buildFrame`/`applyFrame`/`buildControlSnapshot`/`applyControlSnapshot`/`controlsEqual`。
- `src/sync/link.js` — `BroadcastChannel('vj')` ラッパ: `createOperatorLink`/`createOutputLink`（チャンネル・rAF を注入可能にしてテスト可）。
- `tests/sync/remoteAudio.test.mjs`・`tests/sync/snapshot.test.mjs`・`tests/sync/link.test.mjs`。

**改修:**
- `src/main.js` — 先頭で `role` 判定。output は RemoteAudio＋パネル無し＋マイク無し＋city preload＋scene-ready 再適用＋クリック全画面。operator は現状＋`createOperatorLink` 起動。
- `src/ui/ControlPanel.js` — PERFORM 行に「出力を開く」ボタン＋接続インジケータ＋`markOutputConnected()`。
- `sw.js`（デプロイ時） — `ASSETS` に sync 3ファイル追加・`CACHE_VERSION` v16→v17。

---

### Task 1: RemoteAudio（output 用の音源スタブ）

**Files:**
- Create: `src/sync/RemoteAudio.js`
- Test: `tests/sync/remoteAudio.test.mjs`

**Interfaces:**
- Consumes: なし。
- Produces: `class RemoteAudio { state; update(); start(); }` — `state` は `AudioEngine.state` とキー互換（`{ ready, level, bass, mid, treble, beat, beatHold, bpm, spectrum:Uint8Array, waveform:Uint8Array }`）。`Engine._loop` が毎フレーム `audio.update(now)` を呼び `audio.state.bpm`/`.beat` を読むため、`update()` は安全な no-op であること。

- [ ] **Step 1: 失敗するテストを書く**

`tests/sync/remoteAudio.test.mjs`:
```js
import assert from 'node:assert';
import { test } from 'node:test';
import { RemoteAudio } from '../../src/sync/RemoteAudio.js';
import { AudioEngine } from '../../src/audio/AudioEngine.js';

test('RemoteAudio.state は AudioEngine.state とキー互換', () => {
  const r = new RemoteAudio();
  const real = new AudioEngine(); // コンストラクタは AudioContext を作らない
  const realKeys = Object.keys(real.state).sort();
  const remoteKeys = Object.keys(r.state).sort();
  for (const k of realKeys) assert.ok(remoteKeys.includes(k), `欠落キー: ${k}`);
});

test('update()/start() は安全な no-op、state は数値で初期化', () => {
  const r = new RemoteAudio();
  assert.doesNotThrow(() => r.update(123));
  assert.strictEqual(typeof r.state.bpm, 'number');
  assert.strictEqual(r.state.beat, false);
  assert.ok(r.state.spectrum instanceof Uint8Array);
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `node --test tests/sync/remoteAudio.test.mjs`
Expected: FAIL — `Cannot find module '.../src/sync/RemoteAudio.js'`

- [ ] **Step 3: 最小実装**

`src/sync/RemoteAudio.js`:
```js
// output ウィンドウ用の音源スタブ。マイク/AudioContext を持たず、AudioEngine.state と
// 同形の state を公開する。値は operator から受信したフレームで applyFrame() が上書きする。
export class RemoteAudio {
  constructor() {
    this.state = {
      ready: true,
      level: 0, bass: 0, mid: 0, treble: 0,
      beat: false, beatHold: 0,
      bpm: 120,
      spectrum: new Uint8Array(0),
      waveform: new Uint8Array(0),
    };
  }
  update() {}              // Engine._loop が毎フレーム呼ぶ。受信駆動なので何もしない。
  async start() { return true; }
}
```

- [ ] **Step 4: テスト成功を確認**

Run: `node --test tests/sync/remoteAudio.test.mjs`
Expected: PASS（2 tests）

- [ ] **Step 5: コミット**

```bash
git add src/sync/RemoteAudio.js tests/sync/remoteAudio.test.mjs
git commit -m "feat(sync): RemoteAudio（output 用 AudioEngine.state 互換スタブ）"
```

---

### Task 2: snapshot.js（frame/control の純粋コーデック）

**Files:**
- Create: `src/sync/snapshot.js`
- Test: `tests/sync/snapshot.test.mjs`

**Interfaces:**
- Consumes: Task 1 の `RemoteAudio`（テストで使用）。
- Produces:
  - `buildFrame(audioState) → { level,bass,mid,treble,beat,beatHold,bpm,spectrum,waveform }`
  - `applyFrame(frame, remoteAudio) → void`（`remoteAudio.state` を上書き）
  - `buildControlSnapshot({ scenes, palette, overlay }) → snap`（後述の形）
  - `applyControlSnapshot(snap, { scenes, palette, overlay }) → void`
  - `controlsEqual(a, b) → boolean`
- snap の形（JSON-able・キー順固定）:
  ```
  { sceneId, modeIndex, viewIndex|null, modeGroups:{key:index,…}, params:{key:value,…},
    palette:{ index, brightness, contrast, accentStrength, invert },
    overlay:{ hud, grain, scanlines, vignette } }
  ```
- 依存する既存 API（逐語確認済み）: `scenes.currentScene()`(=next||active)・`scenes.activeId()`・`scenes.byId`・`scenes.next`・`scenes.goto(id)`・`scene.modeIndex`・`scene.setMode(i)`・`scene.modes`・`scene.viewIndex`/`scene.setView(i)`（DancersScene のみ）・`scene.modeGroups`(=`[{key,label,options,index}]`)・`scene.setModeGroup(key,i)`・`scene.params[k]`(=`{value,min,max,step,label,onChange?}`)・`palette.index`/`brightness`/`contrast`/`accentStrength`/`invert`・`palette.set/setBrightness/setContrast/setAccentStrength/setInvert`・`overlay.hud/grain/scanlines/vignette`。

- [ ] **Step 1: 失敗するテストを書く**

`tests/sync/snapshot.test.mjs`:
```js
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
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `node --test tests/sync/snapshot.test.mjs`
Expected: FAIL — `Cannot find module '.../src/sync/snapshot.js'`

- [ ] **Step 3: 最小実装**

`src/sync/snapshot.js`:
```js
// operator↔output の状態シリアライズ層（純粋・DOM/THREE/BroadcastChannel 非依存）。
// frame=毎フレームの音、control=操作（シーン/モード/パラメータ/パレット/オーバーレイ）。

export function buildFrame(a) {
  return {
    level: a.level, bass: a.bass, mid: a.mid, treble: a.treble,
    beat: a.beat, beatHold: a.beatHold, bpm: a.bpm,
    spectrum: a.spectrum, waveform: a.waveform,
  };
}

export function applyFrame(f, remoteAudio) {
  const s = remoteAudio.state;
  s.level = f.level; s.bass = f.bass; s.mid = f.mid; s.treble = f.treble;
  s.beat = f.beat; s.beatHold = f.beatHold; s.bpm = f.bpm;
  s.spectrum = f.spectrum; s.waveform = f.waveform;
  s.ready = true;
}

export function buildControlSnapshot({ scenes, palette, overlay }) {
  const scene = scenes.currentScene();
  const snap = {
    sceneId: scene ? scene.id : null,
    modeIndex: scene ? (scene.modeIndex || 0) : 0,
    viewIndex: scene && typeof scene.viewIndex === 'number' ? scene.viewIndex : null,
    modeGroups: {},
    params: {},
    palette: {
      index: palette.index,
      brightness: palette.brightness,
      contrast: palette.contrast,
      accentStrength: palette.accentStrength,
      invert: palette.invert,
    },
    overlay: {
      hud: overlay.hud, grain: overlay.grain,
      scanlines: overlay.scanlines, vignette: overlay.vignette,
    },
  };
  if (scene && scene.modeGroups) for (const g of scene.modeGroups) snap.modeGroups[g.key] = g.index;
  if (scene && scene.params) for (const k in scene.params) snap.params[k] = scene.params[k].value;
  return snap;
}

export function applyControlSnapshot(snap, { scenes, palette, overlay }) {
  if (!snap) return;
  // シーン切替: 目標 id が active でも next でもなければ goto。
  if (snap.sceneId && scenes.activeId() !== snap.sceneId &&
      (!scenes.next || scenes.next.id !== snap.sceneId)) {
    scenes.goto(snap.sceneId);
  }
  // 目標シーンのインスタンスへ直接適用（crossfade 中は next 側でも確実に設定するため byId 優先）。
  const scene = (snap.sceneId && scenes.byId[snap.sceneId]) || scenes.currentScene();
  if (scene) {
    if (typeof snap.modeIndex === 'number' && scene.modes) scene.setMode(snap.modeIndex);
    if (typeof snap.viewIndex === 'number' && scene.setView) scene.setView(snap.viewIndex);
    if (scene.modeGroups && snap.modeGroups) {
      for (const key in snap.modeGroups) scene.setModeGroup(key, snap.modeGroups[key]);
    }
    if (scene.params && snap.params) {
      for (const k in snap.params) {
        const e = scene.params[k];
        if (!e) continue;
        e.value = snap.params[k];
        if (e.onChange) e.onChange(e.value); // city: setShot/setScope 駆動
      }
    }
  }
  if (snap.palette) {
    palette.set(snap.palette.index);
    palette.setBrightness(snap.palette.brightness);
    palette.setContrast(snap.palette.contrast);
    palette.setAccentStrength(snap.palette.accentStrength);
    palette.setInvert(snap.palette.invert);
  }
  if (snap.overlay) {
    overlay.hud = snap.overlay.hud;
    overlay.grain = snap.overlay.grain;
    overlay.scanlines = snap.overlay.scanlines;
    overlay.vignette = snap.overlay.vignette;
  }
}

// snap は固定キー順で組むので文字列化比較で十分（差分検出用）。
export function controlsEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}
```

- [ ] **Step 4: テスト成功を確認**

Run: `node --test tests/sync/snapshot.test.mjs`
Expected: PASS（4 tests）

- [ ] **Step 5: コミット**

```bash
git add src/sync/snapshot.js tests/sync/snapshot.test.mjs
git commit -m "feat(sync): snapshot.js（frame/control 純粋コーデック＋city onChange 駆動）"
```

---

### Task 3: link.js（BroadcastChannel ラッパ）

**Files:**
- Create: `src/sync/link.js`
- Test: `tests/sync/link.test.mjs`

**Interfaces:**
- Consumes: Task 1 `RemoteAudio`、Task 2 `buildFrame/buildControlSnapshot/applyFrame/applyControlSnapshot/controlsEqual`。
- Produces:
  - `createOperatorLink({ audioState, controlSources, onOutputConnected, channel?, raf? }) → { start(), stop() }`
    - `controlSources` = `{ scenes, palette, overlay }`。`channel` 既定 `new BroadcastChannel('vj')`、`raf` 既定 `requestAnimationFrame`。
    - `start()` 後、毎 rAF で `frame` を post し、`control` は差分時のみ post。`hello` 受信で現在の `control` を即 post＋`onOutputConnected()`。
  - `createOutputLink({ remoteAudio, controlTargets, onControl?, channel? }) → { hello(), stop() }`
    - `frame` 受信→`applyFrame`、`control` 受信→`onControl(snap)`（無ければ `applyControlSnapshot(snap, controlTargets)`）。`hello()` で `{t:'hello'}` を post。

- [ ] **Step 1: 失敗するテストを書く**

`tests/sync/link.test.mjs`:
```js
import assert from 'node:assert';
import { test } from 'node:test';
import { RemoteAudio } from '../../src/sync/RemoteAudio.js';
import { createOperatorLink, createOutputLink } from '../../src/sync/link.js';

function fakeChannel() {
  return {
    posts: [], onmessage: null,
    postMessage(m) { this.posts.push(m); },
    close() {},
    deliver(data) { if (this.onmessage) this.onmessage({ data }); },
  };
}
function manualRaf() {
  let pending = null;
  const raf = (cb) => { pending = cb; };
  raf.step = () => { const cb = pending; pending = null; if (cb) cb(); };
  return raf;
}
function sources() {
  const scene = { id: 'dancers', modeIndex: 0, modes: null, modeGroups: null, params: {} };
  const scenes = { byId: { dancers: scene }, next: null, activeId: () => 'dancers', currentScene: () => scene, goto() {} };
  const palette = { index: 0, brightness: 1, contrast: 1, accentStrength: 1, invert: false,
    set() {}, setBrightness() {}, setContrast() {}, setAccentStrength() {}, setInvert() {} };
  const overlay = { hud: false, grain: false, scanlines: false, vignette: false };
  return { scenes, palette, overlay };
}

test('operator: 毎 tick で frame、control は差分時のみ', () => {
  const ch = fakeChannel(); const raf = manualRaf();
  const audioState = { level: 0.1, bass: 0, mid: 0, treble: 0, beat: false, beatHold: 0, bpm: 120,
    spectrum: new Uint8Array(0), waveform: new Uint8Array(0) };
  const link = createOperatorLink({ audioState, controlSources: sources(), channel: ch, raf });
  link.start(); raf.step();
  const kinds1 = ch.posts.map((p) => p.t);
  assert.ok(kinds1.includes('frame'));
  assert.ok(kinds1.includes('control')); // 初回は lastControl=null と差分
  ch.posts.length = 0;
  raf.step(); // 状態変化なし
  const kinds2 = ch.posts.map((p) => p.t);
  assert.ok(kinds2.includes('frame'));
  assert.ok(!kinds2.includes('control')); // 差分なし→control は出さない
});

test('operator: hello 受信で control を即 post＋onOutputConnected', () => {
  const ch = fakeChannel(); const raf = manualRaf();
  let connected = 0;
  const audioState = { level: 0, bass: 0, mid: 0, treble: 0, beat: false, beatHold: 0, bpm: 120,
    spectrum: new Uint8Array(0), waveform: new Uint8Array(0) };
  const link = createOperatorLink({ audioState, controlSources: sources(), channel: ch, raf,
    onOutputConnected: () => { connected++; } });
  link.start();
  ch.deliver({ t: 'hello' });
  assert.strictEqual(connected, 1);
  assert.ok(ch.posts.some((p) => p.t === 'control'));
});

test('output: frame で state 上書き、control で applyControlSnapshot', () => {
  const ch = fakeChannel();               // 注入したフェイクチャンネルのみ使用（実 BroadcastChannel を作らない）
  const remoteAudio = new RemoteAudio();
  let appliedSnap = null;
  const link = createOutputLink({ remoteAudio, controlTargets: sources(), channel: ch,
    onControl: (snap) => { appliedSnap = snap; } });
  ch.deliver({ t: 'frame', frame: { level: 0.9, bass: 0.5, mid: 0.4, treble: 0.3,
    beat: true, beatHold: 1, bpm: 140, spectrum: new Uint8Array([5]), waveform: new Uint8Array([6]) } });
  assert.strictEqual(remoteAudio.state.bpm, 140);
  assert.strictEqual(remoteAudio.state.beat, true);
  ch.deliver({ t: 'control', snap: { sceneId: 'dancers', modeIndex: 0, viewIndex: null,
    modeGroups: {}, params: {}, palette: { index: 0, brightness: 1, contrast: 1, accentStrength: 1, invert: false },
    overlay: { hud: false, grain: false, scanlines: false, vignette: false } } });
  assert.ok(appliedSnap);
  assert.strictEqual(appliedSnap.sceneId, 'dancers');
  link.stop();
});

test('output: hello() で hello を post', () => {
  const ch = fakeChannel();
  const link = createOutputLink({ remoteAudio: new RemoteAudio(), controlTargets: sources(), channel: ch });
  link.hello();
  assert.ok(ch.posts.some((p) => p.t === 'hello'));
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `node --test tests/sync/link.test.mjs`
Expected: FAIL — `Cannot find module '.../src/sync/link.js'`

- [ ] **Step 3: 最小実装**

`src/sync/link.js`:
```js
import {
  buildFrame, applyFrame, buildControlSnapshot, applyControlSnapshot, controlsEqual,
} from './snapshot.js';

const CHANNEL_NAME = 'vj';

// 操作ウィンドウ側。自前 rAF で frame（毎フレーム）と control（差分時のみ）を配信する。
// Engine には触らない（無改変）。channel/raf は注入可能（テスト用）。
export function createOperatorLink({
  audioState, controlSources, onOutputConnected,
  channel = new BroadcastChannel(CHANNEL_NAME),
  raf = (cb) => requestAnimationFrame(cb),
}) {
  let running = false;
  let lastControl = null;
  channel.onmessage = (e) => {
    if (e.data && e.data.t === 'hello') {
      // 後発参加/リロードした output。現在の control を即送って同期させる。
      lastControl = buildControlSnapshot(controlSources);
      channel.postMessage({ t: 'control', snap: lastControl });
      if (onOutputConnected) onOutputConnected();
    }
  };
  function tick() {
    if (!running) return;
    if (audioState) channel.postMessage({ t: 'frame', frame: buildFrame(audioState) });
    const ctrl = buildControlSnapshot(controlSources);
    if (!controlsEqual(ctrl, lastControl)) {
      lastControl = ctrl;
      channel.postMessage({ t: 'control', snap: ctrl });
    }
    raf(tick);
  }
  return {
    start() { if (running) return; running = true; raf(tick); },
    stop() { running = false; try { channel.close(); } catch { /* noop */ } },
  };
}

// 出力ウィンドウ側。受信のみ。frame→RemoteAudio.state 上書き、control→適用。
export function createOutputLink({
  remoteAudio, controlTargets, onControl,
  channel = new BroadcastChannel(CHANNEL_NAME),
}) {
  channel.onmessage = (e) => {
    const m = e.data;
    if (!m) return;
    if (m.t === 'frame') applyFrame(m.frame, remoteAudio);
    else if (m.t === 'control') {
      if (onControl) onControl(m.snap);
      else applyControlSnapshot(m.snap, controlTargets);
    }
  };
  return {
    hello() { channel.postMessage({ t: 'hello' }); },
    stop() { try { channel.close(); } catch { /* noop */ } },
  };
}
```

- [ ] **Step 4: テスト成功を確認**

Run: `node --test tests/sync/link.test.mjs`
Expected: PASS（4 tests）。`BroadcastChannel` 未注入の経路はテストで使わない（全て fakeChannel を注入）。

- [ ] **Step 5: 全テスト確認＋コミット**

```bash
node --test
# Expected: 既存190＋新規10 すべて pass
git add src/sync/link.js tests/sync/link.test.mjs
git commit -m "feat(sync): link.js（BroadcastChannel operator/output ラッパ・注入可能）"
```

---

### Task 4: main.js の役割分岐（operator 配信 / output 受信描画）

**Files:**
- Modify: `src/main.js`（全面的に役割分岐へ再構成）
- 参照: `src/sync/*`（Task 1-3）、`src/platform/fullscreen.js`（`toggleFullscreen(el)`）

**Interfaces:**
- Consumes: `RemoteAudio`、`createOperatorLink`/`createOutputLink`、`applyControlSnapshot`、`toggleFullscreen`。
- Produces: `window.__vj.role`（`'operator'|'output'`）、`window.__vj.link`。operator は従来の起動フロー＋link 起動、output はパネル無し・マイク無し・city preload・scene-ready 再適用・クリック全画面。

- [ ] **Step 1: main.js を役割分岐版に書き換える**

`src/main.js`（全文置換）:
```js
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
scenes.start('dancers');

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
  const goFs = () => { toggleFullscreen(document.documentElement); hint.classList.add('gone'); };
  document.addEventListener('click', goFs);
  window.addEventListener('keydown', (e) => { if (e.key === 'f' || e.key === 'F') goFs(); });
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
```

- [ ] **Step 2: 全テストが緑のままを確認（main.js は import 経路のみ追加）**

Run: `node --test`
Expected: PASS（既存190＋sync 10）。main.js はテスト対象外だが、import するモジュールが解決可能であること。

- [ ] **Step 3: ヘッドレスで output 受信描画を検証**

Run（dev サーバ :8125 稼働前提・stray chrome を掃除してから）:
```bash
pkill -f cdp-shot 2>/dev/null; sleep 0.3
node .superpowers/sdd/devshot/shot.mjs \
  --url='http://localhost:8125/?role=output' \
  --out=/tmp/out_role.png \
  --eval="(async()=>{const ch=new BroadcastChannel('vj');ch.postMessage({t:'control',snap:{sceneId:'moire',modeIndex:0,viewIndex:null,modeGroups:{},params:{},palette:{index:2,brightness:1,contrast:1,accentStrength:1,invert:false},overlay:{hud:false,grain:false,scanlines:false,vignette:false}}});await new Promise(r=>setTimeout(r,500));const cs=window.__vj.scenes.currentScene();throw new Error('CHK role='+window.__vj.role+' panel='+(window.__vj.controlPanel===undefined)+' target='+(cs&&cs.id)+' palIdx='+window.__vj.palette.index+' running='+window.__vj.engine.running);})()" \
  --wait=1200 --w=1280 --h=800
```
Expected: `EVAL ERROR: ...CHK role=output panel=true target=moire palIdx=2 running=true`（output が別 BroadcastChannel からの control を受けて moire へ切替・パレット2適用・パネル未生成・エンジン稼働）。PNG は黒背景に moire の白描画。

- [ ] **Step 4: ヘッドレスで operator が link を起動することを検証**

Run:
```bash
pkill -f cdp-shot 2>/dev/null; sleep 0.3
node .superpowers/sdd/devshot/shot.mjs \
  --url='http://localhost:8125/' \
  --out=/tmp/op_role.png \
  --eval="(function(){document.getElementById('start').click();throw new Error('CHK role='+window.__vj.role+' link='+(!!window.__vj.link)+' panel='+(!!window.__vj.controlPanel));})()" \
  --wait=800 --w=1280 --h=800
```
Expected: `EVAL ERROR: ...CHK role=operator link=true panel=true`。

- [ ] **Step 5: コミット**

```bash
git add src/main.js
git commit -m "feat(sync): main.js を役割分岐（operator 配信 / output 受信描画・city preload・全画面）"
```

---

### Task 5: ControlPanel に「出力を開く」＋接続インジケータ

**Files:**
- Modify: `src/ui/ControlPanel.js`（PERFORM 行へボタン追加・`markOutputConnected()` 追加）
- 参照: `src/ui/Toggles.js`（`createButton(label, onClick)`）

**Interfaces:**
- Consumes: `createButton`（既存 import 済み）。
- Produces: PERFORM 行の「出力を開く」ボタン（`window.open('?role=output','vj-output')`）、`this.outputStatus` 表示、`markOutputConnected()`（main.js の operator link `onOutputConnected` から呼ばれる）。

- [ ] **Step 1: PERFORM 行へボタンと状態表示を追加**

`src/ui/ControlPanel.js` の PERFORM 行（`_build` 内、`if (isFullscreenSupported())` の行の直後、`this.panel.appendChild(this._section('PERFORM', tr));` の直前）に追記:
```js
    // 出力ウィンドウ（クリーン投影用）を開く。クリック=ジェスチャでポップアップブロック回避。
    tr.appendChild(createButton('出力を開く', () => window.open('?role=output', 'vj-output')));
    this.outputStatus = document.createElement('span');
    this.outputStatus.className = 'vj-output-status';
    this.outputStatus.textContent = '出力:未接続';
    tr.appendChild(this.outputStatus);
```

- [ ] **Step 2: `markOutputConnected()` メソッドを追加**

`src/ui/ControlPanel.js` の `markAudioUnavailable()` メソッドの直後に追加:
```js
  markOutputConnected() {
    if (this.outputStatus) {
      this.outputStatus.textContent = '出力:接続';
      this.outputStatus.classList.add('connected');
    }
  }
```

- [ ] **Step 3: ヘッドレスでボタン存在＋クリック挙動を検証**

Run:
```bash
pkill -f cdp-shot 2>/dev/null; sleep 0.3
node .superpowers/sdd/devshot/shot.mjs \
  --url='http://localhost:8125/' \
  --out=/tmp/op_btn.png \
  --eval="(function(){document.getElementById('start').click();var opened='';window.open=function(u,n){opened=u+'|'+n;return {};};var btns=[].slice.call(document.querySelectorAll('.vj-panel .vj-btn'));var b=btns.find(function(x){return x.textContent==='出力を開く';});if(!b)throw new Error('CHK button=MISSING');b.click();throw new Error('CHK button=ok opened='+opened);})()" \
  --wait=800 --w=1280 --h=900
```
Expected: `EVAL ERROR: ...CHK button=ok opened=?role=output|vj-output`。

- [ ] **Step 4: 全テスト確認＋コミット**

```bash
node --test
# Expected: 既存190＋sync 10 すべて pass（ControlPanel は DOM 依存ゆえ単体テスト対象外）
git add src/ui/ControlPanel.js
git commit -m "feat(ui): 操作パネルに『出力を開く』＋接続インジケータ"
```

---

### Task 6: sw.js — sync モジュールを precache・CACHE_VERSION 更新

**Files:**
- Modify: `sw.js`（`ASSETS` に sync 3ファイル追加・`CACHE_VERSION` v16→v17）

**Interfaces:**
- Consumes: なし（デプロイ設定）。
- Produces: オフラインでも sync 層が利用可能。`?role=output` は既存フォールバック（`caches.match('./index.html')`）で動作。

- [ ] **Step 1: ASSETS に sync 3ファイルを追加**

`sw.js` の `ASSETS` 配列、`'./src/ui/Toggles.js',` の直後に追加:
```js
  './src/sync/RemoteAudio.js',
  './src/sync/snapshot.js',
  './src/sync/link.js',
```

- [ ] **Step 2: CACHE_VERSION を更新**

`sw.js` の `const CACHE_VERSION = 'vj-v16';` を以下に変更:
```js
const CACHE_VERSION = 'vj-v17';
```

- [ ] **Step 3: 反映を確認**

Run:
```bash
grep -nE "vj-v17|src/sync/(RemoteAudio|snapshot|link)\.js" sw.js
```
Expected: 4行ヒット（CACHE_VERSION 1 ＋ sync 3ファイル）。

- [ ] **Step 4: コミット**

```bash
git add sw.js
git commit -m "chore(pwa): sync 3モジュールを precache＋CACHE_VERSION v16→v17"
```

---

## 検証（実物確認してから報告 — [[verify-visual-before-claiming]]）

1. `node --test` 全 green（既存190＋sync 10）。
2. Task 4/5 のヘッドレス検証で output 受信描画・operator link 起動・「出力を開く」クリックを確認。
3. **手動（実機・最終・ユーザー）**: PC/Mac を拡張ディスプレイ構成にし、操作ウィンドウで「出力を開く」→出力ウィンドウをプロジェクター側へドラッグ→クリックで全画面。操作側でシーン/パラメータ/国立シティのカメラ・SCOPE を変更→出力が追従。
4. **デプロイ（明示許可後）**: `feat/operator-output-windows` を main へマージ→push（CACHE_VERSION v17 で city 操作パネル＋二画面が同時に本番反映）。

## 守る線（不変条件・厳守）

Global Constraints 節を参照。要約: 映像・シーン・glb・Engine 無改変／mono・strobe≤3Hz・決定論／dancers・dots 不変／iPad は従来通り単体動作／通信は BroadcastChannel のみ・サーバー無し。
