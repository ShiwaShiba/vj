# ハンドオフ — PLATEAU建物差替 → 国立市全域レンダ（Plan 2.5 + 2.6）

**日付:** 2026-06-25
**ブランチ:** `feat/city-webgl-render`（未マージ・保持。`main`=2D配信版で安全・未変更）
**ステータス:** 建物密度修正(Plan 2.5)＋国立市全域化(Plan 2.6)＋glb量子化、**ほぼ完了**。コードとfixturesはcommit済。**残り＝最終RAYS=20 dist と proto.js カメラの2コミットだけ。**

---

## 0. このセッションでやったこと（要約）

引き継ぎ書 `2026-06-25-building-density-rootcause-handoff.md` の建物密度問題を、計画通り **建物源 OSM→PLATEAU 国立市LOD1** に差し替えて解決。さらにユーザー要望で **国立市全域（南=谷保天満宮まで）** に拡張し、iPad向けに **glb量子化** で軽量化した。

- **PLATEAU CityGML は EPSG:6697＝緯度経度**（引き継ぎ書の「6677平面直角」は誤り）。`gml:posList` = `lat lon height` 三つ組、フットプリント=`bldg:lod0RoofEdge`、高さ=`bldg:measuredHeight`。**再投影不要**で既存projectorにそのまま流せた。
- 生CityGMLは全LOD2込みで巨大(対象8メッシュで286MB)。**gzip保存**（`fixtures/plateau/*.gml.gz`）。bakeが`gunzipSync`+txmlでパース。
- **最終extent**: bbox `{s:35.672,w:139.425,n:35.703,e:139.460}`（南=谷保天満宮3.0km / 北=中央線少し北で非国立を除外。ユーザーが行政界赤線で指定）。**24,816棟**描画。
- **glb量子化**: 37MB相当 → **~22.5MB**（POSITION=KHR_mesh_quantization UNSIGNED_SHORT+node TRS / COLOR_0=正規化UNSIGNED_BYTE VEC4）。three GLTFLoader対応済、bbox一致で幾何正常を検証済。

## 1. commit済（このセッション）

```
36ab8fe feat(citybake): full 国立市 extent — south to 谷保天満宮, trim non-国立 north
48063a4 feat(citybake): quantize glb to halve the iPad payload
f6386dc feat(citybake): full-extent BOUNDS + denser terrain + PLATEAU attribution
```
（先行で `bdca195`=vendor txml / `e35598e`=parsePlateau+dropNear / `dee5003`,`92a6fb1`=旧narrow版 もこのセッション）

新規ファイル: `tools/citybake/vendor/txml.mjs`（bake時のみ・PWA非同梱）, `tools/citybake/geo/plateau.mjs`（parsePlateau+dropNear, TDD済）, `tools/citybake/fetch-plateau.mjs`, `tools/citybake/fixtures/plateau/*.gml.gz`(14), `tests/citybake/plateau.test.mjs`。
`node --test tools/citybake/tests/citybake/*.test.mjs` = **30件 green**。

## 2. 残り作業（これだけ）

作業ツリーに未コミット: `dist/`（現在RAYS=1の高速プレビュー）, `src/cityproto/proto.js`（カメラ＋木々）。

1. **最終dist（RAYS=20）**: バックグラウンドのRAYS=20ベイク(task b6av03af7, 約32分)が走っていた。完了していれば`dist/`はRAYS=20。**未完/不明なら素で再ベイク**:
   ```
   node tools/citybake/bake.mjs            # RAYS=20既定, 約32分, 24,816棟
   ```
   ログ末尾 `✓ city.glb ~22MB | buildings 24816 | primary roads 18` を確認。
   ```
   git add tools/citybake/dist/city.glb tools/citybake/dist/city.manifest.json
   git commit -m "feat(citybake): bake full 国立市 dist (RAYS=20, quantized ~22MB)"
   ```
   - byte再現性: narrow版でBYTE-STABLE確認済＋アルゴ리즘決定論(ファイルsort/AO seed=1/量子化Math.round)。念のため2回bake+`shasum`一致を見てよい。

2. **proto.js カメラ（木々行は除外してコミット）**: line 15 を全域フレーミングに変更済（working tree）:
   ```js
   const params = { camX: -5.1, camY: 55.3, camZ: 50, fov: 50, lookX: -5.1, lookY: 0, lookV: 16.8 };
   ```
   木々(line 5 import / line 50-53 buildTrees / line 37-39 コメント)は**温存・未コミット**。`git add -p src/cityproto/proto.js` でカメラ行のhunkだけstage:
   ```
   git add -p src/cityproto/proto.js   # 対話不可環境なら: HEAD版をcheckout→line15だけEdit→commit→working復元
   git commit -m "feat(cityproto): frame camera for full 国立市 extent"
   ```

3. **視覚ゲート（報告前に必須）**: preview起動 → city-proto.html → スクショ。**RAYS=20のクリーンAOで全域が航空写真と一致**を確認してから「完了」と報告。スクショ無しの「直った」禁止 [[verify-visual-before-claiming]]。
   - preview手順: `.claude/launch.json` の `vj`(8125) を preview_start → `http://localhost:8125/city-proto.html`。**注意**: reload後はviewportパディングのクセあり→ `width<=800`(例800x560)にresize＋`window.dispatchEvent(new Event('resize'))`でcanvasがフレームを埋める。

## 3. 守った線（不変・確認済）
モノクロ厳守 / 旧駅舎(OSM way 1158057719)=別ノード・dedup(25m)で非埋没・historicクエリで取得 / 主要道路(manifest経由) / iPad PWA・buildless ESM(txmlはbake時のみ) / リビール順 / plan space規約。PLATEAU出典をHUD attributionに追加済。

## 4. 木々（温存・保留）
`src/cityproto/trees.js`(untracked) ＋ proto.jsの木々行は**本作業で一切commitしない**。建物が密になった全域でも並木+緑地は現在レンダ表示中（ユーザーは完成イメージで容認したが「未コミット温存」の明示指示を維持）。採否はPlan 3で確定。採用時 `trees.js:10` の旧BOUNDSハードコードdesyncを直す（manifest経由 or proto.jsから`buildTrees(manifest,terrain,{bounds})`）。

## 5. 次の本丸（Plan 3 — ユーザーのビジョン）
**段階ズームアウトのリビール演出**: ズームイン序盤→段階的にズームアウト→**国立市全域で少しの時間固定**。ユーザー談「ズームアウトが早すぎると勿体ない、段階(緩急)を設けたい＝展開の肝」。
- perf: 静的unlit・量子化済なので**ズーム演出はカメラアニメだけ＝フレームコストほぼゼロ**。重いのはglb初回DL(~22MB, SWキャッシュ後不要)とGPUメモリ。glb先読みロード推奨。
- manifest 2MB(24,816棟のreveal用メタ, perBuilding revealKey/vStart/vCount)＝本番gzipで~200KB。
- さらなる軽量化が要れば: glb LOD / 小建物間引き / manifest圧縮。

## 6. 検証
`node --test`（30 green）/ bake 2回byte一致 / preview(8125/city-proto.html)→スクショを航空写真と並べて密度・南(谷保)・北(中央線で切れ)・旧駅舎・モノクロ確認。

## ▶ 次回キックオフ（このまま貼れる）
> 国立シティ写実WebGLレンダの続き。ブランチ `feat/city-webgl-render`。建物源OSM→PLATEAU差替＋国立市全域化＋glb量子化は完了しコード/fixturesはcommit済。引き継ぎ `docs/superpowers/handoffs/2026-06-25-plateau-fullcity-handoff.md` を読んで。**残り=(1)`node tools/citybake/bake.mjs`(RAYS=20,32分)で最終dist生成→commit (2)proto.js line15カメラを木々行除いてcommit (3)preview(8125/city-proto.html)でRAYS=20クリーンAOの全域をスクショ確認してから完了報告**。守る線=モノクロ/旧駅舎別ノード非埋没/主要道路/iPad PWA・buildless(txmlはbake時のみ)/木々は未コミット温存。次の本丸=Plan 3の段階ズームアウト・リビール演出。
