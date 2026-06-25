# ハンドオフ — Plan 3 仕上げ: 旧国立駅舎の三角屋根造形 完了 → 次は perf/FXAA (iPad 実機)

**日付:** 2026-06-26
**ブランチ:** `feat/city-webgl-render`（未マージ・保持。`main`=2D配信版で安全）
**ステータス:** **旧駅舎ランドマークを切妻（三角屋根）化・視覚検証済。** Plan 3 シーン演出 step 1-6 ＋本仕上げ。前ハンドオフ: [2026-06-26-plan3-step6-chroma-mode-done-next-audio-scenemanager-handoff.md](2026-06-26-plan3-step6-chroma-mode-done-next-audio-scenemanager-handoff.md)。spec: [2026-06-24-kunitachi-city-photoreal-render-design.md](../specs/2026-06-24-kunitachi-city-photoreal-render-design.md) §6/§55/§60。

---

## 0. 背景・要求

spec は旧国立駅舎（1926 の三角屋根＝市のモニュメント）を「**三角屋根が読める形・最も目立つランドマーク**」と要求。
だが従来は実 OSM フットプリントを**フラット屋根の箱**として押し出すだけ（明るさ `BASE_GREY.landmark=1.15` で目立たせるのみ）。
カメラ①（hero framing, `camrig.js` d1=6/h1=4/fov1=30）が至近で捉えるので、三角屋根が最も効く位置。

## 1. やったこと（ベイカー geometry のみ・ランタイム不変）

**ユーザー方針＝理想化した切妻ボックス**（実生多角形でなく、向き・寸法を PCA 抽出してクリーンな長方形棟＋三角屋根に整形）。

| File | 変更 |
|---|---|
| [tools/citybake/bake/assemble.mjs](../../../tools/citybake/bake/assemble.mjs) | 新 `buildLandmarkGable(soup, ring2d, baseY, params, opts)` を追加し、`assembleCity` の landmark 分岐を ring 有り時にこれへ差替（ring 無しは既存 `pointBox` 維持）。`extrude`/`pushTri` 再利用、決定論（RNG 無）。`perBuilding` は従来同型。 |
| [tools/citybake/tests/citybake/assemble.test.mjs](../../../tools/citybake/tests/citybake/assemble.test.mjs) | 切妻不変条件 2 件追加（屋根が軒上の棟へ立つ／頂点数が箱超／決定論 byte 一致）。**citybake 34 green**。 |
| `tools/citybake/dist/city.glb` | 上記で再ベイク（**RAYS=20 最終**）。landmark は manifest 非収録＝**manifest は byte 不変**。 |

### 切妻ビルダー設計
1. **OBB（PCA）**: ring2d (u,v) の重心＋2×2 共分散の大固有値固有ベクトル＝長軸 `e1`／直交 `e2`、各半幅 `(L,Wd)`。符号正準化（`e1.u≥0`）で決定論化。
2. **棟の角**: `c ± L·e1 ± Wd·e2` の長方形リング。**壁**=`extrude` で baseY→eaveY（軒上の天井 cap は屋根下に隠れる）。
3. **屋根**: 長辺軒線→長軸中央の棟線（高さ ridgeY）へ傾斜クアッド 2＋短辺の妻三角 2。`face()` ヘルパが各 tri を外向き法線になる winding で push（AO 正常）。
4. **既定（目で確定）**: `gableTuning()` = `hScale=2.2`（棟高ブースト＝突出）/ `eaveFrac=0.30`（低い壁＋高い屋根＝急勾配）/ `peakFrac=1.0` / **`ridgeAxis='short'`（妻＝三角面が① カメラ＝南へ正対）**。全て env で上書き可（`LM_HSCALE`/`LM_EAVE`/`LM_PEAK`/`RIDGE_AXIS`）が、**既定が確定値＝最終ベイクは env 不要で再現可**。

## 2. 検証（ブラウザ無し・CPU ラスタライザで実物確認）

⚠️ 本セッション中に**ブラウザ preview MCP が切断**（`mcp__Claude_Preview__*` 消失）。代替として proto と同じ描画（**unlit 頂点カラー＋linear→sRGB・zバッファ**）を再現する CPU ラスタライザを実装し `city.glb` を直接レンダ＝**デバイス非依存で視覚検証**。
- スクリプト（throwaway・未コミット）: scratchpad `render.mjs`（glb パース→①hero/closer-context/gable-only の 3 視点 PNG）/ `landmark-glb.mjs`（assembleCity から landmark のみ即時 glb＝AO 無で形状高速反復）。
- **反復**: フラット箱 before → 既定切妻は浅く小さく読めず → 比率を詰め（hScale/eave）→ **`RIDGE_AXIS=short` で妻が①へ正対し明確な三角**＝確定。
- **確認済み**: ①hero（d1=6）で**明るい三角の妻**が plaza に立つ／closer-context でフラット箱群の中で唯一の急勾配三角＝**形状の差異で突出**（巨塔化せず上品）／棟が南（①）正対／console error 無・周辺建物/地形/道路は従前どおり。
- AO 反復は `RAYS=3`（~4.5 分）で形状確認、最終は `RAYS=20`（~32 分・決定論 seed=1）。

## 3. 守った線（不変条件）

- ランドマークは**同一マテリアル**（baked AO 頂点グレー・最明 1.15）＝再ライティングしない・グロー/虹色無し・モノクロ厳守 [[aesthetic-minimal-techno]]。
- 変えたのは **landmark geometry と `dist/city.glb` のみ**。manifest・道路・地形・他建物・他シーン・2D 配信地図は不変。
- ベイク決定論（seed=1・fixtures・no network）維持。**citybake 34 ＋ 全体 94 tests green**。
- iPad PWA / buildless ESM / three vendored。

## 4. コミット

`tools/citybake/bake/assemble.mjs` ＋ `tools/citybake/tests/citybake/assemble.test.mjs` ＋ `tools/citybake/dist/city.glb`（RAYS=20 再ベイク）＋本ハンドオフ。`dist/city.manifest.json` は差分無し。

## 5. 次（spec 仕上げ・perf 系の残り — iPad 実機が要る）

1. **LOD / perf**: 距離 LOD・`quality` 連動でポスト簡略/本数間引き・60fps 目標・重い端末で自動退避（spec §77-79/§101）。**iPad 未計測**＝実機で fps を見ながら調整するセッションが必要。現状 frustumCulled は trees/particles で意図的 off、pixelRatio≤2。
2. **FXAA**: 現状 MSAA（`antialias:true`）。FXAA は iPad perf 次第の**スワップ**＝perf 計測とセット。
3. （任意）旧駅舎の二段違い棟・丸窓など作り込み（現状は単一支配切妻＝spec「三角が読める」を満たす）。

## ▶ 次回キックオフ（このまま貼れる）

> 国立シティ写実WebGLレンダ Plan 3 の続き。ブランチ `feat/city-webgl-render`。**シーン演出 step1-6 ＋旧駅舎三角屋根 完了・コミット済・視覚検証済（citybake 34 ＋ 全体 94 tests green）**。ハンドオフ `docs/superpowers/handoffs/2026-06-26-plan3-landmark-gable-done-handoff.md` を読んで。次は **仕上げ perf 系（LOD/quality 退避＋FXAA スワップ）で、iPad 実機の fps を見ながら調整するセッション**。守る線＝モノ厳守・再ライティングしない・baked 資産は決定論ベイク・iPad PWA buildless ESM。注意: 本リポは**ブラウザ preview MCP が無い場合がある**＝その時は scratchpad の CPU ラスタライザ（proto と同じ unlit 頂点カラー＋linear→sRGB で `city.glb` を直接レンダ）で視覚検証。ベイクは `node tools/citybake/bake.mjs`（RAYS=20 ~32分、形状反復は RAYS=3 ~4.5分、env `LM_HSCALE/LM_EAVE/RIDGE_AXIS` で landmark 微調整可）。
