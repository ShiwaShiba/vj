# ハンドオフ — 国立シティ 道路レイヤー（二次幹線網＋主要道路の整理）

**日付:** 2026-06-25
**ブランチ:** `feat/city-webgl-render`（未マージ・保持。`main`=2D配信版で安全・未変更）
**ステータス:** 道路まわりほぼ完了。**残り＝白線(国立停車場谷保線)の「谷保天満宮側へ分岐する2セグメント」を消すだけ。** その後コミット。
**このセッションは Context 肥大（大量の画像往復）でこの単純作業にミスが続いたため、fresh-context で再開する。**

---

## 0. 発端と結論

- ユーザー懸念「目立たせた主要道路以外が薄すぎないか?」→ 調査の結果、**主要道路以外は薄いのではなく一切描画されていなかった**（spec [design.md:51,68](docs/superpowers/specs/2026-06-24-kunitachi-city-photoreal-render-design.md) の二次レイヤー＝細街路が未実装だった）。
- 二次幹線網を追加し、ユーザーの逐次フィードバックで主要道路を整理。
- 「ホームベース型（旧駅舎の三角屋根と一致する象徴）」を白で強調する試みは**失敗→完全撤回**（OSM無名道路の再取得も git で巻き戻し済）。
- **最終形：白い主要道路 = 大学通り・富士見通り・旭通り（＋中央線）のみ。** さくら通り＝グレー、SEの同名「富士見通り」＝グレー。

## 1. ★ 残作業（これだけ・単純）

**白い `国立停車場谷保線`（大学通りの谷保延伸）が南端付近で分岐している。直線側＝谷保駅（正）、分岐側＝谷保天満宮（誤）。分岐側を消すだけ。**

確定データ（plan座標。`fixtures/osm.json` は frozen なので OSM id は安定）:
- **残す＝谷保駅へ直線**: 大学通り → `国立停車場谷保線` id `322205624`(v3.53→4.12) → `85221117`(4.12→4.37) → `53348156`(4.37→4.58)。末端 **(u0.04, v4.58) ＝ 谷保駅**。
- **消す＝谷保天満宮へ分岐**: フォーク点(u0.12,v4.37)から SW へ分かれる id `322205618`(→u0.01,v4.34) ＋ `28213299`(→u-0.39,v4.95)。

**実装方針（[tools/citybake/bake/manifest.mjs](tools/citybake/bake/manifest.mjs)）:**
1. `国立停車場谷保線` を primary 昇格する際、**id `322205618` と `28213299` を除外**（`r.id` は parseOsm が保持済み＝[osm.mjs:61](tools/citybake/geo/osm.mjs) 付近で `roads.push({ id, ... })`）。
2. 不要になった **`clipSouth` / `YAHO_LAT` のハックは削除**してよい（分岐を消せば直線は谷保駅(v4.58)で自然終端する）。id除外が綺麗。
   - geometric fallback を使うなら「u<-0.1 へ向かう SW 枝を落とす」だが、`322205618`(u0.01-0.12)が拾えないので **id 除外を推奨**。
3. 再生成 `MANIFEST_ONLY=1 node tools/citybake/bake.mjs` → preview で**白線が分岐せず谷保駅で素直に終わる**ことをスクショ確認（[[verify-visual-before-claiming]]）。

## 2. このセッションの実装（未コミット）

| ファイル | 変更 |
|---|---|
| [tools/citybake/geo/osm.mjs](tools/citybake/geo/osm.mjs) | `PRIMARY_NAMES` に `国立停車場谷保線`（大学通りの谷保延伸）を追加。さくら通りは**入れない**（グレー維持）。 |
| [tools/citybake/bake/manifest.mjs](tools/citybake/bake/manifest.mjs) | (a) `SECONDARY_CLASSES`＋二次幹線網フィルタ (b) **`stationPrimarySet`＝駅連結ゲート**（名前付き avenue 候補のうち「連結成分が駅近傍 v<0.6 に届く」ものだけ白。同名の遠い富士見通り(SE)や歩道橋を自動排除） (c) `clipSouth`+`YAHO_LAT`（谷保打ち切りの暫定。**残作業で id 除外に置換可**）。 |
| [src/cityproto/avenues.js](src/cityproto/avenues.js) | 二次幹線網を1本の merged `LineSegments` で描画（gray `0x9aa0a8` / opacity `0.68` / `depthTest:false` / `renderOrder:6`、主要道路の下）。主要道路(白)の描画は不変。 |
| [tools/citybake/bake.mjs](tools/citybake/bake.mjs) | **`MANIFEST_ONLY=1` ガード**追加。32分の AO 再ベイク＋glb 書き込みをスキップし manifest だけ再生成。道路は manifest にのみ存在＝glb 不変。 |
| [tools/citybake/tests/citybake/manifest.test.mjs](tools/citybake/tests/citybake/manifest.test.mjs) | 二次幹線網のアサーション追加。`node --test tools/citybake/tests/citybake/*.test.mjs` = **31 green**。 |
| `tools/citybake/dist/city.manifest.json` | 上記で再生成（roads 部分のみ変化）。 |
| `.gitignore` | `shots/` を追加（preview スクショを `:8125/shots/<name>.jpg` で配信。コミット対象外）。 |

**撤回済み（git checkout で committed に復帰＝差分なし）:** `fetch.mjs` / `fixtures/osm.json` / `fixtures/meta.json` / `fixtures/dem`（ホームベース用の無名道路 OSM 再取得を巻き戻した）。

## 3. 未コミットの全体像 + コミット方針

`git status` の `M`:
- **このセッションの道路作業**（コミットする）: `osm.mjs` / `manifest.mjs`（残作業の id 除外を入れてから）/ `avenues.js` / `bake.mjs` / `manifest.test.mjs` / `dist/city.manifest.json` / `.gitignore`。
- **前セッションからの保留**（前ハンドオフ参照、コミットする）: `dist/city.glb`（RAYS=20・23MB。committed は古い1MB）/ `src/cityproto/proto.js`（line15 全域カメラ。**木々の行は除外**）。
- **木々（温存・除外）**: `src/cityproto/trees.js`(untracked) と proto.js の木々 import/呼び出し行は**コミットしない**（Plan 3 で採否判断）。

→ 残作業(分岐削除)を入れて再生成 → preview 視覚確認 → 道路作業＋glb＋proto.jsカメラを（木々除外で）コミット。

## 4. 守った線 / 主要な設計判断

- **モノクロ厳守**。主要道路=白、二次=グレー、地形格子=地。虹色/グロー無し。
- **道路名でなく位置（plan座標）で判定**するのがユーザーの明示要求。`stationPrimarySet` の連結ゲートと残作業の id 除外はその思想。
- 二次幹線網は**名前付き幹線のみ**（住宅細街路は対象外。OSM fixture が `way["highway"]["name"]`＝名前付き限定なので、無名の細街路はそもそも非収録）。
- **画像の渡し方**: dev サーバー `:8125` の `shots/` に保存し URL を提示（[[image-delivery-via-localhost]]）。SendUserFile 埋め込みより低トークン。
- iPad PWA / buildless ESM 維持。three は vendored。

## 5. 検証

- `node --test tools/citybake/tests/citybake/*.test.mjs` → **31 green**。
- `city.glb` は本セッション中 SHA 不変（`6a3b4cfe…`、MANIFEST_ONLY のみ）。
- preview: `.claude/launch.json` の `vj`(8125) を preview_start → `http://localhost:8125/city-proto.html`。reload後 `width<=800`(例800x560)に resize ＋ `window.dispatchEvent(new Event('resize'))`。

## 6. 次の本丸（Plan 3）
段階ズームアウトのリビール演出（前ハンドオフ `2026-06-25-plateau-fullcity-handoff.md` §5）。

## ▶ 次回キックオフ（このまま貼れる）
> 国立シティ写実WebGLレンダの続き。ブランチ `feat/city-webgl-render`。前セッションで道路レイヤー（二次幹線網＋主要道路の整理）をほぼ実装したが未コミット。引き継ぎ `docs/superpowers/handoffs/2026-06-25-city-roads-handoff.md` を読んで。**残り作業はこれだけ＝白い `国立停車場谷保線` が南端で分岐しており、谷保駅へ向かう直線(id 322205624/85221117/53348156)を残し、谷保天満宮へ分岐する id 322205618 と 28213299 を `manifest.mjs` の primary 昇格から除外する（不要な clipSouth/YAHO ハックは削除可）。** その後 `MANIFEST_ONLY=1 node tools/citybake/bake.mjs` → preview(8125/city-proto.html)で白線が分岐せず谷保駅で終わるのをスクショ確認 → 道路作業＋（前セッションの）RAYS=20 glb＋proto.js line15カメラを**木々除外**でコミット。守る線=モノクロ/白は大学通り・富士見通り・旭通り＋中央線のみ/位置ベース判定/iPad PWA buildless/木々は温存。画像は :8125/shots/ のURLで渡す。
