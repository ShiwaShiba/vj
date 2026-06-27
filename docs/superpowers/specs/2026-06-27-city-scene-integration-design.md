# 国立シティ（WebGL）を本体VJのシーンに統合 — Design

**日付:** 2026-06-27
**ブランチ:** `feat/city-scene-integration`

## ゴール

本体VJアプリ（`index.html` → `src/main.js`）のシーン切替に「国立シティ（WebGL / three.js）」を1つのシーンとして追加する。ユーザーは dancers / dots と同じ感覚で「国立シティ」へ切り替えられる。音・マイクは本体と共有。古い2D版 GroundPlan シーンは削除する。単体お試しページ `city-proto.html` は残すが、本体シーンと**同じコア**を共有する薄い殻に作り替える。

これは「製品統合」フェーズ（残り約30-40%）の実装。CityScope 等のcity内部機能は完成済みで、本作業はそれを本体に**接続**するだけで、cityの見た目・挙動は一切変えない。

## ユーザーが承認した決定（このセッション）

1. **統合の形 = シーンとして切替**（背景合成でも入口メニューでもない）。本体1アプリの中で city を選べる1シーンにする。
2. **GroundPlan（2D図解マップ）はボツ・削除**。WebGL city がその正式な後継。
3. **16MBの街データは起動時にバックグラウンド先読み**（dancers は即起動を維持、city へ切り替える頃には準備完了）。
4. **`city-proto.html` 単体ページは残す**。ただし本体シーンと同一コアを共有し、ロジックの二重化を防ぐ。
5. **マイクは本体と共有**（city 専用の AudioEngine は本体では使わない）。マイク許可1回で全シーンが同じ音に反応。

## 核心的な技術制約（設計の土台）

- 本体は `#stage` という**1枚の Canvas2D**（`Canvas.js:8` `getContext('2d')`）を全13シーンで共有し、`SceneManager.drawFrame`（`SceneManager.js:103`）が `draw(ctx2d, alpha)` を `globalAlpha` で重ねてクロスフェード合成する immediate-mode 2D パイプライン。
- 1つの canvas 要素は 2D と WebGL を同時に持てない。**three.js は `#stage` の2Dコンテキストには描けない**。
- ゆえに city は**自前の WebGL canvas**を持ち、本体の2Dレイヤーと**重ねて**表示する。クロスフェードは city canvas の **CSS opacity** で行う（2Dシーン同士の trail 混じりクロスフェードとは別物だが、city は自前の film grain overlay を持つため見た目の劣化なし）。これがユーザーが体感する唯一の差異。
- city の重い処理は既にモジュール化・大半が純粋（`director` / `camrig` / `shotDirector` / `cityScope` / `scopeModes` / `live.js` / `intro` は THREE-free or pure）。`liveDriver.js:3-4` は「将来の本番シーン化で唯一書き換えるファイル」として設計済み。摩擦は `proto.js` が「アプリ起動の世話」と「シーン本体」を混在させている点のみ。

## 現状アーキテクチャ（探索で確定した事実）

### 本体VJ
- `index.html:36` `<canvas id="stage">`（全描画面）, `:37` `<div id="ui">`, `:38` `<div id="start">`, `:57` `<script type="module" src="./src/main.js">`。importmap は無い。
- `main.js:18-21` シングルトン生成（AudioEngine, Clock, PaletteManager, `SceneManager(createScenes())`）, `:24` `new Canvas(...)`, `:25` `scenes.attach(canvas.ctx,w,h)`, `:26` `scenes.start('dancers')`, `:28` `new Engine({...})`, `:31` `window.__vj`, `:35-59` `startApp()`（tap→engine.start→audio.start 非ブロッキング）。
- `Engine.js:31-42` RAF loop: `audio.update` → `clock.update` → `palette.update` → `scenes.update(dt, audio.state, palette, clock)` → `scenes.drawFrame(ctx,w,h,palette,audio)`。
- `registry.js:16-32` `createScenes()` は**インスタンス配列**を返す（先頭=起動既定）。GroundPlan は `:7` import / `:26` `new GroundPlan()`。
- `Scene.js:26-31` 契約: `init(ctx,w,h)` / `onResize(w,h)` / `update(dt,audio,palette,clock)` / `draw(ctx,alpha)` / `drawHud(ctx,w,h,info)` / `dispose()`。SceneManager が毎フレーム `this.audio/palette/clock` を注入。`audio` は `AudioEngine.state`（read-only）。
- `AudioEngine.js:29-36` state 形: `{ ready, level, bass, mid, treble, beat, beatHold, bpm, spectrum:Uint8Array, waveform:Uint8Array }`。
- `SceneManager.js`: `:28 attach(ctx,w,h)`（単一ctx保存）, `:37 start(id)`（即時）, `:46 goto(id)`（next+fade=0 でクロスフェード）, `:103 drawFrame`（`:111-112` 背景/trail を fillRect、`:114-115` active→next 描画、`:121-126 _drawScene` が `save/restore`+`globalAlpha=alpha`）。

### city プロト
- `proto.js` は import 時に全実行（クラス・関数 export 無）。`:18-21` `new THREE.WebGLRenderer({canvas:#gl})`, `:23` Scene, `:24` PerspectiveCamera, `:33-39` resize（`innerWidth/innerHeight`）, `:75` `createLiveDriver()`, `:110-147` 自前 RAF `loop`（停止手段なし）, `:151-157` `#start` pointerdown→`beginAudio()`→`driver.start()`, `:159-179` `window.__proto` API（setShot/setScope 他）, `:207-212` 読込ベール, `:216` `loadCity('./tools/citybake/dist/city.glb', …)`, `:310-329` キー操作。
- DOM 直接依存: `#gl` / `#ov` / `#loading`(+`#loadfill`/`#loadlabel`) / `#start`。HUD `#shothud`/`#scopehud` は `city-proto.html` のインライン script が `window.__proto.setShot/setScope` を叩くのみ（疎結合）。
- 音: `proto.js` は Web Audio に触れず、`liveDriver.js:23` が `new AudioEngine()`（自前マイク）を所有。`live.js` は純粋。
- glb 実サイズ: **16,789,152 bytes（約16MB）**, `cityasset.js:10-15` `GLTFLoader().loadAsync` + manifest fetch（streamed progress）。

## 設計（6コンポーネント）

### A. `cityCore` — city の「中身」を括り出す（新規）

**ファイル:** `src/cityproto/cityCore.js`（新規）

`proto.js` の「シーン本体ロジック」だけを抽出した工場関数。three.js は使うが **DOM・マイク・RAF・window.__proto は持たない**。

```
createCityCore({ THREE, renderer, scene, camera }) → {
  load(onProgress): Promise<void>     // loadCity + 全シーングラフ構築（trees/particles/avenues/station/reveal/intro/cityScope/director/...）
  update(dtSec, tSec, audioState):     // director.update + camera apply + trees/particles/reveal/intro/cityScope frame
  render():                            // renderer.render(scene, camera)
  resize(w, h):
  setShot(cfg) / setScope(cfg):        // shotDir.setConfig / cityScope.setConfig へ委譲
  setPaused / seek / goLive / setMode / setStrobe / setSeason / ...  // 既存 __proto API をメソッド化
  dispose():                           // GPU リソース解放（geometry/material/texture dispose）
}
```

- **`audioState` 注入式**: `update` は外から音特徴（本体 `AudioEngine.state` 互換、または liveDriver の出力）を受け取る。city 自身はマイクを開かない。
- `proto.js` の loadCity `.then` ブロック（`:216-303`）と loop 本体（`:110-147`）の中身がここへ移る。renderer/scene/camera は**注入**（`getElementById('gl')` をやめる）。
- 既存の純粋モジュール（director/camrig/shotDirector/cityScope/scopeModes/intro/trees/particles/...）はそのまま import して使う。**それらのファイルは無改変**。

### B. 本体シーン `CityScene`（新規）

**ファイル:** `src/scenes/city/CityScene.js`（新規, `src/scenes/Scene.js` を継承）

本体の Scene 契約を満たす薄いラッパ。中身は `cityCore` に委譲。

- `id='city'`, `name='国立シティ'`。
- `init(ctx, w, h)`: 自前 `WebGLRenderer` を `#city-gl` canvas に生成 → `cityCore.create(...)` → 先読み済みなら即 ready、未完なら `load()` 進捗を待つ。
- `update(dt, audio, palette, clock)`: 本体 `audio`（=AudioEngine.state）を `cityCore.update(dt, clock.tSec, audio)` に渡す。**マイク共有**。
- `draw(ctx, alpha)`: `cityCore.render()` を呼び、`#city-gl` の `style.opacity = alpha`。本体2D ctx には描かない（背景 fillRect が city を消さないよう、city アクティブ時は本体 trail/背景塗りを抑制 — 詳細は実装計画で確定）。
- `onResize(w,h)`: `cityCore.resize(w,h)` + renderer.setSize。
- `dispose()`: `cityCore.dispose()` + renderer.dispose() + `#city-gl` を opacity 0/非表示。RAF は本体 Engine が回すので city 側 RAF は持たない。

### C. WebGL レイヤーの DOM 追加

**ファイル:** `index.html`（改修）

- `#stage`（2D）の**下**に `<canvas id="city-gl">` を追加（同 inset:0 / 100vw×100vh / 既定 `opacity:0` / `pointer-events:none`）。
- three を解決する importmap を `index.html` にも追加（`"three": "./src/vendor/three.module.js"`, `"three/addons/": "./src/vendor/three-addons/"`）。

### D. 起動時バックグラウンド先読み

**ファイル:** `src/main.js`（改修）

- `startApp()`（`:35-59`）の後、本体起動を妨げずに city の `load()` をバックグラウンド起動（fire-and-forget）。
- city シーンは load 完了まで「読込中…」状態。`SceneManager`/UI で未完なら city 切替を保留 or プレースホルダ表示。完了で切替可能化。
- 先読みは `CityScene` の renderer/core を生成しておく方式（init を起動直後に呼ぶ）か、core だけ先に load する方式 — 実装計画で1つに確定。

### E. GroundPlan 削除

**ファイル:** `src/scenes/registry.js`（改修）, `src/scenes/dots/GroundPlan.js`（削除）

- `registry.js:7` の import と `:26` の `new GroundPlan()` を除去し、`new CityScene(...)` を追加。
- `src/scenes/dots/GroundPlan.js`（scene id `'groundplan'`）を削除。GroundPlan 専用のテスト/参照があれば併せて整理。

### F. 単体ページを薄い殻に

**ファイル:** `city-proto.html`（基本維持）, `src/cityproto/proto.js`（改修）

- `proto.js` は renderer/scene/camera/RAF/読込ベール/マイク手配/キー操作/`window.__proto` の「アプリ起動の世話」だけを残し、シーン本体は `cityCore` を呼ぶ。
- 単体ページのマイクは今まで通り `liveDriver` 経由（`cityCore.update` に liveDriver 出力を渡す）。HUD スライダー・キー操作は現状維持。
- `city-proto.html` の DOM/HUD は無改変（`window.__proto` API 形は維持）。

## データフロー（統合後）

```
本体: Engine RAF → audio.update → AudioEngine.state
   → scenes.update(dt, state, palette, clock)
        └ CityScene.update → cityCore.update(dt, clock.tSec, state)
   → scenes.drawFrame → CityScene.draw(ctx, alpha)
        └ cityCore.render() ; #city-gl.opacity = alpha

単体: proto.js RAF → liveDriver.frame → audioState
   → cityCore.update(dt, tSec, audioState) ; cityCore.render()
```

両経路が**同一 `cityCore`** を呼ぶ＝真実1ヶ所。

## テスト戦略

- **純粋ロジックは既存テスト維持**: `scopeModes.test.mjs` 等 184 テストは無改変で green。`cityCore` 抽出で純粋モジュール（director/cityScope/scopeModes/...）のシグネチャを変えない。
- **`cityCore` の契約テスト**（新規, headless 可能な範囲）: `create` が DOM/マイクを参照しないこと、`update` が audioState 注入で決定論的に動くこと（THREE/WebGL を要する描画は除く）。可能なら THREE/renderer をスタブ。
- **回帰の要**: 統合前後で city の見た目が一致すること、GroundPlan 削除で本体が壊れないこと、dancers 即起動が保たれること、を実機/スクショで確認（[[verify-visual-before-claiming]]）。

## 守る線（不変条件）

- city の見た目・挙動は**一切変えない**（統合は接続作業）。mono / ≤3Hz strobe / 決定論 / glb・manifest byte 不変（再ベイク無し）/ INTRO・terrain・landmark・station・道路・木々・particles・seasons・camera 不変。
- 本体 dancers/dots の既存シーンは**byte 不変**（registry の GroundPlan 行除去と CityScene 追加、main.js の先読み追記、index.html のレイヤー追加を除く）。
- dancers の即起動を維持（16MB は非ブロッキング先読み）。
- 単体ページと本体は同一 `cityCore` 共有＝ロジック二重化禁止。
- buildless ESM / iPad PWA / three vendored。
- PWA precache（`sw.js`）に 16MB glb を載せて肥大させない（city はネットワーク取得のまま — 実装計画で `sw.js` 方針確定）。

## リスクと監査ポイント（統合事故の防止）

1. **2層 canvas の合成**: city アクティブ時、本体の背景 fillRect / trail が city を黒塗りで消さないか。`drawFrame` の背景塗りを city シーンで抑制する必要 — 最優先で検証。
2. **renderer 二重化 / コンテキストロス**: 本体に WebGL renderer を追加。iPad で 2D `#stage` + WebGL `#city-gl` 同時生成が GPU/メモリ的に成立するか実機確認。
3. **クロスフェード**: opacity フェードと本体の `fade` タイマの整合。city→dancers / dancers→city の双方向で破綻しないか。
4. **マイク共有のアダプト**: `cityScope`/`liveDriver` が期待する音特徴の形と本体 `AudioEngine.state` の形のズレ（bands 配列 vs bass/mid/treble 等）。
5. **先読みの状態管理**: load 未完で city へ切り替えた時の挙動（保留/プレースホルダ）。
6. **GroundPlan 削除の波及**: registry index ずれ、auto-pilot ループ、GroundPlan を指す保存設定やテスト。

## 重要ファイル一覧

- **新規**: `src/cityproto/cityCore.js` / `src/scenes/city/CityScene.js` / `tests/cityproto/cityCore.test.mjs`
- **改修**: `index.html`（#city-gl + importmap）/ `src/main.js`（先読み）/ `src/scenes/registry.js`（GroundPlan→city）/ `src/cityproto/proto.js`（cityCore 委譲）/ 必要なら `src/scenes/SceneManager.js`（city アクティブ時の背景抑制）/ `src/cityproto/liveDriver.js`（audioState 注入の口）
- **削除**: `src/scenes/dots/GroundPlan.js`
- **無改修（参照）**: director/camrig/shotDirector/cityScope/scopeModes/intro/trees/particles/avenues/station/seasons/cityasset/groundSampler/overlay
