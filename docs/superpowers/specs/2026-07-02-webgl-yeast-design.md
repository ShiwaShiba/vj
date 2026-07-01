# WebGL 酵母シーン「YEAST」— 設計ドキュメント (spec)

> **状態:** 設計承認済 (2026-07-02)。次工程 = writing-plans（実装プラン作成）。
> **ブランチ:** `feat/webgl-yeast`。

## Goal（一文）

Kölsch 酵母の顕微鏡フィールドを、参照動画（漂うモーション）＋参照静止画（細胞の質感）を **精緻化** し、**1つの見た目に固定せず全質感を不規則に巡り続ける** 生きたビジュアルとして、本体VJに統合された新しい mic 反応 WebGL シーンで表現する。

## 背景・参照

- **参照動画** `Adobe Express - Yeast Move.mp4`（~6s ループ, 1170×1164）。抽出フレームで確認した実体 = **ほぼ黒地**に ~80 個の灰色の出芽（figure-8）細胞が、円形視野の中を**ゆっくり回遊・ブラウン揺らぎ**で漂う。柔らかい defocus/回折リングあり。瞑想的。
- **参照静止画**（ユーザー添付）= **スレートブルーの顕微鏡フィールド**、より高密度、細胞は白くクリスプで明るいリム、明示的な円形ビネット。
- → 動画は **モーション** の参照、静止画は **ルック** の参照。両者は地色で食い違う → 「黒既定＋スレートトグル」で両取り（下記 Global Constraints）。
- **方向性モックアップ**（技法検証として実レンダ済・`scratchpad/yeast-mock/`）= ① ORGANIC/ring ② ORGANIC/filled ③ DISCRETE ④ DENSE/SLATE ⑤ DETAIL。ユーザー確認済。

## ユーザー決定事項（ブレストで確定）

1. **地色**：黒(#000) MONO を既定、スレートブルー「顕微鏡」色をワンタッチ切替。
2. **モーションの核**：静かに漂い、音で沸き立つ（無音=瞑想的ブラウン、低音/ビートで強く撹拌・出芽ポップ・ブルーム）。
3. **精緻化の優先度（全部）**：細胞のリアルさ（リム/半透明/核/位相差ハロー）・被写界深度・出芽/分裂・密度&スケール。
4. **描画方式**：**A（インスタンス化ビルボード）と B（メタボール/SDF）の中間** = スクリーン空間メタボール・スプラット。
5. **今回の肝**：①〜④のどれにも固定せず、**全質感を時間とともに巡り、一定周期でなく不規則に何度も戻ってくる**（＝見た目ドリフト）。移行はシームレス。

## Global Constraints（全タスクが従う・実装プランへ継承）

- **決定論**：`yeastDrive.js` は純関数・`Math.random()`/`Date.now()` 非依存。乱数は seeded hash。同一 (time, seed, params) → 同一出力。ユニットテスト対象。
- **モノ＋寒色のみ**：既定 MONO（白/黒）。スレートは寒色の低彩度のみ。**虹色グロー禁止**（`aesthetic-minimal-techno`）。
- **依存ゼロ / buildless**：npm・ビルドステップ無し。ES modules のみ。
- **three.js**：既存 vendored r160＋importmap（`"three"`, `"three/addons/"`）で解決。**無改変**。WebGL2 前提（float RT に `EXT_color_buffer_float`）。
- **統合パリティ**：Noise Orb / 国立シティと同型。専用 `#yeast-gl` canvas に事前レンダ → `draw()` で `opacity=alpha` 合成。遅延 init（`_ensureCore`）でアイドルコスト0。共有マイク。registry 1行で選択可能に。
- **音反応は既定で強め・明確**（`audio-sensitivity-strong`）。scene は `audio.{level,bass,mid,treble,beat,beatHold,bpm,ready}` を読む。
- **動きは有機的・継ぎ目なし**（`motion-organic-seamless`）。非等速 ease、ハードカット無し、ループ点を感じさせない。

## アーキテクチャ（3ファイル＋canvas＋registry）

### `src/scenes/yeast/yeastDrive.js` — 純・決定論・テスト可能
描画も THREE も DOM も持たない。責務：
- `YEAST` 定数（COUNT 既定, FOV, 閾値 T, supFactor 係数, ドリフト周波数群 等）。
- `hash01(...)` 決定論ハッシュ。
- `buildCells(count, seed)` → 細胞レイアウト（クラスタ中心→散布、depth、半径、出芽/分裂フラグ、位相オフセット）。返り値は Float32Array 群（instanced 属性の素）。
- `cellFrame(state, time, audio)` → 各細胞の位置（乱流フロー＋ブラウン＋クラスタ結合）・出芽量・分裂進行を進める。
- `driftFrame(time, audio, tintMode)` → **見た目ドリフト**の現在値：`{density, fusion, fill, focusPlane, rim, halo, tint}`（非整数比 LFO＋低周波ノイズの重ね合わせ、各 [0..1] or 中心±振幅）。`tint` は `tintMode==='auto'` の時のみドリフト（他は固定値）。**アペリオディック**。
- `bandUniforms(audio, prev, coef)` → 音→uniform 平滑（撹拌温度・スウェル・ブルーム・シマー・focus 微振動）。

### `src/scenes/yeast/yeastCore.js` — THREE / GLSL
`createYeastCore({THREE, renderer})` ファクトリ。責務：
- **パス1（場のスプラット）**：各細胞（＋出芽ローブ）を **instanced quad** として **float RenderTarget に加算合成**。フラグメントは Wyvill 型カーネル `(1-d²/R²)³` を出力。`R`(support) と `amp` は per-cell depth と `fusion`/`dof` uniform で変える（奥=広く淡く／手前=締まって明るい）。
- **パス2（閾値シェーディング・全画面）**：場テクスチャを読み、iso 閾値 `T` で本体化。近傍タップで勾配→**明るいリム**、中心距離で**位相差ハロー（同心リング）**、深部で**核の暗がり**、`fill` で中空リング↔中身詰まりを補間、per-fragment で **DoF**（奥ソフト/減光）。最後に**円形FOVビネット**。MONO or スレート tint。
- **パス3（任意ブルーム）**：明るい細胞用に UnrealBloom を弱く（strength は param）。
- API（Orb 同型）：`resize(w,h)`, `setInstances(buffers)`, `setUniforms(obj)`, `setTint(rgb)`, `setDrift(driftObj)`, `setBloom(s)`, `render()`, `dispose()`。

### `src/scenes/yeast/YeastScene.js` — Scene アダプタ
`extends Scene`, `super('yeast', 'YEAST')`（表示名は実装時に最終決定：候補「YEAST」/「酵母」）。責務：
- `defineParam(...)` で下記パラメータ群を定義。
- `_ensureCore()` 遅延生成（`#yeast-gl` 取得→`WebGLRenderer`→`createYeastCore`）。
- `init/onResize` → core.resize。
- `update(dt,audio,palette,clock)` → `yeastDrive` を進め、`driftFrame`＋params＋audio から uniforms を組み、`core.setInstances/setUniforms/setTint/setDrift/setBloom`。
- `draw(ctx,alpha)` → `core.render()`＋`_gl.style.opacity=alpha`。
- `onExit()` opacity=0 / `dispose()`。
- モードグループ **`tint`**（AUTO / MONO / SLATE, 既定 **AUTO**）を持ち、パネル・キーで切替。AUTO=黒優勢で時折スレートへドリフト（＝“不規則な巡回”に地色も含める）。MONO=黒固定、SLATE=スレート固定でピン留め。

### 配線
- `index.html`：`<canvas id="yeast-gl"></canvas>`（Orb/City と同じ fixed/inset/opacity 制御レイヤ）。
- `src/scenes/registry.js`：`import { YeastScene }` ＋ `new YeastScene()` 1行追加（既存シーン無改変）。

## 描画技法（スクリーン空間メタボール・スプラット）詳細

- **なぜ中間**：離散ビルボード（A）の軽さ・スケール・制御を保ちつつ、場の重なりで**触れた細胞がぬるっと融合**（B の有機性）。出芽＝母の隣に小ローブ→首(neck)で連結、分裂＝ローブが離れ場が切れて2細胞に。全画面レイマーチ不要で数百〜数千が安い。
- **場**：float RT に加算。iso 閾値 `T`（既定 ~0.165、実装で視覚チューニング）。
- **リム**：`exp(-((F-T)/rimW)²)` × 勾配強調。近細胞ほど細く明るい。
- **位相差ハロー**：本体外側（F<T）に中心距離で同心リング（2バンド）＋距離減衰。`halo`/treble で明滅。
- **核**：深部（F≫T）を僅かに暗く＝環状の生きた細胞感。
- **fill**：本体塗り（中空リング↔中身詰まり）を補間。ドリフト対象。
- **DoF**：per-cell depth で support/amp を変え、奥は自然にボケ・減光、手前はクリスプ・高輝度。
- **円形FOV**：全画面ビネットで顕微鏡アイピース。スレート時は縁を暗いスレートへ。

## 細胞モデル

- クラスタ中心を FOV 円内に散布 → 各クラスタに数個をガウス散布 ＋ 少数の孤立細胞。
- 各細胞：中心・depth[0..1]（near大/far小・暗）・半径・向き・位相オフセット。
- **出芽**：確率 `budProb`（param＋beat で up）。母の隣に小ローブ、`budAmount` が 0→1 で成長し首で連結。
- **分裂**：出芽の一部が near-equal 2ローブ化し、距離が伸びて場が切れると独立2細胞。非同期（位相オフセット）。

## モーション（`yeastDrive`）

- 円形視野内で **ゆっくりした乱流フロー（curl-noise 的）＋ブラウン揺らぎ**。ゆるいクラスタ結合（近接で弱く引き合う）。境界（FOV縁）で柔らかく回り込む。
- **ループ点を持たない**時間発展（時間を入力にした場の連続進行）＝“不規則に続く”。
- 個体ごとに位相をずらし非同期。

## 見た目ドリフト（今回の肝）

- グローバル“気分”を **非整数比の複数 LFO＋低周波ノイズ**でアペリオディックにドリフト。対象：`density / fusion(離散↔融合) / fill(中空↔詰まり) / focusPlane(合焦面 手前↔奥) / rim / halo`、および `tint`（**AUTO 時のみ**・黒優勢で時折スレートへ）。
- `focusPlane`（どの depth 帯が合焦するか）は `dof`（焦点の“浅さ”＝param）とは別軸：`dof` が浅さの量、`focusPlane` が合焦面の位置。
- 同じ周期で戻らない“不規則な回帰”。全モーフは**シームレス**（ハードカット無し・非等速 ease）。
- **セル毎の多様性**：同時刻でも手前=クリスプ/奥=ソフト、一部リング/一部詰まりが混在（depth＋per-cell hash）。単調回避。
- **manual との関係**：各ドリフト対象は「スライダー=中心値」「ドリフト=中心まわりの有界オフセット」。`driftSpeed=0` で任意ルックにピン留め可能。

## 音反応マッピング（既定で強め・明確）

| 帯域 | 効果 |
|---|---|
| **bass / level** | 撹拌温度↑（ブラウン運動激化）＋全体スウェル/ブルーム。低音で場が沸く。|
| **beat** | 出芽ポップ／分裂トリガー、瞬間の密度・輝度パルス、ドリフトを少し前進。|
| **mid** | 回遊フローの強さ・うねり。|
| **treble** | リムのシマー＋位相差ハロー明滅、focus 微振動。|
| 無音 (`ready=false`) | 静かなブラウン漂い（動画の瞑想感）へ減衰。|

## パラメータ（パネルのスライダー・暫定）

各ルック系は「中心値」を、ドリフトがその周りを揺らす。暫定既定は実装時に headless 視覚チェックで確定。

- `density`（細胞数スケール）, `size`, `fusion`（融合度）, `fill`（中空↔詰まり）, `rim`, `halo`, `dof`（焦点の浅さ）
- `driftSpeed`（見た目ドリフト速度・0でピン留め）, `budRate`（出芽率）, `flow`（回遊の強さ）
- `audioGain`（撹拌の深さ）, `bloom`, `exposure`
- モードグループ `tint`：AUTO / MONO / SLATE（既定 AUTO）

## パレット

- 既定 = **AUTO**（黒 MONO 優勢で時折スレートへドリフト＝地色も不規則巡回に含む）。`tint` を **MONO** に固定すれば純黒、**SLATE** に固定すれば常時スレート「顕微鏡」（寒色低彩度）。全体 COLOR は控えめ寒色のみ、虹色禁止。

## テスト / 検証

- **`yeastDrive.js` 決定論ユニットテスト**：`buildCells`/`cellFrame`/`driftFrame`/`bandUniforms` が同一入力→同一出力、範囲クランプ、ドリフトのアペリオディシティ（短周期で戻らない）、出芽 0→1 単調、無音減衰。
- **headless(ANGLE) 視覚チェック**（`verify-visual-before-claiming` 準拠）：各“気分”（ring / filled / discrete / dense-slate / 出芽・分裂 / 無音アイドル / 低音エラプト / crossfade-hide）を実見 PASS。
- **統合**：既存シーン無改変・SW/デプロイ手順は Orb 同型（`deploy-verify-bare-url`）。

## 非ゴール（YAGNI）

- 実細胞の生物学的正確さ（分裂周期・液胞など）は追わない。あくまで VJ ビジュアル。
- 3D ボリューム/真の SDF レイマーチはしない（中間技法で足りる）。
- Canvas2D TERRAIN 撤去等の別タスクは含めない。

## 未解決（実装時に確定・block ではない）

- 表示名（「YEAST」/「酵母」）。
- 閾値 T・supFactor・リム/ハロー係数・ドリフト周波数の最終値（headless 視覚チューニング）。
- 数百規模での float RT スプラットのパフォーマンス実測（間引き/RT 解像度の調整余地）。
