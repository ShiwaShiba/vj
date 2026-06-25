# ハンドオフ — 国立シティ 写実WebGLレンダ（Plan 2 完了 → Plan 3 へ）

**日付:** 2026-06-25
**ブランチ:** `feat/city-webgl-render`（未マージ・保持。`main` = 2D配信版で安全・未変更）
**ステータス:** Plan 2（オフライン OSM/DEM/AO ベイカー → proto レンダラへスワップ）= **全14タスク完了・視覚検証済み**。次は Plan 3。

---

## 1. Plan 2 で達成したこと

手続き都市を **実データ＋本物のベイク** に置き換え、proto レンダラにスワップした。スクショ検証済み：黒地＋白格子＋実OSMフットプリントの白いカーペット＋ソフトAO接触影＋ホームベース扇（大学通り=南/富士見=西長/旭=東短）＋中央線=水平＋駅グロー。**console エラーなし。node --test 28件 green。**

- **実OSM**（Overpass）= 1113要素 → 976建物フットプリント（フレーム内288）、主要道路、緑地。
- **実GSI DEM**（dem5a z15, 9タイル）= 15m の実起伏（駅77.8m）。地形に沿って建物・道路を conform。
- **本物のレイキャストAO**（半球レイ×グリッド加速、vendored three を Node headless で再利用）→ 頂点グレーに焼成。`aoStrength` でソフト化（接触影、過度な暗化なし）。
- **旧国立駅舎**（OSM way 1158057719, historic=building）を識別＝最重要ランドマーク。現駅（node 2559434122）とは**別の独立ノード**で、駅の南に配置・最も明るい（0.877 vs 現駅0.572）。三角屋根の造形は Plan 3（合意済み）。
- **glTF(.glb)＋manifest.json** をベイク出力 → 検証済み GLTFLoader でロード、材質をモノクロ MeshBasicMaterial にスワップ。**buildless ESM 維持**（importmap＋vendored loader、ビルド工程なし）。

## 2. 守った線（すべて維持）

モノクロ厳守 / 旧駅舎=最重要・現駅と別・埋没なし / 主要道路=depthTest:false で常に明 / iPad PWA・buildless ESM / リビール順=地形→格子→道路→建物（per-building revealKey を manifest に保持、アニメは Plan 3）/ plan space 規約（u=東/v=南、apex=(0,0)、world=(u*SCALE, h*VSCALE, (v-0.3)*SCALE)、SCALE=6,VSCALE=5）。

## 3. 追加ファイルマップ（feat/city-webgl-render 上）

**オフラインベイカー `tools/citybake/`:**
- `geo/project.mjs` — lat/lon↔plan投影（θで中央線水平化）
- `geo/dem.mjs` — GSI DEM parse/stitch/bilinear/sampler/planHeight
- `geo/osm.mjs` — Overpass→footprints/roads/rails/green/landmark/station（旧駅舎は historic||/旧/ かつ railway≠station、駅舎名優先で識別）
- `bake/assemble.mjs` — DEM地形＋格子＋フットプリント押し出し（ear-clip）→三角スープ＋per-building属性
- `bake/ao.mjs` — グリッド加速 半球レイキャストAO（決定論的Hammersley、`aoStrength`/`baseGrey`対応）
- `bake/glb.mjs` — 最小 conformant .glb writer（POSITION/COLOR_0/indices、LINESモード、KHR_materials_unlit）
- `bake/manifest.mjs` — manifest（roads[u,v,h]/green/reveal keys/landmark/attribution）
- `fetch.mjs` — 一度きりの取得（**Overpass は User-Agent 必須**=406回避、GSI dem5a z15→dem z14フォールバック）
- `bake.mjs` — fixtures→glb+manifest（決定論的・byte再現可）。env 調整: `MPU/VEXAG/RAYS/RADIUS/AOSTR`
- `fixtures/`（生OSM/DEM・commit済）, `dist/city.glb`(980KB)+`dist/city.manifest.json`(commit済)
- `tests/citybake/*.test.mjs` — 各純関数のテスト（28件）

**ランタイム:**
- `src/vendor/three-addons/loaders/GLTFLoader.js`, `utils/BufferGeometryUtils.js`（r160 verbatim）
- `city-proto.html` — importmap 追加（three / three/addons/）
- `src/cityproto/cityasset.js` — `loadCity()`（glb+manifest、材質スワップ、layer返却）
- `src/cityproto/avenues.js` / `station.js` — manifest からロード（depthTest:false、複線、駅グロー）
- `src/cityproto/proto.js` — async ロード、リビール順 add。procedural `terrain.js`/`buildings.js` は未使用（fallbackとして残置）

## 4. 再ベイク / 調整方法

```
node tools/citybake/fetch.mjs     # 取得（network。fixturesは commit 済なので通常不要）
node tools/citybake/bake.mjs      # ベイク → dist/（~12s、byte再現可）
VEXAG=3 AOSTR=0.5 node tools/citybake/bake.mjs   # 例: 起伏強め・AO弱め
```
トーン定数は `bake.mjs` の `BASE_GREY`（terrain=0.022 near-black / generic=1.0 / landmark=1.15 / station=0.75）。
ライブカメラ: `window.__proto.params` 書換→`applyCamera()`。`window.__proto.city/manifest` で資産確認。

## 5. 次の一手 — Plan 3（spec の残り）

- **リビールアニメ**（地形格子立ち上げ→道路通電スイープ→建物 rise→木々）。manifest.buildings[].revealKey/vStart/vCount を使用
- **マイク反応**（既存 AudioEngine 思想流用、再ライティングなし）
- **木々/緑地** インスタンス（manifest.green 済）
- **旧駅舎の三角屋根造形**（landmark ノードを差し替え）
- **HUD スキャナUI＋出典表記**（manifest.attribution = ©OpenStreetMap contributors / 地理院タイル）を画面隅に
- **SceneManager/PWA/SW 統合**、距離LOD＋quality 退避（perf）
- **FXAA ポストパス**（現状は MSAA＋2Dグレインoverlay。spec の FXAA は未導入）
- 任意: Plan-1 の SE ワイヤーフレーム「データゾーン」帯は実データ全ソリッド化で消えた。遠景スタイルとして再導入可

## 6. 検証

- `node --test`（28件 green）/ `node tools/citybake/bake.mjs` 2回で byte 同一（決定論）
- preview `vj`（port 8125）→ `http://localhost:8125/city-proto.html` → スクショ
- **ルール:** 視覚は必ずスクショ確認してから報告（本Planでも遵守）

## 7. コミット履歴（Plan 2 分、feat/city-webgl-render）

A1 projector → A2 DEM → A3 OSM → A4 assemble → A5 AO → A6 glb → A7 manifest →
A8 fetch+fixtures → A9 bake+dist → B1 GLTFLoader+importmap → B2-B4 runtime swap →
soft-AO+tone tuning。計 main から24コミット先行。
