# ハンドオフ — 旧国立駅舎ランドマークを `_drawStation` から忠実3D移植

**日付:** 2026-06-26
**ブランチ:** `feat/city-webgl-render`（未マージ・保持。`main`=2D配信版で安全）
**ステータス:** **旧駅舎ランドマークを、ユーザーが WebGL転換以前に完成させた canvas-2D版 `_drawStation` から忠実3D移植・視覚検証済。** 前ハンドオフ: [2026-06-26-plan3-landmark-gable-done-handoff.md](2026-06-26-plan3-landmark-gable-done-handoff.md)。

---

## 0. 経緯（重要）

- 前作業で旧駅舎を「理想化したシンプル切妻ボックス」へ造形済（`ccc28d6`）。
- 本セッションで丸窓＋両翼＋庇＋棟を**勝手に発明して作り込んだ版**は「全く違う形になってしまった」と却下→ `ccc28d6` へ一旦復元。
- ユーザー指示：「**このマップを作り込む以前に一度完成させた旧駅舎モデルを探して参照して**」。
- 発見＝**`src/scenes/dots/GroundPlan.js` の `_drawStation`**（最新版 commit `bf90c81` / branch `wip/canvas-density-tuning`）。WebGL転換前の canvas-2D 版で作った実測比率のカスタムメッシュ。
- 方針確定＝**忠実に全移植**。

## 1. 参照した正典デザイン（旧国立駅舎 1926, `_drawStation`）

非対称の史実構成（実測比率・`+u`東 `+v`南 `+z`上）：
- **主屋(メイン切妻)**: 幅0.12×奥行0.102、壁0.26→棟0.683（急勾配~51°・屋根支配）。棟N-S・中央。**南妻面が大学通り＝①カメラに正対**。
- **西の低い小屋(交差切妻)**: 西へオフセット、棟E-W・低い(0.40)。主屋に food込み**段＋谷**＝非対称の肝。
- **南車寄せ(canopy)**: 南正面の低い庇スカート。
- **南妻面ディテール**: 象徴の**半円アーチ窓**＋上部**背高窓3つ**（＋小屋斜面の半円ドーマー）。

## 2. やったこと（baker geometry のみ・ランタイム不変）

| File | 変更 |
|---|---|
| [tools/citybake/bake/assemble.mjs](../../../tools/citybake/bake/assemble.mjs) | `buildLandmarkGable` を全面刷新。PCA箱を捨て、`ST_REF`（`_drawStation` の28頂点19面を定数化）を baker フレームへ写像（**+v=南=①カメラ向き**、footprint は centroid 配置のみ供給）。`gableTuning` を移植ノブへ（`LM_SCALE`/`LM_PITCH`/`LM_WIN_DEPTH`/`LM_WIN`）。`faceTri`（外向き法線winding）追加。南妻+壁(face 0,4)は `addSouthFacade` が**窓を凹ませた再構成**で置換（傾斜に沿うtrapezoid strip＋窓列を抜き、背面パネル＋内向きrimの盲穴ニッチ＝AOで暗く）。決定論（RNG無）。 |
| [tools/citybake/tests/citybake/assemble.test.mjs](../../../tools/citybake/tests/citybake/assemble.test.mjs) | landmark テストを新モデルの不変条件へ：主屋棟がglobal max・**西小屋棟(0.40/0.683比)の低いplateauが存在**・段差・base on DEM・頂点数>80・決定論byte一致。**citybake 34 green**。 |
| `tools/citybake/dist/city.glb` | 上記で再ベイク（**RAYS=20 最終**, seed=1）。landmark は manifest 非収録＝**manifest byte不変**。 |

### 設計の要点
- **スケール**: `M`=world/ref-unit（水平, `LM_SCALE=2.0`）、高さ=`M*0.175`（pitch比保持＝~51°）。size は footprint でなく M で決まる固定理想形。
- **向き**: footprint centroid に配置、`+v`(南)を `+z`(world)=①カメラ方向へ。PCA不要（`_drawStation` 同様の固定フレーム authoring）。
- **法線**: 各面 centroid 基準で外向きへflip→`faceTri` が三角ごとに winding 決定（AO正常）。
- **窓**: 妻面を strip 化して窓列だけ開け、盲穴ニッチ（背面+rim）。RADIUS0.4>>凹み深さ0.022 でAO確実に暗化。屋根シルエットは strip の外縁が傾斜に沿うので不変。

## 3. 検証（ブラウザ無し・CPUラスタライザ）

⚠️ ブラウザ preview MCP 無し→ scratchpad の CPUラスタライザ（proto相当 unlit頂点カラー＋linear→sRGB）で `city.glb` 直接レンダ＝デバイス非依存。
- `landmark-glb.mjs`（flat-grey 即時=massingシルエット高速反復）＋ `render.mjs`（AO付き①hero/ctx/8方向orbit）＋ `montage.mjs`。
- **確認済み**: 南正面に急勾配主屋＋左=西の低い小屋の段差＋南車寄せ＝参照に忠実／南妻面に中央アーチ窓＋背高窓3つが凹みAOで暗く読める／文脈で唯一の非対称切妻＝モニュメントとして突出／console error 無・周辺建物/地形/道路は従前どおり。
- RAYS=3(~4.5分)で形状/窓反復、最終 RAYS=20(~30分・決定論)。

## 4. 守った線
- ランドマークは**同一マテリアル**（baked AO頂点グレー・`BASE_GREY.landmark=1.15`最明）＝再ライティング無・モノクロ厳守 [[aesthetic-minimal-techno]]。
- 変えたのは **landmark geometry と `dist/city.glb` のみ**。manifest・道路・地形・他建物・他シーン・2D配信地図は不変。決定論ベイク（seed=1）維持。**citybake 34 ＋ 全体 94 green**。
- iPad PWA / buildless ESM / three vendored。

## 5. コミット
`assemble.mjs` ＋ `assemble.test.mjs` ＋ `dist/city.glb`（RAYS=20）＋本ハンドオフ。`dist/city.manifest.json` は差分無し。

## 6. 次（残り・任意）
- アーチ窓は現状**矩形近似**（①heroで~15pxのため半円との差は微小）。半円トップにしたい時は `addSouthFacade` の WIN を段階narrowで近似 or 円弧 strip 追加。
- 小屋斜面の**半円ドーマー**は未移植（最小・任意）。
- spec仕上げの **perf系（LOD/quality退避＋FXAA）は iPad実機計測が要る別セッション**。

## ▶ 次回キックオフ
> 国立シティ写実WebGL Plan3 続き。ブランチ `feat/city-webgl-render`。**旧駅舎ランドマークを `_drawStation`(bf90c81)から忠実3D移植・コミット済・視覚検証済（citybake34＋全体94 green）**。ハンドオフ `docs/superpowers/handoffs/2026-06-26-plan3-landmark-drawstation-port-done-handoff.md` を読んで。旧駅舎の真実源は `src/scenes/dots/GroundPlan.js` の `_drawStation`＝造形を変える時は発明せずこれに合わせる。ブラウザpreview MCP 無い時は scratchpad CPUラスタライザで検証。ベイク=`node tools/citybake/bake.mjs`（RAYS20~30分、形状反復RAYS3~4.5分、`LM_SCALE/LM_WIN_DEPTH`等で微調整）。守る線=モノ厳守・再ライティング無・決定論ベイク・iPad PWA buildless ESM。
