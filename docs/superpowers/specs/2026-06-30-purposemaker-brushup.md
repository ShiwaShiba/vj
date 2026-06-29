# PurposeMaker BrushUP — Design Addendum (2026-06-30)

**Branch**: `feat/purposemaker-brushup`（main から分岐）
**Base spec**: `2026-06-29-purposemaker-design.md`（土台。本書はその差分）
**Trigger**: ユーザー指示（2026-06-30, UltraCode）「動画の流体構造に寄せ／手を女性的に／音反応を
Oscilloscope SPHERE×LISSA 級に。起きたら仕上がっていてほしい」。動画 `~/Downloads/pouposemaker.mov`
（9.745s, Instagram @loopscope の乱流リール）と新リファレンス `HAND_A1.png`/`HAND_B1.png`。

---

## 動画の再分析（実フレーム抽出・実見）
swift/AVFoundation で 28 フレーム抽出し montage 実見。**流体は2状態を周期的に往復**する：

- **LINE 状態**（コヒーレント）: 粒子が**長く細い平行フィラメント線**に櫛けずられる（明点から放射状に伸びる
  ストランド、稜線状の微細striation、輝く稜）。≒ 流れが滑らか（低空間周波数）＋強い方向性移流＝ストレッチ。
- **PARTICLE 状態**（インコヒーレント）: 線がほどけ**柔らかい発光パウダー/スプレー**に拡散（密な発光コア＋
  羽毛状にまばらな粒）。≒ 流れが高周波・カール優勢・移流弱＝散乱。
- 周期 ≈ 3〜4.5s で line↔particle↔line を往復し、形成時に**前へ伸び**・拡散時に**後ろへ退き**、全体は
  **少しずつ前進**（ユーザーの言葉そのまま「粒子→線→粒子(後退)→また線…少しずつ前進」）。

現実装は**定常 simplex 場＋定数 drift/flow**で、この往復が皆無＝「単純」。← 直す核。

## 設計の核（unifying idea）
**line↔particle の往復＝コヒーレンス・パルス `K(t)∈[0,1]`** を導入し、これ1本で全テクスチャ手掛かりを同時駆動：

| K | freq(空間周波数) | 方向性移流(stretch) | 散乱(curl振幅) | streak長/速度 | 明度 |
|---|---|---|---|---|---|
| →1 LINE | 低（大構造） | 強（前へ伸びる） | 小 | 長・速 | 明 |
| →0 PARTICLE | 高（小乱流） | 弱 | 大 | 短・遅 | 淡 |

`K` は (a) **ベースの有機呼吸**（period≈3.5s, 2正弦の非整数比で非周期的・eased）＋ (b) **音エンベロープ**の
`max` 合成。net forward drift（主流方向の微小定数バイアス）を上乗せ＝「少しずつ前進」。spatial項を少量足し
全体が一様スイッチに見えないようにする。

## 音反応（Oscilloscope 級・明確）— ここが最重要
現状＝`flow` を僅かに速めるだけで「イマイチわからない」。新設計は**構造そのものが音に snap**：

- **beat/bass → K サージ**: キックで `K` が 1 へ跳ね、粒子が**アラインした明線に snap**＋**前方サージ**、
  ビート間で dust へ弛緩。＝最も目立つ構造変化を最も目立つ音イベントに連動（明快・音楽的）。
- **level → 全体エネルギー**（速度・streak長・明度のベース）。
- **treble → 微細シマー**: 粒子に高周波ジッタ＝ハイハットでパウダーがきらめく。
- **waveform → 横波リップル**（任意・控えめ）: 主流方向に直交する変位を波形で与え、フィラメントが音の形に
  さざ波立つ＝Oscilloscope 的な複雑さ・洗練を一掬い。
- **手 hold 中**も bass→bloom（手が脈打つ）/ treble→指のシマー。
- `modeGroups.audio = OFF/ON` で一括無効（無音時はベース呼吸のみで自然に動く）。`react` ノブで全体強度。

マクロ振付（R→L→Both の出現schedule）は**自律のまま**（継ぎ目最優先 [[motion-organic-seamless]]）。
音は「質感」と「line↔particle の往復」を駆動し、**出現タイミングは乱さない**。

## 手（女性性）
- ✅**完了(commit 29176d4)**: `HAND_A1/HAND_B1`（長い指・柔らかい陰影）→ grayscale fixtures 作り直し →
  `bakeHands.mjs` 再実行 → `handTargets.data.js` 再生成。向き不変（A=前腕右→右 / B=前腕左→左）。
  headless で R/L/Both hold 実見＝女性的・繊細に改善。
- 残チューニング: 手の密度/サイズ（recruit/count/spanX）と hold 中の audio bloom/shimmer は本体改修で。

## 粒子テクスチャ（質感）
動画＝**柔らかい発光パウダー＋微細稜線**。additive 維持。PARTICLE時=短いほぼ点（round cap）、LINE時=長い
細線。streak は prev→cur を K で**伸長(elongation)**して線らしさを出す。dense域は加算で bloom。count↑/
per-stroke α↓ で滑らかな粉に。trail でコメット状の伸び。

## File Structure（差分）
```
src/scenes/dots/purposeMakerField.js   # NEW PURE: breathAt(time, audioScalars, opts) -> {K, advance, speed, freqMix, scatter, shimmer, bright, ripple} 決定論
src/scenes/dots/PurposeMaker.js        # 改修: ambient を K(t) 駆動の line↔particle 往復に。音マッピング刷新。streak 伸長。手 audio bloom。
src/scenes/dots/purposeMakerChoreo.js  # 既存維持（必要なら duration 微調整）
tests/dots/purposeMakerField.test.mjs  # NEW: K の値域/決定論/音応答(beatで上昇)/seamless(境界連続)
src/scenes/dots/handTargets.data.js    # ✅再bake済
tools/pmbake/fixtures/Hand_A|B.png     # ✅新女性fixtures
```

## Global Constraints（[[aesthetic-minimal-techno]] / base spec から逐語）
- **mono 厳守**・白発光 on 純黒・additive・`palette.fg` のみ。虹色禁止。
- **決定論**: 実行時 `Math.random`/`Date`/`performance.now` 不使用。粒子=ハッシュ seed、振付/呼吸=`clock.time`
  と audio スカラー駆動、手=bake固定。→ operator/output 二画面ミラー一致＆リロード再現。
- **`node --test` 緑維持**（現 247）。新規 pure テスト追加。
- **SW bump はデプロイ時のみ**（実装中は触らない）。
- **二言語コミット**＋フッタ。**視覚は実スクショ実見後のみ「OK」**（[[verify-visual-before-claiming]]）。

## 検証
headless `shot.mjs`（dev :8125・overlay HUD は描画時 noop）で実見：
- ベース呼吸（audio OFF）で line↔particle が往復するか（複数時刻で実見）。
- 合成 audio（beat パターンを `audio.update` 差し替えで注入）で beat→line snap が出るか。
- R/L/Both hold で女性手＋周囲の往復乱流。mono/seamless。
- `node --test` 緑。

## Deploy（最後・ユーザーは就寝中＝完成希望に従い実施）
SW `vj-v35→vj-v36`、二言語コミット、main へ ff-merge、`git push`＝GitHub Pages 反映、**素URLで実機配信を
確認**（[[deploy-verify-bare-url]]）。pwa.js が controllerchange で1回自動リロード。
