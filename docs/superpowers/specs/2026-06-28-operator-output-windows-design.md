# 操作／出力 二画面 VJ（オペレーター・アウトプット分離）設計

**日付:** 2026-06-28
**対象:** 本体VJアプリ（`index.html` → `src/main.js`、Canvas2D + WebGL PWA）
**目的:** 一般的なVJソフト（Resolume/VDMX 等）と同じ「操作画面を客先に見せず、クリーンな映像だけを投影する」二画面モデルを、PC/Mac の拡張ディスプレイ運用で実現する。サーバー不要・GitHub Pages のまま。

---

## ゴール

1台のPC/Macで、**操作ウィンドウ**（パネル＋プレビュー、ラップトップ画面）と**出力ウィンドウ**（パネル無しのクリーン映像、プロジェクター側ディスプレイで全画面）を分離する。両ウィンドウは同一ブラウザ・同一オリジンの `BroadcastChannel` で同期する。映像・シーン・音反応ロジックは一切変更しない。

## アーキテクチャ概要

- **役割は1つのURLフラグで分岐**（同じ `index.html`・同じコードを再利用＝DRY）:
  - **operator（既定）**: 現状のアプリ＋「出力を開く」ボタン＋自前 rAF で状態を配信。マイクを取得し、パネルとプレビューを表示。
  - **output（`?role=output`）**: スタート画面・パネル・マイク・AudioContext すべて無し。黒画面で自動起動し、受信状態から同じシーンを描画し、クリックで全画面。
- **通信は `BroadcastChannel('vj')`**。同一ブラウザ内の全ブラウジングコンテキスト（タブ/ウィンドウ）で共有されるため、`window.open('?role=output')` で開いた出力ウィンドウと自動的に繋がる。WebRTC/WebSocket/バックエンド不要。
- **決定論による一致**: シーンは入力（audio.state, palette, clock）が決まれば決定論的（hash01のみ・RNG/Date無）。同じシーン＋同じパラメータ＋同じ音 ⇒ 見た目が一致。完全なピクセル一致ではない（独立rAF・残像蓄積のわずかな差）が、駆動は同一＝ハードウェアVJ出力と同じ挙動。

## コンポーネント / ファイル構成

既存エンジンは無改変。薄い「通信＋役割」層を足すだけ。

### 新規

- **`src/sync/RemoteAudio.js`** — 出力モード用の音源スタブ。`AudioEngine` と同形の `.state`（`{ ready, level, bass, mid, treble, beat, beatHold, bpm, spectrum:Uint8Array, waveform:Uint8Array }`）を持ち、`update()` は no-op、`start()` は即解決の no-op。受信フレームで `.state` を上書きされる。AudioEngine の内部には一切依存しない。
- **`src/sync/snapshot.js`** — 純粋関数群（DOM/THREE/BroadcastChannel 非依存・`node --test` 可）:
  - `buildControlSnapshot({ scenes, palette, overlay }) → object` … アクティブ `sceneId`・`modeIndex`・`viewIndex`・`modeGroups` の各 index・`params` の値・パレット index＋brightness/contrast/accent/invert・overlay の grain/scanlines/vignette/hud を読む。
  - `applyControlSnapshot(snap, { scenes, palette, overlay }) → void` … 上記を出力側のオブジェクトへ反映。`scenes.goto` は変化時のみ。`params` は値設定＋`onChange` 呼び出し（city の `setShot`/`setScope` 駆動）。`modeGroups` は `setModeGroup(key,i)`、`mode` は `setMode(i)`、`view` は `setView(i)`。
  - `controlsEqual(a, b) → boolean` … operator の差分検出用。
  - `buildFrame(audioState) → object` … `level/bass/mid/treble/beat/beatHold/bpm` ＋ `spectrum`/`waveform`（型付き配列）を含むコンパクトなフレーム。
  - `applyFrame(frame, remoteAudio) → void` … `remoteAudio.state` を上書き。
- **`src/sync/link.js`** — `BroadcastChannel('vj')` のラッパ:
  - `createOperatorLink({ getAudioState, getControlSources }) → { start(), stop() }` … 自前 rAF で毎フレーム `frame` を post。`buildControlSnapshot` を毎フレーム計算し `controlsEqual` で差分があれば `control` を post。出力からの `hello` 受信で現在の `control` を即 post（後発参加の同期）。`hello` 受信で接続状態を通知（コールバック）。
  - `createOutputLink({ remoteAudio, controlTargets, onControl }) → { start(), stop() }` … `frame` 受信で `applyFrame`、`control` 受信で `applyControlSnapshot`＋最新 snapshot を保持（scene-ready 時の再適用用）。読み込み時に `hello` を1回 post。

### 改修

- **`src/main.js`** — 先頭で `new URLSearchParams(location.search).get('role')` を判定し分岐:
  - **output**: `RemoteAudio` を構築（`AudioEngine` は構築しない＝Context無）。`#start` を即非表示、`ControlPanel` は生成しない。`Engine` を構築し、`createOutputLink` を起動、`engine.start()` を即実行。**city を preload**（`_core` 先行生成）。`requestWakeLock()`。出力ウィンドウ内クリックで全画面（`toggleFullscreen`）＋「クリックで全画面」ヒント表示。デバッグキー（`d`）はバインドしない。**シーン切替/再init時に最新 control snapshot を冪等再適用**（`SceneManager.onChange` フック等で `applyControlSnapshot` を再実行）。
  - **operator（既定）**: 現状フローのまま＋`startApp` 内で `createOperatorLink` を起動（`getAudioState=()=>audio.state`、`getControlSources={scenes,palette,overlay:engine.overlay}`）。
- **`src/ui/ControlPanel.js`** — PERFORM 行に**「出力を開く」**ボタン（`window.open('?role=output','vj-output')`）。小さな接続インジケータ（operator link の `hello` 受信で「出力:接続」点灯、ベストエフォート）。
- **`sw.js`**（デプロイ時のみ） — `ASSETS` に `src/sync/RemoteAudio.js`・`src/sync/snapshot.js`・`src/sync/link.js` を追加し、`CACHE_VERSION` を v16→v17 へ。`?role=output` はオフライン時 `caches.match(e.request)` がミスしても `caches.match('./index.html')` にフォールバックするため別エントリ不要。

## データフロー

```
[operator window]
 mic → AudioEngine.state ─┐
 ControlPanel → scenes/palette/overlay ─┐
                          rAF(self)      │
 createOperatorLink ──── frame(audio全体, 毎rAF) ──┐
                    └─── control(差分 or hello応答) ─┤  BroadcastChannel('vj')
                                                     │
[output window]                                      │
 createOutputLink ◀──────────────────────────────────┘
   frame  → applyFrame → RemoteAudio.state
   control→ applyControlSnapshot → scenes.goto/setMode/setModeGroup/params.onChange,
                                   palette.set/setBrightness…, overlay.grain/scan/vignette/hud
 Engine._loop(remoteAudio,…) → scenes.update → drawFrame   (Engine 無改変)
 scene切替/ready → 最新snapshot再適用（cityCore 再生成時のノブ復元）
```

- フレーム量: スカラ7＋`spectrum`/`waveform`（各〜1KB）＝約2KB/フレーム×60Hz。同一マシンの structured clone では無視できる負荷。
- 役割は一方向（operator は送信のみ・output は受信のみ）。エコー/ループ無し。

## エラー処理・エッジケース

- **後発参加 / 出力リロード**: output が `hello` を post → operator が現在の `control` を即返す。frame は常時流れているので audio は即追従。
- **city の load 順**: output は起動時に city を preload（`_core` 先行生成）し、`setShot`/`setScope` が `shotOpts`/`scopeOpts` に蓄積される。さらに scene-ready 時に control を再適用するため、city→他→city と往復して `_core` が再生成されても操作側のノブ値が復元される。
- **GPU 二重描画**: 1台で両ウィンドウが描画。Canvas2D シーンは軽い。WebGL の国立シティのみ二重コスト。緩和レバー（必要時のみ・YAGNIで初期は入れない）: 操作プレビューを30fps間引き／縮小（客先出力は常時フルレート）。
- **全画面ジェスチャ**: 出力ウィンドウの全画面はその窓自身のユーザー操作が要る → クリックで `toggleFullscreen`、Esc で解除。
- **複数 operator**: 単一 operator を前提（複数開くと frame が競合）。本バージョンでは未対応として明記。
- **デバッグ HUD**: 出力はデバッグキー（`d`）をバインドしない。VIEW トグル（grain/scan/vignette/hud）は operator の意図として忠実にミラーする。

## テスト

- **単体（`node --test`・DOM不要）**:
  - `buildControlSnapshot` → `applyControlSnapshot` → `buildControlSnapshot` の往復一致（fake scenes/palette/overlay）。
  - `applyControlSnapshot` が fake `CityScene` の `setModeGroup`・`params.onChange` を正しく呼ぶ。
  - `controlsEqual` が値差を検出する。
  - `buildFrame`/`applyFrame` の往復で `spectrum`/`waveform`（型付き配列）が保持される。
  - `RemoteAudio.state` が `AudioEngine.state` とキー互換。
  - 既存全テスト（190）green を維持。
- **ヘッドレス（[[verify-visual-before-claiming]]）**:
  - `?role=output` ページが黒で自動起動し、テストフックから注入した `frame`＋`control` で正しいシーンへ切替・param 反映することを DOM/描画で確認。
  - operator ページで「出力を開く」が `window.open` を呼ぶことを確認。
- **手動（実機・最終）**: 拡張ディスプレイで出力ウィンドウをプロジェクター側へドラッグ→全画面。操作ウィンドウでシーン/パラメータ変更が出力へ追従。国立シティの operator パネル制御（カメラ/SCOPE 等）が出力へ伝播。

## 守る線（不変条件・厳守）

- mono/strobe≤3Hz/決定論（hash01のみ・RNG/Date無）/`dist/city.glb`・`dist/city.manifest.json` byte不変（再ベイク無し）/dancers・dots 既存シーン不変/iPad PWA。
- 映像・シーンのコードは無改変。Engine も無改変（operator link は自前 rAF）。本作業は「通信＋役割」層のみ。
- iPad は従来通り単体（全部入り1画面）動作のまま。iPad リモート→別PC出力（ネットワーク同期）は本スコープ外（将来フェーズ・サーバー要）。

## 補足: 国立シティ操作パネルが「出ない」件の決着

調査で確定: ローカルコードでは city の操作パネル制御（5モードグループ・18ボタン・5スライダー）は**正常に描画される**（ヘッドレス＋スクショ実証）。`sw.js` は network-first（オンラインは常に最新JS取得・キャッシュはオフライン専用）なので SW は犯人ではない。原因は**未push**＝デプロイ版 `origin/main`（`035c9ef`）がパネル制御コミット 41b8142 の前。本作業を**デプロイ（push＋CACHE_VERSION v17）する時点で、city制御＋二画面が同時に本番反映**され解消する（iPad版も同コードで同時解決）。

## 重要ファイル一覧

- 新規: `src/sync/RemoteAudio.js`・`src/sync/snapshot.js`・`src/sync/link.js`・`tests/sync/snapshot.test.mjs`
- 改修: `src/main.js`（role 分岐）・`src/ui/ControlPanel.js`（出力を開くボタン＋接続表示）・`sw.js`（デプロイ時 ASSETS＋CACHE_VERSION）
- 参照（無編集）: `src/engine/Engine.js`（フレームループ・入力契約）・`src/audio/AudioEngine.js`（`.state` 形）・`src/scenes/city/CityScene.js`（modeGroups/params）・`src/cityproto/cityCore.js`（`setShot`/`setScope` 永続化）
