# GroundPlan 3D立体化フェーズ — 設計

- 日付: 2026-06-24
- 対象シーン: `src/scenes/dots/GroundPlan.js`（承認済み平面地図ベース: commit `b583a67`）
- 種別: 既存シーンの拡張（フェーズ2 = 立体化）

## Context（なぜ / 背景）

承認済みの平面地図（国立の道路網 + 駅起点の回路通電）を土台に、**通電完了後に街が3Dで立ち上がる**最終ゴールへ進む。
ユーザーの確定方針:

- 流れは **通電(平面) → 街が3Dで起き上がる → 保持 → 沈む → 再構築（ループ）** のひと続き。
- **範囲 / カメラ / 高さ性格 / 描画スタイル** の4軸を、それぞれ**独立に切替可能**にする（VJ楽器型）。
- 美学は既存どおり monochrome（Ikeda / Kraftwerk、虹色グロー禁止）。赤は駅ノードのみ。

3D版の実績コードは checkpoint `5bd28e3` に保全済み（弱透視 yaw/pitch 投影・モノクロ階調シェーディング・裏面カリング・
遠→近ソート・LIVEヴァンテージ walker・build/sink ループ）。本フェーズはその**仕組みを新しい正しいジオメトリに載せ替える**。

## Goal / Non-Goals

**Goal**: 平面地図から建物が立ち上がる3D都市。4軸（範囲/カメラ/高さ/スタイル）を独立切替。rise→hold→sink→rebuild のループ。
音量が立ち上がり速度と「呼吸」を駆動。承認済み2D（通電・ジオメトリ・モノクロ）はそのまま土台。

**Non-Goals**: 実建築ディテール（駅舎の実屋根形状の精密再現）、テクスチャ、影、ライトの動的計算。建物は**抽象的な押し出しボリューム**
（Kraftwerk的）に留める。平面地図のジオメトリ自体の変更（承認済みのため凍結）。

## アーキテクチャ

### 全体方針（確定した3判断）
1. **現 GroundPlan を拡張**。新規シーンは作らない。通電→立体化→ループを同一シーンで連続させる。
2. **`modeGroups` 汎用機構を新設**（Scene + ControlPanel に追加・後方互換）。4軸を独立したラベル付きボタン群で出す。
3. **3Dエンジンは `5bd28e3` / FallingCubes の仕組みを流用**（弱透視投影・階調バケツ・裏面カリング・遠近ソート・vantage walker）。

### フェーズ状態機械
`this._phase ∈ { ENERGIZE, RISE, HOLD, SINK }`。ビート時計（`clock.beats/beatPhase`）で進行。

```
ENERGIZE  現状の通電（_front 0→1, wavefront）。完成して一拍保持 →
RISE      カメラが傾き始め、建物が footprint から near→far に押し出される（_rise 0→1）。音量+STALL駆動 →
HOLD      3D都市を保持。カメラは Cam モードに従い動く（LIVE walker 等）。SEC_BEATS×数セクション →
SINK      建物が平面へ収縮（_rise 1→0, 音非依存レートで停止しない）。カメラ俯瞰へ復帰 →
          → RISE へ戻る（再構築 = 再立ち上げ。地図は通電済みのまま保持）。ループ。
```

- 初回のみ `ENERGIZE → RISE`。以降のループは `RISE ↔ HOLD ↔ SINK`（平面地図は通電済みを保持し、3D都市が毎周「再構築」される）。
- 新状態は既存の `_front`（通電）に加え `_rise`（0..1 立体化量）と `_phase` を導入。`_rise` は near→far スイープ（block の
  駅からの距離キーで局所的に立ち上がる、通電と同じ要領）。

### modeGroups 機構（フレームワーク追加・後方互換）
- `src/scenes/Scene.js`: 任意の `this.modeGroups`（`[{ key, label, options:[string], index }]`）と
  `setModeGroup(key, i)` / `mg(key)`（現在 index 取得）を追加。既存 `modes`/`views` は不変。
- `src/ui/ControlPanel.js` `_rebuildSceneControls()`: `modes`/`views` 描画の後に `scene.modeGroups` を走査し、
  group ごとにラベル付きボタン行を生成（クリックで `setModeGroup` → 再構築）。`modeGroups` 未定義のシーンは影響なし。

### GroundPlan が定義する4軸（default ★）
| key | label | options（buttonラベル）| 意味 |
|---|---|---|---|
| `scope` | 範囲 | ★`District` / `City` / `Landmark` | 内=立体都市/外=平面 ／ 街全体3D ／ ランドマークのみ |
| `cam` | カメラ | `Tilt` / ★`Live` / `Plan` | 俯瞰→3/4固定 ／ 視点が動く ／ ほぼ俯瞰 |
| `height` | 高さ | ★`Vary` / `Even` / `Pulse` | 街区変化+ランドマーク ／ 均一 ／ 音で脈動 |
| `style` | スタイル | ★`Hybrid` / `Wire` / `Solid` | 面+輪郭 ／ 輪郭のみ ／ 面のみ |

読み出しは `this.mg('scope')` 等。HUD 表示にも現モード名を出せる。

## コンポーネント詳細

### 1. 建物 footprint 生成（`_buildBlocks()`）
平面ジオメトリ（凍結済み）から押し出し対象の footprint を一度だけ生成。各 block = `{ uMin,uMax,vMin,vMax, hNorm, key, kind }`
（`key` = 駅からの距離 0..1 で near→far スイープ順、`kind` = landmark/inside/outside）。

- **ランドマーク（先頭固定・キャップで落とさない）**: 駅舎タワー（apex、細く高い）、一橋大学 西/東（`CAMP` 矩形、広く低い）。
- **内側街区**: ホームベース内の格子セル（隣接する N-S/E-W 格子線の間）を block 化。spine/avenue 回廊・campus は除外。
- **外側街区**: 外側格子セルを block 化（`City` スコープ時のみ押し出し、低め）。
- 上限 `MAX_BLOCKS ≈ 240`（landmark優先で iteration 順にキャップ）。density スライダーで増減。

### 2. 範囲 Scope（どの footprint を立てるか）
- `District`: 内側街区 + ランドマークのみ押し出し。外側格子は**平面のまま地面**として描画。
- `City`: 内側 + 外側 + ランドマーク（外側は低め・暗め）。
- `Landmark`: ランドマークのみ押し出し。街区・格子は平面。

### 3. 高さ Height（hNorm の決め方）
- `Vary`: block ごとに noise 由来の高さ + spine 寄りで高め、ランドマーク強調（駅最高・campus 広低）。
- `Even`: ほぼ均一高（ランドマークのみ僅かに別格）。
- `Pulse`: 高さ = base + 音の帯域（領域で bass/mid/treble を割当）。イコライザー的に脈動。

### 4. カメラ Camera（pitch/yaw 制御）
- `Tilt`: RISE で pitch を俯瞰→約0.6rad に lerp、以降固定。yaw 僅か。
- `Live`（default）: RISE 後、`LIVE_VANTAGES` を crossfade する walker で pitch/yaw が遊ぶ（旧版流用）。
- `Plan`: pitch を俯瞰寄りに保ち軽いあおりのみ（低い起伏）。

### 5. 描画スタイル Style（面の描き方）
- `Hybrid`: 面塗り + 明るい輪郭。
- `Wire`: 輪郭のみ（面の可視エッジを stroke）。
- `Solid`: 面塗りのみ。
- いずれも階調は `bg→fg` のトーンバケツ（accent 不使用、虹色なし）。

### 6. 3Dレンダリング（流用）
`5bd28e3` / FallingCubes と同型: 弱透視 `_project/_pv`（focal = FOCAL×H）、`BOX_F`（top+4壁、床省略）、world法線シェーディング、
camera法線z 裏面カリング、面を遠→近にソート、アロケーションフリーな投影バッファ。駅ノードの赤菱形のみ saturated。

平面の地面線（通電済みの道路網・外側格子）は3D投影面に乗せて一緒に描く（`District` で外側を地面として残すため）。

## 美学・性能
- monochrome 厳守（Ikeda/Kraftwerk）。accent は駅ノードのみ。`light` 等のシェード強度はスライダー。
- 性能: `MAX_BLOCKS` キャップ、投影/面バッファ再利用、`clock.quality` で負荷時に面・格子を間引き。
- パラメータ（スライダー）: 既存 `buildSpeed`/`density`/`avenueWidth`/`trail` を維持。3D用に `light`（陰影強度）・
  `riseSpeed`（立ち上がり速度）を追加（必要に応じて）。

## 変更ファイル
- `src/scenes/Scene.js` — `modeGroups` / `setModeGroup` / `mg` 追加（後方互換）。
- `src/ui/ControlPanel.js` — `modeGroups` のボタン行描画を追加。
- `src/scenes/dots/GroundPlan.js` — フェーズ状態機械・`_buildBlocks`・3D投影/描画・4軸モードを追加（平面ジオメトリ部は凍結）。
- `sw.js` — 変更不要（GroundPlan は登録済み）。

## 既存資産の再利用
- 投影/シェーディング: 旧 GroundPlan(`5bd28e3`) と `src/scenes/dots/FallingCubes.js`。
- math: `clamp/lerp/smoothstep/map/rgbCss/lerpRgb`（`src/lib/math.js`）、`SimplexNoise`（`src/lib/noise.js`、高さ noise 用）。
- audio/clock: 既存 `audio.level/bass/beatHold`、`clock.beats/beatPhase/beatJustWrapped/quality`。

## Verification（実機・スクショで検証）
`[[verify-visual-before-claiming]]` に従い、報告前にスクショで実物確認。

1. preview_start → `groundplan`。ENERGIZE→RISE→HOLD→SINK→（再）RISE のループが回ることを確認。
2. 4軸×代表組合せをスクショ:
   - Scope: District/City/Landmark で押し出し範囲が変わる。
   - Camera: Tilt/Live/Plan でアングル挙動が変わる（Live で視点が動く）。
   - Height: Vary/Even/Pulse で高さ分布が変わる（Pulse は音で上下）。
   - Style: Hybrid/Wire/Solid で面の描き方が変わる。
3. modeGroups ボタンが ControlPanel に4行出て、クリックで切替＋他シーンに影響が無いこと。
4. monochrome 厳守（赤は駅ノードのみ、虹色なし）、console エラーなし、負荷時のFPSを確認。
5. 平面地図（2D, b583a67 の見え）が壊れていないこと（ENERGIZE段階・District外側の地面）。

## Open Questions（実装中に詰める）
- 高さ noise の具体レンジ・ランドマーク強調量（スクショ反復で調整）。
- HOLD の長さ（SEC_BEATS×セクション数）・SINK レート（旧版 0.26 相当を起点に調整）。
- `City` 外側の到達範囲と暗さ（地面格子と被らない見せ方）。
