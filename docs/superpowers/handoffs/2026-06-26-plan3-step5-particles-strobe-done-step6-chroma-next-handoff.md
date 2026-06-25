# ハンドオフ — Plan 3 step 5（粒子＋冬ストロボ＋並木終点延長）完了 → 次は step 6 季節色モード

**日付:** 2026-06-26
**ブランチ:** `feat/city-webgl-render`（未マージ・保持。`main`=2D配信版で安全）
**ステータス:** **step 1-5 完了・コミット済・視覚検証済。87 tests green ＋ citybake 32 green。** step 5 は本コミット、step 4=`3ef3a22`、step 1-3=`37123fe`。working tree クリーン。次は **step 6＝季節色モード（`C` キー crossfade）＋ ControlPanel 露出＋確定 timing 焼込**。

設計の全体像は spec: [docs/superpowers/specs/2026-06-25-plan3-seasonal-reveal-design.md](../specs/2026-06-25-plan3-seasonal-reveal-design.md)。前ハンドオフ: [2026-06-25-plan3-step4-seasons-done-particles-next-handoff.md](2026-06-25-plan3-step4-seasons-done-particles-next-handoff.md)。

---

## 0. ユーザーのビジョン（確定・不変）

4サイクル＝四季のシネマティック・ループ（時間ベース、音は後）。1サイクル＝往復（①旧駅舎寄り→②扇→③市街 長め hold＝見せ場→④全域→ゆっくり逆ドリーで①へ）。4サイクル＝春→夏→秋→冬→春。大学通りの並木が季節を運ぶ。リビールはイントロで1回。2モード＝**既定モノクロ厳守**（守る線）／`C` キーで季節色モード（step 6）。**最も Ikeda な瞬間＝冬の白ストロボが並木を流れる**（step 5 で実装済）。

## 1. ここまでの実装（step 1-5、全てコミット済）

すべて additive・buildless ESM・three は vendored（r160 `src/vendor/three.module.js`）。`update()`/`plan*()` の純粋部は node テスト済。

| File | 役割 | テスト |
|---|---|---|
| [ease.js](../../../src/cityproto/ease.js) / [camrig.js](../../../src/cityproto/camrig.js) / [director.js](../../../src/cityproto/director.js) | カメラ旅＋マスタータイムライン。`director.update(t)→{cam,reveal,season}` 純関数 | ease/camrig/director |
| [reveal.js](../../../src/cityproto/reveal.js) / [intro.js](../../../src/cityproto/intro.js) | 建物 ripple／地形格子・道路 opacity reveal | reveal/intro |
| [seasons.js](../../../src/cityproto/seasons.js)（拡張） | 季節の単一真実源（純粋）。`MONO_SETTLED`/`COLOR_PALETTE`/`GRAD`/`seasonEndpoints` ＋ **step5: `PARTICLE[4]`/`PARTICLE_COLOR[4]`/`particleEndpoints`** | seasons（12） |
| [trees.js](../../../src/cityproto/trees.js)（拡張） | `planLayout`（純粋）＋`buildTrees`。季節シェーダ ＋ **step5: 冬ストロボ＋`avenueBounds` 延長** | trees（10, planLayout のみ import） |
| **[particles.js](../../../src/cityproto/particles.js)（新）** | **`planEmit`（純粋）＋`buildParticles`→{points,update}**。花びら/落ち葉/雪、GPU 落下シェーダ | **particles（6, planEmit のみ）** |
| [proto.js](../../../src/cityproto/proto.js)（M） | loop で `particles.update` ＋ `trees.update(...,{strobe})`、`S` キー、`__proto.particles`/`setStrobe` | — |

## 2. ★ step 5 の設計と技術メモ（step 6 で必読）

### 2.1 粒子（particles.js）
- **`THREE.Points` 1系統を季節で使い回し**。`THREE.ShaderMaterial`（fresh shader＝建物/canopy と違い baked AO/量子化を保持する必要が無いので onBeforeCompile でなく自前 shader が適切）。`transparent:true, depthWrite:false, depthTest:true, **NormalBlending（無グロー＝守る線）**`、`renderOrder:10`（不透明描画後＝背後の建物/地形で depth カリング＝overdraw 削減）。`frustumCulled=false`＋巨大 boundingSphere（シェーダで x/z drift・y fall するので CPU bounds は誤る）。
- **`planEmit(avenue, opts)`（純粋・node test）** → `{emit:[{u,v,aPhase,aSeed,aBirth,aLife}], life}`。avenue を `stride` 間引き×`perColumn` 段で emit 列を作る。**`aPhase` は avenue 点から carry**（canopy と同じ染め sweep に同期）。`aBirth=rnd()*life`（[0,life) で desync）、`aLife=life*(0.8+rnd()*0.4)`（±20% jitter＝同期カーテン回避）。独立 xorshift（trees と別 seed）で決定的。
- **`buildParticles(planned, terrain, manifest, opts)`（THREE）** → `{points, update(season,mode,dt), uniforms}`。emit 原点ごとに **terrain へ down-raycast（trees.js の groundY idiom 流用）** し `aOrigin.y = gy + fallDist`、`aGround = gy`。
- **落下＝頂点シェーダ（GPU respawn、CPU 書込無＝守る線）**: `age=mod(uTime-aBirth,aLife); frac=age/aLife`。`drop=clamp(frac*fall,0,1)*uFallDist; pos.y=(aGround+uFallDist)-drop`（`fall`>1 は frac<1 で着地→地面で休む、<1 は舞い続ける＝雪）。横揺れ `pos.x+=sway*frac*sin(uTime*spin+aSeed*…)`（2軸＝tumble、×frac で誕生時は締まり落下で開く）。
- **emit gate＝canopy と同じ progI**: `progI=smoothstep(min(aPhase*uStagger,1-uBand),…,uProg)`（`uStagger=0.7,uBand=0.3` を canopy と一致させること＝必須）。`vAlpha = fadeIn(0..0.08) * fadeOut(0.85..1) * progI * mix(uEmit.x,uEmit.y,progI)`＝季節の sweep が来た所だけ降る。
- **季節記述子は seasons.js `PARTICLE[4]`（単一真実源）**: `{amount,size,sway,fall,grey,spin}`。**`size` は world-radius**（size-attenuation `gl_PointSize=clamp(psz*uScale/-mv.z, 1, 16)`、`uScale=0.5*drawingBufferHeight` を毎フレーム renderer から更新）。`particleEndpoints(i)` が `seasonEndpoints` と同型＝連続不変条件 `cur(i)===prev(i+1)` で wrap 継目無（夏 amount=0 で花びら消滅→秋落葉、冬雪→春花びら）。
- **色**: frag `mix(vec3(grey), chroma, uMode)`、grey/chroma とも `vProgI` で prev→cur blend。`PARTICLE_COLOR[3]=[1,1,1]`＝**雪は chroma モードでも白固定（守る線）**。`uMode` は `dt*4` で ease（trees と同じ）。

### 2.2 冬ストロボ（trees.js canopy シェーダ）
- 共有 `U` に `uStrobe`(0..1 envelope)/`uStrobeRate`(2.5Hz)/`uStrobeSpan`(1.0) 追加。頂点に `varying float vPhase; vPhase=aPhase;`（frag が aPhase を必要＝既存は vProgI/vSeed のみ）。
- frag の **既存最終行 `diffuseColor.rgb = mix(vec3(grey), seasonC, uMode);` の直後**に追記:
  ```glsl
  float flashPhase = fract(uTime*uStrobeRate - vPhase*uStrobeSpan);
  float pulse = smoothstep(0.0,0.18,flashPhase) * (1.0 - smoothstep(0.32,0.5,flashPhase));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0), uStrobe*pulse);
  ```
  `vPhase*uStrobeSpan` 位相オフセットで **白パルスが並木を下流へ走る**。**周波数＝uStrobeRate=2.5Hz≤3Hz**（vPhase 項は各木の peak タイミングをずらすだけで、単一 fragment が体感する時間周波数は rate のまま）。窓は soft smoothstep（hard square 禁止）。**白のみ `vec3(1.0)`**。
- **drive（trees.update に opts 引数追加・後方互換）**: `gate=opts.strobe?1:0; strobeTarget=(season.index===3?season.prog:0)*gate; uStrobe += (target-uStrobe)*min(1,dt*3)`（~1s ramp）。**既定 gate=0 → uStrobe→0 → 既定 OFF**。冬以外は index≠3 で target=0。
- **安全策（厳守・検証済）**: ≤3Hz・白のみ・in/out ランプ・`S` キー＋`strobeEnabled` ゲート既定 OFF。proto の `let strobeEnabled=false`＋`S` keydown＋`__proto.setStrobe(b)`。

### 2.3 並木終点延長（planLayout `avenueBounds`）
- `bounds`（scatter 用、v1=1.3 据置）と独立に **`avenueBounds`（既定 `{...bounds, v1:3.55}`）** を avenue 植えにのみ適用。共有 bounds.v1 を上げると緑地 scatter が増えてしまうので分離（より surgical）。`inB(b,u,v)`/`plant(u,v,arr,b)` を bounds 引数化。
- 自己調整: `aPhase` は植えた avenue の実 v 範囲で正規化されるので延長後も 0..1（sweep/emit 自動追従）。粒子 emit も avenue 点流用で自動延長。
- **結果（実測）**: avenue **97→289 本**、world z **-0.58..19.41**（=大学通り終点 v≈3.53）、**全 289 本が DEM 着地（y=0 fallback 0 本＝floater 無）**。terrain は全域被覆（全道路 v≈8.1 まで）。

## 3. 視覚検証（実物確認済み・再現手順）

dev サーバー: `.claude/launch.json` の `vj`（:8125, ThreadingTCPServer）。`preview_start vj` → `http://localhost:8125/city-proto.html` → reload。**resize は ≤667 幅**（800 等は screenshot に黒帯。canvas は正しい [[image-delivery-via-localhost]]）。

固定カメラ手順（director.update を patch して cam だけ差替え、season/reveal は原版）:
```js
const p = window.__proto;
if (!p.__origUpdate) p.__origUpdate = p.director.update.bind(p.director);
window.__cam = { camX:1.05, camY:0.62, camZ:1.4, fov:52, lookX:-0.02, lookY:0.12, lookV:5.2 }; // 並木 接写
p.director.update = (t,o) => { const f = p.__origUpdate(t,o); f.cam = window.__cam; return f; };
const cd = p.director.cycleDur; // 20.4
window.__season = (i) => { const t = i*cd + cd*0.59; p.seek(t); p.setPaused(true); return p.__origUpdate(t).season; };
p.setMode(0); p.setStrobe(false);
// __season(0)春花びら / __season(2)秋落葉 / __season(3)冬雪。
// 冬ストロボ: window.__season(3); p.setStrobe(true); ~1.3s 待つ（uStrobe envelope ramp）。
// 復元: p.director.update = p.__origUpdate; delete p.__origUpdate; p.setPaused(false); p.setMode(0); p.setStrobe(false);
```
※paused 中も `uTime` は進む（dt>0）ので季節 hold のまま粒子は降り続け・ストロボも点滅する。

**確認済み**: 春＝明るく密な白花びら（canopy 高さ＝`fallDist=0.32`、初期 1.6 は空高すぎで修正）／秋＝灰色・大粒・flutter の落葉＋疎な canopy／冬＝小粒密な白雪＋最疎 canopy／**冬ストロボ＝走る白パルス band・2.5Hz・winter のみ（spring で gate ON でも uStrobe→0.02）・既定 OFF（winter でも S 前は uStrobe=0）**／chroma（`setMode(1)`）で粒子 `uColor1`=桜 pink・雪は白維持／延長 avenue 289 本全域接地。console error 無。

## 4. ★ 次の本丸 — step 6: 季節色モード＋確定 timing 焼込

**シェーダは無編集で済む**（trees/particles とも `uMode` 後ろの chroma 分岐＋`COLOR_PALETTE`/`PARTICLE_COLOR` 配線済、`update` 内で `uMode` を `dt*4` で ease 済）。やること:
1. **`C` キー**: proto に keydown 追加 → `mode = mode?0:1`（`trees.update`/`particles.update` の3引数目に既に流れる）。~0.6s crossfade は ease で疎通済。spec の `EnvelopeFollower` 相当は ease で足りる。
2. **ControlPanel 露出**（city-proto 段階では keydown で十分、本番 SceneManager 統合時に UI へ）。`petalCount`(`{perColumn,stride}`)/`strobeRate`/各キーフレーム camera params の露出。
3. **確定 timing/keyframe を既定へ焼く**（director.tuning/camrig を目で詰めて DEFAULTS へ）。
4. **音連動は別提案**（director は名前付きセグメント＋`update(t)` 純関数なので後付け）。
5. look-tuning（任意）: `MONO_SETTLED`/`PARTICLE` の値は目で詰めて確定可（単一真実源を維持）。`fallDist`/`perColumn,stride`/`uStrobeRate` も live 調整可。

## 5. 守った線（不変条件・厳守）

- **モノクロ厳守**（既定）。白＝大学通り・富士見・旭・中央線のみ。**雪／ストロボは無彩白で許容**。色は `uMode` 後ろの opt-in のみ。虹色/グロー無し（**粒子は NormalBlending＝additive 禁止**）。
- アニメは camera/uniform 駆動（**静的 unlit・再ライティングしない**）。**instanceMatrix／canopy baked グラデ色は不変**。**粒子も GPU 駆動（`mod(uTime-aBirth,aLife)`・CPU respawn 無）**。
- **ストロボ安全**: ≤3Hz・白のみ・in/out ランプ・`S`＋`strobeEnabled` ゲート（既定 OFF・winter のみ）。
- 道路は位置・id 判定（baked、不変）。reveal/intro は道路 tier に触れない。
- iPad PWA / buildless ESM / three vendored。baked 資産（glb/manifest）不変。2D配信地図・他VJシーンは不変。

## 6. 検証コマンド

- `node --test`（全体）＝**87 green**。cityproto 群: `node --test tests/cityproto/*.test.mjs`。
- ベイク不変: `node --test tools/citybake/tests/citybake/*.test.mjs`＝**32 green**。
- preview で §3 の固定カメラ手順。画像は `:8125/shots/` URL で [[image-delivery-via-localhost]]、実物確認後に報告 [[verify-visual-before-claiming]]。

## 7. コミット状態

**step 1-5 コミット済・working tree クリーン。** step 5（本コミット）= `src/cityproto/{particles.js(新),seasons.js,trees.js,proto.js}` ＋ `tests/cityproto/{particles.test.mjs(新),seasons.test.mjs,trees.test.mjs}`。step 4=`3ef3a22`／step 1-3=`37123fe`。

## ▶ 次回キックオフ（このまま貼れる）

> 国立シティ写実WebGLレンダ Plan 3 の続き。ブランチ `feat/city-webgl-render`。**step 1-5 完了・コミット済・視覚検証済・87 tests green ＋ citybake 32 green**（step5=粒子＋冬ストロボ＋並木終点延長）。ハンドオフ `docs/superpowers/handoffs/2026-06-26-plan3-step5-particles-strobe-done-step6-chroma-next-handoff.md` と spec `docs/superpowers/specs/2026-06-25-plan3-seasonal-reveal-design.md` を読んで。次は **step 6＝季節色モード（`C` キーで mono↔chroma crossfade）＋ ControlPanel 露出＋確定 timing/keyframe 焼込**。**シェーダ無編集**（trees/particles とも `uMode` 後ろの chroma＋`COLOR_PALETTE`/`PARTICLE_COLOR` 配線済・`update` で `uMode` を `dt*4` ease 済）＝proto に `C` keydown で `mode` トグルするだけ。守る線＝モノ既定／雪・ストロボは白／再ライティングしない・instanceMatrix 不書換・粒子 GPU 駆動／ストロボ ≤3Hz・白・S＋strobeEnabled ゲート既定 OFF／iPad PWA buildless ESM。検証は §3 固定カメラ手順（director.update patch・`window.__season(i)`・冬ストロボは `setStrobe(true)` 後 ~1.3s）。画像は `:8125/shots/` URL で。
