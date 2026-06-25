# ハンドオフ — Plan 3 step 4（大学通り並木のモノクロ四季）完了 → 次は step 5 粒子＋冬ストロボ

**日付:** 2026-06-25
**ブランチ:** `feat/city-webgl-render`（未マージ・保持。`main`=2D配信版で安全）
**ステータス:** **step 1-4 完了・コミット済・視覚検証済。73 tests green。** step 4（並木のモノクロ四季）は commit **`3ef3a22`**、step 1-3 は **`37123fe`**。working tree クリーン。次は **step 5＝粒子（花びら/落ち葉/雪）＋冬の白ストロボ**。

設計の全体像は spec を必ず読む: [docs/superpowers/specs/2026-06-25-plan3-seasonal-reveal-design.md](../specs/2026-06-25-plan3-seasonal-reveal-design.md)（特に §「木々 季節システム」の粒子・ストロボ部分）。前ハンドオフ: [2026-06-25-plan3-intro-done-seasons-next-handoff.md](2026-06-25-plan3-intro-done-seasons-next-handoff.md)。

---

## 0. ユーザーのビジョン（確定・不変）

4サイクル＝四季のシネマティック・ループ（時間ベース、音は後）。
- **1サイクル＝往復**: ① 旧駅舎寄り → ② 扇 → ③ 市街（長め固定＝見せ場）→ ④ 全域 → **ゆっくり逆ドリーで①へ沈む**。
- **4サイクル＝春→夏→秋→冬**、冬の次は春へループ。大学通りの並木が季節を運び、③ の長め hold で見せる。
- **リビールはイントロで1回**（地形→道路→建物が組み上がる）。以後は街は建ったまま、カメラ往復＋並木の季節変化のみ。
- **2モード**: 既定＝モノクロ厳守（守る線）。`C` キーで季節色モードにトグル（step 6）。
- step 4 で四季の見た目（明度/密度/トーン/雪）は実装済。**step 5 で「動き」＝散る粒子と冬ストロボを足す**（最も Ikeda な瞬間＝冬の白ストロボが並木を流れる）。

## 1. ここまでの実装（step 1-4、全てコミット済）

すべて additive・buildless ESM・three は vendored（r160 `src/vendor/three.module.js`）。`update()` 系の純粋部は node テスト済。

| File | 役割 | テスト |
|---|---|---|
| [src/cityproto/ease.js](../../../src/cityproto/ease.js) | 純粋 easing＋`byName` | ease（5） |
| [src/cityproto/camrig.js](../../../src/cityproto/camrig.js) | 4フレーミング keyframes／lerp／parallax | camrig（7） |
| [src/cityproto/director.js](../../../src/cityproto/director.js) | マスタータイムライン。`update(tSec)→{cam,reveal,season}`。`SEASON_NAMES` の正本 | director（8） |
| [src/cityproto/reveal.js](../../../src/cityproto/reveal.js) | 建物 ripple（per-vertex aReveal/aBaseY＋onBeforeCompile） | reveal（2） |
| [src/cityproto/intro.js](../../../src/cityproto/intro.js) | 地形格子＋道路の opacity reveal | intro（2） |
| **[src/cityproto/seasons.js](../../../src/cityproto/seasons.js)（新）** | **季節の単一真実源（純粋）**。`MONO_SETTLED[4]`／`COLOR_PALETTE[4]`／`GRAD`／`seasonEndpoints` | **seasons（7）** |
| **[src/cityproto/trees.js](../../../src/cityproto/trees.js)（拡張）** | **`planLayout`（純粋）＋`buildTrees`→{group,update,setMode}**。季節シェーダ | **trees（7, planLayout のみ import）** |
| [src/cityproto/proto.js](../../../src/cityproto/proto.js)（M） | loop で `trees.update(f.season, mode, dt)`、`__proto.setMode` | — |

**proto.js loop の要**（[proto.js](../../../src/cityproto/proto.js)）:
```
const f = director.update(tSec, { parallax });
Object.assign(params, f.cam); applyCamera();
if (reveal) reveal.setProgress(f.reveal.buildings);
if (intro) { intro.setTerrain(f.reveal.terrain); intro.setRoads(f.reveal.roads); }
if (trees) trees.update(f.season, mode, dt);     // ★ step 4 で追加。mode は proto の let（既定 0）
```
`mode` は proto モジュールの `let mode = 0`（mono）。`window.__proto.setMode(b)` で 0/1 を切替（step 6 の `C` キーはまだ無い＝テスト用に露出）。

## 2. ★ step 4 の設計と技術メモ（step 5 で必読）

### 2.1 季節の駆動メカニズム（並木が「下流へ染まる」仕組み）
- director の `f.season = {index(0..3), prog(0→1), name}` をそのまま消費。`prog` は ①→②→③ で 0→1（`seasonRampEnd`≈12.7s で 1 到達）、④/reverse は 1 固定。次サイクルで index++、prog は 0 へ。
- **seasons.js `seasonEndpoints(index)`** が `{prev: MONO_SETTLED[(i+3)%4], cur: MONO_SETTLED[i], colorPrev, colorCur}` を返す。**連続不変条件 `cur(i) === prev((i+1)%4)`**（＝prog=1 の見た目が次サイクル prog=0 の起点と一致）。これが 4サイクルループを継ぎ目なくする肝。unit test 済。
- **per-instance progI**（GLSL）: `progI = smoothstep(min(aPhase*uStagger, 1-uBand), …, uProg)`。上流（aPhase小）が先、下流（aPhase大）が遅れて染まる＝spec の「並木を下流へゆっくり染める」。**`min(…, 1-uBand)` クランプが R-6＝wrap pop 防止の肝**（これが無いと最下流木が prog=1 で cur に到達せずサイクル境界でポップ）。`uStagger=0.7, uBand=0.3`（和=1.0、クランプは inert だが堅牢化のため残す）。
- canopy は instance ごとに `prev→cur` の settled 値（scale/density/toneLo/toneHi/shimmer/snow）を `progI` で blend。

### 2.2 並木の構成（trees.js）
- **`planLayout(manifest, opts)`（純粋・THREE/terrain 不要）** → `{avenue:[{u,v,aPhase,seed}], scatter:[{u,v,aPhase,seed}]}`。xorshift seed・grid-thin dedupe・green散布・大学通り両側植えを内包。`aPhase` = **植えた avenue 点の v実測 min/max** で正規化（ハードコードしない。`V1===V0` ガード）。`seed` は plant 順に draw＝layout も seed も完全決定（reveal.js の `buildRevealAttributes` 純粋／`installReveal` THREE 分離と同型）。
- **`buildTrees`（THREE）** → `{group, update(season,mode,dt), setMode(mode), uniforms}`。avenueMesh（97本・uDamp 1.0）と scatterMesh（547本・uDamp 0.45）の **2つの InstancedMesh**。各々 **geo を clone**（per-instance `aPhase`/`aSeed` を別々に持つため）＋ material を clone（uDamp 差）。**DEM raycast 着地＋instanceMatrix の基本サイズ（seed 由来）は不変＝毎フレーム書換えない**。`frustumCulled=false`（シェーダで伸縮＝CPU bounds が誤るため必須）。
- **共有 uniforms `U`**（同じ `{value}` オブジェクトを両 material の onBeforeCompile で参照＝1書込で両プログラム更新）: `uProg, uScale(vec2), uDensity(vec2), uToneLo(vec2), uToneHi(vec2), uShimmer(vec2), uSnow(vec2), uColor0(vec3), uColor1(vec3), uMode, uTime, uStagger(0.7), uBand(0.3), uGradBase, uGradSpan`。per-mesh: `uDamp`。`__proto.trees.uniforms` で露出（デバッグ用）。
- **GRAD 単一真実源**: canopy の baked 縦グレーグラデ `grey = GRAD.base + GRAD.span*t`（base 0.11/span 0.20）。シェーダはこの定数（`uGradBase/uGradSpan`）で `t` を逆算→季節トーンへ再マップ。bake と shader が drift しない。

### 2.3 onBeforeCompile アンカー（vendored three r160 で検証済・verbatim）
- 頂点: `#include <common>`（attribute/uniform/varying 宣言）→ `#include <begin_vertex>` の直後で `transformed` をローカル空間スケール。`instanceMatrix` は後段 `#include <project_vertex>` で乗るので、ここでのスケールは正しく「ローカル→instance」順になる（reveal.js と同型）。
- フラグメント: `#include <common>`（宣言）→ **`#include <color_fragment>` の直後**で `diffuseColor.rgb` を上書き（この時点で `diffuseColor.rgb == vColor == baked grey`）。`vertexColors:true`＝`USE_COLOR` で `vColor` が両ステージに宣言される。
- **R-1（冬の点スペック回避）**: 間引いた木（`keep→0`）は `transformed.y -= 999.0*(1.0-keep)` で地下へ追放（scale→0 だけだと canopy 中心に 1px の点が残る）。
- 色は最後に `diffuseColor.rgb = mix(vec3(grey), seasonC, uMode)`＝**mono が既定**、`uMode=0` で chroma 分岐は死んでいる（コンパイルはされる＝step 6 はシェーダ無編集）。

### 2.4 MONO_SETTLED の現値（look-tuning、目で詰めて確定可）
| 季節 | scale | density | toneLo | toneHi | shimmer | snow |
|---|---|---|---|---|---|---|
| 春 桜 | 1.05 | 0.90 | 0.20 | 0.46 | 0 | 0 |
| 夏 濃緑 | 1.18 | 1.00 | 0.09 | 0.22 | 0 | 0 |
| 秋 | 0.98 | 0.62 | 0.14 | 0.34 | 0.10 | 0 |
| 冬 | 0.82 | 0.42 | 0.11 | 0.40 | 0.02 | 0.7 |

`COLOR_PALETTE`（0..1 linear、step 6 用）: 春[0.95,0.62,0.72]／夏[0.36,0.58,0.30]／秋[0.85,0.50,0.18]／冬[0.80,0.86,0.95]。

## 3. 視覚検証（実物確認済み・再現手順）

dev サーバー: `.claude/launch.json` の `vj`（:8125, ThreadingTCPServer）。`preview_start vj` → `http://localhost:8125/city-proto.html` → reload。**resize は ≤667 幅**（800 等に emulate すると screenshot に黒帯。canvas 自体は正しい [[image-delivery-via-localhost]]）。

**ループが毎フレーム上書きするので、特定の季節/カメラを固定して見る手順**（本セッションで使用）:
```js
// ① カメラを固定（season/reveal は原版のまま、cam だけ差し替え）
const p = window.__proto;
p.__origUpdate = p.director.update.bind(p.director);
window.__cam = { camX:1.6, camY:1.45, camZ:-1.2, fov:50, lookX:-0.05, lookY:0.02, lookV:3.2 }; // 並木接写
p.director.update = (t,o) => { const f = p.__origUpdate(t,o); f.cam = window.__cam; return f; };
p.setPaused(true); p.setMode(0);
// ② 各季節の③hold（prog≈0.99）へ。cycleDur=20.4、③hold中央≈local 12.0
window.__season = (i) => { const t = i*20.4 + 12.0; p.seek(t); return p.__origUpdate(t).season; };
// 染めsweep（遷移途中）は t = i*20.4 + 4.8 あたり（prog≈0.32）
// wrap連続は t=20.3（春prog1）と t=20.5（夏prog≈0）が同一フレーム
// ③ 復元: p.director.update = p.__origUpdate; p.setPaused(false); p.setMode(0);
```
avenue 並木は **x≈0、z≈-0.6..5.9 の南北ライン**（aPhase は v→z で増加、低z=aPhase0、高z=aPhase1）。

**確認済み**: 四季が明瞭に分離（春=明/密・夏=暗/最密・秋=中/疎化・冬=白雪crown/最疎）／染めが上流→下流へ sweep／wrap でポップ無し（20.3≡20.5）／冬に中心スペック無し／`mode=0` で完全モノクロ／`__proto.setMode(1)` で chroma（春=桜ピンク）が崩れず疎通。

## 4. ★ 次の本丸 — step 5: 粒子（花びら/落ち葉/雪）＋冬の白ストロボ

spec §「木々 季節システム」の粒子・ストロボ部分。**最も Ikeda な瞬間＝冬の白ストロボが並木を流れる**。

### 4.1 粒子（spec 準拠）
- **`THREE.Points` 1系統を季節で使い回し**（~1.5–3k、`params.petalCount`）。**落下は頂点シェーダで `mod(uTime - aBirth, life)`＝CPU respawn 無し**（守る線：GPU 駆動・再ライティングしない）。
- emit 領域＝**大学通り並木沿い**（`planLayout().avenue` を流用、または avenue 点から散布原点を作る）。per-particle `aBirth`/`aSeed`/`aPhase`（aPhase は並木と揃えると染めと同期した散りになる）。
- 季節で見た目を uniform 切替: **春＝花びら（モノ=白、色=ピンク）**／**秋＝落ち葉（モノ=中明、色=黄→橙→赤）**／**冬＝雪（白）**。夏は粒子ほぼ無し。粒子の量/種別は **seasons.js に記述子を足して単一真実源を維持**（例: `MONO_SETTLED` に `fall`(0..1) を足す、or `PARTICLE[4]`）。
- 落下範囲は DEM 厳密でなくてよい（canopy 高さ→地面付近の一定窓で十分）。サイズは `gl_PointSize`。

### 4.2 冬ストロボ（canopy シェーダに追加）
- canopy material に **`uStrobe` uniform を追加**（spec の uniforms リストに既出）。**aPhase ベースの走る白パルス**＝並木を白点滅が下流へ流れる。
- **安全策（厳守）**: **≤3Hz**、in/out ランプ（急峻禁止）、**白のみ**（無彩）、**`S` キー＋`params.strobeEnabled` でゲート**（既定オフでも可）。光感受性配慮。
- 冬（season index 3）でのみ有効。`uStrobe` を director or trees 側で冬かつ prog 進行に応じて 0→1。

### 4.3 実装方針（提案）
1. **seasons.js** に粒子記述子を追加（季節ごとの fall 量/種別）＝単一真実源を崩さない。
2. **新 `src/cityproto/particles.js`**: `planEmit`（純粋・avenue 点から emit 原点＋aBirth/aSeed/aPhase）＋`buildParticles(THREE, emit, opts)`→`{points, update(season, mode, dt)}`。落下/季節は頂点シェーダ。純粋部を node test。
3. **trees.js** canopy シェーダに `uStrobe` を足す（onBeforeCompile に白パルス1行＋uniform）。`trees.setStrobe?` か `update` 内で冬判定。
4. **proto.js**: particles 結線（`scene.add(particles.points)`、loop で `particles.update(f.season, mode, dt)`）、`S` キー、`params.strobeEnabled`/`petalCount`。
5. 既存 73 tests 緑維持＋particles 純粋部の test 追加。

### 4.4 残り（step 6）
**季節色モード**: `COLOR_PALETTE`／`uMode` は **既に配線済**（trees）。step 6 は `C` キー（`EnvelopeFollower` 等で ~0.6s crossfade＝既に `update` 内で `uMode` を dt*4 でイージング済）＋粒子の色版＋ControlPanel 露出。**シェーダ編集は不要**。

## 5. 守った線（不変条件・厳守）

- **モノクロ厳守**（既定）。白＝大学通り・富士見・旭・中央線のみ。**雪／ストロボは無彩白で許容**。色は `uMode` 後ろの opt-in のみ。虹色/グロー無し。
- アニメは camera/uniform 駆動（**静的 unlit・再ライティングしない**）。**instanceMatrix／canopy の baked グラデ色は不変**、季節は uniform のみ。**粒子も GPU 駆動（CPU respawn 無し）**。
- **ストロボ安全**: ≤3Hz・白のみ・in/out ランプ・`S`＋`strobeEnabled` ゲート。
- 道路は位置・id 判定（baked、変更しない）。reveal/intro は道路 tier ロジックに触れない。
- iPad PWA / buildless ESM / three vendored。baked 資産（glb/manifest）不変。2D配信地図・他VJシーンは不変。

## 6. 検証

- `node --test`（全体）＝**73 green**。cityproto 群: `node --test tests/cityproto/*.test.mjs`（41）。
- ベイク不変: `node --test tools/citybake/tests/citybake/*.test.mjs`（32 green）。
- preview で step ごとに実物スクショ確認（§3 の固定カメラ手順）。画像は `:8125/shots/` URL で渡す [[image-delivery-via-localhost]]、実物確認後に報告 [[verify-visual-before-claiming]]。

## 7. コミット状態

**step 1-4 はコミット済・working tree クリーン。**
- step 4: `3ef3a22`（`src/cityproto/{seasons.js,trees.js,proto.js}` ＋ `tests/cityproto/{seasons,trees}.test.mjs`、+385/−47）。
- step 1-3: `37123fe`。spec＋前 handoff も commit 済。

## ▶ 次回キックオフ（このまま貼れる）

> 国立シティ写実WebGLレンダ Plan 3 の続き。ブランチ `feat/city-webgl-render`。**step 1-4 完了・コミット済・視覚検証済・73 tests green**（step4=大学通り並木のモノクロ四季 commit `3ef3a22`／step1-3 `37123fe`）。ハンドオフ `docs/superpowers/handoffs/2026-06-25-plan3-step4-seasons-done-particles-next-handoff.md` と spec `docs/superpowers/specs/2026-06-25-plan3-seasonal-reveal-design.md`（§木々 季節システムの粒子・ストロボ）を読んで。次の本丸は **step 5＝粒子（花びら/落ち葉/雪）＋冬の白ストロボ**: 新 `particles.js`（`THREE.Points` 1系統を季節使い回し、emit=大学通り並木沿い、落下は頂点シェーダ `mod(uTime-aBirth,life)`＝CPU respawn 無し、春=花びら/秋=落ち葉/冬=雪、量/種別は seasons.js に足して単一真実源維持）＋ canopy シェーダに `uStrobe`（aPhase で並木を白点滅が下流へ流れる、冬のみ）。**ストロボ安全＝≤3Hz・白のみ・in/out ランプ・`S`キー＋`params.strobeEnabled` ゲート**。守る線＝モノ既定（色は uMode opt-in、step6 は配線済でシェーダ無編集）／再ライティングしない・instanceMatrix 不書換／iPad PWA buildless ESM。検証は固定カメラ手順（ハンドオフ §3、director.update を patch して並木接写、`window.__season(i)` で季節 hold、wrap連続=20.3≡20.5）。画像は `:8125/shots/` URL で。
