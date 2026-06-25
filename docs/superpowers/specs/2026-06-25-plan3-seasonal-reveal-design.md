# 設計書: Plan 3 — 段階ズームアウトの四季リビール演出

作成日: 2026-06-25
ブランチ: `feat/city-webgl-render`
ステータス: ドラフト（ユーザーレビュー待ち）
前提spec: [2026-06-24-kunitachi-city-photoreal-render-design.md](2026-06-24-kunitachi-city-photoreal-render-design.md)

## Context（なぜ作るのか）

国立シティ写実WebGLレンダは、地形・道路・建物・木々の素材を**全レイヤー即表示**している（[proto.js](../../../src/cityproto/proto.js)）。本丸の演出 = **段階ズームアウトのリビール**がまだ無い。ユーザーのビジョンは「ズームイン序盤 → 段階的にズームアウト → 国立市全域で少し固定。緩急（段）が肝」。

ブレストでこれが大きく育った: 単発のリビールではなく、**カメラの往復を1サイクルとし、4サイクルで春夏秋冬を巡る持続ループ**。大学通りの並木が季節を運ぶ。守る線（モノクロ厳守）は維持しつつ、**季節色モードを切替機能として併設**する。

## 合意した design（確定要件）

### 1. カメラの旅 — 4フレーミング
① **旧国立駅舎に寄り**（ランドマーク＝主役）→ ② **扇**（大学通り・富士見・旭の白い扇）→ ③ **市街**（中ズーム・**長め固定**）→ ④ **全域**（国立市全域＝現 `params`）。各フレーミングはカメラ paramキーフレーム。間は ease で繋ぐ（緩急: 平らな溜め＝緩、ease の引き＝急。③ の hold を ①② より長く）。

### 2. 1サイクル＝往復
①→②→③（長め hold）→④ → そのあと **ゆっくり逆ドリーで ④→① に沈む**（次の季節へ）。

### 3. 4サイクル＝春→夏→秋→冬
冬の次は春へループ。各サイクルで大学通りの並木がその季節を巡り、**③ 市街の長め hold で見せ場**。

### 4. リビールはイントロで1回だけ
最初の外向き（春の ①→④）で **地形（格子が立つ）→ 道路（通電スイープ）→ 建物（駅から距離 ripple で rise）** が組み上がる。以後は街は建ったまま、カメラ往復＋並木の季節変化のみ。地形・道路・建物は季節で変わらない。

### 5. 2つのパレットモード（切替機能）
- **デフォルト = モノクロ厳守**（守る線: 白は大学通り・富士見・旭・中央線のみ。他はグレー。虹色/グロー無し）。
- **キー押下で季節色モードにトグル**（春ピンク / 夏 緑 / 秋 黄→橙→赤 / 冬）。両方実装、モノクロが既定。後で ControlPanel に出す。

### 6. 並木の季節表現
モノクロモード = **明度・密度・落下粒子・冬の白ストロボ**で表現。季節色モード = 同じ density/scale カーブに hue を乗せる。
- **春 桜**: canopy が明るく開花（モノ=白へ、色=ピンク）。`aPhase` で**並木を下流へゆっくり染める**。花びらが散って落ち、間引かれる。
- **夏 新緑→濃緑**: canopy が満ちて密に。tone が深まる（明→暗グレー / 薄緑→濃緑）。
- **秋**: tonal shimmer、落ち葉、間引かれて疎へ（色=黄→橙→赤→黄）。
- **冬**: 疎な canopy に白い雪、そして **Christmas ライト＝白ストロボが並木を流れる**（最も Ikeda な瞬間。色=黄スタート→雪→ストロボ）。

### 7. カメラ動作 2種
**ストレート・ドリーアウト**と**微パララックス**（引きながら僅かに旋回/高度ドリフト）の両方を実装し、トグルで A/B して目で見て決める。

### 8. 音連動
**今は実装しない**（時間ベース）。ただしタイムラインは**名前付きセグメント**で組み、後で音が各セグメントを駆動できる構造にする。別途提案。

## アーキテクチャ（追加 module、すべて `src/cityproto/`）

すべて additive。2D配信地図・他VJシーンは不変。import は `../vendor/three.module.js` と `../lib/math.js`（`clamp/lerp/smoothstep/hslRgb` 等が既にある）。

| File | Export | 責務 |
|---|---|---|
| `ease.js`（新） | `easeInOutCubic` 他 + `byName` | 純粋スカラ easing。緩急の語彙。 |
| `director.js`（新） | `createDirector({station, landmarkMesh, scale})` → `{update(now), params}` | **マスタータイムライン**。名前付きセグメント（intro＋loop、③長 hold、逆ドリー）。毎フレーム camera params / reveal進捗(0..1, intro のみ) / season state を計算。`update(now)` は now の純関数＝スクラブ可。 |
| `camrig.js`（新） | `makeKeyframes`, `sampleCamera`, `applyParallax` | 4フレーミング＋補間＋パララックス variant。① は landmark の `matrixWorld` から導出。 |
| `reveal.js`（新） | `installReveal(buildingsMesh, perBuilding)` → `{material, setProgress(p)}` | per-vertex `aReveal`/`aBaseY` を構築し unlit material を `onBeforeCompile` で patch。`uReveal` で駅から距離 ripple。**モノクロ安全（Y のみ変位、色不触）**。 |
| `seasons.js`（新） | `SEASON_NAMES`, `MONO_PALETTE`, `COLOR_PALETTE`, `seasonTone()` | `(seasonIndex, prog, mode)` → canopy tone/scale/hue/粒子フラグ。両モードの単一真実源。 |
| `trees.js`（拡張） | `buildTrees(manifest, terrain, opts)` → `{group, update(season, mode, dt), setMode(mode)}` | 季節駆動の並木＋緑地散布、花びら/落ち葉/雪の粒子、冬ストロボ、モノ↔色切替。既存の seeded layout＋DEM raycast は維持。 |

### proto.js への結線
`loadCity().then` 内で systems を構築（`installReveal` → `buildings.material` 差し替え、`buildTrees` → `scene.add(trees.group)`、`createDirector`）。`loop()` をマスタークロック化:
```
const f = director.update(now);     // {cam, reveal, season}
Object.assign(params, f.cam); applyCamera();
reveal.setProgress(f.reveal);       // intro 後は 1 に固定
trees.update(f.season, mode, dt);
renderer.render(scene, camera); drawOverlay();
```
`params`/`applyCamera` は流用（director が毎フレーム params を供給）。**毎フレームCPUはほぼゼロ**（1.55M頂点の変位は全GPU、tree更新は uniform のみ＝再ライティングしない）。loop はアセット到着後に開始（director/reveal/trees の null を回避）。

## ★ 重要な技術的発見（Plan agent が検証）

glb は **`KHR_mesh_quantization`**。POSITION は UNSIGNED_SHORT（0..65535）で、ワールド変換は**ノード行列**（buildings node の translation/scale）に乗る。つまり頂点シェーダの `position.y` は**生の量子化ローカル値**であってワールド Y ではない。

→ reveal シェーダは**ローカル空間で完結**させる:
- `aBaseY` = 各建物の頂点範囲 `[vStart, vStart+vCount)` における**生 `position.y` の最小値**（マニフェストの world `baseY=planHeight*VSCALE` は使わない＝誤り）。
- `onBeforeCompile` で `transformed.y = mix(aBaseY, transformed.y, smoothstep(aReveal-uBand, aReveal, uReveal))`。`transformed` はモデル行列**適用前**なので、沈んだ床も正しいワールド高にマップされる。
- `revealKey = hypot(u,v)` ＝駅からの距離。footprint は OSM 順（距離順でない）なので `setDrawRange` では放射 ripple にできない → **per-vertex 属性方式が必須**。

検証必須: step 2 で建物の床が DEM に密着する（浮かない/沈まない）こと。

## 建物 reveal の詳細
ロード後・初回描画前に perBuilding（24,816）を走査し `aReveal`/`aBaseY`（Float32×1.55M ≈ +12.4MB GPU）を構築。`MeshBasicMaterial` を `onBeforeCompile`（ShaderMaterial 新規ではなく＝vertexColors/unlit/quantization を Three に任せる）。`setProgress(p)` は `uReveal = p * maxRevealKey(≈7.873)`。intro の `intro.buildings` 中のみ 0→1、以後 1 固定。**色は一切触らない**（COLOR_0 の AO×光は不変）。

## 木々 季節システム
- `avenueMesh`（大学通り並木＝季節の主役）と `scatterMesh`（緑地散布＝控えめ・`uScatterDamp`）に分割。
- per-instance 属性: `aPhase`（並木 v軸 0..1＝染める stagger）、`aSeed`（jitter/strobe/間引き閾値）。
- canopy material も `MeshBasicMaterial` を `onBeforeCompile`、uniforms: `uSeason/uSeasonProg/uMode/uPalette/uStrobe/uTime`。scale/density/tone は shader 内で `uSeasonProg`+`aSeed` から（行列再書き込み無し）。色モードは `mix(monoGrey, seasonColor, uMode)`＝モノが既定、色は uniform 1つ。
- 粒子: `THREE.Points` 1系統を季節で使い回し（~1.5–3k、`params.petalCount`）。落下は頂点シェーダで `mod(uTime-aBirth, life)`＝CPU respawn 無し。
- 冬ストロボ: `uStrobe` で並木を白点滅が流れる。**安全策**: ≤3Hz、in/out ランプ、白のみ、`S` キー＋`params.strobeEnabled` でゲート。

## モード切替・操作（city-proto 段階）
proto.js に additive keydown:
- `C` モノ↔季節色（`trees.setMode`、`EnvelopeFollower` で ~0.6s クロスフェード）
- `P` パララックス variant トグル（A/B）
- `Space` director クロック pause/resume
- `[` `]` 時間スクラブ（`update(now)` が純関数なのでクロックoffsetだけ）
- `S` 冬ストロボ トグル
ライブ調整: `window.__proto.director.params`（segDur, holdMidScale, parallaxAmt, revealBand, petalCount, strobeRate, 4キーフレーム camera params…）。毎フレーム params を読むので即反映＝**緩急を目で見て詰める**。確定後に既定へ焼く。

## 温存物の採否（handoff §2）
`trees.js`（untracked）と `proto.js` の木々3 hunk（import/buildTrees呼び/window.__proto.trees）は**採用**。本 Plan で trees.js を季節システムへ拡張し、proto.js 呼び出し側を新 return 形（`{group, update, setMode}`）に更新してコミット。

## 建物 reveal/カメラ以外の intro reveal（軽量）
- 地形 格子: `terrainGrid`（LineSegments）の opacity 0→target を `intro.terrain` で（必要なら Y rise は後）。
- 道路 通電: avenue `Line`（per-road, [avenues.js:34](../../../src/cityproto/avenues.js)）の opacity を staggered に `intro.roads` で。**道路の tier ロジックは不変**（守る線）。

## 建てる順（各段、dev preview で単体検証）
1. **`ease.js`＋`camrig.js`＋`director.js`（カメラのみ）＋loop 結線** — 街は全表示固定、①→②→③(長)→④→逆ドリーを目で確認。**肝＝ここで緩急/キーフレームを詰める**。① が旧駅舎を正しくフレーミング（matrixWorld）、④ が現行と一致。
2. **`reveal.js`（建物 ripple）** — 量子化前提を視覚検証（床が DEM 密着）。色不変・1回再生・以後固定。perf 確認。
3. **地形＋道路の intro reveal（軽量）** — terrain→roads→buildings が連続して読めるか。
4. **`trees.js` 拡張＋`seasons.js`（モノ季節）** — proto 呼出側を新 return 形に更新。スクラブで各季節を確認（粒子はまだ）。
5. **粒子＋冬ストロボ** — iPad で滑らかさ、count/rate 調整、安全 cap。
6. **季節色モード＋キー操作** — モノ既定・色は綺麗な opt-in・モノで白が予約通り。確定 timing/keyframe を既定へ焼く。

## リスクと対策
- **量子化の取り違え**（最重要）: `position.y` を world と誤解 → `aBaseY` は生 `position.y` 最小、`transformed.y` を model 行列前で編集。step2 で床密着を視覚確認。
- **onBeforeCompile 脆さ**: three は r160 vendored 固定。`#include <common>`/`<begin_vertex>` アンカーは安定。
- **GPU メモリ +12.4MB**: iPad 可だが監視。必要なら `aBaseY` を Uint16（生 position.y のミラー）で半減。
- **粒子 count / ストロボ comfort**: cap＋ライブ調整、ストロボ ≤3Hz・白のみ・ゲート。
- **モノクロ忠実度**: reveal は色不触、木々モノは輝度のみ、雪/ストロボは無彩白（許容）。`C` off で予約白以外に hue が無いことを確認。
- **音は後**: director は名前付きセグメント＋`update(now)` 純関数なので、後から音がクロック/進捗を駆動するだけ＝構造変更不要。

## 検証
- 各 step を dev preview（`.claude/launch.json` の `vj`=8125 → `http://localhost:8125/city-proto.html`）で。reload 後 `width<=800` に resize＋`dispatchEvent(new Event('resize'))`。
- 画像は `shots/<name>.jpg` に保存し `http://localhost:8125/shots/<name>.jpg` の URL で提示（[[image-delivery-via-localhost]]）。実物スクショ確認後に報告（[[verify-visual-before-claiming]]）。
- 既存テスト緑維持: `node --test tools/citybake/tests/citybake/*.test.mjs`（ベイク不変）。

## 非目標
- 音連動（別提案）。建物/地形/道路の季節変化。他VJシーン・2D配信地図の変更。完全フォトリアル。
