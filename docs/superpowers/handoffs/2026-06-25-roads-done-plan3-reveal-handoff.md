# ハンドオフ — 道路レイヤー完了 → 次の本丸 Plan 3（段階ズームアウトのリビール演出）

**日付:** 2026-06-25
**ブランチ:** `feat/city-webgl-render`（未マージ・保持。`main`=2D配信版で安全・未変更）
**ステータス:** **道路レイヤー完了・コミット済み（`5956748`）。** 次は Plan 3＝リビール演出（未着手）。

---

## 0. このセッションの結論

前セッションの残作業（白い `国立停車場谷保線` が南端で谷保天満宮へ分岐していた件）を解消し、保留中の道路作業一式をコミットした。

- **核心**: 5本の `国立停車場谷保線` way はすべて同名＋`highway:secondary`。名前で区別不能なので **OSM id で判定**するしかない。さらに当初案「primary 昇格から除外」だけでは、分岐2本が**グレーの二次線として残ってしまう**（name付き＋secondaryクラスは二次層に該当）。よって **id を tier 判定の前で完全 drop**（白でもグレーでも描かない）が正解。
- 旧 `clipSouth`/`YAHO_LAT` ハック（v座標で南を切る）は、フォーク・スタブ `322205618`（v≈4.34＝谷保駅より北）を取りこぼしていた本体。削除して id drop に置換。
- 検証: 残った `国立停車場谷保線` の最南点 `u=-0.162, v=4.578`＝谷保駅。分岐先（v≈4.95 / u≈-0.39）は消滅。視覚確認済（白線が1点で素直に終端、分岐なし）。

## 1. 確定した実装（コミット `5956748` に含まれる）

| ファイル | 変更 |
|---|---|
| [tools/citybake/bake/manifest.mjs](tools/citybake/bake/manifest.mjs) | `DROP_IDS = new Set([322205618, 28213299])`、road ループ先頭で `if (DROP_IDS.has(r.id)) continue;`。`clipSouth`/`YAHO_LAT`/`yahoV` ハック削除。前セッションの二次幹線網フィルタ＋`stationPrimarySet`（駅連結ゲート）も同梱。 |
| [tools/citybake/geo/osm.mjs](tools/citybake/geo/osm.mjs) | `PRIMARY_NAMES` に `国立停車場谷保線`。road は `id: el.id` 保持済（drop 判定の前提）。 |
| [src/cityproto/avenues.js](src/cityproto/avenues.js) | 二次幹線網を merged `LineSegments`（gray `0x9aa0a8`/opacity`0.68`/`depthTest:false`/`renderOrder:6`、白の下）。 |
| [tools/citybake/bake.mjs](tools/citybake/bake.mjs) | `MANIFEST_ONLY=1` ガード（AO再ベイク＋glb書き込みをスキップ、manifestのみ再生成）。 |
| [tools/citybake/tests/citybake/manifest.test.mjs](tools/citybake/tests/citybake/manifest.test.mjs) | id ベース除外の回帰テスト追加（同名 sibling は残り、分岐 id だけ消えることを assert）。**`node --test tools/citybake/tests/citybake/*.test.mjs` = 32 green**。 |
| `tools/citybake/dist/city.manifest.json` | 上記で再生成（primary 17 / secondary 230）。 |
| `tools/citybake/dist/city.glb` | 前セッションの RAYS=20・23MB（committed は旧1MB）。`MANIFEST_ONLY` 中 SHA 不変＝`ce435c3f…`。 |
| `src/cityproto/proto.js` | **line15 カメラのみ**（国立市全域フレーミング）。木々の行は**除外**。 |
| `docs/.../2026-06-25-city-roads-handoff.md` | 前セッションのハンドオフ（記録として同梱）。 |

## 2. ★ working tree に温存した未コミット物（重要・stray ではない）

`git status` に残るのは**意図的な温存**。Plan 3 で採否判断するため、まだコミットしていない:

- `src/cityproto/trees.js`（untracked）— モノクロ植生インスタンシング（green rects 散布＋大学通り並木、DEM へ raycast 着地、グレーのみ）。
- `src/cityproto/proto.js` の木々3 hunk（working diff として残存）— `import { buildTrees }` / `let trees…buildTrees(manifest, terrain)` / `window.__proto.trees`。

→ Plan 3 で「木々を reveal 演出に組み込む」と決めたらここでコミット。捨てる判断なら `git checkout proto.js && rm trees.js`。**先に消さないこと**。

## 3. 次の本丸 — Plan 3（段階ズームアウトのリビール演出）

**ユーザーのビジョン**（[前ハンドオフ §5](docs/superpowers/handoffs/2026-06-25-plateau-fullcity-handoff.md)）:
> ズームイン序盤 → **段階的に**ズームアウト → 国立市全域で少し固定。「ズームアウトが早すぎると勿体ない、緩急(段階)を設けたい＝展開の肝」。

**リビール順**（[spec L20/L73](docs/superpowers/specs/2026-06-24-kunitachi-city-photoreal-render-design.md)）: ① 地形（格子が立ち上がる）→ ② 道路（通電スイープ、主要道路は最上位で明）→ ③ 建物（距離・音で rise）→ ④ 木々が点る → ⑤ HUD/微細。

**実装の足場（既にある材料）:**
- manifest に per-building reveal メタ済: `buildings[].revealKey`（駅からの距離キー＝リビール順）/ `type` / `vStart` / `vCount`。24,816棟。**駆動コードはまだ無い**（現状 proto.js は全レイヤーを即 full 表示）。
- レイヤーは reveal 順に scene 追加済（[proto.js:40-51](src/cityproto/proto.js)）。各 mesh に `userData.revealKey`/`type`（trees は revealKey 99）。
- カメラは `params` + `applyCamera()`（[proto.js:14-21](src/cityproto/proto.js)）。**演出はカメラアニメだけ＝フレームコストほぼゼロ**（静的unlit・量子化済）。
- 音反応の既存基盤: [src/audio/AudioEngine.js](src/audio/AudioEngine.js)（本番VJアプリ側）。city-proto はまだ未接続。spec L41「再ライティングせず visibility/scale/opacity/highlight を駆動」。

**実装方針の素案**（次セッションで brainstorming 推奨）:
1. まずカメラのキーフレーム・タイムライン（緩急 ease）でズームアウト演出を作る＝最小で「肝」を形にする。
2. 次に building の段階出現（`vStart`/`vCount` で `geometry.setDrawRange` を revealKey 順に伸ばす、または per-instance scale/opacity）。
3. 道路の通電スイープ、最後に木々（trees.js を採用するならここ）。
4. 音接続は最後。

**perf 留意**: 重いのは glb 初回DL(~22MB、SWキャッシュ後不要)＋GPUメモリ。glb 先読みロード推奨。manifest 2MB は本番 gzip で ~200KB。さらに要れば glb LOD / 小建物間引き / manifest 圧縮。

## 4. 守った線（不変条件・厳守）

- **モノクロ厳守**: 白＝大学通り・富士見通り・旭通り＋中央線のみ。二次幹線＝グレー。地形格子＝地。虹色/グロー無し。
- **道路は位置（plan座標）・id で判定**（名前ではなく）＝ユーザー明示要求。`stationPrimarySet` の駅連結ゲート＋ `DROP_IDS` はその思想。
- 二次幹線網は**名前付き幹線のみ**（住宅細街路は OSM fixture に非収録）。さくら通り＝グレー維持（白に上げない）。
- iPad PWA / buildless ESM 維持。three は vendored。
- 木々は温存（§2）。

## 5. 検証

- `node --test tools/citybake/tests/citybake/*.test.mjs` → **32 green**。
- `MANIFEST_ONLY=1 node tools/citybake/bake.mjs` で manifest のみ再生成（glb SHA 不変を確認）。
- preview: `.claude/launch.json` の `vj`(8125) を preview_start → `http://localhost:8125/city-proto.html`。reload 後 `width<=800`(例800x560) に resize ＋ `window.dispatchEvent(new Event('resize'))`。
- **画像の渡し方**: `shots/<name>.jpg` に保存し `http://localhost:8125/shots/<name>.jpg` の URL で提示（[[image-delivery-via-localhost]]、SendUserFile 埋め込みより低トークン）。実物スクショ確認してから報告（[[verify-visual-before-claiming]]）。
  - **dev サーバーは ThreadingTCPServer に修正済**（`.claude/launch.json`、git-ignore＝差分なし・マシンローカル）。旧 `TCPServer`(単スレッド)はプレビュー用ブラウザが接続を掴むと shots URL が 404/タイムアウトになる不具合があった。並列リクエスト 200 を確認済。

## ▶ 次回キックオフ（このまま貼れる）

> 国立シティ写実WebGLレンダの続き。ブランチ `feat/city-webgl-render`。**道路レイヤーは完了・コミット済み（`5956748`）**。引き継ぎ `docs/superpowers/handoffs/2026-06-25-roads-done-plan3-reveal-handoff.md` を読んで。次の本丸は **Plan 3＝段階ズームアウトのリビール演出**（ユーザーのビジョン：ズームイン序盤→段階的にズームアウト→国立市全域で少し固定、緩急が肝）。実装の足場は既にある＝manifest に per-building reveal メタ（`revealKey`/`vStart`/`vCount`、24,816棟）、レイヤーは reveal 順に scene 追加済、カメラは `params`+`applyCamera()`、音基盤は `src/audio/AudioEngine.js`。**ただし reveal 駆動コードはまだ無い**（現状は全レイヤー即表示）。まず brainstorming でカメラ・タイムラインの緩急設計から。守る線＝モノクロ厳守（白は大学通り・富士見通り・旭通り＋中央線のみ）/位置・id ベース判定/iPad PWA buildless ESM。**`trees.js`(untracked) と proto.js の木々3 hunk は温存中＝stray ではない、Plan 3 で採否判断（先に消さない）**。画像は `:8125/shots/` の URL で渡す（dev サーバーは ThreadingTCPServer 修正済）。
