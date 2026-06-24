# ハンドオフ — GroundPlan 3D（駅舎ほぼ完成・改善継続フェーズへ）

> 更新 2026-06-24（**セッション3末**）。セッション2の駅舎/キューブに加え、**動きの質感改善（波1+波2）**を実装・検証済（全commit済・未push）。
> このファイル + memory（`groundplan-flat-redirect.md`）+ git だけで再開できるように書いてある。

## ★ セッション3（動きの質感改善）— DONE・未配信

全て `GroundPlan.js`、**commit済（push無し、SWは vj-v14 のまま）**。freeze-frame + 数値 + スクショで検証済。

| commit | 内容 |
|---|---|
| `79c2942` | チェックポイント（セッション2の未コミット成果を保全） |
| `3504968` | **波1**: #1 リフレーミング / #3 カメラ / #4 量塊 / #6 背骨トリム |
| `9f25fa8` | **#2** 一橋を低い開放プレート化（`_drawCampus`） |
| `0185cbb` | **#5** SINK崩落波（far→near、駅舎が最後） |

- **#1 リフレーミング**: `_cyLift = lerp(0, H*FRAME_DROP(0.20), tilt)`。傾き時に街を縦中央へ。`tilt`ゲートで真俯瞰(riseView=0)は不変。
- **#3 カメラ**: `LIVE_VANTAGES` 4視点を別構図に + `HOLD_SECTIONS=4` + HOLD中 `yawTgt += 0.03*sin(t*0.25)` 微ドリフト。
- **#4 量塊**: 多オクターブ `nMix=clamp(0.55n+0.55n2²,0,1)` でレアな高層クラスタ + `spineBoost=1+0.8*smoothstep(0.18,0,|cu|)` 背骨稜線。実測 中央値8px/p99 23px/背骨14.2 vs 外周6.3/最大は駅舎の0.5倍（墓標なし）。
- **#6 背骨**: 大学通り南端 1.15→1.06（下フレームの尾引き除去）。※真俯瞰の背骨尾が僅かに短くなる（構造は不変）。
- **#2 キャンパス**: 新 `_drawCampus`。`H*0.008*local`(=6.1px≒街平均0.65倍)の低プレート+明縁取り、中間グレー。cubeループ先頭に `K_LAND skip`。`front3d>0.001`ゲートで俯瞰不可視。`_drawStation`不変。
- **#5 SINK**: 新 `_sinkFront`(0→`_keyMax`+SINK_W)。`_keyMax`(最遠ブロック, _buildBlocksで算出)で波を正規化。PH_SINK時のみ各localに `stand` 乗算で far→near 崩落、駅舎(key≈0)が最後。波の間tilt保持→抜けたらde-tilt+recede→再ENERGIZE。
- **perf**: dev Mac headless で District/Hybrid ~49fps(11.3ms) / City/Hybrid ~41fps / quality=1。**実機iPad計測は未（ユーザーのデバイス必須）**＝§6参照。
- 新定数/状態: `FRAME_DROP, SINK_W, _sinkFront, _keyMax, _cSX/_cSY`。新メソッド `_drawCampus`。

## ▶ 次回キックオフ（このまま貼って開始できる）

> GroundPlan 3D の続き。まず `docs/HANDOFF-groundplan-3d.md` の **★セッション3** と **§5技術的学び** と **§6**、memory `groundplan-flat-redirect.md` を読んで。
>
> 状態: 波1+波2（動きの質感改善 全7点）は**実装・検証・commit 済（`79c2942`→`318139d`, main, 未push, SW vj-v14のまま）**。作業ツリーはクリーン。
>
> 鉄則（厳守）: 駅舎 `_drawStation` 不可侵 / モノクロ（赤は駅ノード+tipのみ・グロー禁止）/ **真俯瞰(riseView=0)は配信2Dと一致を維持**＝リフレーミング/高さ/崩落は全て `tilt` か `front3d`（riseView=0で0）でゲート / `git checkout … GroundPlan.js` 禁止 / **配信は俺の承認後のみ**（sw.js vj-v15 bump+push、勝手にやらない）/「直った」は §5 のスクショ・pixel/数値検証後に報告。
>
> 今回やること: **実機(localhost:8125)を見ながらライブ微調整**。回せるツマミ＝`FRAME_DROP`(0.20)/`LIVE_VANTAGES`(4視点 pitch/yaw)/微ドリフト(0.03rad)/`SEC_BEATS`(32)・`HOLD_SECTIONS`(4)/`SINK_RATE`(崩落速度)/キャンパス高(`H*0.008`)/`spineBoost`(0.8)・背骨長(1.06)/量塊の高さ分布。俺がラフに指示するので当てて実機確認→commit。
>
> 並行で残: **実機iPad perf計測**（City/Hybrid/1300 で ≥30fps、手順は §6）。

**再開時の実機セットアップ（headlessでの検証手順）**:
1. `preview_start`（name=`vj`, port 8125）。`http://localhost:8125`。
2. SWキャッシュ解除（§2スニペット）→ reload。
3. 決定的フレーム検証は freeze-frame: `gp.update` を monkeypatch して `window.__pose({phase,front,rise,riseView,cam,vantage,scope,height,style,sinkFront})` で状態固定（本セッションで使用、§5）。`sinkFront` は SINK波の検証用。`window.__unfreeze()` で復帰。
4. ⚠️ headless は dpr=1 報告でも実 backing が2×のことがあり、screenshot が左上に縮む場合がある（環境差・コードは正しい）。composition は読める。iPad実機では正常。

---

## 0. 一行で言うと

国立 Ground Plan シーン：**2D平面地図（配信済）+ 3D立体化（A〜E修正済）+ 旧駅舎ランドマークを実物トレースで作り込み済 + キューブ密度調整済**。
全部 **`src/scenes/dots/GroundPlan.js` の未コミット作業ツリー**にある。駅舎は「ほぼ完成」（ユーザー承認 2026-06-24）。次は新鮮な脳で全体の質感改善。

---

## 1. ⚠️ デプロイ状態（最重要・先に読む）

| | コミット | SW | 内容 | 公開 |
|---|---|---|---|---|
| **本番 origin/main** | `f2a37e5` | `vj-v14` | **2D平面地図のみ** | ✅ https://shiwashiba.github.io/vj/ |
| **ローカル main HEAD** | `0185cbb` | `vj-v14` | 2D + 3D（A〜E + 駅舎 + キューブ密度 + **波1/波2 動き改善**）全commit済 | ❌ 未push |

### 🚨 絶対に守る
- **セッション2+3の成果は全て commit 済**（`79c2942`→`0185cbb`、上記★表）。**まだ push していない**（SW `vj-v14` のまま）。
- **`git checkout … -- src/scenes/dots/GroundPlan.js` を実行しない**（履歴は safe だが習慣として封印）。
- 配信はユーザー承認後のみ（下記手順、SW bump + push）。

### 配信手順（ユーザー承認後のみ・勝手にpushしない）
1. 作業ツリーを commit（複数commitに分けてもよい）。
2. `sw.js` の `CACHE_VERSION` を `vj-v14` → `vj-v15` に bump（[sw.js:3](../sw.js#L3)）。
3. `git push origin main`。GitHub Pages 更新。**配信はユーザー承認が必須。**

---

## 2. 実機で見る手順（SWキャッシュに注意）

1. dev server 起動：`preview_start`（name=`vj`, port 8125。`.claude/launch.json` 定義済、python http.server + no-store）。
2. ブラウザで http://localhost:8125。
3. **SWが cache-first** なので古コードが出ることがある。コンソールで下記を実行→自動リロードで最新化：
   ```js
   (async()=>{for(const r of await navigator.serviceWorker.getRegistrations())await r.unregister();for(const k of await caches.keys())await caches.delete(k);location.reload();})()
   ```
4. 「タップして開始」→ ≡メニュー → **GROUND PLAN**。声/音で通電→起き上がりループ。

---

## 3. このセッションで実装した内容（DONE）

### A〜E（前回ハンドオフの確定修正・完了）
- **A 通電を円形→分岐成長 + 毎ループ再生**：各セグメントに front空間スケジュール `{t0,tg}` を付与（新 `_schedule()`、`_build()` で `_trunkSched` 算出）。`draw()` は半径Rでなく `this._front` と `s.t0` を比較。幹（spine/富士見/旭/rail）が時間差で先行→格子が枝分かれ。**毎ループ**：SINKで建物イージング沈降→`RETRACT_RATE`で回路後退→再ENERGIZE（`update()` 位相機械）。暗い外周メッシュ(K_GOUT)は地区エンベロープからの**はみ出し量**でキー（円を再生しない）。
- **B Grid最細**：`density` 既定 **2.0**（[L106](../src/scenes/dots/GroundPlan.js#L106)）。segCount≈663（MAX_SEG 1500内）。
- **C/密度（下記§3キューブで進化）**。
- **D 線路長**：`railHalf = SH_L`（[L196](../src/scenes/dots/GroundPlan.js#L196)）= 富士見の終点幅。
- **E 質感**：tip を `smoothstep` イージング、SINK を指数イージング。

### 旧駅舎ランドマーク（新規 `_drawStation` [L632]・実物トレース）
ユーザーが実物写真/図を反復提示。**「ほぼ完成」承認済**。要点：
- **旧駅舎タワー（旧 K_LAND ブロック）を撤去**し、専用メッシュで描画。`_buildBlocks` の駅舎push削除（[L300]）。城/街と同じ投影・モノクロ階調・面ソート、最背面に描画（cubeはすべて駅舎より南＝手前なので順序OK）。
- **屋根は2つの別棟切妻が段違い**（重要・ユーザー明示仕様）：
  - **主屋根**：中央〜右、N-S棟、正面に大きな三角**妻壁**（=壁、屋根面ではない）。ピッチ **~51°**（ピクセル計測で確認）。`uW=-0.060,uE=0.060,vS=0.065,vN=-0.037,hW=0.26,hR=0.683`（[L640]）。**奥行きは半分**に調整済（depth=0.102）。
  - **左側 低い別棟**：**E-W棟**（正面からは平面、側面で三角）。主屋根より低い（`whR=0.40` vs `hR=0.683`）。主の西斜面に差し込み段差/谷。`wuW=-0.140,wuE=-0.050,wvS=0.058,wvN=-0.026,wRv=0.016,whW=0.17,whR=0.40`（[L641]）。
- **ディテール（南妻面に線描）**：半円アーチ窓 + 縦長3窓。左低層屋根の南斜面前寄りに**半円ドーマー窓**（eyebrow）。
- **庇**（platform canopy）を南基部に。`cuW=-0.062,cuE=0.062,cvN=0.065,cvS=0.118,cb=0.12,ct=0.175`。
- **モノクロ厳守**：屋根は赤に出来ない（赤は通電ノード/tip専用）。**シルエットで「あの三角屋根」を表現**。
- 起き上がり：`local = smoothstep(0,0.16,front3d)` で rise と連動（[L520]）。

### キューブ（非ランドマーク建物・密度仕様）
ユーザー指示：「ホームベース枠内はびっしり、枠外はまばら、低く（墓標回避）」。
- `_buildBlocks`：`BLOCK_CELLS=1.6`（小セル=多数）、`MAX_BLOCKS=1300`。inside は `CUBE_FILL_IN=0.82`（ほぼ埋める）、outside は `CUBE_FILL_OUT=0.55`。`JIT_POS=0.07`（格子CG感を崩す微小ジッタ）。**高さを低く**（`hNorm` inside=0.12+0.30n / outside=0.09+0.16n）＝低層テクスチャ。各blockに `rnd`（sparse-outside抽選用）。
- `draw()` scope分岐：District は inside全部 + outside を `blk.rnd > OUT_SPARSE(0.32)` で間引き（まばら散布）。City は全部。Landmark は K_LAND のみ。

---

## 4. アーキテクチャ / 主要メソッド・定数（編集の地図）

全ロジックは **`src/scenes/dots/GroundPlan.js`（~720行）**。`Scene` 契約・registry・投影基盤は不変。

| メソッド | 役割 |
|---|---|
| `_build()` [173] | 道路+格子セグメント。`_trunkSched` 算出 → `_schedule()` → `_buildBlocks()` |
| `_schedule()` | seg毎に kind別 `{t0,tg}`（分岐成長スケジュール） |
| `_genGrid()` | 全画面格子（K_GRID内/K_GOUT外） |
| `_buildBlocks()` | キューブfootprint（inside密/outside疎、ジッタ、低層） |
| `update()` [311] | drive計算 → 毎ループ位相機械（front前進/RISE/HOLD/SINK retract） |
| `draw()` [~460] | seg描画（front-schedule）→ `_drawStation` → cube面ソート描画 |
| **`_drawStation()` [632]** | 旧駅舎（2段違い切妻+庇+窓+ドーマー）。法線は外積+外向き反転、camNz背面カリング、camZソート |
| `_basis/_project/_pv/_strokeFaces` | 弱透視投影・面 |

**定数（現値）**：`MAX_BLOCKS=1300, BLOCK_CELLS=1.6, CUBE_FILL_IN=0.82, CUBE_FILL_OUT=0.55, OUT_SPARSE=0.32, JIT_POS=0.07`（[L59-64]）／`TRUNK_SPAN=0.55, BRANCH_DELAY=0.015, RETRACT_RATE=0.5, SINK_RATE=0.26`（[L71-76]）／`density既定2.0`[L106]／`railHalf=SH_L`[L196]。
**2D承認済ジオメトリ（基本いじらない）**：`A_FUJIMI=52° A_ASAHI=46° SH_L=0.945 SH_R=0.511`（富士見:旭≈1.7非対称）。

---

## 5. 🔧 技術的学び（次セッション必読 — スクショ/検証の落とし穴）

これを知らないと前回同様スクショで何時間も溶かす。

1. **プレビュー canvas は backing が logical の2倍**（例 backing 1520 / logical 760, dpr報告は1）。手動 `ctx.setTransform(1,0,0,1,0,0)` クリアは engine の2×変換を消し、内容が左上1/4に描かれる。**手動描画時は**：device空間でクリア → `ctx.setTransform(bw/w,0,0,bh/h,0,0)` を設定してから `drawFrame/_drawStation`。**通常のengineループは正しく処理**（手動描画だけ要対処）。
2. **headless preview の RAF は走り、シーンを自動進行させる**。決定的フレーム撮影は (a) `eng.running=false` で凍結→手動描画、または (b) `gp.update` を monkeypatch で状態固定。
3. **精度メソッド（有効だった）**：geometryを**明示的な数値比**で作る → canvas pixel を `getImageData` で読み、駅舎シルエット（apex/eave/pitch）を実測。駅舎だけ分離するには、tone（`_toneCss`）を一度 `drawFrame` で埋めた後、クリア→**`_drawStation` だけ**を描いて計測。ピッチ51°を実測確認した。
4. **SW cache-first**：リロード前に §2 のスニペットで unregister + caches.delete。
5. **Bash が一時的に全コマンド Exit 1 になる**ことがある（環境の揺れ）。少し待って再試行で復帰。syntax確認は `cp …/tmp/x.mjs && node --check`。

---

## 6. 次の改善候補

**セッション3で対応済（★参照）**：動き/カメラ質感(#1#3)、キューブ段差/起き上がり(#4)、SINKテンポ(#5)、キャンパス(#2)、背骨(#6)。

**残・次セッション向け**：
- **★実機iPad perf計測（最優先・未完）**：dev Mac headless は District ~49fps / City ~41fps（quality=1）だが iPad未計測。手順=Mac IP:8125 を iPad Safari で開く（同一LAN）→ §2スニペットでSWキャッシュ解除 → Ground Plan, **scope=City + style=Hybrid**（最悪）→ Web Inspector で RISE→HOLD→SINK 10秒録画、最低FPSと律速フェーズ。**目標 持続≥30fps**。下回れば ①`clock.quality`下げてq-shedが効くか確認 ②`order.sort` を深度バケットソート(O(n))化 ③`MAX_BLOCKS` 1300→1100。
- **ライブ・チューニング候補（数値のみ・実機で）**：`FRAME_DROP`(0.16–0.24)、`LIVE_VANTAGES` の pitch/yaw、微ドリフト振幅(0.03)、`SINK_RATE`(崩落の速さ)、キャンパス高さ(`H*0.008`)、`spineBoost`(0.8)。
- **駅舎の最終調整候補**（必要なら・**触るなら最小限・要確認**）：段差/谷を明確化、ドーマー拡大、左別棟の浴場窓追加。
- **minimal-techno 維持**：新規の色/グロー禁止、赤は駅ノード+tipのみ、モノクロ厳守 [[aesthetic-minimal-techno]]。

---

## 7. 鉄則（忘れない）
- モノクロ厳守。赤は駅ノード＋通電tipのみ。虹色グロー禁止。
- 真俯瞰の全通電(ENERGIZE冒頭)は配信版2Dと同一の見え（弱透視がorthoに一致）。`_basis/_project` 不変。
- **「直った」はスクショ実測後に報告**（§5の精度メソッド使用）。
- 配信はユーザー承認後のみ。勝手にpushしない。**作業ツリーを checkout で潰さない。**

---

## 8. 復旧ポイント / 関連
- 駅舎前の3Dチェックポイント：`5bd28e3`（※checkoutは作業ツリーを潰すので使うなら別ブランチで）。
- memory：`groundplan-flat-redirect.md`（現状）／`aesthetic-minimal-techno.md`（美学）／`verify-visual-before-claiming.md`。
- 設計spec：`docs/superpowers/specs/2026-06-24-groundplan-3d-elevation-design.md`。
