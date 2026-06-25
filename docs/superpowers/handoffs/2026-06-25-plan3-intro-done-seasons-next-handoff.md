# ハンドオフ — Plan 3 イントロ一式（step 1-3）完了 → 次は step 4 四季の並木

**日付:** 2026-06-25
**ブランチ:** `feat/city-webgl-render`（未マージ・保持。`main`=2D配信版で安全）
**ステータス:** **step 1-3（カメラリグ／建物 ripple／地形・道路の intro reveal）完了・視覚検証済み。59 tests green。ただし未コミット**（working tree に保持中）。次は **step 4＝大学通り並木のモノクロ四季**。

設計の全体像は spec を必ず読む: [docs/superpowers/specs/2026-06-25-plan3-seasonal-reveal-design.md](../specs/2026-06-25-plan3-seasonal-reveal-design.md)

---

## 0. ユーザーのビジョン（確定）

4サイクル＝四季のシネマティック・ループ（時間ベース、音は後）。
- **1サイクル＝往復**: ① 旧駅舎寄り → ② 扇 → ③ 市街（長め固定＝見せ場）→ ④ 全域 → **ゆっくり逆ドリーで①へ沈む**。
- **4サイクル＝春→夏→秋→冬**、冬の次は春へループ。大学通りの並木が季節を運び、③ の長め hold で見せる。
- **リビールはイントロで1回**（地形→道路→建物が組み上がる）。以後は街は建ったまま、カメラ往復＋並木の季節変化のみ。
- **2モード**: 既定＝モノクロ厳守（守る線）。`C` キーで季節色モードにトグル（step 6）。
- カメラ動作: ストレート・ドリー＋微パララックスの両方、`P` で A/B。

## 1. ここまでの実装（step 1-3、未コミット）

すべて additive・buildless ESM・three は vendored。`update(now)` 系は純粋関数で node テスト済み。

| File | 役割 | テスト |
|---|---|---|
| [src/cityproto/ease.js](../../../src/cityproto/ease.js) | 純粋 easing（緩急の語彙）＋ `byName` | ease.test.mjs（5） |
| [src/cityproto/camrig.js](../../../src/cityproto/camrig.js) | 4フレーミング `makeKeyframes`／`lerpParams`／`applyParallax`。① は landmark の matrixWorld から | camrig.test.mjs（7） |
| [src/cityproto/director.js](../../../src/cityproto/director.js) | **マスタータイムライン** `createDirector({keyframes})`→`{update(tSec)→{cam,reveal,season},cycleDur,segments,tuning}`。名前付きセグメント、③長 hold、逆ドリー、季節 index、reveal は absolute time の smoothstep（1回・latch） | director.test.mjs（8） |
| [src/cityproto/reveal.js](../../../src/cityproto/reveal.js) | 建物 ripple。`buildRevealAttributes`（純粋）＋`installReveal(THREE,mesh,perBuilding)`→`{material,setProgress,maxRevealKey}`。per-vertex `aReveal`/`aBaseY`＋`onBeforeCompile` | reveal.test.mjs（2） |
| [src/cityproto/intro.js](../../../src/cityproto/intro.js) | 地形格子＋道路の opacity reveal。`stagger`（純粋）＋`installIntroLayers({gridMaterials,roadMaterials})`→`{setTerrain,setRoads}` | intro.test.mjs（2） |
| [src/cityproto/proto.js](../../../src/cityproto/proto.js)（M） | bare loop → **マスタークロック loop**。director/reveal/intro を結線。`window.__proto` に制御 API。キー操作 | — |

**proto.js loop の要**（[proto.js](../../../src/cityproto/proto.js)）:
```
const f = director.update(tSec, { parallax });
Object.assign(params, f.cam); applyCamera();
if (reveal) reveal.setProgress(f.reveal.buildings);
if (intro) { intro.setTerrain(f.reveal.terrain); intro.setRoads(f.reveal.roads); }
```
毎フレームCPUほぼゼロ（1.55M頂点の変位は全GPU）。loop はアセット到着後（`loadCity().then` 内で director 等を構築）。

**制御 API（`window.__proto`）**: `seek(t)` / `setPaused(b)` / `setParallax(b)` / `state()` / `director`（`.tuning` をライブ編集→即反映） / `reveal` / `intro` / `keyframes` / `city` / `manifest`。
**キー**: `Space` pause、`[` `]` scrub ±1s、`P` パララックス。

**緩急 tuning（director.tuning、秒）**: `hold1 1.2, out12 2.5, hold2 1.0, out23 3.0, holdMid 5.0, out34 2.5, hold4 1.2, reverse 4.0`（cycleDur 20.4）。reveal 窓: `terrainWin [0,2.5], roadWin [1.2,4.7], buildWin [4.7,9]`。すべて目で見て調整→確定後に既定へ焼く。

## 2. ★ 重要な技術的発見（必読・step 4 でも効く）

glb は **`KHR_mesh_quantization`**。頂点シェーダの `position.y` は**生の 0..65535 ローカル値**で、ワールド変換は**ノード/モデル行列**に乗る。よって reveal は**ローカル空間で完結**: `aBaseY` = 各建物の頂点範囲の**生 position.y 最小**、`transformed.y` を model 行列**前**で編集。検証済み（p=1 が既存コミット描画と一致＝床が DEM に密着）。**step 4 で並木にシェーダ変位を入れる場合も同じ注意**（trees の InstancedMesh は別ジオメトリだが、icosahedron は素の position なので素直。ただし instanceMatrix のスケールと併用に注意）。

## 3. 視覚検証（実物確認済み）

dev サーバー: `.claude/launch.json` の `vj`(8125、ThreadingTCPServer)。preview_start → reload。**実プレビュー窓は 667px 幅**（800 等に emulate-resize すると screenshot に黒帯が出る＝アーティファクト。canvas 自体は正しい）。画像は `shots/<name>.jpg` に保存し `http://localhost:8125/shots/<name>.jpg` URL で渡す（[[image-delivery-via-localhost]]、実物確認後に報告 [[verify-visual-before-claiming]]）。
- 4フレーミング: `shots/plan3_framings.jpg`
- 建物 ripple: `shots/plan3_ripple.jpg`（p=0/0.4/1）
- intro レイヤ順: `shots/plan3_intro_layers.jpg`（ground→格子→通電→建物）

検証 tip: ループが毎フレーム reveal/intro を上書きするので、特定段を見るには `setPaused(true)` ＋ setter を一時 no-op に差し替えて手動駆動（手順は本セッションの eval 参照）。

## 4. 次の本丸 — step 4: 大学通り並木のモノクロ四季

**現状の [trees.js](../../../src/cityproto/trees.js)（untracked）**: `buildTrees(manifest, terrain)` → 単一 InstancedMesh（icosahedron canopy、縦グレーグラデ vertex color、green rects 散布＋大学通り両側並木、DEM raycast 着地、`userData.revealKey=99`）。proto.js は現状 `scene.add(buildTrees(...))`（mesh をそのまま add）。

**step 4 でやること（spec §「木々 季節システム」）**:
1. `buildTrees` の戻りを **`{ group, update(season, mode, dt), setMode(mode) }`** に変更（proto.js 呼び出し側も更新：現状 `if(terrain){trees=buildTrees(...); scene.add(trees);}` → `scene.add(trees.group)`、loop で `trees.update(f.season, mode, dt)`）。
2. **avenueMesh（大学通り並木＝季節の主役）と scatterMesh（緑地散布＝控えめ・`uScatterDamp`）に分割**。
3. per-instance 属性（`InstancedBufferAttribute`）: `aPhase`（並木 v軸 0..1＝染める stagger。大学通り v 0.195→3.530）、`aSeed`（jitter/間引き/後の strobe）。
4. canopy material も `MeshBasicMaterial` を `onBeforeCompile`。uniforms: `uSeason`（0..3 float、季節跨ぎは小数で blend）、`uSeasonProg`（0..1）、`uMode`（0=mono,1=color）、`uTime`、（step5 で `uStrobe`）。**scale/density/tone は shader 内で `uSeasonProg`+`aSeed`+`aPhase` から算出（instanceMatrix 再書き込みしない＝再ライティングしない）**。
5. **モノ季節カーブ（seasons.js 新規＝両モードの単一真実源）**:
   - 春 桜: canopy が白へ明るく、`aPhase` vs `uSeasonProg` の smoothstep で**並木を下流へ染める**。終盤 thin（scale→0 を `aSeed` 閾値で）。
   - 夏 新緑→濃緑: scale 満ちて密、tone を明→暗グレー。
   - 秋: tonal shimmer（`uTime`·`aSeed` 微ノイズ）、thin（疎へ）。
   - 冬: 疎な canopy＋crown を白へ（雪）。ストロボは step 5。
6. **季節 index/prog は director から**（`f.season = {index,prog,name}`、③ hold で prog≈1 に到達済）。季節跨ぎの blend は trees 側で index+prog から。
7. **色は触らない（mono 既定）**。`uMode` のみで `mix(monoGrey, seasonColor, uMode)`（COLOR_PALETTE は step 6）。

**残り**: step 5＝粒子（花びら/落ち葉/雪、`THREE.Points` 1系統使い回し、GPU 駆動 fall、~1.5-3k）＋冬ストロボ（白・≤3Hz・`S`キー＋ゲート）。step 6＝季節色モード（`COLOR_PALETTE`、`C`キー crossfade via `EnvelopeFollower`）＋キー操作。

**温存の扱い**: trees.js／proto.js の木々結線は **採用済み**（step 4 で trees.js を上記に拡張・proto 呼び出し側更新）。捨てない。

## 5. 守った線（不変条件・厳守）

- **モノクロ厳守**（既定）。白＝大学通り・富士見・旭・中央線のみ。雪/ストロボは無彩白で許容。色は `uMode` 後ろの opt-in のみ。虹色/グロー無し。
- 道路は位置・id 判定（baked、変更しない）。reveal/intro は道路 tier ロジックに触れない。
- iPad PWA / buildless ESM / three vendored。アニメは camera/uniform 駆動（静的unlit・再ライティングしない）。
- 2D配信地図・他VJシーンは不変。baked 資産（glb/manifest）不変。

## 6. 検証

- `node --test`（全体）＝**59 green**。`node --test tests/cityproto/*.test.mjs` で cityproto 群。
- ベイク不変: `node --test tools/citybake/tests/citybake/*.test.mjs`（32 green）。
- preview で step ごとに実物スクショ確認（§3）。

## 7. ★ コミット状態（重要）

**step 1-3 は未コミット**。`git status`:
- `M src/cityproto/proto.js`
- `?? src/cityproto/{ease,camrig,director,reveal,intro}.js`
- `?? src/cityproto/trees.js`（温存・step 4 で拡張）
- `?? tests/cityproto/{ease,camrig,director,reveal,intro}.test.mjs`
- `?? docs/superpowers/specs/2026-06-25-plan3-seasonal-reveal-design.md`
- `?? docs/superpowers/handoffs/2026-06-25-plan3-intro-done-seasons-next-handoff.md`（本書）

→ 次セッション冒頭で **step 1-3＋spec＋handoff をコミット**してから step 4 着手を推奨（trees.js は step 4 で大きく変わるので、コミットに含めるか step 4 完了時に一緒にするか判断）。

## ▶ 次回キックオフ（このまま貼れる）

> 国立シティ写実WebGLレンダ Plan 3 の続き。ブランチ `feat/city-webgl-render`。**step 1-3（カメラリグ＝①②③④の往復ループ＋逆ドリー／建物の駅から距離 ripple reveal／地形格子・道路通電の intro reveal）完了・視覚検証済み・59 tests green、ただし未コミット**。ハンドオフ `docs/superpowers/handoffs/2026-06-25-plan3-intro-done-seasons-next-handoff.md` と spec `docs/superpowers/specs/2026-06-25-plan3-seasonal-reveal-design.md` を読んで。まず step 1-3＋spec＋handoff をコミット。次の本丸は **step 4＝大学通り並木のモノクロ四季**（trees.js を `{group,update,setMode}` に拡張、avenue/scatter 分割、per-instance `aPhase`/`aSeed`、canopy を onBeforeCompile で季節 uniform 駆動：春=白く染め stagger／夏=濃く密／秋=shimmer+疎／冬=疎+雪。粒子・ストロボは step5、色モードは step6）。守る線＝モノクロ厳守（色は uMode 後ろの opt-in）／位置・id 判定／iPad PWA buildless ESM／再ライティングしない。**glb は KHR_mesh_quantization** に注意（シェーダ変位はローカル空間で）。画像は `:8125/shots/` URL で。
