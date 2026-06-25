# ハンドオフ — 建物密度問題の根本原因と修正計画（最優先・Plan 3 より前）

**日付:** 2026-06-25
**ブランチ:** `feat/city-webgl-render`（未マージ・保持。`main` = 2D配信版で安全・未変更）
**ステータス:** Plan 2（OSM/DEM/AO ベイカー）は完了済みだが、**レンダの建物が実際の国立駅周辺より遥かにスカスカ**だとユーザー（地元・現地を熟知）から指摘。原因を実数で特定済。**この修正を Plan 3 より先に行う。**

---

## 0. 何が起きたか（正直な記録）

前担当（＝私）は「南口側は一橋大キャンパス＋並木で疎、よって地理的に忠実」と説明したが、これは**事実に反する後付けの正当化で誤り**だった。ユーザーが実際の航空写真を提示：国立駅周辺は**南口側も含めびっしり密集、高い建物も多数**。レンダのスカスカは「忠実」ではなく**こちらのバグ／データ選択ミス**。以後この種の正当化は禁止。視覚は必ず実物（航空写真／スクショ）と突き合わせて報告する [[verify-visual-before-claiming]]。

## 1. 根本原因（実数で確定。3つが重畳）

`tools/citybake/fixtures/osm.json` を実測した結果：

| # | 原因 | 実数 | 効き目 |
|---|---|---|---|
| **1. カメラ枠が狭すぎ** | `bake.mjs` の `BOUNDS={u0:-1.85,u1:1.72,v0:-0.42,v1:1.3}` が取得済み建物の71%をクリップ | **描画 288 / 取得 976 棟**（688棟を枠外で捨てている） | 枠を広げれば即〜3倍 |
| **2. データ源(OSM)が薄い** | OSMボランティア作成の建物が国立では実態の1/5〜1/10 | bbox全体で **284棟/km²**（実際の密集住宅地は1500〜3500棟/km²。駅400m核でも342棟＝684/km²） | **本丸。データ源差し替えが必要** |
| **3. 高さがほぼ全部低層** | `osm.mjs estimateLevels` が `building:levels` 欠落時に低層へ倒れる | **976棟中956棟(98%)が1〜3階**、4階以上はわずか20棟 | 南口の高い建物が出ない。**実測高さが必要** |

→ 「微調整」では直らない。**建物データ源の差し替え＋枠の拡大＋実高さの採用**が要る。

## 2. 解決策（裏取り済）— 建物源を PLATEAU に差し替える

**国交省 Project PLATEAU（3D都市モデル）に国立市あり**。建築物 **LOD0/1/2**、CityGML＋3DTiles、**2023年度・2025年度**版。LOD1 が **正確なフットプリント＋実測高さ `bldg:measuredHeight`** を持つ → **原因2(薄い)と原因3(低層潰れ)を同時に解決**。

- ポータル: https://front.geospatial.jp/plateau_portal_site/
- オープンデータ: https://www.mlit.go.jp/plateau/open-data/
- 国立市データセット(2023): G空間情報センター `plateau-13215-kunitachi-shi-2023`（13215＝国立市のJISコード。2025年度版も出ている）

**役割分担（推奨）:**
- **建物 = PLATEAU LOD1**（フットプリント＋実高さ）← 差し替えの本体
- **道路・線路・主要通り名・旧駅舎(ランドマーク) = 現状のOSMを継続**（これらはOSMで足りている。旧駅舎= way 1158057719 の識別ロジックも維持）
- **地形 = 現状のGSI DEM を継続**

**技術的な要注意点:**
- PLATEAU CityGML の座標系 = **JGD2011 / 平面直角座標系 第IX系（EPSG:6677, 東京都）**。lat/lon もしくは直接 plan space へ変換する層が必要。フットプリントは `bldg:lod0RoofEdge`/`lod0FootPrint` or `lod1Solid` の `gml:posList`、高さは `bldg:measuredHeight`。
- CityGML は冗長なXML。buildless Node でパースするなら軽量XMLパーサ（vendored ESM）を入れるか、**事前にGeoJSON/FlatGeobufへ変換した版**を使うのが楽（PLATEAU配布物やコミュニティ変換物にGeoJSONあり）。`fetch.mjs`の思想（一度きり取得→`fixtures/`にcommit→bakeは決定論）を踏襲。
- タイル単位＝3次メッシュ。bbox を覆うメッシュだけ取得。

## 3. 修正の進め方（superpowers: writing-plans で計画化してから着手）

「Plan 2.5: 建物源を PLATEAU へ差し替え」を1枚の計画に。骨子：
1. **取得**: PLATEAU 国立市 LOD1 建築物を取得 → `tools/citybake/fixtures/plateau/`（CityGMLかGeoJSON）。`fetch.mjs` に経路追加 or 別 `fetch-plateau.mjs`。
2. **パース**: `geo/plateau.mjs`（新）= CityGML/GeoJSON → `{footprints:[{ring(lat/lon or plan), height(実測m), id}]}`。座標系変換込み。TDD。
3. **配線**: `assemble.mjs` の建物入力を OSM footprints から PLATEAU footprints に差し替え（押し出し高さ＝実測 `measuredHeight`、低層推定は撤去）。道路/線路/緑地/ランドマークはOSM継続。
4. **枠拡大**: `BOUNDS` を広げる（特に `v1` を 1.3→1.7+ で南を、`u0/u1` も。フレーミングはスクショで反復）。`MPU`/カメラも再調整。
5. **再ベイク**: AO は建物が密＆高くなるので効きが変わる。`AOSTR`/`RAYS`/`RADIUS` 再調整。`dist/` 再生成（byte再現性は維持）。
6. **視覚ゲート**: 航空写真と並べて密度・高さ・南口の高層が出ているか確認してから報告。

## 4. 守る線（不変）

モノクロ厳守(虹色グロー禁止 [[aesthetic-minimal-techno]]) / **旧駅舎=最重要ランドマーク・現駅と別・埋没なし** / 主要道路(大学/富士見/旭/中央線)埋没禁止 / iPad PWA・buildless ESM維持(新依存はvendored ESMのみ) / リビール順=地形→道路→建物→木々 / plan space規約(u=東,v=南,apex=(0,0),world=(u\*SCALE,h\*VSCALE,(v-vOffset)\*SCALE), SCALE=6,VSCALE=5,vOffset=0.3)。

## 5. 作業ツリーの状態（重要）

本セッションで **木々インスタンシング** を試作したが、これは「南がスカスカ」という**誤った前提**を埋める目的だった。建物を正しく密にすれば前提自体が消える。よって**未コミットのまま保留**：
- `src/cityproto/trees.js`（新規・未commit）= モノクロ灰のキャノピーを `manifest.green`(緑地)に散布＋`大学通り`両側に並木。地形へレイキャスト着地、シード固定。
- `src/cityproto/proto.js`（変更・未commit）= 上を第4層として追加（`buildTrees(manifest, terrain)`）。

**判断**: 大学通り並木と緑地(キャンパス/公園)は実在する正当なPlan 3要素なので**捨てるのは惜しいが、建物修正後に再評価**。建物が密になった上で並木が映えるか見てから採否を決める。今は git に未コミットで残置（`git status` に出る）。次セッション冒頭で「残す/revertして作り直す」を判断。

## 6. 既存の土台（Plan 2、commit済・有効）

`tools/citybake/`（projector/dem/osm/assemble/ao/glb/manifest/fetch/bake）＋ `dist/city.glb`+`manifest.json`、ランタイム `src/cityproto/`（cityasset/avenues/station/proto）＋ vendored GLTFLoader+importmap。`node --test` 28件green。詳細は [2026-06-25-plan2-complete-handoff.md](2026-06-25-plan2-complete-handoff.md)。建物源差し替えは assemble の入力を替えるだけで、AO/glb/manifest/ランタイムの大半は再利用できる設計。

## 7. 検証

`node --test`（新plateauパーサのテスト追加）/ bake 2回 byte一致 / preview `vj`(8125)→`city-proto.html`→スクショを**航空写真と並べて**密度・高さ確認。**スクショ無しの「直った」は禁止** [[verify-visual-before-claiming]]。

---

## ▶ 次回キックオフ（このまま貼れる）

> 国立シティ写実WebGLレンダの続き。ブランチ `feat/city-webgl-render`。**最優先タスク=建物密度問題の修正**（Plan 3 より前）。引き継ぎ書 `docs/superpowers/handoffs/2026-06-25-building-density-rootcause-handoff.md` を読んで把握して。
> 要点: 現状レンダは実際の国立駅周辺より遥かにスカスカ。根本原因は3つ＝(1)カメラ枠が取得976棟中288棟しか映していない (2)データ源OSMが国立では実態の1/5〜1/10しかない(284棟/km²) (3)高さが98%低層推定で南口の高層が出ない。
> 解決=**建物源をOSM→国交省PLATEAU 国立市 LOD1(フットプリント＋実測高さ)に差し替え**（道路/線路/旧駅舎/地形はOSM・GSI DEM継続）＋枠拡大＋AO再調整。
> 進め方: まず PLATEAU 国立市データ(CityGML or GeoJSON, データセット `plateau-13215-kunitachi-shi-2023`)の取得形式と座標系(EPSG:6677)を確認 → `superpowers: writing-plans` で「Plan 2.5: 建物源PLATEAU差し替え」を立てて提示 → 承認後に着手。守る線=モノクロ厳守/旧駅舎=最重要・別ノード・埋没なし/主要道路埋没禁止/iPad PWA・buildless ESM/リビール順。検証=preview(8125/city-proto.html)+node --test、視覚は必ず航空写真と並べてスクショ確認してから報告。
> なお作業ツリーに未コミットの木々試作(trees.js + proto.js)あり。建物修正後に残す/作り直すを判断。まず計画提示から。
