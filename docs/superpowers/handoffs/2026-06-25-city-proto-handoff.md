# ハンドオフ — 国立シティ 写実WebGLレンダ（Plan 1 完了 → Plan 2 へ）

**日付:** 2026-06-25
**ブランチ:** `feat/city-webgl-render`（未マージ。`main` には一切触れていない）
**ステータス:** Plan 1（タッチ・プロトタイプ）＝**全7タスク + R1–R5タッチ修正、完了**。次は Plan 2（実データ・ベイカー）の spec 確認 → 計画 → 実装。

---

## 1. これは何のプロジェクトか（背景）

iPad向け（GitHub Pages PWA・buildless ESM）のマイク反応モノクロVJ。その中の「国立駅周辺の都市」シーンを作っている。

**大転換（重要）:** 旧来の canvas-2D 図解（flat diagram）では参照画像の「画風＝写実3Dレンダの質感」に永遠に届かない、と判明。ユーザーは「IKEDA風／MinimalTechno風という概念とここまでの成果物に執着せず、画像のタッチを望む」と明言。よって **WebGL/Three.js + 実OSM/DEM + オフラインAO/ライトベイク + ポスト処理（グレイン/トーン）+ 地形DEM起伏** へ方針転換。生成リアルタイム＋iPad PWA は維持。

参照画像 = 一次ターゲット（黒地に白い都市スキャン、繊細な地形起伏、ソフトな接触影、滑らかなAA、フィルムグレイン）。

---

## 2. 確定している意思決定・制約（next session が破ってはいけない線）

- **画風:** 写実3Dレンダが核。flat canvas diagram には戻さない。
- **モノクロ厳守。** 虹色グロー禁止（ユーザーの一貫した嫌悪点）。
- **旧駅舎 = 最重要ランドマーク。** 現在の機能駅とは**別**の建物で、市のモニュメント的存在。「どちらを目立たせるか＝旧駅舎」。現駅は多少縮小してよい。旧駅舎の作り込みは Plan 2/3。
- **主要道路（大学通り・富士見通り・旭通り・学園通り/中央線）は常に明確に。** 絶対に密度カーペットに埋没させない（過去のNG指摘点）。
- **ホームベース型の都市骨格を維持**（大学通りを軸に富士見=西/長、旭=東/短の扇）。
- **緑地 = ほぼ黒の静かな空隙**（ユーザー選択）。
- **建物密度 = 参照画像にフル一致（＋深度LOD）**（ユーザー選択）。
- **リビール順序:** 地形（格子）→ 道路 → 建物 → 木々。
- **iPad PWA / buildless ESM 維持。** 実行時の再ライティングはしない（ベイク済みを安く回す）。AO/ライトはオフラインベイク＋ポスト処理（方式A）。
- **plan space 規約:** `u`=東(+)/西(−)、`v`=北(−)/南(+)、apex（駅）=(0,0)。富士見=西/長(≈52°相当)、旭=東/短。world=`(u*SCALE, h*VSCALE, (v-0.3)*SCALE)`、`SCALE=6, VSCALE=5`。
- **canvas GroundPlan の `riseView=0` byte-parity ルール:** 2D配信マップ（vj-v14系）はバイト同一を保つ。今回の city-proto はこれと別系統なので影響なし。

---

## 3. 現在地 — Plan 1 で達成したこと

standalone Three.js プロトタイプで「参照のタッチが buildless/iPad スタックのリアルタイムWebGLで出せる」ことを実証・確立した。

最後の検証スクショの状態:
- 黒背景 + 細い白格子線（灰色スラブを排除 ← 重要な転換点）
- 白いソリッド低層ビル・カーペット（西広・ホームベース寄りで密）
- 南東に**ワイヤーフレーム（フットプリント輪郭）帯** ↔ ソリッド帯の対比（参照の署名的要素）
- 駅 = 輝くノード + 抑制的グロー（フルbloomではない）
- 中央線 = くっきり複線
- 大学通り/富士見/旭の主要道路が明線で legible、地形起伏あり
- console エラーなし

R1–R5 のタッチ修正（黒地化／細密線描／ソリッド↔ワイヤー帯／駅グロー／複線レール／小粒・暗い隙間ビル）すべて反映済み。

---

## 4. proto に残るギャップ（正直な評価 — Plan 2 で埋める）

- **建物が手続きの箱**（実OSMフットプリントでない）
- **AOが擬似**（vertex-color勾配＋密度暗化。本物のレイキャストでない）
- **線描が均一グリッド**（実道路網でない）
- **鉄道/駅グローが抑制的**

→ 「タッチの方向（黒地・白線・立体カーペット・スキャン感）」は実証済み。残りの“写真らしさ”は**実データ次第**。

---

## 5. 次の一手 — Plan 2（オフライン OSM/DEM ベイカー）

spec: `docs/superpowers/specs/2026-06-24-kunitachi-city-photoreal-render-design.md`

やること:
1. 実 OpenStreetMap の建物フットプリント取得（国立駅周辺）
2. GSI DEM の地形高
3. **本物のレイキャストAOベイク**（オフライン）→ glTF（or 頂点カラー付きジオメトリ）
4. 検証済みの proto renderer にスワップ（procedural → 実データ）

その後 **Plan 3:** Scene framework 統合、リビールアニメ（地形→道路→建物→木）、マイク反応、木々、旧駅舎の作り込み、HUDスキャナUI、perf最適化。

各 Plan は実装前に spec確認 → 計画作成（superpowers: brainstorming → writing-plans → executing-plans / subagent-driven-development）。

---

## 6. ファイルマップ

**proto 実装（feat/city-webgl-render 上）:**
- `city-proto.html` — standalone dev page（`#gl` WebGL + `#ov` 2Dオーバーレイ）
- `src/vendor/three.module.js` — vendored three.js r160（1.27MB、SWキャッシュ可）
- `src/cityproto/proto.js` — entry: renderer/camera/scene組立/loop/overlay。`window.__proto = { THREE, scene, camera, renderer, params, applyCamera }`
- `src/cityproto/geo.js` — 純粋ジオメトリ（`terrainHeight`, `inHomePlate`, `AVENUES`, `distToSeg`, `GREEN`, `inGreen`）。テスト可
- `src/cityproto/terrain.js` — `buildTerrain()`（高さ場+擬似ランバート傾斜シェーディングを頂点色に焼く）/ `buildTerrainGrid()`（step=0.06 細格子）
- `src/cityproto/buildings.js` — `buildBuildings()` → `{solid, wire}`。SE は `wireZone` でフットプリント輪郭のみ。各道路/駅フットプリントのコリドーをクリア
- `src/cityproto/avenues.js` — `buildAvenues()`（明線、depthTest:false, renderOrder:10。chuoはstation.jsへ移管）
- `src/cityproto/station.js` — `buildStation()`（apex の明箱+加算グローSprite）/ `buildRailway()`（v=-0.118 / -0.152 複線 + v=-0.135 淡中央線）
- `src/cityproto/overlay.js` — `makeOverlay()`（220px グレイン tile + 放射ビネット + 上部ヘイズ）
- `tests/cityproto/geo.test.mjs` — geo.js の Node テスト
- `package.json` — `{"type":"module"}`（Node が .js を ESM 扱いするため。ブラウザ無影響）

**ドキュメント:**
- `docs/superpowers/specs/2026-06-24-kunitachi-city-photoreal-render-design.md` — 写実レンダ設計（3層: offline baker / runtime CityScene / 再利用shell）
- `docs/superpowers/plans/2026-06-24-city-touch-prototype.md` — Plan 1（本ハンドオフで完了）

**現状のカメラ params（proto.js）:** `{ camX:0, camY:12, camZ:8, fov:47, lookX:0, lookY:0, lookV:0.5 }`

---

## 7. 検証方法

- preview server `vj`（`.claude/launch.json`、port 8125、no-store python http.server）→ `http://localhost:8125/city-proto.html`
- `node --test`（geo テスト）
- ライブ調整: `window.__proto.params` を書き換え → `window.__proto.applyCamera()`
- **ルール（メモリ）:** 視覚/アニメは実物をスクショ確認してから報告。未検証の「直った」は厳禁。

---

## 8. ブランチ状況

- `feat/city-webgl-render` ← **作業中・ここ**（proto 全部）
- `wip/canvas-density-tuning`（bf90c81）← 旧 canvas-2D 密度調整（GroundPlan STEP0-5）を退避。捨てない
- `main` / `origin/main` ← 2D配信版 vj-v14 系。**安全・未変更**

## 9. proto コミット履歴（feat/city-webgl-render）

```
339926c glowing station node + crisp double-track railway   (R4)
1abfcb7 solid-built zone vs SE wireframe footprint zone      (R3)
d9cb6a5 black ground + fine grid linework + finer buildings  (R1+R2+R5)
4d7715b tune camera/tone to the reference framing            (Task 7)
aa91332 2D grain/vignette/haze overlay — rendered-photo touch(Task 6)
0c56f44 main avenues as bright overlay lines                 (Task 5)
eef21df low-rise building field with baked vertex-AO shading (Task 4)
77a828a terrain heightfield + grid with slope-shaded relief  (Task 3)
13f0efc pure plan-geometry helpers + tests                   (Task 2)
dd4c9e1 vendor three.js + standalone proto page with cube    (Task 1)
```
