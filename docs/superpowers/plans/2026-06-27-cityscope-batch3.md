# CityScope 第3陣 Implementation Plan — ④二値マトリクス / ⑥グラビティ落下

> **For agentic workers:** 既存 batch-1/2 と同一アーキテクチャ。各モード＝`scopeModes.js` の純関数1個。シェーダ/reveal/glb/manifest は不変。

**Goal:** CityScope に最後の2モード（④二値マトリクス＝池田 data.matrix／⑥グラビティ落下＝崩落→減衰バネ復帰）を、純関数追加だけで足す。

**Architecture:** computeScope は建物ごとに `fn(c, u, cfg, b)` を呼び scope∈[0,1] を building-index テクスチャへ書く（batch-1 で据済）。本陣は `b` を mode シグネチャ**末尾に追加**（既存5モードは無視＝既存テスト call site 不変）し、frameUniforms に `clk`/`dropT` を露出（drop 検出は bloom 配管を再利用）。

**Tech Stack:** buildless ESM, three vendored, node:test, iPad PWA.

## Global Constraints（守る線・厳守）

- mono 単一チャンネルのみ・色/グロー/再ライティング無・`THREE.NormalBlending` 不変。
- ≤3Hz strobe。決定論＝`hash01` のみ（**NO Math.random/Date**）。
- **glb・manifest byte 不変** — `git status --short -- tools/citybake/dist/` が空（NO rebake）。
- OFF（enabled=false / mix=0）→ computeScope 全 1 ＝現状ピクセル一致。
- INTRO 不変 — scope は LIVE のみ（uScopeEnabled=0 until LIVE）。
- 「図解」回帰禁止＝音駆動で沈黙時に消える一時変調であり静的 per-building グレーではない。
- 他レイヤ不変（terrain/landmark/station/roads/trees/particles/seasons/shotDir/2D配信地図）。
- snow 常に白。CPU ラスタライザで視覚検証してから報告。画像は `:8125/shots/` URL で。

---

### Task 1: config keys ＋ frameUniforms に clk/dropT 露出

**Files:** Modify `src/cityproto/cityScope.js` / Test `tests/cityproto/cityScope.test.mjs`

**Interfaces:**
- Produces: `defaultScopeConfig()` に `matrixBase, matrixGain, matrixFloor, matrixRate, gravStagger, gravTau, gravFreq`。`frameUniforms(...)` 返り値に `clk`(=state.clk), `dropT`(=state.lastDropT)。

- [ ] Step 1: 失敗テストを書く（frameUniforms が clk を前進し、drop で dropT=clk になる）。
- [ ] Step 2: 落ちるのを確認（clk undefined）。
- [ ] Step 3: config 7キー追加＋return に `clk: state.clk, dropT: state.lastDropT`。
- [ ] Step 4: green 確認。
- [ ] Step 5: commit。

### Task 2: mode シグネチャに b 追加 ＋ ④matrix

**Files:** Modify `src/cityproto/scopeModes.js`, `src/cityproto/cityScope.js`(computeScope の `fn(c,u,cfg,b)`) / Test `tests/cityproto/scopeModes.test.mjs`

**Interfaces:**
- Consumes: `hash01`(済), `u.beatsFloat`, `u.level`, `cfg.matrix*`。
- Produces: `MODES.matrix(c, u, cfg, b)` → `hash01((b*2654435761) ^ step) < density ? 1 : matrixFloor`、`step=floor(beatsFloat*matrixRate)`、`density=clamp(matrixBase+matrixGain*level,0,1)`。

- [ ] Step 1: 失敗テスト（matrix は 0 か 1 のみ／level↑で点灯数↑／step 跨ぎで場が変わる／決定論）。
- [ ] Step 2: 落ちる確認（matrix undefined）。
- [ ] Step 3: computeScope を `fn(c,u,cfg,b)` に・matrix 実装。
- [ ] Step 4: green（既存も不変で green）。
- [ ] Step 5: commit。

### Task 3: ⑥gravity

**Files:** Modify `src/cityproto/scopeModes.js` / Test `tests/cityproto/scopeModes.test.mjs`

**Interfaces:**
- Consumes: `u.clk`, `u.dropT`, `cfg.gravStagger/gravTau/gravFreq`。
- Produces: `MODES.gravity(c, u, cfg)` → `t=(clk-dropT)-c*gravStagger`; `t<=0 ? 1 : 1 - exp(-t/gravTau)*cos(gravFreq*t)`。

- [ ] Step 1: 失敗テスト（drop 直後 c=0 は ≈0 崩落／波未到達(c 大)は 1／時間経過で 1 へ復帰）。
- [ ] Step 2: 落ちる確認。
- [ ] Step 3: gravity 実装。
- [ ] Step 4: green。
- [ ] Step 5: commit。

### Task 4: SCOPE HUD を7モード化

**Files:** Modify `city-proto.html`

- [ ] Step 1: `MODES`/`MODE_JA` に `matrix`/`gravity`（二値/重力）追加、`#sc-mo` max=6。
- [ ] Step 2: CPU ラスタライザ（scope_verify_b3.mjs）で OFF/matrix/gravity ×3空間を PNG 出力・目視。
- [ ] Step 3: `dist/` byte 不変確認・commit。

## 検証
`node --test`（全 green・既存不変）／CPU rasterizer PNG を自分で目視（mono・他レイヤ不変・matrix 二値・gravity 崩落復帰）／`git status --short -- tools/citybake/dist/` 空。
