# ハンドオフ — Plan 3 step 6（季節色モード Cキー＋live tuningノブ）完了 → 次は audio反応 / SceneManager 統合

**日付:** 2026-06-26
**ブランチ:** `feat/city-webgl-render`（未マージ・保持。`main`=2D配信版で安全）
**ステータス:** **Plan 3 step 1-6 完了・コミット済・視覚検証済。92 tests green ＋ citybake 32 green。** step 6 は本コミット、step 5=`ce64ce3`、step 4=`3ef3a22`、step 1-3=`37123fe`。working tree クリーン。

設計の全体像は spec: [docs/superpowers/specs/2026-06-25-plan3-seasonal-reveal-design.md](../specs/2026-06-25-plan3-seasonal-reveal-design.md)。前ハンドオフ: [2026-06-26-plan3-step5-particles-strobe-done-step6-chroma-next-handoff.md](2026-06-26-plan3-step5-particles-strobe-done-step6-chroma-next-handoff.md)。

---

## 0. ユーザーのビジョン（確定・不変）

4サイクル＝四季のシネマティック・ループ（時間ベース、音は後）。1サイクル＝往復（①旧駅舎寄り→②扇→③市街 長め hold＝見せ場→④全域→ゆっくり逆ドリーで①へ）。4サイクル＝春→夏→秋→冬→春。大学通りの並木が季節を運ぶ。リビールはイントロで1回。2モード＝**既定モノクロ厳守**（守る線）／`C` キーで季節色モード。最も Ikeda な瞬間＝冬の白ストロボが並木を流れる（step 5）。

## 1. step 6 でやったこと（全てコミット済）

**シェーダは無編集**（step 4-5 で `uMode` 後ろの chroma 分岐＋`update()` の `uMode` ease `dt*4` を配線済だった）。step 6 は UI グルー＋パレット確定＋ノブ配線のみ。

| File | 変更 | テスト |
|---|---|---|
| [seasons.js](../../../src/cityproto/seasons.js) | `COLOR_PALETTE` 単一 const → **`CHROMA_VARIANTS{current,mid,muted}` + swappable `_chroma`**（`setChromaVariant`）。`chromaCanopy`/`chromaParticle` 経由で `seasonEndpoints`/`particleEndpoints` を配線。後方互換 export 維持（既定 `current` = `COLOR_PALETTE`） | seasons（**+5**＝variant 4×rgb・back-compat・swap・**冬雪 全variant白**・swap後連続不変） |
| [proto.js](../../../src/cityproto/proto.js) | **`C` キー**（`mode` toggle）＋ `window.__proto` live ノブ：`setChromaVariant`/`setStrobeRate`(clamp≤3)/`setPetals`(粒子再構築)/`setTiming`/`setFraming`(director 再生成・`tSec` 継続)。`rebuildParticles`/`rebuildDirector` ヘルパ | — (THREE/UI 層) |
| [tests/cityproto/seasons.test.mjs](../../../tests/cityproto/seasons.test.mjs) | step 6 の variant 単一真実源＋守る線を test 化（末尾追加、状態リーク防止に必ず `current` へ reset） | 上記 |

### 設計メモ（step 6）
- **`C` キー crossfade**：proto の keydown が `mode = mode?0:1` するだけ。loop が既に `trees.update(season,mode,dt,…)`/`particles.update(season,mode,dt)` へ流し、両者 `uMode += (target-uMode)*min(1,dt*4)` で ease。**実測 uMode 0→0.49(150ms)→0.92(600ms)→0.98(900ms)**＝瞬間切替でなく ~0.6s、樹冠と粒子は lockstep、両方向トグル可。
- **swappable パレット**：`let _chroma = CHROMA_VARIANTS[DEFAULT_CHROMA]`（既定 `current`）。`setChromaVariant(name)` が `_chroma` 差替（未知名は no-op）。`chromaCanopy(i)=_chroma[i%4]`、`chromaParticle(i)= i==3 ? [1,1,1] : _chroma[i]`（**雪は全 variant で白固定＝守る線**）。`seasonEndpoints`/`particleEndpoints` がこれを読む＝**color sweep の連続不変条件 `cur(i)===prev(i+1)` は両端同一 `_chroma` 参照で variant 切替後も成立**。
- **ユーザー採択＝`current`（鮮やか・現行値）**。3案を固定カメラ montage（春/秋×current/mid/muted・彩度実測 current>mid>muted）で提示し選択。既定は `current` のまま＝コード上の bake 変更なし。
- **live ノブ**（画面 HUD なし＝本番 SceneManager 統合時に UI へ）。`rebuildDirector` は load 時スナップショット `kfInputs{full,landmark,station}` ＋ `framingOpts`/`timingOpts`（初期 `{}`＝DEFAULTS/DEF）から再生成、`tSec` リセットせず継続。`rebuildParticles` は旧 `points` を `scene.remove`＋`geometry/material.dispose()` してから `planLayout`→`planEmit(petalOpts)`→`buildParticles` で再構築（GPU リーク防止）。
- **timing/keyframe は現状維持**（step1-3 で検証済）＝DEFAULTS(director)/DEF(camrig) 不変。ユーザー方針「現状維持＋ノブ配線のみ」。

## 2. 守った線（不変条件・厳守）

- **モノクロ既定**（load 時 `mode=0`）。色は `uMode` 後ろの opt-in のみ。**建物・地形は無着色＝色がつくのは並木の樹冠＋落下粒子だけ**（視覚確認済）。
- **雪／冬ストロボは白固定**：`chromaParticle(3)=[1,1,1]`（全 variant）、strobe は `vec3(1.0)`。冬雪領域の彩度実測 ~1.1（全 variant 白）。
- 再ライティングしない＝uniform 駆動。instanceMatrix／canopy baked グラデ不変。**粒子 GPU 駆動**（`mod(uTime-aBirth,aLife)`・CPU respawn 無）。
- **ストロボ ≤3Hz**：`setStrobeRate` が `clamp(hz,0,3)`（9 投入→3 確認）。`S`＋`strobeEnabled` ゲート既定 OFF・winter のみ。
- **NormalBlending 維持**（粒子 additive グロー無し）。iPad PWA / buildless ESM / three vendored / baked 資産・2D 配信地図・他シーン不変。

## 3. 視覚検証（実物確認済み・再現手順）

dev サーバー: `.claude/launch.json` の `vj`（:8125, ThreadingTCPServer・read-only）。`preview_start vj` → `http://localhost:8125/city-proto.html` → reload。**resize は ≤667 幅**。
固定カメラは step5 ハンドオフ §3 と同手順（`p.__origUpdate` patch・`window.__season(i)`）。`p.setMode(1)` で chroma、`p.setChromaVariant('mid'|'muted'|'current')` で register 切替。

**スクショ取得（read-only server 故の手段）**: `document.getElementById('gl')` を `renderer.render()` 直後に **同一 task 内で `toDataURL('image/jpeg',q)`**（preserveDrawingBuffer 無でも同期 capture なら有効）。montage は offscreen 2D canvas に `drawImage(gl,…)` でタイル組み→`toDataURL`。返り値 base64 が大きいと tool-results file に落ちるので `python3 base64.b64decode` で `shots/*.jpg` 化（`shots/` は gitignore＝ローカル成果物）。

**確認済み（step 6）**: C クロスフェード ~0.6s ease（樹冠＋粒子 lockstep・両方向）／3案彩度 current>mid>muted・建物はモノ維持／冬雪 全 variant 白・グロー無し／live ノブ（setStrobeRate clamp / setPetals 2023→1445 本再構築 / setTiming cycleDur 20.4→21.4 / setFraming k3 移動）全て error 無し・revert 後 pristine／node test 92 green・console error 無。

## 4. ★ 次の候補（Plan 3 の残り＝いずれも後付け設計）

step 6 で spec の §4 列挙（1.Cキー / 2.ControlPanel露出 / 3.timing焼込 / 5.look-tuning）は**完了 or ユーザー判断で skip**。残るは:
1. **音連動（別提案）**：`director` は名前付きセグメント＋`update(t)` 純関数なので、tSec に音響エンベロープ/ビートを注入する形で後付け可。マイク反応は既存 VJ アプリの DSP を流用（[[vj-app]]）。
2. **SceneManager / PWA 統合**：city-proto を本番 VJ アプリのシーンとして組込み、**本番 ControlPanel UI**（step 6 の `window.__proto` ノブ＝`setChromaVariant`/`setStrobeRate`/`setPetals`/`setTiming`/`setFraming` を画面ツマミへ）。2D HUD 層・出典表記もここで。
3. 旧駅舎三角屋根の造形 / LOD perf / FXAA（spec の Plan 3 残タスク）。
4. look-tuning（任意・単一真実源維持）：`MONO_SETTLED`/`PARTICLE`/`CHROMA_VARIANTS`/`fallDist`/`perColumn,stride`/`uStrobeRate` は live ノブで目視確定可。

## 5. コミット状態

**step 1-6 コミット済・working tree クリーン。** step 6（本コミット）= `src/cityproto/{seasons.js,proto.js}` ＋ `tests/cityproto/seasons.test.mjs` ＋本ハンドオフ。`shots/` は gitignore。

## 6. 検証コマンド

- `node --test`（全体）＝**92 green**。cityproto 群: `node --test tests/cityproto/*.test.mjs`。
- ベイク不変: `node --test tools/citybake/tests/citybake/*.test.mjs`＝**32 green**。
- preview で §3 手順。画像は `:8125/shots/` URL で [[image-delivery-via-localhost]]、実物確認後に報告 [[verify-visual-before-claiming]]。

## ▶ 次回キックオフ（このまま貼れる）

> 国立シティ写実WebGLレンダ Plan 3 の続き。ブランチ `feat/city-webgl-render`。**step 1-6 完了・コミット済・視覚検証済・92 tests green ＋ citybake 32 green**（step6=季節色モード Cキー＋chroma register 採択 current＋live tuning ノブ）。ハンドオフ `docs/superpowers/handoffs/2026-06-26-plan3-step6-chroma-mode-done-next-audio-scenemanager-handoff.md` と spec `docs/superpowers/specs/2026-06-25-plan3-seasonal-reveal-design.md` を読んで。Plan 3 のシーン演出（reveal/四季/粒子/ストロボ/季節色/緩急ノブ）は完成。次は **(a) 音連動（director の名前付きセグメント＋`update(t)` 純関数に音響エンベロープを注入・マイク DSP は既存 VJ 流用）か (b) SceneManager·PWA 統合（city-proto を本番シーン化＋`window.__proto` の live ノブを本番 ControlPanel UI へ＋2D HUD・出典表記）**。守る線＝モノ既定／色は樹冠＋粒子のみ・雪/ストロボは白／再ライティングしない・instanceMatrix 不書換・粒子 GPU 駆動／ストロボ ≤3Hz・S＋strobeEnabled ゲート既定 OFF／iPad PWA buildless ESM・baked 資産不変。検証は固定カメラ手順、画像は `:8125/shots/` URL（read-only server 故 `toDataURL`→base64→decode）。
