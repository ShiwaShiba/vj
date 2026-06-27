# CityScope 第2陣 (batch 2) Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans. TDD, checkbox steps, commit per task.

**Goal:** Add two new audio→building scope modes — ①レーダーping（音履歴リングバッファの外向き進行波＝マップに巻いたオシロスコープ）と ②スペクトラムEQ（周波数帯を半径/Z ゾーンへ）— purely as functions in `scopeModes.js`, riding the batch-1 per-building scope texture untouched.

**Architecture:** Both modes are pure `(coord, frameUniforms, cfg) → scope∈[0,1]` functions. ① needs a deterministic time-driven ring buffer of audio energy, held in `state` (mutated in `frameUniforms`, exposed via `u`); a building at normalized distance `c` displays the energy from `c·sweepSec` seconds ago (traveling wave). ② reads `u.bands=[bass,mid,treble]` and quantizes `c` into 3 EQ zones. The vertex shader, `reveal.js`, and the glb/manifest are NOT touched.

**Tech Stack:** buildless ESM, three vendored, node:test (headless), CPU rasterizer for visual verify.

## Global Constraints (verbatim — 守る線)

- mono single-channel only; no hue/glow/relighting; `THREE.NormalBlending` unchanged.
- ≤3Hz strobe; deterministic — `hash01` only, **NO `Math.random`/`Date`**.
- **glb + manifest byte-unchanged** — verify `git status --short -- tools/citybake/dist/` is empty (NO rebake).
- OFF (`enabled=false` or `mix=0`) → `computeScope` fills `1` → pixel-identical to current look.
- INTRO untouched — scope only active in LIVE (`uScopeEnabled=0` until `cityScope.frame` runs in LIVE).
- No "図解" regression — audio-driven temporary modulation that vanishes at silence ≠ static per-building grey.
- Other layers untouched (terrain/landmark/station/roads/trees/particles/seasons/shotDir cam/2D map).
- Verify visual via CPU rasterizer before claiming; deliver images via `http://localhost:8125/shots/` URLs. Snow always white.

---

### Task 1: ring-buffer config + state + energy push (frameUniforms)

**Files:**
- Modify: `src/cityproto/cityScope.js` (`defaultScopeConfig`, `frameUniforms`)
- Test: `tests/cityproto/cityScope.test.mjs`

**Interfaces:**
- Produces: `frameUniforms(...)` now returns, in addition to existing fields: `hist:Float32Array`, `histHead:int`, `histDt:number`, `sweepSec:number`, `bands:[number,number,number]`. Lazily allocates `state.hist` (len `cfg.histN`), `state.histHead`, `state.acc`.
- Config gains: `histN:96, histDt:0.033, sweepSec:1.4, radarGain:1.6, radarFloor:0.2, eqGain:1.5, eqFloor:0.18`.

- [ ] **Step 1: failing test** — append to `tests/cityproto/cityScope.test.mjs`:

```js
test('frameUniforms: ring buffer fills with energy and exposes hist/bands', () => {
  const cfg = defaultScopeConfig(); cfg.histN = 8; cfg.histDt = 0.05;
  const s = initScopeState();
  // 0.2s at dt=0.05 → 4 pushes of energy(level 1, bass 1) ≈ clamp(0.7+0.6)=1
  let u;
  for (let i = 0; i < 4; i++) u = frameUniforms(feat({ level: 1, bass: 1, mid: 0.4, treble: 0.7 }), 0.05, cfg, s);
  assert.equal(u.hist.length, 8);
  assert.ok(u.hist[u.histHead] > 0.99, 'most-recent slot holds full energy');
  assert.equal(u.histDt, 0.05);
  assert.deepEqual(u.bands.map(x => +x.toFixed(2)), [1, 0.4, 0.7]);
});

test('frameUniforms: ring buffer push count is time-driven (deterministic)', () => {
  const cfg = defaultScopeConfig(); cfg.histN = 100; cfg.histDt = 0.05;
  const a = initScopeState(), b = initScopeState();
  let ua, ub;
  for (let i = 0; i < 10; i++) { ua = frameUniforms(feat({ level: 0.5, bass: 0.3 }), 0.05, cfg, a); }
  for (let i = 0; i < 10; i++) { ub = frameUniforms(feat({ level: 0.5, bass: 0.3 }), 0.05, cfg, b); }
  assert.equal(ua.histHead, ub.histHead);
  assert.deepEqual([...ua.hist], [...ub.hist]);
});
```

- [ ] **Step 2: run → fail** — `node --test tests/cityproto/cityScope.test.mjs` (hist undefined).
- [ ] **Step 3: implement** — in `defaultScopeConfig()` return object add the 7 keys above. In `frameUniforms`, after `state.clk += dt;` add lazy ring alloc + time-driven push of `energy = clamp(0.7*level + 0.6*(features.bass||0), 0, 1)` at `histDt` cadence (guard ≤512), and add `hist/histHead/histDt/sweepSec/bands` to the returned object.
- [ ] **Step 4: run → pass** + full suite `node --test`.
- [ ] **Step 5: commit** — `feat(cityproto): Plan CityScope 第2陣 step 1 — 音履歴リングバッファ(state/frameUniforms)`.

### Task 2: `sampleHistory` + `radar` mode

**Files:**
- Modify: `src/cityproto/scopeModes.js` (export `sampleHistory`, add `MODES.radar`)
- Test: `tests/cityproto/scopeModes.test.mjs`

**Interfaces:**
- Produces: `sampleHistory(hist, head, samplesBack) → number` (fractional, ring-wrapped, clamped to buffer). `MODES.radar(c, u, cfg)` reads `u.hist/u.histHead/u.histDt/cfg.sweepSec/cfg.radarGain/cfg.radarFloor`.

- [ ] **Step 1: failing test** — append to `tests/cityproto/scopeModes.test.mjs` (import `sampleHistory`):

```js
test('sampleHistory reads back from head with wrap + lerp', () => {
  const h = new Float32Array([0, 1, 2, 3]); // head=3 → most recent is 3
  assert.equal(sampleHistory(h, 3, 0), 3);
  assert.equal(sampleHistory(h, 3, 1), 2);
  assert.equal(sampleHistory(h, 3, 0.5), 2.5);
  assert.equal(sampleHistory(h, 0, 1), 3, 'wraps past index 0');
});

test('radar: near rings show recent audio, far rings show older (traveling wave)', () => {
  const cfg = defaultScopeConfig(); cfg.sweepSec = 1.0; cfg.histDt = 0.1; cfg.radarFloor = 0;
  // hist: most-recent loud, older silent → near (c~0) tall, far (c~1) short
  const hist = new Float32Array(16); const head = 5; hist[head] = 1; // newest loud only
  const u = { hist, histHead: head, histDt: 0.1, sweepSec: 1.0 };
  assert.ok(MODES.radar(0.0, u, cfg) > MODES.radar(0.9, u, cfg), 'wavefront nearer the centre');
});
```

- [ ] **Step 2: run → fail**.
- [ ] **Step 3: implement** — `export function sampleHistory(hist, head, samplesBack){...}` (clamp `samplesBack∈[0,len-1]`, floor+frac, two ring reads, lerp). `radar(c,u,cfg)`: `delay=c*cfg.sweepSec; e=sampleHistory(u.hist,u.histHead,delay/Math.max(1e-3,u.histDt)); return lerp(cfg.radarFloor,1,smooth01(e*cfg.radarGain));`
- [ ] **Step 4: run → pass** + full suite.
- [ ] **Step 5: commit** — `feat(cityproto): Plan CityScope 第2陣 step 2 — レーダーping(進行波) + sampleHistory`.

### Task 3: `eq` mode (spectrum zones)

**Files:**
- Modify: `src/cityproto/scopeModes.js` (add `MODES.eq`)
- Test: `tests/cityproto/scopeModes.test.mjs`

**Interfaces:**
- Produces: `MODES.eq(c, u, cfg)` reads `u.bands=[bass,mid,treble]`, `cfg.eqGain/cfg.eqFloor`. `c` quantized into 3 zones: `[0,1/3)`→bass, `[1/3,2/3)`→mid, `[2/3,1]`→treble.

- [ ] **Step 1: failing test**:

```js
test('eq: coord zone selects bass/mid/treble band', () => {
  const cfg = defaultScopeConfig(); cfg.eqFloor = 0; cfg.eqGain = 10; // saturate present bands
  const u = { bands: [1, 0, 0] };                 // only bass loud
  assert.ok(MODES.eq(0.1, u, cfg) > 0.9, 'inner zone follows bass');
  assert.ok(MODES.eq(0.5, u, cfg) < 0.05, 'mid zone silent');
  assert.ok(MODES.eq(0.9, u, cfg) < 0.05, 'outer zone silent');
  const u2 = { bands: [0, 0, 1] };
  assert.ok(MODES.eq(0.9, u2, cfg) > 0.9, 'outer zone follows treble');
});
```

- [ ] **Step 2: run → fail**.
- [ ] **Step 3: implement** — `eq(c,u,cfg){ const bi = c<1/3?0:(c<2/3?1:2); const e = (u.bands && u.bands[bi]) || 0; return lerp(cfg.eqFloor, 1, smooth01(e*cfg.eqGain)); }`
- [ ] **Step 4: run → pass** + full suite.
- [ ] **Step 5: commit** — `feat(cityproto): Plan CityScope 第2陣 step 3 — スペクトラムEQ(帯ゾーン)`.

### Task 4: HUD wiring (radar/eq selectable) + CPU verify

**Files:**
- Modify: `city-proto.html` (MODES/MODE_JA arrays, `sc-mo` range max 4)
- Verify: `scratchpad/scope_verify.mjs` (extend mode rows)

- [ ] **Step 1** — in `city-proto.html` SCOPE-HUD script: `MODES=['breathing','scanbar','bloom','radar','eq']`, `MODE_JA=['呼吸','走査','開花','レーダー','EQ']`; set `<input id="sc-mo" ... max="4">`.
- [ ] **Step 2** — full suite `node --test` stays green (no shader change → existing reveal test unaffected).
- [ ] **Step 3** — extend `scratchpad/scope_verify.mjs` to render radar + eq rows (drive a synthetic `frameUniforms`/hist so the wave is visible); output `shots/scope_verify_b2.png`. Inspect myself: radar = ring/stripe wavefront mono; eq = 3 distinct zones mono; terrain/roads/trees unchanged; OFF row still == current city.
- [ ] **Step 4** — verify `git status --short -- tools/citybake/dist/` empty.
- [ ] **Step 5: commit** — `feat(cityproto): Plan CityScope 第2陣 step 4 — HUDにレーダー/EQ追加`.

## 検証
1. `node --test` 全 green（batch-1 既存テスト不変）。
2. CPU ラスタ `shots/scope_verify_b2.png` を自分で確認 → ユーザーへ `:8125` URL で送付。
3. `dist/` byte 不変・OFF でピクセル一致を確認。

## 守る線（再掲）
Global Constraints セクションに同じ。**前に作ったもの（batch-1 の3モード・空間3択・HUD・reveal の `.y` 所有・他レイヤ）は一切壊さない。** shader/reveal/glb/manifest は無編集で増設する。
