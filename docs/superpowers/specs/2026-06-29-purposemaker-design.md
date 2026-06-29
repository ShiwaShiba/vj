# PurposeMaker — 乱流から立ち現れる手 (Design Spec)

**日付**: 2026-06-29
**ブランチ**: `feat/purposemaker-hands`（main から分岐）
**ステータス**: 設計承認済（ユーザー 2026-06-29）。本ドキュメントは spec。次は writing-plans。

---

## Goal（一文）
mono の乱流パーティクル場を“媒体”として、美しい手＋前腕が **右 → 左 → 両方** の順ににじみ出て(coalesce)・保持(hold)・また乱流へ霧散(dissolve)する様を、継ぎ目なく循環する新しい VJ モード `PurposeMaker` を `dots` ファミリーに追加する。

## Architecture（要約）
既存 `src/scenes/dots/FlowField.js` の実証済み**実行基盤**（決定論ハッシュ seed・mono インク・trail 累積・正射影・depth-band 一括 stroke）を土台に、各粒子へ **手のターゲット点**（ドローイングを濃度サンプリングした点群）を持たせ、clock 駆動の **cohesion（結束）エンベロープ**で「自由乱流 ⇄ ターゲット吸着」をブレンドする。

**重要**: アンビエント乱流は FlowField の汎用定数を流用せず、**ソース動画から実測した乱流プロファイル**（spawn 密度マップ＋主流向き＋特徴スケール＋筋長分布）で駆動し、動画の質感に寄せる（ユーザー指針 2026-06-29）。手の点群と乱流プロファイルはどちらもオフラインで **bake**（依存ゼロ Node、`tools/citybake` 流儀）して committed asset 化する。描画は白発光 on 黒（additive）。

## Tech Stack
- 実行時: ブラウザ Canvas-2D、ES modules、`src/lib/noise.js`(SimplexNoise)、`src/lib/math.js`(TWO_PI/clamp/lerp/smoothstep)。新規 npm 依存なし。
- bake: Node `node:fs`/`node:zlib`（`tools/citybake` と同じ流儀。依存ゼロ）。
- テスト: `node --test`（`tests/**/*.test.mjs`）。

---

## Global Constraints（全タスク共通・spec から逐語）
- **mono 厳守**: 白発光 on 純黒。虹色グロー禁止。`palette.fg` を唯一のインク色に使う。
- **白発光 on 黒**: 背景は黒。粒子は白（additive `lighter`）。密度＝トーン。
- **決定論**: `Math.random` / `Date` / `performance.now` を実行時に使わない。粒子 seed はハッシュ（FlowField `_h(n)`流儀）、振付は `clock.time`/`clock.beats` 駆動、手ターゲットは bake 済み固定配列。→ operator/output 二画面ミラー一致＆リロード再現。
- **`node --test` は緑のまま**（現状 ~220）。新規テストを追加し、既存を壊さない。
- **SW `CACHE_VERSION` の bump は“デプロイ時のみ”**（現 `vj-v33`→`vj-v34`）。実装中は触らない。
- **二言語コミット**（JP+EN）＋フッタ `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` / `Claude-Session: https://claude.ai/code/session_01TDo59SJjRsGDawtwgz2oFi`。
- **feature branch `feat/purposemaker-hands`** 上で作業。main への push/デプロイはユーザー判断。
- **視覚は実スクショ確認後にのみ「OK」**（[[verify-visual-before-claiming]]）。**ユーザーが観る画角＝正面**（このモードは正面固定の平面手なので正面で検証して良い。FlowField/Dancer のような奥行き回転は使わない）。

---

## 検証済みの見え方（look）
Hand_A を濃度サンプリング→白発光粒子 on 黒（8k/18k/34k点）で「黒地に光で描いた手」として美しく読めることを scratchpad ミックアップで確認済み（`shots`相当 `hand_mock.png`）。密度を上げるほど陰影が出る。**手は形＋陰影として読めるが、鉛筆の細かいハッチング線そのものは再現しない**（塵の濃淡として出る）。指は細いので低密度だと指先が淡くなる→手粒子 ≈22k（`recruit*count`）で安定。また**アンビエント乱流が画面外まで続き、手はその中の濃化として現れる**ことも prototype で確認（pm_holds / pm_phase）。hold 中も周囲の乱流は四辺から流れ続ける。

## 素材と向き（数値確定）
- `Hand_A.png`（2816×1536）= 前腕が**右**（rightThirdInk 優勢）→ **右から出現**。
- `Hand_B.png`（2816×1536）= 前腕が**左**（leftThirdInk 優勢）→ **左から出現**。
- **両方** = A(右)とB(左)を同時表示、指先が中央で向かい合う（縦に僅かにずらして触れ合う寸前にする）。

---

## File Structure（pure/impure 分離）
```
src/scenes/dots/PurposeMaker.js        # Scene（glue + 粒子物理 + 描画）。impure。
src/scenes/dots/purposeMakerChoreo.js  # PURE: cohesion エンベロープ + station スケジュール。
src/scenes/dots/handTargets.js         # bake 出力（手の点群・base64）+ pure decodeHandTargets()。
src/scenes/dots/turbProfile.js         # bake 出力（動画由来の乱流プロファイル）+ pure decodeTurbProfile()。
src/scenes/registry.js                 # import + createScenes() に登録（FlowField/ParticleField 付近）。
tools/pmbake/png.mjs                   # 依存ゼロ PNG デコード（zlib inflate + unfilter）。pure。
tools/pmbake/bakeHands.mjs             # Hand_A/B → 重要度サンプリング → handTargets.js。
tools/pmbake/turb.mjs                  # PURE: フレーム群→密度マップ/主流向き/特徴スケール/筋長 の計測。
tools/pmbake/extractTurb.mjs           # フレーム読込→turb.mjs→turbProfile.js を書く entrypoint。
tools/pmbake/fixtures/Hand_A.png       # 縮小グレースケール（committed・bake入力）。
tools/pmbake/fixtures/Hand_B.png
tools/pmbake/fixtures/frames/          # 動画の縮小フレーム数十枚（committed・抽出入力）。
tools/pmbake/tests/pmbake.test.mjs     # PNG decode / 重要度サンプリング / 乱流計測 のテスト。
tests/dots/purposeMakerChoreo.test.mjs # 振付エンベロープのテスト。
tests/dots/handTargets.test.mjs        # 手点群 decode のテスト。
tests/dots/turbProfile.test.mjs        # 乱流プロファイル decode のテスト。
```

## Data Flow
1. **bake-hands（dev 時のみ・1回）**: `node tools/pmbake/bakeHands.mjs` が fixtures の 2 枚を PNG decode → 濃度（暗さ）に比例した重要度サンプリングで各 26,000 点を抽出 → 正規化座標 (u,v)∈[0,1] を Int16 にパック → base64 → `src/scenes/dots/handTargets.js`（committed）。**等重み**（トーンは点の“密度”で出る）。
2. **bake-turb（dev 時のみ・1回）**: `node tools/pmbake/extractTurb.mjs` が fixtures/frames の縮小フレーム群を読み、`turb.mjs` で densityMap/flow/scale/streakLen/contrast を計測 → `src/scenes/dots/turbProfile.js`（committed）。
3. **init**: `PurposeMaker` が `decodeHandTargets()`・`decodeTurbProfile()` で復号。粒子配列を確保し、アンビエント粒子は `densityMap` 重みでハッシュ散布。
4. **update(dt,audio,palette,clock)**: `purposeMakerChoreo` から station（R/L/Both）と cohesion `c` を取得。recruit 粒子は「乱流速度 ⇄ ターゲット引力」を `c` でブレンド、アンビエント粒子は profile 駆動の乱流のみ。積分＋外縁 reseed。
5. **draw(ctx,alpha)**: prev→cur を additive の細い線分/点として白で描画（trail 累積）。

---

## 粒子モデル（2.5D）
- **アンビエント乱流（媒体・常時・動画駆動）**: 全粒子のうち `1-recruit` 割合は常に自由乱流。シミュレーション領域は**ビューポートより広い**（world ±1.6 を可視枠 ±1.0 が覗く）→ 粒子は四辺から画面外へ流れ続け、外縁で inflow 側へ決定論 reseed ＝**連続した溢れ**。**手が出ている間(hold)も周囲の乱流は画面外へ流れ続ける**（＝動画と同じ。手は黒地の孤立塊ではない）。
  - **FlowField の汎用乱流を流用しない**。spawn 密度は `turbProfile.densityMap`（動画の平均輝度分布＝粒子が居やすい場所）に従い、移流の**主流向き・カール強度**は `turbProfile.flow`、simplex の `freq`/オクターブは `turbProfile.scale`（筋の太さ/間隔の実測）、streak 長は `turbProfile.streakLen` に従う。＝**動画の乱流の“居方・流れ方・粒度”を実測値で再現**する。`scale`/`flow` ノブはこの実測基準値に対する倍率。
- **手への濃化（recruit）**: 残り `recruit` 割合だけが gather/hold 中にターゲットへ吸着、disperse で媒体へ復帰。手は**流れ続ける乱流の“中の濃化”**として立ち現れる。
- 粒子状態: world `(x,y,z)`、可視枠 `x,y∈[-1,1]`・sim 領域 `x∈[-1.6,1.6]`（正射影で screen 化）、`z∈[-1,1]`（乱流の奥行き）。FlowField 同様 prev 位置 `(px,py,pz)` も保持（streak 用）。
- **乱流速度** `v_turb`: 2 オクターブ 3D simplex ベクトル場（FlowField の `freq`/`detail` 相当）。`flow`（速度）と `scale`（場サイズ）で制御。`clock.time` でゆっくり時間進化。
- **ターゲット引力** `v_pull = (target_i - P)`: 粒子 i のターゲット `target_i`（後述の station 配置で決まる world 座標、`tz≈0`＋微小ジッタ）へのバネ。
- **ブレンド**: `v = v_turb*flow*(1-cc) + v_pull*cohesion*cc`、`cc = smootherstep(c)`。`P += v*dt`。
  - `c=0`: 純乱流（手なし）。`c=1`: ターゲット吸着＋微細 quiver で“立ち現れて静止”。中間: にじみ出る/霧散。
  - 霧散は `c→0` で乱流が支配→粒子は吸着位置から自然に流れ去る（瞬間移動でなく連続＝継ぎ目なし）。
- **ターゲット割当**（決定論）: station R → `target_i = A[i % nA]`、L → `B[i % nB]`、Both → 偶数 i→A、奇数 i→B。
- **正射影**: ほぼ正面。微小固定 TILT（≈0.06rad）＋ごく緩い parallax で“生きてる”感のみ。**手をタンブルさせる回転は使わない**（可読性優先）。
- **reseed**: 乱流位相で寿命切れ/場外の粒子はハッシュで再投入（FlowField `_reseed` 流儀）。ただし `cc` が高い間は reseed を抑制（手が欠けないように）。

## 動画由来の乱流プロファイル（`turbProfile`）
ソース動画（`ScreenRecording…20-42-47_1.mov`、9.74s/≈49fps/1170²）の抽出フレーム群（`tools/pmbake/fixtures/frames/` に縮小コミット）から、`tools/pmbake/turb.mjs`（PURE）で計測してオフライン bake → `src/scenes/dots/turbProfile.js`。計測項目：
- **densityMap**（例 96×96 の Float、0..1）: 全フレームの平均輝度（IG UI の角は事前マスク）。＝乱流が“居やすい”空間分布。アンビエント粒子の spawn 密度に使う（均質ガウス帯ではなく、動画の実分布）。
- **flow**: 連続フレーム差分／構造テンソルから推定した**主流向き（角度）とカール強度**。アンビエント移流の支配方向。
- **scale**: 輝度の自己相関幅＝**筋の特徴スケール**（太さ/間隔）。simplex `freq` とオクターブ配分の基準。
- **streakLen**: 明部のモーション残像長の代表値。streak 描画長・粒子速度の基準。
- **contrast / mean**: 輝度ヒストグラム。additive α・trail の基準。
これらは小さなスカラー＋低解像度マップなので `turbProfile.js`（base64 + スカラー）として軽量にコミット。実行時 `decodeTurbProfile()` で復号。**決定論**（固定 fixtures → 固定出力）。

## station 配置（target 正規化座標 → world）
画像座標 `u`=横[0,1]、`v`=縦[0,1]。`spanX≈1.3`、`spanY≈1.0`、中心 0。
- **Right(Hand_A)**: `tx = -0.3 + 1.3*u`（u=1 根=+1.0 右端、u=0 指先=-0.3 中央左）。`ty = (0.5 - v)*spanY`。
- **Left(Hand_B)**: `tx = -1.0 + 1.3*u`（u=0 根=-1.0 左端、u=1 指先=+0.3 中央右）。`ty = (0.5 - v)*spanY`。
- **Both**: A を `ty += 0.12`、B を `ty -= 0.12`（縦に僅差→指先が中央で触れ合う寸前）。
- 数値（spanX/spanY/offset/TILT）は**視覚調整ノブ**。実装時に headless 実見で詰める。

---

## 振付ステートマシン（PURE・決定論・seamless）
`purposeMakerChoreo.js`:
```
cohesionAt(time, { pace }) -> { station: 'R'|'L'|'Both', cR, cL }
```
- 1 station = `gather(2.6s) → hold(2.4s) → disperse(2.2s) → gap(0.5s 純乱流)`（既定。`pace` で一括スケール）。
- `c(局所位相)` = gather 中 smootherstep で 0→1、hold 中 1、disperse 中 smootherstep で 1→0、gap 中 0。
- sequence: **R → L → Both → ループ**。1 周 = 3×(2.6+2.4+2.2+0.5)=**23.1s**（pace=1）。
- **seamless 不変条件**: 各 station の両端（gather 開始直前・disperse 終了直後）で `c=0` かつ `dc/dt≈0`。station 間に gap を挟むので、手が完全に乱流へ還ってから次が始まる＝ポップ無し。
- Both のとき `cR=cL=c`（A,B 同時）。R のとき `cL=0`、L のとき `cR=0`。
- manual モード（`modes`）が Cycle 以外なら、その station を `c=1` 固定（hold 呼吸のみ）にして手を出しっぱなしにできる（VJ 操作用）。

---

## 描画（mono additive）
- `ctx.globalCompositeOperation = 'lighter'`（additive）。`this.trail` で前フレームを薄く残す（既定 0.16・要 headless 調整。additive×trail の白飛びは per-stroke α を低く＋trail 強めで回避）。
- インク色 = `palette.fg`（mono）。per-stroke α は低め（密度で明るさを積む）。粒子ごとに seed 由来の微小 α/径ジッタ。
- prev→cur が短い（hold 時）→ ほぼ点。長い（gather/disperse 時）→ 煙の筋。`thread` で線幅。
- FlowField の depth-band 一括 stroke 最適化（明度量子化して band ごと 1 stroke）を流用して総 30–40k 本を高速描画。

## 音反応（[[audio-sensitivity-strong]] + [[motion-organic-seamless]]）
- **マクロ振付は完全自律**（`clock.time` 駆動・継ぎ目最優先）。音で出現タイミングは乱さない。
- 音は“質感”を駆動: `level/bass → 乱流の激しさ(flow) と 粒子明度`、`beat → 霧散(disperse)時のうねり/散り impulse`、`hold 中は level で微細 quiver＝手が呼吸`。
- `react` ノブで全体強度。`modeGroups.audio = OFF/ON` で一括無効化（無音検証用にも）。

## Params / Modes
```
defineParam('count',    34000, 10000, 44000, 1000, 'Particles') // 総数（手+アンビエント）
defineParam('recruit',  0.65,  0.3,   0.9,   0.05, 'Recruit')   // 手に集める割合。残りは画面外へ流れ続ける乱流
defineParam('flow',     0.5,   0.1,  1.5,   0.05, 'Flow Speed')
defineParam('scale',    1.6,   0.6,  3.2,   0.1,  'Field Scale')
defineParam('cohesion', 1.0,   0.3,  2.0,   0.1,  'Cohesion')   // 大=手がくっきり速く結束
defineParam('thread',   0.9,   0.4,  2.0,   0.1,  'Thread')
defineParam('react',    2.0,   0,    6,     0.5,  'React')
defineParam('pace',     1.0,   0.4,  2.0,   0.1,  'Pace')        // 振付の速さ
modes = [{name:'Cycle'},{name:'Right'},{name:'Left'},{name:'Both'}]
modeGroups = [{ key:'audio', label:'Audio', options:['OFF','ON'], index:1 }]
this.trail = 0.16
```
手粒子数 = `recruit*count`。bake は 26000 点/手（手粒子がこれを超える分はターゲットを modulo 反復＝濃くなるだけで破綻なし）。`clock.quality` で実効 count を下方スケール（FlowField 同様）。

## Determinism / 二画面ミラー
bake 済みターゲット（固定）＋ハッシュ seed 粒子＋`clock` 駆動振付＝同 `clock` で同一フレーム。`Math.random`/`Date` 不使用。operator/output 二画面・リロードで完全一致。

## Registry 統合
`src/scenes/registry.js` に `import { PurposeMaker } from './dots/PurposeMaker.js';` と `createScenes()` 配列へ `new PurposeMaker()` を追加（FlowField/ParticleField 付近）。既存シーンの順序・既定（先頭 Dancers）は不変。

---

## Testing
**ユニット（`node --test`・DOM/canvas 無し・pure ロジック）**
- `tests/dots/purposeMakerChoreo.test.mjs`:
  - 端点: gap 時刻で `cR=cL=0`；hold 中点で active station の `c≈1`。
  - **seamless**: station 境界で `c` 連続・`|Δc|` 微小、station 間で 0 に戻る。
  - 決定論: 同 time→同値、`Date`/`random` 不使用（関数が引数 time のみ依存）。
  - schedule: 1 周で R→L→Both の順・active フラグ正しい。`pace` が duration を線形スケール。
- `tests/dots/handTargets.test.mjs`: `decodeHandTargets()` が 2 点群を返し、各 count が想定帯（>10k）・全 `u,v∈[0,1]`。
- `tests/dots/turbProfile.test.mjs`: `decodeTurbProfile()` が densityMap（想定寸法・値域 0..1）と flow/scale/streakLen スカラーを返す。
- `tools/pmbake/tests/pmbake.test.mjs`（citybake/tests 流儀）: PNG デコードが小 fixture の寸法/画素を正しく返す；合成グラデーションへの importance sample が「暗い領域に点が多い」；`turb.mjs` の計測が合成入力で期待挙動（一様輝度→density 平坦、既知方向ストライプ→flow 角度が一致、既知周期→scale 推定が近い）；固定入力で出力決定論。

**ヘッドレス視覚検証（実物確認・`node --test`ではない手動ゲート）** [[verify-visual-before-claiming]]
- `shot.mjs` で Right/Left/Both の **hold** を撮影→手が美しく読めるか実見。
- gather/disperse の中間フレーム→にじみ出る/霧散の質感。
- mono（白 on 黒）・seamless（ループ継ぎ目でポップ無し）。
- 正面画角で検証（このモードは正面固定なので OK）。

## Performance
総 30–40k 粒子（手＋アンビエント）。FlowField 18k の depth-band stroke 実績の延長。additive＋band 一括描画で stroke 数を抑制し、`clock.quality` で動的減数（iPad は実効 count を下げる）。アンビエントは faint・短 streak なので安価。

## Honest Scope / YAGNI
- v1 は**正面固定の平面手**（タンブル無し）。手のトーンは密度由来（ハッチング線の忠実再現はしない）。
- 手は提供の 2 枚のみ（手続き生成や追加ポーズは YAGNI）。
- 立体（手の厚み/法線）・色・3D 回転は対象外。
- bake 入力は committed の縮小 fixtures（手2枚＝グレースケール／動画フレーム数十枚＝縮小。原寸 9.4MB×2 や .mov は commit しない）。
- アンビエント乱流は**動画実測プロファイル駆動**（汎用 FlowField 定数の流用ではない）。ただし計測は低解像度の統計（密度/主流/スケール）であり、動画の 1:1 ピクセル再生ではない＝“質感を寄せる”もの。

## Deploy（ユーザー判断・実装後）
`sw.js` `vj-v33→vj-v34`、二言語コミット、`git push`（main 反映＝GitHub Pages）。実機 PWA はリロードで更新。**実装中は SW を触らない。**
