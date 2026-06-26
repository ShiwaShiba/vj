# 設計書: 建物 bake の接触影深化（二スケール AO・generic 限定）

作成日: 2026-06-26
ステータス: ドラフト（adversarial 監査反映済み・ユーザーレビュー待ち）
ブランチ: `feat/city-webgl-render`

## Context（なぜ・何を強化するのか）

国立シティの generic 建物（PLATEAU LOD1 約24,800棟）は現状すべて `baseGrey 1.0` で焼かれ、
単一スケールの半球 AO（半径0.4・20本・`AO_STRENGTH=0.55`）×指向光だけで差がつく。承認済みの
写実 look（`shots/roads5_full.jpg`）は均一な明グレーのカーペットだが、**建物の足元・隣接の谷間に
接地感／奥行きが薄く**、spec `2026-06-24-kunitachi-city-photoreal-render-design.md` が「タッチの核」と
名指しした「柔らかい AO（**接触影**）」がまだ弱い。

本設計はその唯一の正道＝**bake 側の AO 強化**で「中庸に読める接地感／奥行き」を足す。
**任意の per-building グレー個体差は加えない**（[[building-differentiation-ao-only]]＝2026-06-24 にボツにした
canvas-2D「16段グレー/図解」形質の再来になるため厳禁）。差は実 occlusion からのみ出す。

ユーザー確定事項（2026-06-26 brainstorm）:
- スコープ＝**AO／接触影の深化のみ**（区画線・grain は別レイヤーとして分離・後続）。
- 効き具合＝**中庸（明確に読める奥行き）**。強度は env 化し、CPU ラスタライザのモンタージュで最終値を確定。
- 実機が当面使えないため**リモート検証**（headless CPU ラスタライザ）で判断する。

本 spec は実装前の adversarial 監査（4視点：図解回帰／承認済み look／技術不変条件／完全性）を反映済み。
監査で出た高重要度の指摘（landmark/station が global AO で暗化する／terrain の sRGB ハロ／回帰テストの
トートロジー化）を設計に取り込み、下記の修正を確定した。

## 目標 / 非目標

**目標**: generic 建物の接触ゾーン（足元・隣接の谷間）に局所化した柔らかい暗部を bake で足し、均一カーペットの
明るさ印象を保ったまま「中庸に読める接地感／奥行き」に到達する。モノクロ・決定論・iPad 維持。

**非目標**: 区画線（地割り線）、grain（spec 上ランタイム post）、ランタイム再ライティング、
任意の per-building 個体差、ジオメトリ変更、**landmark/station/terrain の見た目変更**。

## アーキテクチャ（二スケール AO・単一キャスト距離バケット・generic 限定・ソフトフォールオフ）

現行 `tools/citybake/bake/ao.mjs` の `bakeAO` はレイごとに「ヒット有無」だけを数える（`ao.mjs:83`）。
`THREE.Raycaster.intersectObject` は交差を**距離昇順**で返す（vendored three: ascSort `a.distance-b.distance`）ので、
**最近ヒット距離 `hits[0].distance`** を読めば、同じレイ・同じ本数・同じ半径の**単一キャスト**から2つの occlusion を導ける。
追加レイ無し（現コードも既に array を materialize し `.length` だけ読んでいる）＝バケ時間ほぼ不変。

```js
// opts: contactStrength=0(既定), contactRadius=radius*0.3, contactMask(Float32Array|null)
let occ = 0, occContact = 0;
// per ray（occ/occContact は頂点ごとに 0 初期化）:
const hits = rc.intersectObject(mesh, false);   // 距離昇順
if (hits.length) {
  occ++;                                          // 広域 ambient（= 現状と同一の occlusion カウント）
  // ソフトフォールオフ: バイナリ閾値ではなく距離で連続重み付け（接触リング/バンディング防止）
  const w = 1 - hits[0].distance / contactRadius;
  if (w > 0) occContact += w;
}
// 合成（mesh=null の頂点は occ=occContact=0 → ambientAO=contactAO=1）:
const cmask = contactMask ? contactMask[i] : 1;            // generic=1, 他=0
const ambientAO = 1 - aoStrength * (occ / rays);           // = 現行の AO 項（不変）
const contactAO = 1 - contactStrength * cmask * (occContact / rays); // 新: 接触ゾーン局所暗化
const ao = ambientAO * contactAO;
const grey = clamp(greyOf(i) * light * ao);                // モノクロ単一チャンネル
```

**type ゲート（generic 限定）**: `bake.mjs` は terrain+generic+landmark+station を1つの soup に統合し
**global に** `bakeAO` を1回呼ぶ（`bake.mjs:76-103`）。素の global contact 項は **旧駅舎(landmark, baseGrey 1.15)・
現役駅・terrain の足元まで暗化**してしまう（監査 high 指摘）。これを避けるため `bake.mjs` の type レンジ
fill ループ（`bake.mjs:87-95`、`baseGrey.fill` の隣）で `contactMask` を作り、**generic レンジのみ 1.0／
terrain・landmark・station は 0** とし `bakeAO` へ渡す。これで「landmark/station/terrain 一切不変」が
**文字通り真**になり、terrain の near-black に sRGB で増幅されるハロも原理的に出ない。

**効果**: 近接 occluder を持つ generic 頂点（建物の足元・隣接の谷間）にのみ追加の柔らかい暗部が乗り、
遠方 occluder のみの開いた面・屋上（n·L 高い）は ambient のまま明るい＝承認済みカーペット印象を保持。
ソフトフォールオフで距離方向に C0 連続＝接触リングや量子化段差が出ない。

## ノブと既定（env 化）

| env | 既定 | 意味 |
|---|---|---|
| `CONTACT_STRENGTH` | `bake.mjs`: **中庸値（モンタージュで 0.2〜0.35 から確定）** ／ `ao.mjs` API 既定: **0** | 接触項の強さ |
| `CONTACT_RADIUS` | `RADIUS * 0.3`（≈0.12 world unit）。env 指定時は**絶対 world unit**。`min(指定, RADIUS)` でクランプ | 接触判定の近接距離 |

`ambient`(0.35) / `L0`([-0.45,0.82,-0.35]) / `AO_STRENGTH`(0.55) / `RADIUS`(0.4) / `RAYS`(20) は不変。
モンタージュ候補強度は **0.25 / 0.35 / 0.5** を固定（再現可能）。`CONTACT_RADIUS >= RADIUS` は contactAO を
第2 ambient 項へ退化させるためクランプ＋テストで防ぐ。レイ原点は法線方向に `eps=radius*0.01` オフセット
されており `hits[0].distance` に約 +0.004 の決定論的バイアスが乗る（チューニング時に勘案・コード変更不要）。

## 不変条件（厳守）

- **ジオメトリ・量子化・manifest は byte 不変** — 変わるのは AO ステージが書く **generic 建物の** COLOR_0 グレー値のみ。
  これは手編集ではなく**ユーザー承認済みの意図的な再ベイク**（dist 更新）。**`dist/city.glb` の COLOR_0 内容は変わる**＝
  旧アセットの再現には `CONTACT_STRENGTH=0` を明示する必要がある。
- **`ao.mjs` API で `contactStrength=0` は現行ピクセル完全一致**（`contactAO=1` → `ao=ambientAO`、`x*1.0==x`／
  `0*finite==+0` の IEEE-754 恒等）。これがパラメータ水準の安全弁。出荷 default（`bake.mjs`）は中庸値＝非0。
- **landmark/station/terrain は一切不変**（contactMask=0 で contact 項が完全に効かない＝COLOR_0 も byte 不変）。
- **モノクロ厳守**（単一グレー）。色/グロー/再ライティング無し。
- **決定論**（seed=1、RNG/Date 無し、距離バケット＋フォールオフは決定論的、同入力→byte 一致）。
- **任意 per-building 個体差を一切入れない**（図解化ガード・[[building-differentiation-ao-only]]）。
  `greyOf` の array/function 形は generic を一律 1.0 で埋める用途のみ＝個体差混入の seam にしない（テストで固定）。
- 道路（manifest 2D 線）/terrainGrid LINES（未ベイク）/木々/particles/reveal の `.y`/season/audio LIVE 層/
  2D 配信地図は一切不変。

## テスト（`tools/citybake/tests/citybake/ao.test.mjs` 拡張・node --test・headless）

- **凍結ゴールデン回帰**: 変更前 `bakeAO` の COLOR_0（量子化後バイト）を test scene で1度生成し**フィクスチャとして
  コミット**。新コードを `contactStrength=0` で実行→**ゴールデンと byte 一致**（自己参照トートロジーを避ける）。
- **generic 限定マスク**: contact>0 でも `contactMask=0` の頂点（terrain/landmark/station 相当）はゴールデンと一致。
- **近接 occluder で暗化＋単調性**: 合成シーンで頂点直近に占有面 → contact 有り < 無し、かつ強度↑で grey 単調減少。
- **遠方 occluder は contact 不変**: occluder を `contactRadius` 超に置くと `w<=0`＝contact=0、ambient のみ。
- **合成の証明**: `ao == ambientAO * contactAO`（contact on でも ambient 項が不変であること）。
- **決定論（contact>0）**: 2 回実行 byte 一致。
- **エッジ**: `mesh=null`→`contactAO=1`／`contactRadius>=radius` はクランプされ degenerate しない／全グレー ∈ [0,1]。
- **個体差 seam ガード**: generic の `baseGrey` スライスが定数 1.0 であることを assert（将来の per-id 変種注入を CI で落とす）。
- 既存テスト全 green 維持。

## 検証（実物確認してから報告・[[verify-visual-before-claiming]]）

0. **`render.mjs` の色パイプライン整合を先に確認**: ランタイム（`MeshBasicMaterial vertexColors` + renderer の
   sRGB 出力）と同じ linear→sRGB エンコードで COLOR_0 を解釈していること。差があるとモンタージュ値が実機へ転送
   されないため、検証の前提として固定する。
1. `node --test` 全 green。
2. **反復モンタージュ**: `CONTACT_STRENGTH ∈ {0, 0.25, 0.35, 0.5}` を `RAYS=4-5` 全バケ（≈4〜5分）で生成 →
   各 glb を scratchpad 退避 → `render.mjs` で広域＋**密集コア拡大**＋**建物足元拡大**＋**旧駅舎周辺**をレンダ →
   モンタージュ作成。**低レイは contact が ~1/5 段に量子化され段差を過大表示する**点を注記。
3. `shots/roads5_full.jpg` と並べ受入ゲート（各々を明示確認）: ①密集コアの谷間が**潰れて near-black 化しない**
   （濁らない）②建物足元の接触線が**リング/段差なく滑らか**③**旧駅舎・現役駅・terrain が不変**④図解化しない。
   合わせて contact 発火頂点率（`occContact>0` の generic 頂点割合）をログし、`RADIUS*0.3` で意味ある母数に
   効いているか確認（小さすぎ＝ほぼ無効／大きすぎ＝ambient 重複）。
4. **確定強度で `RAYS=20` の確認タイル**を1枚焼き、低レイ判断が滑らかな最終と一致することを確認 → 中庸値を確定。
5. 確定値で **`RAYS=20` 全バケ（≈25分）** → 最終 `dist/city.glb` を生成。
6. **明示許可後**に commit（`ao.mjs`＋`bake.mjs`＋`ao.test.mjs`＋ゴールデンフィクスチャ＋再ベイク `dist/city.glb`；
   `dist/city.manifest.json` は差分無しを確認）。

## 重要ファイル

- 改修: `tools/citybake/bake/ao.mjs`（`bakeAO` に距離バケット＋ソフトフォールオフ contact 項＋`contactMask` 受け取り）／
  `tools/citybake/bake.mjs`（`CONTACT_STRENGTH`/`CONTACT_RADIUS` env 読み＋クランプ＋`contactMask` 構築＋ `bakeAO` opts へ受け渡し）。
- テスト: `tools/citybake/tests/citybake/ao.test.mjs` 拡張＋ゴールデンフィクスチャ追加。
- 検証のみ（scratchpad・原則未コミット）: `render.mjs`（実 glb をラスタライズ；要作成・色パイプライン整合確認）。
- 参照（無編集）: `bake/manifest.mjs`（COLOR_0 を書かない）／`glb.mjs`（量子化）／`shots/roads5_full.jpg`（承認済み look）／
  `docs/superpowers/specs/2026-06-24-kunitachi-city-photoreal-render-design.md`（ボツ記録・タッチの核）。
