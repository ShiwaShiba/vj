# WebGL「Noise Orb」— 設計仕様 (Design Spec)

**日付:** 2026-07-01
**対象アプリ:** `/Users/shiwa/Claude-Atelier/VJ`（iPad向けマイク反応VJ・依存ゼロ ES Modules・GitHub Pages PWA）
**ブランチ（実装時）:** `main` から `feat/webgl-noise-orb` を切って作業（main直編集しない）
**関連メモリ:** prefer-gpu-webgl / aesthetic-minimal-techno / verify-visual-before-claiming / deploy-verify-bare-url / city-scene-integration / scope-spread-initiative

---

## 1. Goal（一行）

参照 `vj-blob.html` の品質（Three.js・**140k GPU点**・**AdditiveBlending**・**UnrealBloom**・simplex FBM5オクターブ＋Worley）を、**決定論・モノクロ・帯域別音反応**で、独立WebGLシーン **「Noise Orb」** として本体VJに統合する。

## 2. Motivation（なぜ作るか）

現行 Canvas2D「TERRAIN Noise Blob」（Oscilloscope の Form: TERRAIN）は参照品質に**構造的に**届かない:

| | 現行 Canvas2D TERRAIN | 参照 / 本仕様 (GPU) |
|---|---|---|
| 加算 | 8bit fillRect加算（バンディング） | float HDR加算 |
| bloom | blur×2の偽ハロー | 実 UnrealBloom（mipピラミッド） |
| 解像度 | ハーフ解像度offscreen | pixelRatio≤2フル |
| ノイズ再計算 | 1/4分割・キャッシュ | 毎フレーム全点フル |
| FBM | 3オクターブ | 5オクターブ |
| 点数 | 70k | 140k |

差はチューニングでなく描画アーキテクチャ。ターゲット機 = **iPad Air 第5世代 (Apple M1・GPU8コア・8GB)**、最悪 **MacBook Air M3 16GB**（iOS WebGLコンテキストロスの保険）。土台は既にある = Three.js 同梱・CityScene がWebGL本番稼働。

## 3. スコープ / 確定事項（ユーザー承認済み）

- **独立GPUシーン**（CityScene同型）。`id='orb'`、表示名 `'Noise Orb'`（ノイズオーブ）。**形状は球ブロブ**（参照どおり）。
- 既存 Canvas2D TERRAIN は**当面残置**、Noise Orb の実機（iPad/Mac）検証が済んだらフォローアップで撤去（本仕様の対象外・別作業）。
- 音反応 = **リッチ帯域別**: BASS=全体スウェル＋キックでリング・バースト / MID=Worley壁網を走るモーフィング光front / TREBLE=微粒シマー。
- ブルーム = **実 UnrealBloom**（three r160 addonを vendored 追加）。
- 点数 = **140k**（`clock.quality` で自動減）。
- **モノクロ**（`palette.fg` のみ・カラーUIなし）・**加算**・**決定論**。

## 4. Global Constraints（全タスク共通・逐語）

- **決定論:** `src/` 配下の実行時コードに `Math.random` / `Date` / `performance.now` **禁止**。per-pointシードは整数ハッシュ、時刻は `clock.time` のみ。（vendored three 内部は視覚再現に無影響のため対象外＝three本体と同じ扱い。UnrealBloomのgaussカーネルは固定値で乱数非依存。）
- **モノクロ:** 白 on 黒のみ（`palette.fg`）。色・虹グロー**禁止**。カラースウォッチ不採用。
- **依存ゼロ:** npm依存追加なし。addonの vendoring は依存追加ではない（three本体・GLTFLoaderと同じ同梱方式）。
- **加算 / 非機械的モーション:** AdditiveBlending。動きは有機的・非等速・継ぎ目なし（[[motion-organic-seamless]]）。
- **音反応は強く明確に:** 3帯域が視覚的に判別できる（[[audio-sensitivity-strong]]）。ビート検出はクランプ前 bass の立上り。
- **本番デプロイは明示承認後のみ。** 素URL（クエリ無し）で検証（[[deploy-verify-bare-url]]）。
- **視覚は実物スクショ確認してから「できた」と言う**（[[verify-visual-before-claiming]]）。

---

## 5. アーキテクチャ / ファイル構成

### 5.1 統合パターン（CitySceneで実証済み）

WebGLシーンは Canvas2Dエンジンと**opacity合成**で共存する:
- `index.html` に専用 `<canvas>` を1枚（`position:fixed; inset:0; z-index:1; opacity:0; pointer-events:none`）。Canvas2Dの `#stage`(z0) の上、UI(z10)の下。
- シーンは毎フレーム自前のWebGLキャンバスへ `render()` し、`draw(ctx,alpha)` で `canvas.style.opacity = alpha`（クロスフェード連動）。`onExit()` で opacity 0。**DOM並べ替えなし**。
- レンダラは初表示時に遅延生成（`_ensureCore`流儀）＝未使用時コストゼロ。`#city-gl` と `#orb-gl` の二枚共存は M1/8GB で問題なし（両者 opacity0待機・activeのみ点灯）。

### 5.2 新規ファイル

| ファイル | 責務 |
|---|---|
| **NEW** `src/scenes/orb/orbDrive.js` | **THREE非依存のPUREモジュール**。決定論的な幾何生成・音→uniform写像・バースト/sweepの時間発展・定数集約。← ユニットテスト対象 |
| **NEW** `src/scenes/orb/orbCore.js` | THREE の renderer/scene/camera/points/material/**composer(UnrealBloom)** を所有する描画コア。`render/resize/setUniforms/setTint/setBloom/dispose` を出す |
| **NEW** `src/scenes/orb/OrbScene.js` | `Scene` 継承の薄いアダプタ（ライフサイクル＋params＋modeGroups＋update内の音配線）。CityScene同型 |
| **EDIT** `index.html` | `<canvas id="orb-gl">`（`#city-gl`と同じCSS）を1枚追加 |
| **EDIT** `src/scenes/registry.js` | `import { OrbScene }` ＋ `createScenes()` に1行 |
| **NEW(vendored)** `src/vendor/three-addons/postprocessing/*` ＋ `shaders/*` | r160 の `EffectComposer` `RenderPass` `ShaderPass` `MaskPass` `Pass` `UnrealBloomPass` `CopyShader` `LuminosityHighPassShader`。import指定子を相対 `../three.module.js` へパッチ（既存 vendored addon と同じ流儀） |
| **NEW(test)** `tests/scenes/orb/orbDrive.test.mjs` | `orbDrive.js` 純関数の決定論・境界・単調性 |
| **EDIT(deploy時)** `sw.js` | 上記ファイルを ASSETS に追加、`CACHE_VERSION` v46→v47 |

## 6. データフロー（信号フロー）

```
Engine ループ（每フレーム）
  audio.update → clock.update → palette.update
  scenes.update(dt, audio.state, palette, clock)
     └─ OrbScene.update:
          audio.bass/mid/treble/level + clock.time/beats
            → orbDrive: 平滑化 / バースト立上り点火 / sweep軸・band数発展 / 帯域→値
            → orbCore.setUniforms({...}) + setTint(palette.fg) + setBloom(strength)
          points.rotation を rotSpeed/wobble で更新
  scenes.drawFrame → OrbScene.draw(ctx, alpha):
     orbCore.render()（composer: RenderPass→UnrealBloomPass）
     orbGl.style.opacity = alpha
```

エンジン提供オブジェクト（確認済み）:
- `audio.state`: `level, bass, mid, treble`（各0..1クランプ）, `beat, beatHold, bpm, spectrum, waveform`
- `clock`: `time(秒), dt, bpm, beatPhase, beats, beatJustWrapped, quality(適応品質0..1)`
- `palette`: `fg[r,g,b 0..255]`, `bg, accent, ramp`, `colorAt(t,out)`, `fgCss(a)` 等

---

## 7. コンポーネント詳細

### 7.1 `orbCore.js`（THREE所有・描画）

- `renderer = new THREE.WebGLRenderer({ canvas: orbGl, antialias:true })`、`setPixelRatio(min(devicePixelRatio,2))`、`setClearColor(0x000000,1)`。
- `scene`、`PerspectiveCamera(45, aspect, 0.1, 100)`、`camera.position.z = 4.4`。
- `points = new THREE.Points(geometry, material)`（回転は `points.rotation` を Scene 側から駆動）。
- `composer = new EffectComposer(renderer)`; `addPass(new RenderPass(scene,camera))`; `addPass(new UnrealBloomPass(new Vector2(w,h), strength, 0.6, 0.0))`。
- **公開API:** `render()` / `resize(w,h)`（renderer・composer・camera.aspect・uPixelRatio更新）/ `setUniforms(obj)` / `setTint(fgRGB)`（uColorへ 0..1正規化）/ `setBloom(strength)` / `dispose()`。

**Uniforms 一覧:**

| uniform | 型 | 供給元 | 意味 |
|---|---|---|---|
| `uTime` | float | clock.time | モーフ時刻（決定論） |
| `uMorphSpeed` | float | param | 表面ノイズの進行速度 |
| `uNoiseScale` | float | param | セル空間周波数 |
| `uDisplace` | float | param | 変位（凸凹深さ） |
| `uCellEdge` | float | param×MID | Worley壁ridgeの強さ |
| `uPointSize` | float | param | グレイン点サイズ |
| `uExposure` | float | param×loud | 全体輝度 |
| `uColor` | vec3 | palette.fg | モノ色（0..1） |
| `uPixelRatio` | float | renderer | 点サイズ補正 |
| `uBassSwell` | float | orbDrive(bass平滑) | 半径スウェル＋輝度 |
| `uTravelAmt` | float | orbDrive(mid) | 走る光frontの強さ |
| `uSweepAxis` | vec3 | orbDrive(time) | 光front掃引軸（正規化） |
| `uSweepK` | float | orbDrive(time) | 掃引の帯数（breathe） |
| `uSweepFlow`| float | orbDrive(time,mid) | 掃引の位相流れ |
| `uTreble` | float | orbDrive(treble平滑) | 微粒クラックル／シマー |
| `uFastFlow` | float | orbDrive(time) | treble高速位相 |
| `uBurstAxis`| vec3 | orbDrive(burst) | バースト中心方向 |
| `uBurstCos` | float | orbDrive(burst) | リング角半径(cos空間) |
| `uBurstEnv` | float | orbDrive(burst) | リング輝度エンベロープ（0=不活性） |

### 7.2 GLSL（要点・参照からの差分）

**vertex**（変位＋輝度）— 参照GLSL（Ashima `snoise` / `fbm`5oct / `worley`）を土台に、帯域項を頂点単位で加える:
```glsl
vec3 dir = normalize(position);
float t   = uTime * uMorphSpeed;
vec3  sp  = dir * uNoiseScale;
float f    = fbm(sp + vec3(0.,0.,t));
float cell = worley(sp*1.45 + vec3(t*0.6));
float wall = 1.0 - smoothstep(0.0, 0.45, cell);      // 壁で明るい
float disp = f*0.55 + wall*uCellEdge*0.7;
float radius = 1.0 + uDisplace*disp + uBassSwell*0.28;      // BASS: 全体スウェル
radius += uTreble * 0.05 * snoise(dir*9.0 + vec3(uFastFlow)); // TREBLE: 微粒クラックル
vec4 mv = modelViewMatrix * vec4(dir*radius, 1.0);
gl_Position = projectionMatrix * mv;
gl_PointSize = uPointSize*(0.7+0.6*aSeed)*uPixelRatio * (4.0 / -mv.z); // k≈4 厳守（巨大スプラット回避）
// MID: Worley壁を走るモーフィング光front（軸wobble＋帯数breathe）
float cr = 0.5 + 0.5*sin(dot(dir,uSweepAxis)*uSweepK - uSweepFlow + aSeed*1.1);
// BASSキック: cos空間の拡大リング・バースト（acos/expなし）
float q = (dot(dir,uBurstAxis) - uBurstCos) * 4.0; q = 1.0 - q*q;
cr = max(cr, q>0.0 ? q*q*uBurstEnv : 0.0);
float depthFade = clamp(0.55 + 0.45*(radius-0.8), 0.3, 1.2);
float base = (0.10 + 1.5*wall*uCellEdge + 0.45*max(disp,0.0)) * (0.8+0.6*aSeed);
vBright = base*depthFade*(1.0+uBassSwell*0.8)
        + wall*uCellEdge*uTravelAmt*cr*cr*cr*depthFade*(0.8+0.6*aSeed); // 走る光＋バースト
if (uTreble > 0.001) vBright *= 1.0 + uTreble*0.7*snoise(dir*7.0 - vec3(uFastFlow)); // 輝度シマー
```
**fragment**（参照どおり）: `gl_PointCoord` 距離→柔らかい円スプライト（`a=smoothstep(0.5,0.,d); a*=a;`）、`gl_FragColor = vec4(uColor*vBright*uExposure, a)`。material: `AdditiveBlending, depthWrite:false, transparent:true`。

### 7.3 `orbDrive.js`（PURE・テスト対象）— 関数シグネチャ

```js
export const ORB = {           // 定数集約（Canvas2D TERRAIN から移植・調整）
  COUNT: 140000,
  BURST_BASS_HI: 0.55, BURST_MIN_GAP: 0.22, BURST_LIFE: 1.1,
  BURST_SPEED: 3.3, BURST_DECAY: 2.1, BURST_W: 4.0, BURST_GAIN: 1.3,
  WAVE_K: 9.0, WAVE_SPEED: 0.8, WAVE_SPEED_MID: 2.4, WALL_TRAVEL: 1.15,
  SMOOTH: 0.18,                 // 一極平滑係数
};
export function hash01(x, y, z, c);                 // → [0,1) 決定論整数ハッシュ（Math.imul）
export function buildOrbGeometry(count);            // → {positions:Float32Array(3n), seeds:Float32Array(n)} Fibonacci球＋hashジッタ＋hashシード（|dir|=1正規化）
export function updateBurst(state, bass, time);     // bass立上り(>HI)＋屈折(MIN_GAP)でstate.{t0,n,amp}更新・state.prevBass追跡
export function burstFrame(state, time);            // → {axis:[x,y,z]単位, cos, env, active} 黄金角ホップ軸・cos空間エンベロープ(exp減衰)
export function sweepFrame(time, mid);              // → {axis:[x,y,z]単位(never collapse), k(~5..11), flow(単調)} 軸wobble＋帯数breathe
export function bandUniforms(audio, prev, coef);    // → 平滑化した {bassSwell, travelAmt, treble, exposureLoud, fastFlow} と更新後prev
```
`state = { t0:-99, n:0, amp:0, prevBass:0 }`。全て `time`（=clock.time）と `audio` のみに依存＝決定論。

### 7.4 `OrbScene.js`（Sceneアダプタ）— params

`constructor`: `super('orb','Noise Orb')`、`defineParam` でスライダ宣言（ControlPanel自動生成）。参照レバー名/範囲を流用:

| param | 既定 | min | max | step | → |
|---|---|---|---|---|---|
| `rotSpeed` | 0.18 | 0 | 1.2 | 0.01 | points.rotation.y 速度 |
| `morphSpeed` | 0.45 | 0 | 1.5 | 0.01 | uMorphSpeed |
| `noiseScale` | 1.70 | 0.6 | 4.0 | 0.01 | uNoiseScale |
| `displace` | 0.42 | 0 | 0.9 | 0.005 | uDisplace |
| `cellEdge` | 0.55 | 0 | 1.0 | 0.01 | uCellEdge基値 |
| `pointSize` | 1.70 | 0.5 | 4.0 | 0.05 | uPointSize |
| `exposure` | 1.15 | 0.2 | 2.5 | 0.01 | uExposure基値 |
| `bloom` | 1.05 | 0 | 2.0 | 0.01 | UnrealBloom.strength |
| `audioGain` | 1.10 | 0 | 2.5 | 0.01 | 帯域反応の深さ |

`modeGroups`: 当面なし（リッチ帯域別を既定挙動とし、audioGainで深さ調整）。将来 calm↔active トグルは余地として残す（YAGNIで今は入れない）。
ライフサイクル: `init(ctx,w,h)`（`_ensureCore`＋`resize`）/ `onResize` / `update`（音配線・rotation・setUniforms）/ `draw`（render＋opacity）/ `onExit`（opacity0）/ `dispose`。

---

## 8. パフォーマンス

- 140k＋bloom ≈ 参照実測~100fps（近代ラップトップGPU）。M1 iPad は同等級。MID光front/burst/treble は頂点シェーダの数項追加＝GPUで安価。
- **適応:** `clock.quality < 1` のとき ① UnrealBloom解像度/strength を下げ、② それでも足りなければ描画点数を間引く（`geometry.setDrawRange(0, COUNT*quality)`）。順序は bloom→点数。
- pixelRatio ≤ 2。lazy init で未使用時ゼロ。

## 9. エラー処理・エッジケース

- **WebGLコンテキストロス（iOS）:** `webglcontextlost`/`restored` を購読し restored で core を再構築（最小実装。当面は Mac退避が保険なので簡易でよい）。
- **初期化失敗:** core未生成なら `draw` は即return＋opacity0＝黒のまま。他シーンに影響なし。
- **point-size暴走:** k≈4 固定・`gl_PointSize` は透視減衰のみ。白飛び回帰をheadlessで監視。
- **palette未供給:** `setTint` は palette があるフレームのみ呼ぶ（CityScene同様のガード）。

## 10. テスト戦略

**ユニット（`node --test`, `tests/scenes/orb/orbDrive.test.mjs`）— THREE非依存で全て検証可能:**
- `buildOrbGeometry(n)`: 決定論（2回呼んで一致）／`positions` 全点 `|dir|≈1`（±1e-5）／長さ `3n`・`n`／`seeds ∈ [0,1)`。
- `hash01`: `[0,1)` ・決定論・入力で変化。
- `updateBurst`: bass が HI 未満→HI超で `n` 増加＆ `t0=time`；屈折時間内の再上昇は不発；`amp ∈ [0.45,1]`；`prevBass` 追跡。
- `burstFrame`: `active` は `BURST_LIFE` 内のみ／`env` 単調減衰／`axis` 単位長／`n` 違いで `axis` 相違（黄金角）。
- `sweepFrame`: `axis` は**常に単位長**（分母が0にならない＝band collapse無し）／`k ∈ ~[5,11]`／`flow` は time 単調増。
- `bandUniforms`: 目標へ平滑接近／出力有界。

**Headless視覚ゲート（`.superpowers/sdd/devshot/shot.mjs` で `:8125`）:** blob→ `window.__vj` でorbシーンへ切替、audio注入4種で目視し**参照と照合**: (a) idle=静かな回転＋呼吸 (b) bassパルス=全体スウェル＋キックでリング・バースト (c) mid=壁網を走る光front (d) treble=微粒シマー。決定論なので同注入で再現。**実見でOKが出るまで「完了」と言わない**（[[verify-visual-before-claiming]]）。
- ⚠️ **リスク:** headless Chrome の WebGL 可否（SwiftShader/ANGLE 次第）。GLコンテキストが取れない場合は**実機スクショで検証**にフォールバック（[[headless-screenshot-cdp.md]] の手段で確認、または iPad/Mac 実機）。
- **回帰:** 既存テスト緑維持（TERRAIN残置＝既存シーン無改変）。

## 11. デプロイ（明示承認後のみ）

`sw.js` ASSETS に `src/scenes/orb/{OrbScene,orbCore,orbDrive}.js` ＋ vendored addon 群を追加、`CACHE_VERSION` v46→v47。main へ `merge --ff-only` → `git push`（GitHub Pages）。**素URL**（クエリ無し）で `vj-v47`/age低/新コード配信を確認。iPad PWA は1リロードで反映。

## 12. リスクと対処

1. **headless WebGL不可** → 実機スクショ検証にフォールバック（§10）。
2. **addon vendoring の import 指定子** → 各ファイルの `from 'three'` を相対 `../three.module.js` にパッチ、相互 `./Pass.js` 等はそのまま（GLTFLoaderと同じ流儀）。r160 一致で API 差異なし。
3. **point-size 白飛び**（SPEC最大の落とし穴）→ k≈4厳守・headless監視。
4. **二WebGLキャンバスのメモリ** → M1/8GB で問題なし・lazy init で待機コストゼロ。
5. **決定論** → シーン実行時は hash＋clock.time のみ。UnrealBloom は固定カーネル（乱数非依存）。

## 13. 実装順（plan用の示唆）

依存順・並列可: **{T1 vendoring, T2 orbDrive+tests} → T3 orbCore(GLSL) → T4 OrbScene＋index＋registry統合 → T5 音配線＋params → T6 bloom＋適応 → T7 headless/実機 視覚ゲート**。各タスクは実装→自己レビュー→タスクレビュー→是正。最後に whole-branch レビュー＋実見ゲート → （承認後）デプロイ。
