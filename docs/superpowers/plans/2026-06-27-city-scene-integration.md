# 国立シティ（WebGL）を本体VJのシーンに統合 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 本体VJ（`index.html`→`src/main.js`）のシーン切替に「国立シティ（WebGL）」を即LIVE音反応の1シーンとして追加し、古い2D GroundPlan を削除する。

**Architecture:** city の per-frame ロジックと scene-graph を `proto.js` から純粋な工場 `cityCore.js` に括り出し、(1) 単体ページ `proto.js` と (2) 本体シーン `CityScene.js` の両方が同じコアを呼ぶ。本体では city 専用 WebGL canvas `#city-gl` を 2D `#stage` の**上**に重ね、CSS opacity でクロスフェード。マイクは本体 `AudioEngine.state` を共有し、city は LIVE 状態（④全域フレーミング＋ビート連動＋CityScope）で即起動する。

**Tech Stack:** buildless ESM / three.js (vendored `src/vendor/three.module.js`) / iPad PWA / `node --test`。

## Global Constraints

- city の見た目・挙動は**一切変更しない**。統合は接続作業のみ。
- mono 単一チャンネル / strobe ≤3Hz / 決定論（hash01 のみ、Math.random/Date 禁止）。
- `tools/citybake/dist/city.glb`・`city.manifest.json` は **byte 不変**（再ベイク禁止 — `git status --short -- tools/citybake/dist/` が空であること）。
- 本体 dancers/dots の既存シーンは byte 不変（registry の GroundPlan 行と main.js 先読み追記・index.html レイヤー追加を除く）。
- dancers の即起動を維持（16MB glb は非ブロッキング先読み）。
- 単体ページと本体は**同一 `cityCore` を共有**＝ロジック二重化禁止。
- 視覚は実物スクショで確認してから「できた」と報告（`http://localhost:8125/shots/` URL で渡す）。
- 既存 184 テストは全タスクで green を維持。

## File Structure

| ファイル | 役割 | 操作 |
|---|---|---|
| `src/cityproto/cityCore.js` | THREE scene-graph 構築＋per-frame update。DOM/mic/RAF/window 非依存。`createCityCore({THREE,renderer})` | 新規 |
| `src/cityproto/sceneAudioAdapter.js` | 本体 `AudioEngine.state`＋`Clock` を liveDriver 互換の音源に変換 | 新規 |
| `src/scenes/city/CityScene.js` | 本体 Scene 契約ラッパ（`#city-gl` renderer 所有・LIVE 即起動・opacity フェード） | 新規 |
| `index.html` | `#city-gl` canvas（`#stage` の上）＋ three importmap | 改修 |
| `src/main.js` | 起動後の glb バックグラウンド先読み | 改修 |
| `src/scenes/registry.js` | GroundPlan を除去し CityScene を追加 | 改修 |
| `src/cityproto/proto.js` | scene-graph/update を `cityCore` 委譲に置換（INTRO+mic は残す） | 改修 |
| `src/scenes/dots/GroundPlan.js` | 2D 図解マップ（ボツ） | 削除 |
| `tests/cityproto/cityCore.test.mjs` | cityCore の非描画契約（DOM/mic 非参照・決定論） | 新規 |
| `tests/cityproto/sceneAudioAdapter.test.mjs` | adapter の形変換 | 新規 |

**zオーダー（下→上）:** `#stage`(2D不透明) < `#city-gl`(WebGL, opacity可変) < `#ui`(DOM操作) < `#start`。`#stage` が `alpha:false` 不透明のため city は必ず `#stage` の上に置く。city 非アクティブ時 opacity=0、アクティブ時 opacity=fade。背景塗り抑制・SceneManager 改修は不要。

---

### Task 1: ベースライン確認とコア抽出の足場

**Files:**
- Test: 既存 `tests/` 全体
- Modify: なし（確認のみ）

**Interfaces:**
- Produces: 緑のベースライン（184 tests）＋ glb byte 不変の確認。

- [ ] **Step 1: 全テストが緑であることを確認**

Run: `cd /Users/shiwa/Claude-Atelier/VJ && npm test 2>&1 | tail -5`
Expected: `tests N` / `pass N` / `fail 0`（N は約184）。

- [ ] **Step 2: glb/manifest が未変更であることを確認**

Run: `git status --short -- tools/citybake/dist/`
Expected: 出力なし（空）。

- [ ] **Step 3: dev サーバーが :8125 で生きているか確認**

Run: `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8125/city-proto.html`
Expected: `200`。（落ちていれば起動: プロジェクト既定の dev サーバ起動コマンドで :8125 を立てる。）

- [ ] **Step 4: 単体ページの現状ベースラインを1枚撮る（回帰比較の基準）**

`http://localhost:8125/city-proto.html` を開き TAP TO START → 数秒後の俯瞰を 1 枚スクショして `shots/` に `city-before.png` として保存。これが Task 5 以降の「見た目不変」比較基準。

---

### Task 2: `cityCore` を抽出（scene-graph＋update、DOM/mic/RAF 非依存）

**Files:**
- Create: `src/cityproto/cityCore.js`
- Create: `tests/cityproto/cityCore.test.mjs`
- Modify: `src/cityproto/proto.js`（cityCore に委譲）

**Interfaces:**
- Consumes: 既存純粋モジュール群（`avenues/station/trees/particles/seasons/cityasset/camrig/director/reveal/intro/shotDirector/groundSampler/cityScope` — **すべて無改修**）。
- Produces:
  ```
  createCityCore({ THREE, renderer }) → core = {
    scene, camera, params,            // THREE オブジェクト（proto.js:23-25 相当）
    applyCamera(),
    resize(w, h),                     // renderer.setSize(w,h,false) + camera.aspect
    load(onProgress) → Promise<void>, // proto.js:216-303 のシーングラフ構築を内包。loadCity 済みなら再利用可
    update(dt, now, { audioState, driver, live, intro:bool }), // proto.js:110-141 のフレーム本体
    render(),                         // renderer.render(core.scene, core.camera)
    setShot(cfg), setScope(cfg),      // shotDir/cityScope.setConfig 委譲
    setMode(b), setStrobe(b), setStrobeRate(hz), setPetals(p), setTiming(p), setFraming(p),
    setSeason(i), seek(t), goLive(driver),
    dispose(),                        // geometry/material/texture dispose + scene clear
    refs: () => ({ trees, particles, reveal, intro, director, shotDir, cityScope, manifest, terrain })
  }
  ```
  - `update` の音源は**注入**。`driver`（liveDriver 互換: `isLive()/frame()/clock`）と `audioState` を呼び元が渡す。`live` フラグで INTRO/LIVE を切替。`intro:false` の呼び元（本体シーン）は director INTRO ブロックを完全スキップし、camera を ④ params に固定。
  - `core` は `window`・`document`・mic・`requestAnimationFrame` を**一切参照しない**（`getElementById('gl')` を renderer 注入に置換）。

- [ ] **Step 1: 失敗するテストを書く（cityCore が DOM/mic を参照しない契約）**

`tests/cityproto/cityCore.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const src = readFileSync(fileURLToPath(new URL('../../src/cityproto/cityCore.js', import.meta.url)), 'utf8');

test('cityCore は DOM/window/mic/RAF を参照しない（注入式）', () => {
  assert.ok(!/getElementById/.test(src), 'no getElementById');
  assert.ok(!/document\./.test(src), 'no document.*');
  assert.ok(!/requestAnimationFrame/.test(src), 'no RAF (caller owns the loop)');
  assert.ok(!/getUserMedia|AudioContext|createLiveDriver/.test(src), 'no mic ownership');
  assert.ok(/export function createCityCore/.test(src), 'exports createCityCore');
});
```

- [ ] **Step 2: テストが落ちることを確認**

Run: `node --test tests/cityproto/cityCore.test.mjs 2>&1 | tail -5`
Expected: FAIL（`cityCore.js` 不在 → import 解決失敗）。

- [ ] **Step 3: `cityCore.js` を実装（proto.js からロジックを移送）**

`proto.js` の以下を `createCityCore({THREE, renderer})` 内に移送する。**コードの中身は変えず、所有関係だけ注入式に変える**：
- `proto.js:23-31`（scene/camera/params/applyCamera）→ core 内ローカル。
- `proto.js:33-38`（resize）→ `core.resize(w,h)`（`innerWidth/innerHeight` を引数化）。
- `proto.js:42-72`（director/reveal/intro/trees/particles/… のモジュール状態）→ core 内ローカル。
- `proto.js:110-141`（loop 本体の director/driver 適用部）→ `core.update(dt, now, {audioState, driver, live, intro})`。`renderer.render` と overlay/debug は core 外（呼び元）に残す。
- `proto.js:183-199`（rebuildParticles/rebuildDirector）→ core 内。
- `proto.js:216-303`（loadCity → scene-graph 構築）→ `core.load(onProgress)`。`scene.add` 等は core.scene へ。`window.__proto.*` への代入は**除去**（呼び元が refs() で取得）。
- setter 群（`proto.js:161-178`）→ core メソッド。`seek/goLive/setPaused/setParallax/setMode/setStrobe/...` を core API へ。`goLive` は driver を引数で受ける。

実装の指針: `intro===false`（本体シーン）の時、`update` は `director.update` ブロック（proto.js:119-131）を実行せず、`Object.assign(params, kfInputs.full)` で ④ に固定し、`shotDir.apply` と `driver.frame`（LIVE）と `cityScope` のみ走らせる。

- [ ] **Step 4: `proto.js` を cityCore 委譲に書き換え（INTRO+mic は proto に残す）**

`proto.js` を次の薄い殻にする：
```js
import * as THREE from '../vendor/three.module.js';
import { createCityCore } from './cityCore.js';
import { makeOverlay } from './overlay.js';
import { createLiveDriver } from './liveDriver.js';

const glCanvas = document.getElementById('gl');
const renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setClearColor(0x07080a, 1);

const core = createCityCore({ THREE, renderer });
const driver = createLiveDriver();
let liveOverlayI = null;
function resize(){ core.resize(innerWidth, innerHeight); }
addEventListener('resize', resize); resize(); core.applyCamera();

let last = null;
function loop(now){
  if (last === null) last = now;
  const dt = Math.min((now - last)/1000, 0.05); last = now;
  core.update(dt, now, { audioState: driver.audio.state, driver, live: driver.isLive(), intro: true,
    setOverlayIntensity: (v)=>{ liveOverlayI = v; } });
  core.render();
  drawOverlay(); drawDebug();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
// ... #start mic gesture（proto.js:151-157 のまま）, #loading veil（:207-212,:301-307）,
//     keydown（:310-329）, window.__proto（core メソッドへ薄く委譲）, drawOverlay/drawDebug は proto に残置
```
`window.__proto.setShot/setScope/...` は `core.setShot/...` へ委譲。HUD・キー操作・DOM は無改修。

- [ ] **Step 5: cityCore テストが通ることを確認**

Run: `node --test tests/cityproto/cityCore.test.mjs 2>&1 | tail -5`
Expected: PASS（5 assertions）。

- [ ] **Step 6: 全テスト緑を確認**

Run: `npm test 2>&1 | tail -5`
Expected: `fail 0`。

- [ ] **Step 7: 単体ページが見た目不変であることをスクショ確認**

`http://localhost:8125/city-proto.html` を TAP → 数秒後の俯瞰を `shots/city-after-t2.png` に保存し、`city-before.png` と並べて**同一**であることを目視。INTRO 演出・LIVE（L キー）・季節（N）・strobe（S）が以前通り動くことも確認。差異があれば Step 3-4 を修正。

- [ ] **Step 8: コミット**

```bash
git add src/cityproto/cityCore.js tests/cityproto/cityCore.test.mjs src/cityproto/proto.js
git commit -m "refactor(city): proto から cityCore を抽出（DOM/mic/RAF 非依存の共有コア）"
```

---

### Task 3: 本体音源アダプタ `sceneAudioAdapter`

**Files:**
- Create: `src/cityproto/sceneAudioAdapter.js`
- Create: `tests/cityproto/sceneAudioAdapter.test.mjs`

**Interfaces:**
- Consumes: 本体 `AudioEngine.state`（`{ready,level,bass,mid,treble,beat,beatHold,bpm,spectrum,waveform}`）＋本体 `Clock`（`{beats,beatPhase}`）。
- Produces:
  ```
  createSceneAudioAdapter() → adapter = {
    audio: { state, sensitivity },     // liveDriver.audio 互換（state は下で update）
    clock,                             // {beats, beatPhase} を本体 clock から複製
    phase: 'live', started: true,
    feat, ps, knobs, modeConfig,       // liveDriver と同じ読み取り口（debug 用、最小実装可）
    isLive: () => true,                // 本体シーンは常に LIVE
    setColorMode(m), cycleColorMode(), setConfig(p),
    update(audioState, clock),         // 本体 state/clock を内部へ写し、live.js reducer を1ステップ進める
    frame(dt, now, ctx),               // liveDriver.frame と同じ ctx 契約（cityScope/shotDir/trees/particles/camera を駆動）
  }
  ```
  - `frame` は city core が LIVE で必要とする driver 契約を満たす最小実装。マイクは**持たない**。`live.js`（純粋 reducer）を再利用して drop 検出・knobs を動かす。

- [ ] **Step 1: 失敗するテストを書く（形変換とマイク非所有）**

`tests/cityproto/sceneAudioAdapter.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createSceneAudioAdapter } from '../../src/cityproto/sceneAudioAdapter.js';

const src = readFileSync(fileURLToPath(new URL('../../src/cityproto/sceneAudioAdapter.js', import.meta.url)), 'utf8');

test('adapter はマイクを持たず、本体 state/clock を取り込む', () => {
  assert.ok(!/getUserMedia|new AudioEngine|createAnalyser/.test(src), 'no mic');
  const a = createSceneAudioAdapter();
  assert.equal(a.isLive(), true, 'scene is always LIVE');
  a.update({ ready:true, level:0.5, bass:0.4, mid:0.3, treble:0.2, beat:false, beatHold:0, bpm:120, spectrum:new Uint8Array(1024), waveform:new Uint8Array(2048) }, { beats: 8, beatPhase: 0.25 });
  assert.equal(a.audio.state.level, 0.5, 'state mirrored');
  assert.equal(a.clock.beats, 8, 'clock mirrored');
});
```

- [ ] **Step 2: テストが落ちることを確認**

Run: `node --test tests/cityproto/sceneAudioAdapter.test.mjs 2>&1 | tail -5`
Expected: FAIL（モジュール不在）。

- [ ] **Step 3: `sceneAudioAdapter.js` を実装**

`liveDriver.js` を読み、その `frame(dt, now, ctx)` 本体（cityScope/shotDir/camera/season 駆動部）を、マイク所有部（`new AudioEngine()`/`start()`）抜きで再構成。`audio.state` と `clock` は `update(audioState, clock)` で外部から写す。`live.js` の純粋 reducer はそのまま import して使う（無改修）。`audio.sensitivity` は固定値 1 で可。

- [ ] **Step 4: テストが通ることを確認**

Run: `node --test tests/cityproto/sceneAudioAdapter.test.mjs 2>&1 | tail -5`
Expected: PASS。

- [ ] **Step 5: 全テスト緑を確認**

Run: `npm test 2>&1 | tail -5`
Expected: `fail 0`。

- [ ] **Step 6: コミット**

```bash
git add src/cityproto/sceneAudioAdapter.js tests/cityproto/sceneAudioAdapter.test.mjs
git commit -m "feat(city): 本体 AudioEngine.state を消費する sceneAudioAdapter（mic 共有）"
```

---

### Task 4: `index.html` に WebGL レイヤーと importmap を追加

**Files:**
- Modify: `index.html:33`（`#stage` の style 後に `#city-gl`）, `index.html:36`（canvas 追加）, `index.html:57`（importmap）

**Interfaces:**
- Produces: DOM 上に `<canvas id="city-gl">`（`#stage` の上・`opacity:0`）と three importmap。

- [ ] **Step 1: `#city-gl` の CSS を追加**

`index.html` の `<style>` 内（`#stage{...}` の後）に：
```css
    #city-gl {
      position: fixed;
      inset: 0;
      width: 100vw;
      height: 100vh;
      display: block;
      opacity: 0;            /* CityScene が draw() で alpha を書く */
      pointer-events: none;  /* タッチは下の #stage / 上の #ui が受ける */
      z-index: 1;            /* #stage(=0,不透明)の上、#ui の下 */
    }
```

- [ ] **Step 2: canvas 要素を追加**

`index.html:36` の `<canvas id="stage"></canvas>` の直後に：
```html
  <canvas id="city-gl"></canvas>
```

- [ ] **Step 3: three importmap を追加**

`index.html:57` の `<script type="module" src="./src/main.js"></script>` の**直前**に：
```html
  <script type="importmap">
  { "imports": {
    "three": "./src/vendor/three.module.js",
    "three/addons/": "./src/vendor/three-addons/"
  } }
  </script>
```

- [ ] **Step 4: 本体が今まで通り起動することを確認（dancers 不変）**

`http://localhost:8125/` を TAP → dancers が即起動し、`#city-gl` が透明で何も影響しないことをスクショ確認（`shots/main-dancers-t4.png`）。コンソールエラーが無いこと。

- [ ] **Step 5: コミット**

```bash
git add index.html
git commit -m "feat(city): index.html に #city-gl WebGL レイヤー（#stage の上）と three importmap"
```

---

### Task 5: 本体シーン `CityScene`

**Files:**
- Create: `src/scenes/city/CityScene.js`

**Interfaces:**
- Consumes: `createCityCore`（Task 2）, `createSceneAudioAdapter`（Task 3）, `Scene`（基底）, three。
- Produces:
  ```
  class CityScene extends Scene {
    constructor()                       // super('city', '国立シティ')
    init(ctx, w, h)                     // #city-gl に renderer 生成 → core 生成 → (先読み済みなら) ready
    preload()                           // glb を先読み開始（main.js から起動直後に呼ぶ）。Promise を返す
    update(dt, audio, palette, clock)   // adapter.update(audio, clock) → core.update(dt, now, {live:true, intro:false})
    draw(ctx, alpha)                    // core.render(); cityGl.style.opacity = alpha
    onResize(w, h)                      // core.resize(w,h)
    dispose()                           // core.dispose(); renderer.dispose(); opacity 0
  }
  ```
  - `update` は描画しない契約（Scene 規約）だが、WebGL は immediate でないため `core.render()` は `draw()` 側で呼ぶ。`update` は adapter/core の状態前進のみ。
  - load 未完なら `draw` は opacity を 0 のままにし、`ready` フラグ立後にフェード許可。

- [ ] **Step 1: `CityScene.js` を実装**

`src/scenes/city/CityScene.js`:
```js
import * as THREE from '../../vendor/three.module.js';
import { Scene } from '../Scene.js';
import { createCityCore } from '../../cityproto/cityCore.js';
import { createSceneAudioAdapter } from '../../cityproto/sceneAudioAdapter.js';

export class CityScene extends Scene {
  constructor() {
    super('city', '国立シティ');
    this.trail = 1;
    this._core = null; this._renderer = null; this._adapter = null;
    this._ready = false; this._loading = null; this._cityGl = null; this._now = 0;
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
    }).catch((e) => console.error('[city] preload failed', e));
    return this._loading;
  }
  init(ctx, w, h) { this.w = w; this.h = h; this._ensureCore(); this.preload(); }
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
  dispose() {
    if (this._cityGl) this._cityGl.style.opacity = 0;
    if (this._core) this._core.dispose();
    if (this._renderer) this._renderer.dispose();
  }
}
```

- [ ] **Step 2: 構文・import 解決の確認（headless）**

Run: `node -e "import('./src/scenes/city/CityScene.js').then(()=>console.log('import ok')).catch(e=>{console.error(e.message);process.exit(1)})" 2>&1 | tail -3`
Expected: three が DOM/WebGL を要するため import 時にエラーになり得る。**最低限「構文エラーが無い」**ことを確認（`Unexpected token` 等が出ないこと）。WebGL/DOM 由来のエラーは許容（本体ブラウザで検証）。

- [ ] **Step 3: 全テスト緑を確認**

Run: `npm test 2>&1 | tail -5`
Expected: `fail 0`（CityScene は registry 未接続なのでまだ本体に影響しない）。

- [ ] **Step 4: コミット**

```bash
git add src/scenes/city/CityScene.js
git commit -m "feat(city): 本体 Scene 契約の CityScene（#city-gl renderer・即LIVE・opacity フェード）"
```

---

### Task 6: registry 差し替え（GroundPlan 削除 → CityScene 追加）

**Files:**
- Modify: `src/scenes/registry.js:7`（import 除去）, `:26`（インスタンス差し替え）
- Delete: `src/scenes/dots/GroundPlan.js`

**Interfaces:**
- Consumes: `CityScene`（Task 5）。
- Produces: シーン配列に `city` が含まれ `groundplan` が消える。

- [ ] **Step 1: GroundPlan を参照しているテスト/コードを洗い出す**

Run: `grep -rn "GroundPlan\|groundplan" src/ tests/ --include=*.js --include=*.mjs`
Expected: `registry.js:7`, `registry.js:26` 以外に参照があれば、それも本タスクで整理（保存設定・auto-pilot index 依存・専用テスト）。出力を確認してから次へ。

- [ ] **Step 2: registry を書き換え**

`src/scenes/registry.js`:
- `:7` の `import { GroundPlan } from './dots/GroundPlan.js';` を削除。
- 先頭付近に `import { CityScene } from './city/CityScene.js';` を追加。
- `:26` の `new GroundPlan(),` を `new CityScene(),` に置換。

- [ ] **Step 3: GroundPlan.js を削除**

Run: `git rm src/scenes/dots/GroundPlan.js`

- [ ] **Step 4: 全テスト緑を確認（GroundPlan 専用テストがあれば併せて削除済みであること）**

Run: `npm test 2>&1 | tail -8`
Expected: `fail 0`。GroundPlan を import していたテストが残って落ちる場合は、その参照を除去/削除。

- [ ] **Step 5: 本体でシーン一覧に「国立シティ」が出て切替できることをスクショ確認**

`http://localhost:8125/` を TAP → 操作パネルで「国立シティ」に切替 → 街がフェードインし、音（スピーカー）に反応すること、dancers へ戻れることをスクショ（`shots/main-city-t6.png` / `shots/main-back-dancers-t6.png`）。

- [ ] **Step 6: コミット**

```bash
git add src/scenes/registry.js
git commit -m "feat(city): registry で GroundPlan を CityScene に差し替え（2D図解マップ廃止）"
```

---

### Task 7: 起動時バックグラウンド先読み

**Files:**
- Modify: `src/main.js:44-58`（`startApp` 内で city 先読みを fire-and-forget 起動）

**Interfaces:**
- Consumes: `scenes.byId['city']`（CityScene インスタンス、`preload()` を持つ）。
- Produces: dancers 即起動を保ったまま、city glb がバックグラウンドで読み込まれ、切替時には準備完了。

- [ ] **Step 1: `startApp` に先読みを追加**

`src/main.js` の `engine.start();`（`:44`）の後に：
```js
  // 国立シティ(16MB)を起動直後にバックグラウンド先読み。dancers の即起動は妨げない
  // (fire-and-forget)。読み込み完了まで city は opacity 0 のまま、切替時にフェードイン。
  const cityScene = scenes.byId['city'];
  if (cityScene && cityScene.preload) cityScene.preload();
```

- [ ] **Step 2: dancers が即起動し、数秒後に city が切替可能になることを確認**

`http://localhost:8125/` を TAP → dancers が即出ること（先読みでカクつかない）をスクショ。数秒後に「国立シティ」へ切替 → 待ち時間ほぼ無しでフェードインすることを確認（`shots/main-preload-t7.png`）。Network タブで city.glb がバックグラウンド取得されていること。

- [ ] **Step 3: 全テスト緑を確認**

Run: `npm test 2>&1 | tail -5`
Expected: `fail 0`。

- [ ] **Step 4: コミット**

```bash
git add src/main.js
git commit -m "feat(city): 起動直後に city glb をバックグラウンド先読み（dancers 即起動は維持）"
```

---

### Task 8: 統合監査（クロスフェード・PWA precache・glb 不変・最終回帰）

**Files:**
- Modify: 必要に応じて（監査で判明した不具合のみ）
- Check: `sw.js`

**Interfaces:**
- Produces: 統合完了の確証（見た目不変・dancers 不変・glb byte 不変・テスト緑）。

- [ ] **Step 1: PWA precache が 16MB glb を載せていないことを確認**

Run: `grep -n "city.glb\|city.manifest\|ASSETS\|CACHE_VERSION" sw.js`
Expected: `sw.js` の precache 一覧（ASSETS）に `city.glb`/`city.manifest.json` が**含まれない**こと。含まれていれば除外（city はネットワーク取得のまま）。network-first 方針なら実害が無いことを確認し、必要なら除外。

- [ ] **Step 2: 双方向クロスフェードの監査**

`http://localhost:8125/` で dancers→city→dots→city を数回往復切替し、(a) フェードが両方向で破綻しない、(b) city アクティブ時に 2D シーンの残像が透けない、(c) city→他へ切替で `#city-gl` が opacity 0 に戻る、をスクショ（`shots/xfade-*.png`）。破綻があれば CityScene.draw の opacity 制御 / SceneManager.fade 整合を修正。

- [ ] **Step 3: city の見た目が単体ページと一致することを確認**

`http://localhost:8125/city-proto.html`（L キーで LIVE）と本体の city シーンを同条件で並べ、街・カメラ・CityScope の見た目が一致することをスクショ比較（`shots/parity-proto-vs-scene.png`）。

- [ ] **Step 4: glb/manifest が byte 不変であることを最終確認**

Run: `git status --short -- tools/citybake/dist/`
Expected: 出力なし（空）。

- [ ] **Step 5: 全テスト緑を最終確認**

Run: `npm test 2>&1 | tail -8`
Expected: `fail 0`（cityCore + sceneAudioAdapter の新規テスト込み）。

- [ ] **Step 6: 不具合修正があればコミット、無ければ Task 完了を記録**

```bash
git add -A
git commit -m "fix(city): 統合監査で判明した不具合を修正（クロスフェード/precache 等）" # 修正があった場合のみ
```

---

## Self-Review（plan 作成後の照合）

- **Spec coverage:** spec の 6 コンポーネント（A cityCore / B CityScene / C #city-gl レイヤー / D 先読み / E GroundPlan 削除 / F 単体ページ薄殻化）→ Task 2 / 5 / 4 / 7 / 6 / 2(proto 委譲) で全てカバー。マイク共有(spec 5)=Task 3。
- **守る線:** glb byte 不変=Task1/8、見た目不変=Task2/8、dancers 不変=Task4/7、二重化禁止=Task2(共有コア)。全て検証ステップ有り。
- **未確定だった点の解決:** 先読み方式=「CityScene.preload() を main.js が起動直後に呼ぶ」に確定（Task5/7）。背景抑制=「#city-gl を #stage の上に置く」で SceneManager 改修不要に確定（Task4）。INTRO/LIVE=即LIVE（intro:false で director スキップ、Task2/5）。
- **型整合:** `createCityCore({THREE,renderer})` / `core.update(dt,now,{audioState,driver,live,intro})` / `core.load(onProgress)` / `core.goLive(driver)` / `createSceneAudioAdapter()→{update,frame,isLive,audio,clock}` / `CityScene.preload()` — Task 間でシグネチャ一致。
- **既知の不確実性（実機検証が要る）:** iPad で 2D `#stage` + WebGL `#city-gl` 同時生成の GPU/メモリ成立（Task6/8 実機スクショで確認）。cityCore 抽出は「proto.js のロジックを所有関係だけ注入式に移送」＝挙動は単体ページの回帰スクショ（Task2 Step7）で担保。
