# 国立シティ — カメラ演出強化＋季節色/COLOR操作 設計

**日付:** 2026-06-28
**対象:** WebGL 国立シティ（`src/cityproto/cityCore.js` ＋ `src/scenes/city/CityScene.js`、本体VJの選択シーン）
**目的:** ユーザー実機フィードバック3点の解消 —
1. カメラ画角が単調で演出として飽きる（俯瞰が完全固定）。→ 俯瞰の緩旋回＋呼吸＋新ショット少量で動きを足す。
2. 四季（季節色）モードが本番で反映されず、切替スイッチも無い。→ パネルにワンタッチ公開（モノ既定）。
3. VJソフトの「COLOR」パレット選択が市に効かない。→ 建物/地面を控えめ着色（虹色化しない・季節色と別レイヤー）。

すべて**ランタイム実装＝再ベイク無し**。映像SoT（`seasons.js` のモノ基調）と `Engine.js` は無改変。新パネル操作は既存の二画面同期にそのまま乗る。

---

## 背景（現状の確定事実）

- **カメラ**：camera は `cityCore.js` 所有。`params{camX,camY,camZ,fov,lookX,lookY,lookV}` を毎フレーム書いて `applyCamera()`。lookAt点は `(lookX, lookY, lookV)`（`lookV`=Z, `lookY`=高さ）。本番は `intro:false` body-scene 経路（`CityScene.js:89`）＝毎フレーム ④全域フレーミング `kfInputs.full` にリセット後 `shotDir.apply`。
- **ショット**：`shotDirector.js` に2種のみ。`'aerial'`＝base の純パススルー（**位置・向き完全固定**、`shotDirector.js:122`）、`'avenue'`＝並木低空フライ（動く）。バー区切りで `hash01(group)<avenueRatio` により決定論的に振り分け、`blendSec` でブレンド。旋回・首振り変数は一切無し。
- **季節色**：`seasons.js`（SoT・モノ基調・chromaは opt-in `uMode`）／`director.js`（INTRO時間巡回）／`live.js`（LIVE反応 reducer：`seasonIndex`＋`chromaMix` を発火）。本番 body-scene は LIVE ドライバ（`sceneAudioAdapter.js`）所有で、既定 `colorMode='burst'`＝**モノが定常・色はドロップ時だけ一瞬滲む**。だから「四季が出ない」ように見える（季節は裏で巡回するがモノ表示）。
- **配線済みの口**：`sceneAudioAdapter` は `setColorMode`/`cycleColorMode`/`modeConfig`(cfg getter)/`isLive` を公開。`cfg.manualSeason`/`cfg.manualChromaMix` を manual モードで読む（`live.js`）。`cityCore` は `setMode`/`setSeason`(no-opスタブ)/`setStrobe`/`setStrobeRate`/`setChromaVariant` を公開。→ proto の C/N/B/M/S キー相当を **adapter＋core 経由**で再現可能。`core.setMode`/`setSeason` は LIVE で無効なので使わない。
- **CityScene の現状パネル**：`modeGroups`＝カメラ/切替間隔/建物連動/SCOPE/空間、`params`＝CAMブレンド/アップ比率/前進/SCOPE強さ/SCOPE A比率。季節色・全体COLORは未配線。`CityScene.update(dt,audio,palette,clock)` は `palette` を受け取るが**無視**している。
- **全体パレット**：`PaletteManager`（12色ミニマルテクノ・`bg/fg/accent/ramp`）。Engine が毎フレーム全シーンへ fan-out。市は現状これと完全独立。
- **二画面同期**：パネルの modeGroups/params と全体パレットは既存スナップショット（`src/sync/`）で出力ウィンドウへ自動伝播。`CityScene.update` は出力側でも palette を受けるので、機能Cも自動追従する。

## 守る線（不変条件・全機能厳守）

- **mono基調維持**：建物/地面の着色は単一色相・低強度＝**虹色化しない**。季節chromaは既存の opt-in のまま。**雪は常時白**、per-building 個体差は付けない（ボツ要素禁止）。
- **strobe ≤3Hz・既定OFF**（光感受性）。
- **決定論**：旋回角・新ショット振り分けは `beatsFloat`／`hash01` のみ。`Math.random`/`Date` 禁止。
- **`dist/city.glb`・`dist/city.manifest.json` は byte 不変**（純ランタイム・再ベイク無し）。
- **`Engine.js`・dancers・dots 既存シーンは無改変**。iPad PWA・buildless ESM・three vendored。
- **酔わせない**：旋回角速度は遅く、既存 `maxBlendSec`/`minDwellBars` のcomfort思想を踏襲。

---

## 機能A：カメラの動き（俯瞰旋回＋呼吸＋新ショット少量）

### A-1. aerial を旋回＋呼吸へ
`shotDirector.js` に純粋関数 `aerialCam(base, cfg, beatsFloat, variant)` を追加し、`stepShot`（現 `:122` の `{ ...base }`）を置換。
- **公転**：lookAt点 `(base.lookX, base.lookV)` を中心に `(camX,camZ)` を角度 `θ = θ0 + 2π·(beatsFloat / (orbitBars·barBeats))·dir` で回転（`θ0` は base の方位、`r=hypot(camX-lookX, camZ-lookV)`）。`orbitBars` 大＝遅い。
- **呼吸**：`r *= 1 + breatheAmp·sin(2π·beatsFloat/(breatheBars·barBeats))`、`fov` も同位相で微増減（任意・小さく）。
- **comfort**：角速度は `orbitBars` を十分大きい既定（例 96 小節/周）にして遅く。`enabled:false` または `orbitBars→∞`（=旋回0）で現状の固定に完全復帰。

### A-2. 新ショット「俯瞰ニア」を少量追加
- ショット語彙を 2→3：`'aerial'`（俯瞰ワイド旋回）／`'aerialNear'`（俯瞰ニア旋回）／`'avenue'`（並木アップ）。
- `aerialNear` は `aerial` 機構を流用し `variant` で半径/高さ/FOV を寄せた値に（新規look調整は最小）。
- `stepShot` の振り分けを決定論的に拡張：`hash01(group)` を `avenueRatio`／`nearRatio` のしきい値で3分割（並木→俯瞰ニア→俯瞰ワイド）。`hash01` 境界は node テストで検証。

### A-3. cfg キーと既定（`defaultShotConfig`）
追加：`orbitBars`(既定 96)／`orbitDir`(±1, 既定 1)／`breatheBars`(既定 24)／`breatheAmp`(既定 0.06)／`nearRatio`(既定 0.25)／`aerialNear` 用の `nearHeightMul`/`nearRadiusMul`/`nearFov`。既定はゆっくり旋回ON＝起動から動きが出る。

### A-4. パネル（CityScene）
- スライダー「**俯瞰旋回**(0=固定〜1=速)」を追加 → `orbitBars` へ逆写像（0→旋回停止）。
- 任意でスライダー「俯瞰ニア比率」→ `nearRatio`。
- 既存の `shotEnabled`/`switchBars`/`blend`/`avenue`/`travel` は不変。

---

## 機能B：季節色をパネルにワンタッチ公開（モノ既定）

本番は LIVE ドライバ所有。CityScene に modeGroups/配線を追加（`adapter`＋`core` 経由・proto キー相当）。

- **季節色** `['モノ','季節色']` → `adapter.setColorMode('manual')` ＋ `adapter.modeConfig.manualChromaMix = (idx===1?1:0)`（＝Cキー）。**既定 index 0=モノ**。
- **季節** `['自動','春','夏','秋','冬']` → idx0=`setColorMode('burst')`（音反応に戻す）、idx1..4=`setColorMode('manual')`＋`modeConfig.manualSeason = idx-1`＋`manualChromaMix=1`（＝N/Bキー）。
- **色変種** `['現行','淡','中']` → `core.setChromaVariant('current'|'muted'|'mid')`。
- **冬ストロボ** `['OFF','ON']` → `core.setStrobe(idx===1)`（≤3Hz・既定OFF）。

LIVE では `uMode` を adapter が毎フレーム `knobs.chromaMix` から書く（`sceneAudioAdapter.js:135`）。manual＋manualChromaMix=1 で `chromaMix→1`＝持続chroma、=0 でモノ。season select は `knobs.seasonIndex=cfg.manualSeason`。proto と完全一致の挙動。

守る線：起動はモノ（burst 既定のまま）。色はワンタッチで出るが常時ではない。

---

## 機能C：全体COLORパレットで市を控えめ着色

`CityScene.update` の `palette` を読み、**tint色＋低strength**を `core.setTint({r,g,b,strength})` で渡す。

- **写像（純粋ヘルパに分離）** `paletteToCityTint(palette, strength) → {r,g,b,strength}`：`palette.fg`（または accent）の色相を取り、**低彩度化**して tint RGB に。strength は 0..1 にクランプ。MONO パレット等の無彩色は tint≈白＝実質無着色＝モノ復帰。node テスト可能。
- **適用（core）**：`setTint` が建物 material（`reveal.js` の `onBeforeCompile` フックに `uCityTint`/`uCityTintStr` uniform 追加）と地形/道路 material に `diffuseColor.rgb = mix(rgb, rgb·uCityTint, uCityTintStr)` を低強度で適用。ほぼ白い建物が選択色へ淡くトーン転ぶ。
- **パネル**：スライダー「**全体色なじみ**(0=無視〜1=しっかり)」、既定は控えめ（~0.2）。0 で完全モノ復帰。
- 守る線：単一色相・低強度＝虹色化しない。季節色（並木/粒子）とは別レイヤーで共存。建物 per-building 個体差は付けない。`uCityTint` は `uReveal`/`uScopeTex` と独立 uniform（clobber 無）。

---

## データフロー

```
[操作] ControlPanel → CityScene.modeGroups/params.onChange
  A: setShot({orbitBars,nearRatio,...}) → shotDirector.setConfig
  B: adapter.setColorMode / adapter.modeConfig.manual* / core.setChromaVariant / core.setStrobe
  C: (palette経由) CityScene.update → paletteToCityTint(palette) → core.setTint(uniform)

[毎フレーム] Engine._loop → CityScene.update(dt,audio,palette,clock)
  A: cityCore.update → shotDir.apply → aerialCam(beatsFloat) 旋回/呼吸 → applyCamera
  B: adapter.frame → trees/particles.uMode = knobs.chromaMix（manual で持続）
  C: paletteToCityTint(palette) → setTint → buildings/terrain shader mix

[二画面] modeGroups/params/palette は既存スナップショットで出力へ自動伝播
```

## テスト方針

- **A**：`shotDirector` の `aerialCam`（決定論・角速度上限・呼吸範囲）＋新ショット3分割の `hash01` 境界を node テスト。
- **B**：パネル選択→setter 呼び出しの純粋マッピングを fake core/adapter で検証（colorMode/manualSeason/manualChromaMix/chromaVariant/strobe）。
- **C**：`paletteToCityTint` の node テスト（単一色相・strength クランプ・無彩色→モノ復帰・strength0 で恒等）。
- **既存全テスト green 維持**。
- **ヘッドレス CDP**（[[verify-visual-before-claiming]]）：旋回が乗る／季節色トグルで色が出る／全体COLOR変更で市が淡く色付く／モノ既定・虹色化しない・glb差分無し、を実描画スクショで確認してから報告。

## 重要ファイル

- 改修：`src/cityproto/shotDirector.js`（A：aerialCam/新ショット/cfg）／`src/scenes/city/CityScene.js`（A・B・C のパネル＋配線・update で palette→setTint）／`src/cityproto/cityCore.js`（C：`setTint`＋material配線）／`src/cityproto/reveal.js`（C：tint uniform）／地形/道路 module（C：tint uniform）。
- 新規：`src/cityproto/cityTint.js`（純粋 `paletteToCityTint`）＋ `tests/cityproto/cityTint.test.mjs`／`tests/cityproto/aerialCam.test.mjs`（A）／CityScene 配線の純粋マッピングテスト（B）。
- 参照（無編集）：`src/cityproto/sceneAudioAdapter.js`（setColorMode/modeConfig）／`src/cityproto/live.js`（manual reducer）／`src/cityproto/seasons.js`（setChromaVariant）／`src/color/PaletteManager.js`（fg/accent）／`Engine.js`（fan-out）。
- byte不変厳守：`dist/city.glb`・`dist/city.manifest.json`。
