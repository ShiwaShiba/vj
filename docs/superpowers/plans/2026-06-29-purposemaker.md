# PurposeMaker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new `dots` scene `PurposeMaker` where beautiful hands coalesce out of a mono turbulence field (right → left → both), hold, then dissolve — seamless loop — with the ambient turbulence driven by structure measured from the source video.

**Architecture:** Two baked assets (hand point-clouds + a video-derived turbulence profile) feed a Canvas-2D particle system. A `recruit` fraction of particles condenses onto hand targets via a clock-driven cohesion envelope; the rest stay ambient, flowing through a region wider than the viewport and bleeding off all edges. Pure logic (codec, sampler, turbulence measurement, choreography, decoders) is split into small tested modules; the Scene is the impure glue.

**Tech Stack:** ES modules, Canvas-2D, `src/lib/noise.js` (SimplexNoise), `src/lib/math.js`. Bake tools are dependency-free Node (`node:fs`, `node:zlib`). Tests: `node --test`. No new npm dependencies.

**Branch:** `feat/purposemaker-hands` (already created from `main`). Spec: `docs/superpowers/specs/2026-06-29-purposemaker-design.md`.

## Global Constraints

- **mono 厳守**: 白発光 on 純黒。`palette.fg` を唯一のインク色に使う。虹色グロー禁止。
- **白発光 on 黒・additive**: 描画は `ctx.globalCompositeOperation='lighter'`。密度＝トーン。
- **決定論**: 実行時に `Math.random` / `Date` / `performance.now` 不使用。粒子 seed はハッシュ、振付は `clock.time` 駆動、アセットは bake 済み固定。bake ツールは固定 seed の LCG（オフライン・決定論）は可。
- **`node --test` は緑のまま**（現状 ~220）。新規テストを追加、既存を壊さない。
- **新 npm 依存を追加しない**（deps/devDeps は空のまま）。
- **SW `CACHE_VERSION` の bump はデプロイ時のみ**（現 `vj-v33`）。実装中は `sw.js` を触らない。
- **二言語コミット**（JP+EN）＋フッタ `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` と `Claude-Session: https://claude.ai/code/session_01TDo59SJjRsGDawtwgz2oFi`。
- **視覚は実スクショ確認後にのみ「OK」**（最終タスクの headless 検証ゲート）。

---

## File Structure

| File | Responsibility | Pure? |
|---|---|---|
| `src/scenes/dots/pmCodec.js` | base64 ⇄ typed-array (Int16/Uint8) codec。bake と runtime 双方が使う。 | pure |
| `tools/pmbake/png.mjs` | 依存ゼロ PNG デコード（8bit gray/RGB/RGBA, filter0-4, 非interlace）＋ luminance 化。 | pure |
| `tools/pmbake/sample.mjs` | ドローイングの濃度（暗さ）に比例した重要度サンプリング → 正規化点群。 | pure |
| `tools/pmbake/turb.mjs` | フレーム群 → densityMap / flowAngle / coherence / scale / streakLen / mean / contrast を計測。 | pure |
| `tools/pmbake/bakeHands.mjs` | entrypoint: 手 fixtures を読み sample → `handTargets.data.js` を書く。 | impure |
| `tools/pmbake/extractTurb.mjs` | entrypoint: フレーム fixtures を読み turb → `turbProfile.data.js` を書く。 | impure |
| `tools/pmbake/fixtures/Hand_A.png`, `Hand_B.png` | 縮小グレースケールの bake 入力（committed）。 | data |
| `tools/pmbake/fixtures/frames/f00..f39.png` | 動画の縮小フレーム（committed）。 | data |
| `src/scenes/dots/handTargets.data.js` | 生成: `export const HANDS = {A:{n,u,v}, B:{n,u,v}}`（u,v=base64 Int16）。 | data |
| `src/scenes/dots/handTargets.js` | `decodeHandTargets()` → `{A:{n,u:Int16Array,v:Int16Array}, B:...}`。 | pure |
| `src/scenes/dots/turbProfile.data.js` | 生成: `export const TURB = {dim,density,flowAngle,coherence,scale,streakLen,mean,contrast}`。 | data |
| `src/scenes/dots/turbProfile.js` | `decodeTurbProfile()` → density:Float32Array(0..1)+スカラー。 | pure |
| `src/scenes/dots/purposeMakerChoreo.js` | `cohesionAt(time,opts)` + station スケジュール。 | pure |
| `src/scenes/dots/PurposeMaker.js` | Scene: 粒子物理（ambient + recruit）＋描画。 | impure |
| `src/scenes/registry.js` | import + `createScenes()` に登録。 | — |

Tests: `tests/dots/pmCodec.test.mjs`, `tests/dots/purposeMakerChoreo.test.mjs`, `tests/dots/handTargets.test.mjs`, `tests/dots/turbProfile.test.mjs`, `tests/dots/purposeMaker.test.mjs`, `tools/pmbake/tests/pmbake.test.mjs`.

---

## Task 1: pmCodec — base64 ⇄ typed-array codec

**Files:**
- Create: `src/scenes/dots/pmCodec.js`
- Test: `tests/dots/pmCodec.test.mjs`

**Interfaces:**
- Produces:
  - `bytesToB64(bytes: Uint8Array): string`
  - `b64ToBytes(b64: string): Uint8Array`
  - `packInt16(values: number[]|Int16Array): string` (little-endian)
  - `unpackInt16(b64: string): Int16Array`
  - `packUint8(values: number[]|Uint8Array): string`
  - `unpackUint8(b64: string): Uint8Array`

- [ ] **Step 1: Write the failing test**

`tests/dots/pmCodec.test.mjs`:
```js
import assert from 'node:assert';
import { test } from 'node:test';
import { bytesToB64, b64ToBytes, packInt16, unpackInt16, packUint8, unpackUint8 } from '../../src/scenes/dots/pmCodec.js';

test('bytes round-trip through base64', () => {
  const src = Uint8Array.from([0, 1, 2, 254, 255, 127, 128]);
  const round = b64ToBytes(bytesToB64(src));
  assert.deepStrictEqual(Array.from(round), Array.from(src));
});

test('Int16 round-trip preserves signed values', () => {
  const src = [0, -1, 32767, -32768, 1234, -4321];
  const out = unpackInt16(packInt16(src));
  assert.strictEqual(out.length, src.length);
  for (let i = 0; i < src.length; i++) assert.strictEqual(out[i], src[i]);
});

test('Uint8 round-trip', () => {
  const src = [0, 5, 200, 255];
  const out = unpackUint8(packUint8(src));
  assert.deepStrictEqual(Array.from(out), src);
});

test('large buffer does not overflow the call stack', () => {
  const big = new Uint8Array(200000);
  for (let i = 0; i < big.length; i++) big[i] = i & 255;
  const round = b64ToBytes(bytesToB64(big));
  assert.strictEqual(round.length, big.length);
  assert.strictEqual(round[199999], 199999 & 255);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/dots/pmCodec.test.mjs`
Expected: FAIL — `Cannot find module ... pmCodec.js`.

- [ ] **Step 3: Implement**

`src/scenes/dots/pmCodec.js`:
```js
// base64 ⇄ typed-array codec. Works in Node 18+ and browsers (atob/btoa globals).
// Used by the offline bake tools (encode) and the runtime decoders (decode).
const CHUNK = 0x8000; // chunk fromCharCode/charCodeAt to avoid call-stack limits

export function bytesToB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(s);
}

export function b64ToBytes(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 255;
  return out;
}

export function packInt16(values) {
  const n = values.length;
  const buf = new Uint8Array(n * 2);
  const dv = new DataView(buf.buffer);
  for (let i = 0; i < n; i++) dv.setInt16(i * 2, values[i] | 0, true);
  return bytesToB64(buf);
}

export function unpackInt16(b64) {
  const bytes = b64ToBytes(b64);
  const n = bytes.length >> 1;
  const out = new Int16Array(n);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < n; i++) out[i] = dv.getInt16(i * 2, true);
  return out;
}

export function packUint8(values) {
  return bytesToB64(values instanceof Uint8Array ? values : Uint8Array.from(values));
}

export function unpackUint8(b64) {
  return b64ToBytes(b64);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/dots/pmCodec.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/scenes/dots/pmCodec.js tests/dots/pmCodec.test.mjs
git commit -m "feat(purposemaker): pmCodec base64⇄typed-array codec / pmCodec for baked assets

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TDo59SJjRsGDawtwgz2oFi"
```

---

## Task 2: PNG decoder (dependency-free)

**Files:**
- Create: `tools/pmbake/png.mjs`
- Test: `tools/pmbake/tests/pmbake.test.mjs` (this task adds the PNG-decode tests; later tasks append more)

**Interfaces:**
- Produces:
  - `decodePng(buf: Uint8Array): { width:number, height:number, channels:number, data:Uint8Array }` — 8-bit, non-interlaced, color types 0(gray)/2(rgb)/6(rgba).
  - `toLum({width,height,channels,data}): { w:number, h:number, lum:Float32Array }` — luminance 0..255, `lum[y*w+x]`.

- [ ] **Step 1: Write the failing test**

`tools/pmbake/tests/pmbake.test.mjs`:
```js
import assert from 'node:assert';
import { test } from 'node:test';
import { deflateSync } from 'node:zlib';
import { decodePng, toLum } from '../png.mjs';

// Build a minimal 8-bit RGB PNG in-memory (filter 0 per row) so the test needs no fixture file.
function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
  }
  return (~c) >>> 0;
}
function chunk(type, data) {
  const t = Buffer.from(type, 'latin1');
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([t, data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function makeRgbPng(w, h, pixel) { // pixel(x,y)->[r,g,b]
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0; // 8-bit, RGB
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 3)] = 0; // filter none
    for (let x = 0; x < w; x++) {
      const [r, g, b] = pixel(x, y);
      const o = y * (1 + w * 3) + 1 + x * 3;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b;
    }
  }
  const idat = deflateSync(raw);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

test('decodePng reads an 8-bit RGB image with correct dims and pixels', () => {
  const png = makeRgbPng(3, 2, (x, y) => [x * 10, y * 20, 30]);
  const d = decodePng(new Uint8Array(png));
  assert.strictEqual(d.width, 3);
  assert.strictEqual(d.height, 2);
  assert.strictEqual(d.channels, 3);
  // pixel (2,1) = [20,20,30]
  const o = (1 * 3 + 2) * 3;
  assert.deepStrictEqual([d.data[o], d.data[o + 1], d.data[o + 2]], [20, 20, 30]);
});

test('toLum produces luminance 0..255 with expected length', () => {
  const png = makeRgbPng(2, 2, () => [255, 255, 255]);
  const { w, h, lum } = toLum(decodePng(new Uint8Array(png)));
  assert.strictEqual(w, 2); assert.strictEqual(h, 2); assert.strictEqual(lum.length, 4);
  for (const v of lum) assert.ok(Math.abs(v - 255) < 0.5, 'white -> ~255');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tools/pmbake/tests/pmbake.test.mjs`
Expected: FAIL — `Cannot find module ../png.mjs`.

- [ ] **Step 3: Implement**

`tools/pmbake/png.mjs`:
```js
// Minimal dependency-free PNG decoder: 8-bit, non-interlaced, color types 0/2/6.
// Enough for our committed fixtures. Not a general PNG library.
import { inflateSync } from 'node:zlib';

const CH = { 0: 1, 2: 3, 4: 2, 6: 4 }; // color type -> channels (4=gray+alpha)

export function decodePng(buf) {
  const b = Buffer.from(buf.buffer || buf, buf.byteOffset || 0, buf.byteLength || buf.length);
  if (b[0] !== 137 || b[1] !== 80 || b[2] !== 78 || b[3] !== 71) throw new Error('not a PNG');
  let p = 8, width = 0, height = 0, bitDepth = 0, colorType = 0;
  const idat = [];
  while (p < b.length) {
    const len = b.readUInt32BE(p); const type = b.toString('latin1', p + 4, p + 8);
    const data = b.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9];
      if (data[12] !== 0) throw new Error('interlaced PNG unsupported');
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  if (bitDepth !== 8) throw new Error('only 8-bit PNG supported, got ' + bitDepth);
  const channels = CH[colorType];
  if (!channels) throw new Error('unsupported color type ' + colorType);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = new Uint8Array(width * height * channels);
  const prev = new Uint8Array(stride);
  let ip = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[ip++];
    const cur = raw.subarray(ip, ip + stride); ip += stride;
    const line = out.subarray(y * stride, y * stride + stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels] : 0;
      const bb = prev[i];
      const cc = i >= channels ? prev[i - channels] : 0;
      let v = cur[i];
      switch (filter) {
        case 0: break;
        case 1: v = (v + a) & 255; break;
        case 2: v = (v + bb) & 255; break;
        case 3: v = (v + ((a + bb) >> 1)) & 255; break;
        case 4: { const pa = Math.abs(bb - cc), pb = Math.abs(a - cc), pc = Math.abs(a + bb - 2 * cc);
          const pr = pa <= pb && pa <= pc ? a : pb <= pc ? bb : cc; v = (v + pr) & 255; break; }
        default: throw new Error('bad filter ' + filter);
      }
      line[i] = v;
    }
    prev.set(line);
  }
  return { width, height, channels, data: out };
}

export function toLum({ width, height, channels, data }) {
  const lum = new Float32Array(width * height);
  for (let i = 0, j = 0; i < width * height; i++, j += channels) {
    if (channels >= 3) lum[i] = 0.299 * data[j] + 0.587 * data[j + 1] + 0.114 * data[j + 2];
    else lum[i] = data[j]; // gray or gray+alpha
  }
  return { w: width, h: height, lum };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tools/pmbake/tests/pmbake.test.mjs`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add tools/pmbake/png.mjs tools/pmbake/tests/pmbake.test.mjs
git commit -m "feat(purposemaker): dependency-free PNG decoder for bake / PNG decode

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TDo59SJjRsGDawtwgz2oFi"
```

---

## Task 3: Importance sampler (hands)

**Files:**
- Create: `tools/pmbake/sample.mjs`
- Test: `tools/pmbake/tests/pmbake.test.mjs` (append)

**Interfaces:**
- Consumes: `toLum` output shape `{ w, h, lum:Float32Array }`.
- Produces:
  - `importanceSample({ w, h, lum }, K:number, seed:number): { n:number, u:Int16Array, v:Int16Array }` — `u,v` are normalized coords in `0..32767` (`u=round(x/w*32767)`), density ∝ darkness `(paper - lum)`. Deterministic from `seed`.
  - `paperLevel(lum): number` — brightest dominant histogram bin (150..255).

- [ ] **Step 1: Write the failing test (append to pmbake.test.mjs)**
```js
import { importanceSample, paperLevel } from '../sample.mjs';

test('paperLevel finds the bright paper tone', () => {
  const lum = new Float32Array(1000).fill(240);
  for (let i = 0; i < 100; i++) lum[i] = 20; // some dark ink
  assert.ok(Math.abs(paperLevel(lum) - 240) <= 2);
});

test('importanceSample puts most points in the dark region', () => {
  // left half dark (ink), right half paper
  const w = 100, h = 40; const lum = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) lum[y * w + x] = x < w / 2 ? 30 : 240;
  const { n, u, v } = importanceSample({ w, h, lum }, 4000, 7);
  assert.ok(n > 3000, 'collected most of K');
  let left = 0;
  for (let i = 0; i < n; i++) if (u[i] < 32767 / 2) left++;
  assert.ok(left / n > 0.9, 'over 90% of points land in the dark left half');
  assert.ok(v.length === u.length);
});

test('importanceSample is deterministic for a fixed seed', () => {
  const w = 30, h = 30; const lum = new Float32Array(w * h);
  for (let i = 0; i < lum.length; i++) lum[i] = (i % 7) * 30;
  const a = importanceSample({ w, h, lum }, 500, 3);
  const b = importanceSample({ w, h, lum }, 500, 3);
  assert.deepStrictEqual(Array.from(a.u), Array.from(b.u));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tools/pmbake/tests/pmbake.test.mjs`
Expected: FAIL — `Cannot find module ../sample.mjs`.

- [ ] **Step 3: Implement**

`tools/pmbake/sample.mjs`:
```js
// Importance-sample a luminance grid into normalized points with density ∝ darkness.
// Equal-weight points: tone emerges from point DENSITY, so no per-point weight is stored.
export function paperLevel(lum) {
  const hist = new Uint32Array(256);
  for (let i = 0; i < lum.length; i++) hist[Math.max(0, Math.min(255, lum[i] | 0))]++;
  let best = 0, paper = 230;
  for (let v = 150; v < 256; v++) if (hist[v] > best) { best = hist[v]; paper = v; }
  return paper;
}

// deterministic xorshift32 from a seed
function rng(seed) {
  let s = (seed | 0) || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) / 4294967296); };
}

export function importanceSample({ w, h, lum }, K, seed) {
  const paper = paperLevel(lum);
  let maxd = 1;
  for (let i = 0; i < lum.length; i++) { const d = paper - lum[i]; if (d > maxd) maxd = d; }
  const rand = rng(seed);
  const u = new Int16Array(K), v = new Int16Array(K);
  let n = 0, guard = 0, guardMax = K * 120;
  while (n < K && guard++ < guardMax) {
    const x = (rand() * (w - 1)) | 0, y = (rand() * (h - 1)) | 0;
    const dk = Math.max(0, paper - lum[y * w + x]) / maxd;
    if (rand() < Math.pow(dk, 1.2)) {
      u[n] = Math.round((x / (w - 1)) * 32767);
      v[n] = Math.round((y / (h - 1)) * 32767);
      n++;
    }
  }
  return { n, u: u.subarray(0, n), v: v.subarray(0, n) };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tools/pmbake/tests/pmbake.test.mjs`
Expected: PASS (5 tests total).

- [ ] **Step 5: Commit**

```bash
git add tools/pmbake/sample.mjs tools/pmbake/tests/pmbake.test.mjs
git commit -m "feat(purposemaker): importance sampler (density∝darkness) / hand point sampler

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TDo59SJjRsGDawtwgz2oFi"
```

---

## Task 4: Bake hand targets → committed asset + decoder

**Files:**
- Create: `tools/pmbake/bakeHands.mjs`, `tools/pmbake/fixtures/Hand_A.png`, `tools/pmbake/fixtures/Hand_B.png`, `src/scenes/dots/handTargets.data.js` (generated), `src/scenes/dots/handTargets.js`
- Test: `tests/dots/handTargets.test.mjs`

**Interfaces:**
- Consumes: `decodePng`, `toLum` (Task 2), `importanceSample` (Task 3), `packInt16` (Task 1).
- Produces:
  - generated `handTargets.data.js`: `export const HANDS = { A:{ n:Number, u:String, v:String }, B:{ n:Number, u:String, v:String } }` (u,v = base64 Int16, values 0..32767).
  - `decodeHandTargets(): { A:{ n, u:Int16Array, v:Int16Array }, B:{ n, u:Int16Array, v:Int16Array } }` — values still 0..32767 (normalize at use with `/32767`).

- [ ] **Step 1: Create the fixtures (downscaled grayscale hands)**

Run (macOS `sips`, downscale the originals in ~/Downloads to width 1280, grayscale, into fixtures):
```bash
mkdir -p tools/pmbake/fixtures
sips -s format png -Z 1280 -m '/System/Library/ColorSync/Profiles/Generic Gray Profile.icc' \
  "/Users/shiwa/Downloads/Hand_A.png" --out tools/pmbake/fixtures/Hand_A.png
sips -s format png -Z 1280 -m '/System/Library/ColorSync/Profiles/Generic Gray Profile.icc' \
  "/Users/shiwa/Downloads/Hand_B.png" --out tools/pmbake/fixtures/Hand_B.png
file tools/pmbake/fixtures/Hand_A.png   # expect PNG, ~1280px wide
```
Expected: two PNG files ≤ ~600KB each.

- [ ] **Step 2: Write the bake entrypoint**

`tools/pmbake/bakeHands.mjs`:
```js
// Bake Hand_A/B fixtures into src/scenes/dots/handTargets.data.js (committed).
//   node tools/pmbake/bakeHands.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { decodePng, toLum } from './png.mjs';
import { importanceSample } from './sample.mjs';
import { packInt16 } from '../../src/scenes/dots/pmCodec.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, 'fixtures');
const OUT = join(HERE, '..', '..', 'src', 'scenes', 'dots', 'handTargets.data.js');
const K = 26000;

function bake(name, seed) {
  const png = decodePng(new Uint8Array(readFileSync(join(FIX, name))));
  const { n, u, v } = importanceSample(toLum(png), K, seed);
  return { n, u: packInt16(u), v: packInt16(v) };
}

const A = bake('Hand_A.png', 101);
const B = bake('Hand_B.png', 202);
const body = `// GENERATED by tools/pmbake/bakeHands.mjs — do not edit by hand.\n` +
  `export const HANDS = ${JSON.stringify({ A, B })};\n`;
writeFileSync(OUT, body);
console.log('wrote', OUT, 'A.n=', A.n, 'B.n=', B.n);
```

- [ ] **Step 3: Run the bake**

Run: `node tools/pmbake/bakeHands.mjs`
Expected: prints `A.n=` and `B.n=` near 26000 (≥ ~18000); creates `src/scenes/dots/handTargets.data.js`.

- [ ] **Step 4: Write the decoder**

`src/scenes/dots/handTargets.js`:
```js
import { HANDS } from './handTargets.data.js';
import { unpackInt16 } from './pmCodec.js';

// Decode the baked hand point-clouds. u,v are 0..32767 normalized image coords.
export function decodeHandTargets() {
  const dec = (hand) => ({ n: hand.n, u: unpackInt16(hand.u), v: unpackInt16(hand.v) });
  return { A: dec(HANDS.A), B: dec(HANDS.B) };
}
```

- [ ] **Step 5: Write the test**

`tests/dots/handTargets.test.mjs`:
```js
import assert from 'node:assert';
import { test } from 'node:test';
import { decodeHandTargets } from '../../src/scenes/dots/handTargets.js';

test('decodeHandTargets returns two non-trivial clouds in range', () => {
  const { A, B } = decodeHandTargets();
  for (const [name, c] of [['A', A], ['B', B]]) {
    assert.ok(c.n > 10000, `${name} has enough points (${c.n})`);
    assert.strictEqual(c.u.length, c.n);
    assert.strictEqual(c.v.length, c.n);
    for (let i = 0; i < c.n; i += 137) {
      assert.ok(c.u[i] >= 0 && c.u[i] <= 32767, `${name}.u in range`);
      assert.ok(c.v[i] >= 0 && c.v[i] <= 32767, `${name}.v in range`);
    }
  }
});

test('A (right-entering) has its arm-root ink toward the right, B toward the left', () => {
  // arm root = denser column band. Compare mean u of each cloud.
  const { A, B } = decodeHandTargets();
  const meanU = (c) => { let s = 0; for (let i = 0; i < c.n; i++) s += c.u[i]; return s / c.n / 32767; };
  assert.ok(meanU(A) > meanU(B), 'A skews right of B');
});
```

- [ ] **Step 6: Run the test**

Run: `node --test tests/dots/handTargets.test.mjs`
Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add tools/pmbake/bakeHands.mjs tools/pmbake/fixtures/Hand_A.png tools/pmbake/fixtures/Hand_B.png \
  src/scenes/dots/handTargets.data.js src/scenes/dots/handTargets.js tests/dots/handTargets.test.mjs
git commit -m "feat(purposemaker): bake hand target point-clouds / handTargets asset+decoder

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TDo59SJjRsGDawtwgz2oFi"
```

---

## Task 5: Turbulence measurement (pure)

**Files:**
- Create: `tools/pmbake/turb.mjs`
- Test: `tools/pmbake/tests/pmbake.test.mjs` (append)

**Interfaces:**
- Consumes: frames as `Array<{ w, h, lum:Float32Array }>` (from `toLum`).
- Produces:
  - `measureTurb(frames, dim=64): { dim, density:Uint8Array, flowAngle:Number, coherence:Number, scale:Number, streakLen:Number, mean:Number, contrast:Number }`
    - `density`: `dim*dim` Uint8 (0..255), per-cell mean luminance across frames, corners masked.
    - `flowAngle`: radians, signed dominant flow direction (from brightness-centroid drift across frames).
    - `coherence`: 0..1 anisotropy from the structure tensor (1 = strongly directional).
    - `scale`: characteristic filament length as a fraction of frame size (autocorrelation 1/e width).
    - `streakLen`: mean per-frame centroid displacement as a fraction of frame size.
    - `mean`, `contrast`: normalized luminance mean and (p95-p50)/255.
  - Helpers (exported for tests): `downsample(frame, dim): Float32Array`, `structureTensor(grid, dim): { angle, coherence }`, `centroidDrift(frames): { angle, streak }`.

- [ ] **Step 1: Write the failing test (append)**
```js
import { measureTurb, structureTensor, centroidDrift, downsample } from '../turb.mjs';

function frame(w, h, fn) { const lum = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) lum[y * w + x] = fn(x, y); return { w, h, lum }; }

test('downsample averages into a dim×dim grid', () => {
  const f = frame(64, 64, () => 128);
  const g = downsample(f, 8);
  assert.strictEqual(g.length, 64);
  for (const v of g) assert.ok(Math.abs(v - 128) < 1e-3);
});

test('structureTensor reports high coherence for vertical stripes and ~0 for flat', () => {
  const dim = 32;
  const stripes = new Float32Array(dim * dim);
  for (let y = 0; y < dim; y++) for (let x = 0; x < dim; x++) stripes[y * dim + x] = (x % 4 < 2) ? 255 : 0;
  const st = structureTensor(stripes, dim);
  assert.ok(st.coherence > 0.5, 'stripes are directional');
  const flat = new Float32Array(dim * dim).fill(120);
  assert.ok(structureTensor(flat, dim).coherence < 0.2, 'flat is isotropic');
});

test('centroidDrift detects rightward motion', () => {
  const w = 40, h = 40; const frames = [];
  for (let t = 0; t < 6; t++) frames.push(frame(w, h, (x, y) => {
    const cx = 8 + t * 4; return Math.exp(-((x - cx) ** 2 + (y - 20) ** 2) / 30) * 255; }));
  const { angle, streak } = centroidDrift(frames);
  assert.ok(Math.abs(angle) < 0.4, 'near-horizontal (cos~1)'); // rightward ≈ angle 0
  assert.ok(streak > 0, 'positive displacement');
});

test('measureTurb returns a full profile with masked corners and valid ranges', () => {
  const w = 48, h = 48; const frames = [];
  for (let t = 0; t < 5; t++) frames.push(frame(w, h, (x, y) =>
    Math.exp(-((x - 24) ** 2 + (y - 24) ** 2) / 200) * 200));
  const p = measureTurb(frames, 16);
  assert.strictEqual(p.density.length, 16 * 16);
  assert.ok(p.coherence >= 0 && p.coherence <= 1);
  assert.ok(p.scale > 0 && p.scale < 1);
  assert.ok(p.mean >= 0 && p.mean <= 1);
  assert.ok(Number.isFinite(p.flowAngle));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tools/pmbake/tests/pmbake.test.mjs`
Expected: FAIL — `Cannot find module ../turb.mjs`.

- [ ] **Step 3: Implement**

`tools/pmbake/turb.mjs`:
```js
// Measure turbulence structure from video frames (all grayscale, same w×h).
// Pure: same frames -> same profile. No Date/random.

export function downsample(frame, dim) {
  const { w, h, lum } = frame;
  const g = new Float32Array(dim * dim);
  for (let gy = 0; gy < dim; gy++) {
    const y0 = (gy * h / dim) | 0, y1 = Math.max(y0 + 1, ((gy + 1) * h / dim) | 0);
    for (let gx = 0; gx < dim; gx++) {
      const x0 = (gx * w / dim) | 0, x1 = Math.max(x0 + 1, ((gx + 1) * w / dim) | 0);
      let s = 0, c = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { s += lum[y * w + x]; c++; }
      g[gy * dim + gx] = s / c;
    }
  }
  return g;
}

export function structureTensor(grid, dim) {
  let Jxx = 0, Jyy = 0, Jxy = 0;
  for (let y = 1; y < dim - 1; y++) for (let x = 1; x < dim - 1; x++) {
    const gx = grid[y * dim + x + 1] - grid[y * dim + x - 1];
    const gy = grid[(y + 1) * dim + x] - grid[(y - 1) * dim + x];
    Jxx += gx * gx; Jyy += gy * gy; Jxy += gx * gy;
  }
  const tr = Jxx + Jyy;
  const diff = Math.sqrt((Jxx - Jyy) * (Jxx - Jyy) + 4 * Jxy * Jxy);
  const l1 = (tr + diff) / 2, l2 = (tr - diff) / 2;
  const coherence = tr > 1e-6 ? (l1 - l2) / (l1 + l2) : 0;
  // gradient orientation; filaments run perpendicular (+90°)
  const gradAngle = 0.5 * Math.atan2(2 * Jxy, Jxx - Jyy);
  return { angle: gradAngle + Math.PI / 2, coherence };
}

export function centroidDrift(frames) {
  const cs = frames.map((f) => {
    const { w, h, lum } = f; let sx = 0, sy = 0, s = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const L = lum[y * w + x]; sx += x * L; sy += y * L; s += L; }
    return s > 1e-6 ? { x: sx / s, y: sy / s, w, h } : { x: w / 2, y: h / 2, w, h };
  });
  let dx = 0, dy = 0, d = 0;
  for (let i = 1; i < cs.length; i++) { dx += cs[i].x - cs[i - 1].x; dy += cs[i].y - cs[i - 1].y; d += Math.hypot(cs[i].x - cs[i - 1].x, cs[i].y - cs[i - 1].y); }
  const n = Math.max(1, cs.length - 1);
  const W = frames[0].w;
  // image y is down; flip to math-up so angle 0 = +x (right), positive = up
  const angle = Math.atan2(-dy / n, dx / n);
  return { angle, streak: (d / n) / W };
}

function autocorrScale(grid, dim) {
  // mean over rows of horizontal autocorrelation; find lag where it drops to 1/e
  let m = 0; for (const v of grid) m += v; m /= grid.length;
  const c0 = (() => { let s = 0; for (const v of grid) s += (v - m) * (v - m); return s / grid.length || 1; })();
  for (let lag = 1; lag < dim; lag++) {
    let s = 0, cnt = 0;
    for (let y = 0; y < dim; y++) for (let x = 0; x + lag < dim; x++) { s += (grid[y * dim + x] - m) * (grid[y * dim + x + lag] - m); cnt++; }
    const c = (s / cnt) / c0;
    if (c < Math.exp(-1)) return lag / dim;
  }
  return 0.5;
}

function maskCorners(density, dim) {
  // neutralize IG-UI corner marks: set a corner block to the global median
  const sorted = Float32Array.from(density).sort();
  const med = sorted[sorted.length >> 1];
  const b = Math.max(1, (dim * 0.12) | 0);
  for (let y = 0; y < dim; y++) for (let x = 0; x < dim; x++) {
    const corner = (x < b || x >= dim - b) && (y < b || y >= dim - b);
    if (corner) density[y * dim + x] = med;
  }
}

export function measureTurb(frames, dim = 64) {
  const grids = frames.map((f) => downsample(f, dim));
  // mean density map
  const dens = new Float32Array(dim * dim);
  for (const g of grids) for (let i = 0; i < g.length; i++) dens[i] += g[i];
  for (let i = 0; i < dens.length; i++) dens[i] /= grids.length;
  maskCorners(dens, dim);
  let lo = Infinity, hi = -Infinity;
  for (const v of dens) { if (v < lo) lo = v; if (v > hi) hi = v; }
  const span = hi - lo || 1;
  const density = new Uint8Array(dim * dim);
  for (let i = 0; i < dens.length; i++) density[i] = Math.round(((dens[i] - lo) / span) * 255);
  // direction & anisotropy from a late, well-developed frame's grid
  const late = grids[grids.length - 1];
  const st = structureTensor(late, dim);
  const drift = centroidDrift(frames);
  // prefer signed drift direction when motion is meaningful, else tensor axis
  const flowAngle = drift.streak > 0.002 ? drift.angle : st.angle;
  // luminance stats (0..1)
  let sum = 0, cnt = 0; const vals = [];
  for (const g of grids) for (const v of g) { sum += v; cnt++; vals.push(v); }
  vals.sort((a, b) => a - b);
  const mean = sum / cnt / 255;
  const p50 = vals[(vals.length * 0.5) | 0], p95 = vals[(vals.length * 0.95) | 0];
  return {
    dim, density,
    flowAngle, coherence: st.coherence,
    scale: autocorrScale(late, dim),
    streakLen: drift.streak,
    mean, contrast: Math.max(0, (p95 - p50) / 255),
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tools/pmbake/tests/pmbake.test.mjs`
Expected: PASS (9 tests total).

- [ ] **Step 5: Commit**

```bash
git add tools/pmbake/turb.mjs tools/pmbake/tests/pmbake.test.mjs
git commit -m "feat(purposemaker): video turbulence measurement (density/flow/scale) / turb.mjs

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TDo59SJjRsGDawtwgz2oFi"
```

---

## Task 6: Extract turbulence profile → committed asset + decoder

**Files:**
- Create: `tools/pmbake/extractFrames.mjs` (one-time frame extractor), `tools/pmbake/extractTurb.mjs`, `tools/pmbake/fixtures/frames/f00..f39.png`, `src/scenes/dots/turbProfile.data.js` (generated), `src/scenes/dots/turbProfile.js`
- Test: `tests/dots/turbProfile.test.mjs`

**Interfaces:**
- Consumes: `decodePng`, `toLum`, `measureTurb`, `packUint8`.
- Produces:
  - generated `turbProfile.data.js`: `export const TURB = { dim, density:String(b64 Uint8), flowAngle, coherence, scale, streakLen, mean, contrast }`.
  - `decodeTurbProfile(): { dim, density:Float32Array(0..1), flowAngle, coherence, scale, streakLen, mean, contrast }`.

- [ ] **Step 1: Create the frame fixtures from the .mov (macOS, AVFoundation via swift)**

Create `tools/pmbake/extractFrames.mjs` is not viable in pure Node; use this committed helper script `tools/pmbake/extractFrames.swift` and run it once:
```bash
mkdir -p tools/pmbake/fixtures/frames
cat > tools/pmbake/extractFrames.swift <<'SWIFT'
import AVFoundation
import AppKit
let path = CommandLine.arguments[1]
let outdir = CommandLine.arguments[2]
let asset = AVURLAsset(url: URL(fileURLWithPath: path))
let dur = CMTimeGetSeconds(asset.duration)
let gen = AVAssetImageGenerator(asset: asset)
gen.appliesPreferredTrackTransform = true
gen.requestedTimeToleranceBefore = .zero; gen.requestedTimeToleranceAfter = .zero
gen.maximumSize = CGSize(width: 256, height: 256)   // small fixtures
let N = 40
for i in 0..<N {
  let t = dur * Double(i) / Double(N - 1)
  let ct = CMTime(seconds: max(0, min(dur - 0.01, t)), preferredTimescale: 600)
  if let cg = try? gen.copyCGImage(at: ct, actualTime: nil) {
    let rep = NSBitmapImageRep(cgImage: cg)
    let png = rep.representation(using: .png, properties: [:])!
    try! png.write(to: URL(fileURLWithPath: String(format: "%@/f%02d.png", outdir, i)))
  }
}
print("wrote \(N) frames")
SWIFT
swift tools/pmbake/extractFrames.swift "/Users/shiwa/Downloads/ScreenRecording_06-29-2026 20-42-47_1.mov" tools/pmbake/fixtures/frames
ls tools/pmbake/fixtures/frames | wc -l   # expect 40
```
Expected: 40 small PNG frames (~256px) committed under fixtures/frames.

- [ ] **Step 2: Write the extract entrypoint**

`tools/pmbake/extractTurb.mjs`:
```js
// Bake the turbulence profile from committed frame fixtures into turbProfile.data.js.
//   node tools/pmbake/extractTurb.mjs
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { decodePng, toLum } from './png.mjs';
import { measureTurb } from './turb.mjs';
import { packUint8 } from '../../src/scenes/dots/pmCodec.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FRAMES = join(HERE, 'fixtures', 'frames');
const OUT = join(HERE, '..', '..', 'src', 'scenes', 'dots', 'turbProfile.data.js');

const files = readdirSync(FRAMES).filter((f) => f.endsWith('.png')).sort();
const frames = files.map((f) => toLum(decodePng(new Uint8Array(readFileSync(join(FRAMES, f))))));
const p = measureTurb(frames, 64);
const data = {
  dim: p.dim, density: packUint8(p.density),
  flowAngle: +p.flowAngle.toFixed(5), coherence: +p.coherence.toFixed(4),
  scale: +p.scale.toFixed(4), streakLen: +p.streakLen.toFixed(4),
  mean: +p.mean.toFixed(4), contrast: +p.contrast.toFixed(4),
};
writeFileSync(OUT, `// GENERATED by tools/pmbake/extractTurb.mjs — do not edit by hand.\nexport const TURB = ${JSON.stringify(data)};\n`);
console.log('wrote', OUT, 'flowAngle=', data.flowAngle, 'coherence=', data.coherence, 'scale=', data.scale);
```

- [ ] **Step 3: Run the extract**

Run: `node tools/pmbake/extractTurb.mjs`
Expected: prints flowAngle/coherence/scale; creates `src/scenes/dots/turbProfile.data.js`.

- [ ] **Step 4: Write the decoder**

`src/scenes/dots/turbProfile.js`:
```js
import { TURB } from './turbProfile.data.js';
import { unpackUint8 } from './pmCodec.js';

// Decode the baked video turbulence profile. density is dim*dim, normalized 0..1.
export function decodeTurbProfile() {
  const bytes = unpackUint8(TURB.density);
  const density = new Float32Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) density[i] = bytes[i] / 255;
  return {
    dim: TURB.dim, density,
    flowAngle: TURB.flowAngle, coherence: TURB.coherence,
    scale: TURB.scale, streakLen: TURB.streakLen,
    mean: TURB.mean, contrast: TURB.contrast,
  };
}
```

- [ ] **Step 5: Write the test**

`tests/dots/turbProfile.test.mjs`:
```js
import assert from 'node:assert';
import { test } from 'node:test';
import { decodeTurbProfile } from '../../src/scenes/dots/turbProfile.js';

test('decodeTurbProfile returns a valid density map and scalars', () => {
  const p = decodeTurbProfile();
  assert.ok(p.dim >= 16, 'has a grid');
  assert.strictEqual(p.density.length, p.dim * p.dim);
  let lo = Infinity, hi = -Infinity;
  for (const v of p.density) { assert.ok(v >= 0 && v <= 1); if (v < lo) lo = v; if (v > hi) hi = v; }
  assert.ok(hi > lo, 'density has contrast (not all one value)');
  assert.ok(Number.isFinite(p.flowAngle));
  assert.ok(p.coherence >= 0 && p.coherence <= 1);
  assert.ok(p.scale > 0 && p.scale < 1);
});
```

- [ ] **Step 6: Run the test**

Run: `node --test tests/dots/turbProfile.test.mjs`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add tools/pmbake/extractFrames.swift tools/pmbake/extractTurb.mjs tools/pmbake/fixtures/frames \
  src/scenes/dots/turbProfile.data.js src/scenes/dots/turbProfile.js tests/dots/turbProfile.test.mjs
git commit -m "feat(purposemaker): bake video turbulence profile / turbProfile asset+decoder

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TDo59SJjRsGDawtwgz2oFi"
```

---

## Task 7: Choreography (pure cohesion envelope)

**Files:**
- Create: `src/scenes/dots/purposeMakerChoreo.js`
- Test: `tests/dots/purposeMakerChoreo.test.mjs`

**Interfaces:**
- Produces:
  - `DURATIONS = { gather:2.6, hold:2.4, disperse:2.2, gap:0.5 }` and `STATION = 7.7` (sum), `CYCLE = 23.1`.
  - `STATION_SEQ = ['R','L','Both']`.
  - `cohesionAt(time:number, opts?:{pace?:number}): { station:'R'|'L'|'Both', cR:number, cL:number, phase:'gather'|'hold'|'disperse'|'gap' }`.
  - `smoother(t:number): number` (smootherstep, endpoints/derivatives 0).

- [ ] **Step 1: Write the failing test**

`tests/dots/purposeMakerChoreo.test.mjs`:
```js
import assert from 'node:assert';
import { test } from 'node:test';
import { cohesionAt, smoother, CYCLE, STATION } from '../../src/scenes/dots/purposeMakerChoreo.js';

test('smoother pins endpoints with zero slope', () => {
  assert.strictEqual(smoother(0), 0);
  assert.strictEqual(smoother(1), 1);
  assert.ok(smoother(0.01) < 0.001, 'slow start');
});

test('station R holds full cohesion at its hold midpoint, B stays 0', () => {
  const s = cohesionAt(2.6 + 1.2); // R gather(2.6)+half hold
  assert.strictEqual(s.station, 'R');
  assert.ok(s.cR > 0.99 && s.phase === 'hold');
  assert.strictEqual(s.cL, 0);
});

test('sequence is R -> L -> Both across one cycle', () => {
  assert.strictEqual(cohesionAt(3.8).station, 'R');
  assert.strictEqual(cohesionAt(STATION + 3.8).station, 'L');
  assert.strictEqual(cohesionAt(2 * STATION + 3.8).station, 'Both');
  assert.ok(cohesionAt(2 * STATION + 3.8).cR > 0.99 && cohesionAt(2 * STATION + 3.8).cL > 0.99);
});

test('gap returns zero cohesion (hand fully dissolved)', () => {
  const s = cohesionAt(7.45); // R disperse ends 7.2, gap to 7.7
  assert.strictEqual(s.phase, 'gap');
  assert.ok(s.cR < 1e-6 && s.cL < 1e-6);
});

test('seamless: cohesion is continuous and returns to 0 at every station boundary', () => {
  for (let k = 0; k < 3; k++) {
    const b = k * STATION; // boundary
    const before = cohesionAt(b - 0.001), after = cohesionAt(b + 0.001);
    assert.ok(Math.abs(before.cR) < 1e-3 && Math.abs(before.cL) < 1e-3, 'cohesion 0 just before boundary');
    assert.ok(Math.abs(after.cR) < 1e-3 && Math.abs(after.cL) < 1e-3, 'cohesion 0 just after boundary');
  }
});

test('deterministic and loops with the cycle period', () => {
  assert.deepStrictEqual(cohesionAt(5.123), cohesionAt(5.123));
  assert.deepStrictEqual(cohesionAt(1.0), cohesionAt(1.0 + CYCLE));
});

test('pace scales durations (pace=2 stretches time by 2x)', () => {
  const a = cohesionAt(3.8, { pace: 1 });
  const b = cohesionAt(7.6, { pace: 2 });
  assert.strictEqual(a.station, b.station);
  assert.ok(Math.abs(a.cR - b.cR) < 1e-9);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/dots/purposeMakerChoreo.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/scenes/dots/purposeMakerChoreo.js`:
```js
// Pure, deterministic choreography for PurposeMaker. No Date/random.
// One station = gather -> hold -> disperse -> gap. Sequence R -> L -> Both, looping.
// Seamless: cohesion is 0 with zero slope at every station boundary (gap before next gather).
export const DURATIONS = { gather: 2.6, hold: 2.4, disperse: 2.2, gap: 0.5 };
export const STATION = DURATIONS.gather + DURATIONS.hold + DURATIONS.disperse + DURATIONS.gap; // 7.7
export const STATION_SEQ = ['R', 'L', 'Both'];
export const CYCLE = STATION * STATION_SEQ.length; // 23.1

export function smoother(t) {
  if (t <= 0) return 0; if (t >= 1) return 1;
  return t * t * t * (t * (t * 6 - 15) + 10);
}

// local cohesion 0..1 over one station's local time
function localCohesion(local) {
  const { gather, hold, disperse } = DURATIONS;
  if (local < gather) return { c: smoother(local / gather), phase: 'gather' };
  if (local < gather + hold) return { c: 1, phase: 'hold' };
  if (local < gather + hold + disperse) return { c: 1 - smoother((local - gather - hold) / disperse), phase: 'disperse' };
  return { c: 0, phase: 'gap' };
}

export function cohesionAt(time, opts) {
  const pace = (opts && opts.pace) || 1;
  const T = time / pace;
  let t = T % CYCLE; if (t < 0) t += CYCLE;
  const idx = Math.min(STATION_SEQ.length - 1, (t / STATION) | 0);
  const station = STATION_SEQ[idx];
  const { c, phase } = localCohesion(t - idx * STATION);
  const cR = station === 'L' ? 0 : c;
  const cL = station === 'R' ? 0 : c;
  return { station, cR, cL, phase };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/dots/purposeMakerChoreo.test.mjs`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/scenes/dots/purposeMakerChoreo.js tests/dots/purposeMakerChoreo.test.mjs
git commit -m "feat(purposemaker): seamless cohesion choreography (R→L→Both) / choreo

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TDo59SJjRsGDawtwgz2oFi"
```

---

## Task 8: PurposeMaker Scene + registry

**Files:**
- Create: `src/scenes/dots/PurposeMaker.js`
- Modify: `src/scenes/registry.js`
- Test: `tests/dots/purposeMaker.test.mjs`

**Interfaces:**
- Consumes: `Scene` base (`src/scenes/Scene.js`: `defineParam(key,value,min,max,step,label)`, `p(key)`, `mg(key)`, `this.modes`, `this.modeGroups`, `this.modeIndex`, `this.trail`, `init(ctx,w,h)`, `this.w/h`, `this.palette`); `SimplexNoise` (`src/lib/noise.js`); `decodeHandTargets`, `decodeTurbProfile`, `cohesionAt`.
- Produces: `class PurposeMaker extends Scene` with `super('purposeMaker','PurposeMaker')`.

> **Note on the Scene base:** confirm the SimplexNoise import + `palette.fg` shape by reading `src/scenes/dots/FlowField.js` first — this Scene mirrors its hashing, projection and depth-band stroke patterns.

- [ ] **Step 1: Write the failing test**

`tests/dots/purposeMaker.test.mjs`:
```js
import assert from 'node:assert';
import { test } from 'node:test';
import { PurposeMaker } from '../../src/scenes/dots/PurposeMaker.js';

// Minimal mock 2D context: records nothing, just satisfies the calls draw() makes.
function mockCtx() {
  return new Proxy({}, { get: (_t, k) => (k === 'canvas' ? { width: 800, height: 800 } : () => {}) });
}
const audio = { level: 0.3, bass: 0.2, treble: 0.1, beat: false, beatHold: 0 };
const clock = { time: 0, beats: 0, beatPhase: 0, quality: 1 };

test('constructs with id, params, and four station modes', () => {
  const s = new PurposeMaker();
  assert.strictEqual(s.id, 'purposeMaker');
  assert.deepStrictEqual(s.modes.map((m) => m.name), ['Cycle', 'Right', 'Left', 'Both']);
  for (const key of ['count', 'recruit', 'flow', 'scale', 'cohesion', 'thread', 'react', 'pace'])
    assert.ok(s.p(key) !== undefined, `param ${key} defined`);
});

test('update advances particles without producing NaN over many frames', () => {
  const s = new PurposeMaker();
  s.init(mockCtx(), 800, 800);
  s.palette = { fg: [240, 240, 240], bg: [0, 0, 0] };
  for (let f = 0; f < 120; f++) { clock.time = f / 60; s.update(1 / 60, audio, s.palette, clock); }
  let checked = 0;
  for (let i = 0; i < s.n; i += 200) { assert.ok(Number.isFinite(s.X[i]) && Number.isFinite(s.Y[i])); checked++; }
  assert.ok(checked > 0);
});

test('draw runs against a mock context without throwing', () => {
  const s = new PurposeMaker();
  s.init(mockCtx(), 800, 800);
  s.palette = { fg: [240, 240, 240], bg: [0, 0, 0] };
  clock.time = 3.8; s.update(1 / 60, audio, s.palette, clock);
  assert.doesNotThrow(() => s.draw(mockCtx(), 1));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/dots/purposeMaker.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the Scene**

`src/scenes/dots/PurposeMaker.js`:
```js
import { Scene } from '../Scene.js';
import { TWO_PI } from '../../lib/math.js';
import { SimplexNoise } from '../../lib/noise.js';
import { decodeHandTargets } from './handTargets.js';
import { decodeTurbProfile } from './turbProfile.js';
import { cohesionAt, smoother } from './purposeMakerChoreo.js';

// PurposeMaker — hands coalesce out of a video-derived turbulence field (R→L→Both),
// hold, then dissolve, seamlessly. A `recruit` fraction of particles condenses onto
// the baked hand point-clouds; the rest stay ambient, flowing through a region wider
// than the viewport and bleeding off all edges. mono, additive, deterministic.
const MAXN = 44000;
const SIMX = 1.6, SIMY = 1.2;   // sim half-extent (viewport shows ±1.0) -> off-frame bleed
const TILT = 0.06;              // tiny fixed tilt for life (hands stay readable)
const BANDS = 6;

export class PurposeMaker extends Scene {
  constructor() {
    super('purposeMaker', 'PurposeMaker');
    this.trail = 0.16;
    this.modes = [{ name: 'Cycle' }, { name: 'Right' }, { name: 'Left' }, { name: 'Both' }];
    this.modeGroups = [{ key: 'audio', label: 'Audio', options: ['OFF', 'ON'], index: 1 }];
    this.defineParam('count', 34000, 10000, MAXN, 1000, 'Particles');
    this.defineParam('recruit', 0.65, 0.3, 0.9, 0.05, 'Recruit');
    this.defineParam('flow', 0.5, 0.1, 1.5, 0.05, 'Flow Speed');
    this.defineParam('scale', 1.6, 0.6, 3.2, 0.1, 'Field Scale');
    this.defineParam('cohesion', 1.0, 0.3, 2.0, 0.1, 'Cohesion');
    this.defineParam('thread', 0.9, 0.4, 2.0, 0.1, 'Thread');
    this.defineParam('react', 2.0, 0, 6, 0.5, 'React');
    this.defineParam('pace', 1.0, 0.4, 2.0, 0.1, 'Pace');
    this.noise = new SimplexNoise(11);
    this.X = this.Y = this.Z = this.PX = this.PY = this.PZ = null;
    this.sx = this.sy = this.psx = this.psy = this.sval = this.sband = null;
    this.n = 0; this.t = 0; this.level = 0; this.bass = 0;
    this.hands = null; this.turb = null;
  }

  init(ctx, w, h) {
    super.init(ctx, w, h);
    this.hands = decodeHandTargets();
    this.turb = decodeTurbProfile();
    this._alloc();
    this._seedAll();
  }
  onResize(w, h) { super.onResize(w, h); } // normalized coords — no respawn

  _alloc() {
    if (this.X) return;
    const F = () => new Float32Array(MAXN);
    this.X = F(); this.Y = F(); this.Z = F(); this.PX = F(); this.PY = F(); this.PZ = F();
    this.sx = F(); this.sy = F(); this.psx = F(); this.psy = F();
    this.sval = new Uint8Array(MAXN); this.sband = new Uint8Array(MAXN);
  }
  // deterministic hash -> [0,1)
  _h(n) {
    n = (n | 0) ^ 0x9e3779b9;
    n = Math.imul(n ^ (n >>> 16), 0x21f0aaad);
    n = Math.imul(n ^ (n >>> 15), 0x735a2d97);
    return ((n ^ (n >>> 15)) >>> 0) / 4294967296;
  }
  // sample an ambient spawn position weighted by the video density map; bias inflow side
  _ambientPos(i, fromEdge) {
    const d = this.turb, dim = d.dim;
    // rejection-sample a cell by density, deterministic per (i, attempt)
    let gx = 0, gy = 0;
    for (let a = 0; a < 24; a++) {
      const rx = this._h(i * 7 + a * 131 + 1), ry = this._h(i * 7 + a * 131 + 2), rp = this._h(i * 7 + a * 131 + 3);
      gx = (rx * dim) | 0; gy = (ry * dim) | 0;
      if (rp < 0.15 + 0.85 * d.density[gy * dim + gx]) break;
    }
    // map grid (0..1) to sim space (wider than viewport)
    let x = (gx / dim) * 2 * SIMX - SIMX;
    let y = (gy / dim) * 2 * SIMY - SIMY;
    if (fromEdge) { // reseed on the inflow edge so flow is continuous
      const ang = this.turb.flowAngle;
      x = -Math.cos(ang) * SIMX; y = Math.sin(ang) * SIMY * 0.6 + (this._h(i * 13 + 9) - 0.5) * SIMY;
    }
    return { x, y, z: this._h(i * 17 + 5) * 2 - 1 };
  }
  _seedAll() {
    const N = MAXN;
    for (let i = 0; i < N; i++) {
      const p = this._ambientPos(i, false);
      this.X[i] = this.PX[i] = p.x; this.Y[i] = this.PY[i] = p.y; this.Z[i] = this.PZ[i] = p.z;
    }
  }
  // hand target (world) for a recruited particle i in the active station
  _targetFor(i, station) {
    const H = this.hands;
    let hand, cloud;
    if (station === 'R') { hand = 'A'; cloud = H.A; }
    else if (station === 'L') { hand = 'B'; cloud = H.B; }
    else { hand = this._h(i * 3 + 1) < 0.5 ? 'A' : 'B'; cloud = hand === 'A' ? H.A : H.B; }
    const idx = ((i / 1) | 0) % cloud.n;
    const u = cloud.u[idx] / 32767, v = cloud.v[idx] / 32767;
    // station placement (matches spec): spanX 1.3, spanY 1.0
    let tx, ty = (0.5 - v) * 1.0;
    if (hand === 'A') tx = -0.3 + 1.3 * u; else tx = -1.0 + 1.3 * u;
    if (station === 'Both') ty += hand === 'A' ? 0.12 : -0.12;
    return { tx, ty, tz: 0 };
  }

  update(dt, audio, palette, clock) {
    this.t = clock.time; this.level = audio.level; this.bass = audio.bass;
    const q = clock.quality || 1;
    const n = this.n = Math.min(MAXN, Math.round(this.p('count') * q));
    const recruit = this.p('recruit');
    const audioOn = this.mg('audio') === 1;
    const react = audioOn ? this.p('react') : 0;
    // station: Cycle = auto choreography; else lock to that station at full cohesion
    const mi = this.modeIndex;
    let st;
    if (mi === 0) st = cohesionAt(this.t, { pace: this.p('pace') });
    else { const map = [null, 'R', 'L', 'Both']; const s = map[mi]; st = { station: s, cR: s !== 'L' ? 1 : 0, cL: s !== 'R' ? 1 : 0, phase: 'hold' }; }
    // video-derived field params
    const baseFreq = this.turb.scale > 0.001 ? (0.9 / this.turb.scale) : 1.6;
    const f = baseFreq * (this.p('scale') / 1.6);
    const fa = this.turb.flowAngle, fcos = Math.cos(fa), fsin = Math.sin(fa);
    const drift = (0.15 + 0.6 * this.turb.coherence);
    const sp = this.p('flow') * (1 + react * 0.25 * (this.level + this.bass)) * dt;
    const zt = this.t * 0.05;
    const cohK = this.p('cohesion') * 8.0;
    const noise = this.noise;
    for (let i = 0; i < n; i++) {
      this.PX[i] = this.X[i]; this.PY[i] = this.Y[i]; this.PZ[i] = this.Z[i];
      const x = this.X[i], y = this.Y[i], z = this.Z[i];
      // video-driven turbulent velocity: simplex field + mean drift along measured flow
      let vx = noise.noise3D(x * f, y * f, z * f + zt) + fcos * drift;
      let vy = noise.noise3D(x * f + 5.2, y * f + 9.1, z * f + zt + 2.3) - fsin * drift;
      let vz = noise.noise3D(x * f + 2.7, y * f + 4.4, z * f + zt + 7.8);
      const hi = this._h(i * 7 + 99);
      const isHand = hi < recruit;
      let cc = 0;
      if (isHand) {
        const which = st.station === 'L' ? st.cL : st.station === 'R' ? st.cR
          : (this._h(i * 3 + 1) < 0.5 ? st.cR : st.cL);
        cc = smoother(which);
      }
      if (isHand && cc > 0.001) {
        const tgt = this._targetFor(i, st.station);
        const pullx = (tgt.tx - x), pully = (tgt.ty - y), pullz = (tgt.tz - z);
        // blend turbulence -> pull by cohesion; hold quiver keeps it alive
        const qv = cc > 0.6 ? 0.012 * Math.sin(this.t * 18 + hi * TWO_PI) : 0;
        vx = vx * sp * (1 - cc) + (pullx * cohK + qv) * cc * dt;
        vy = vy * sp * (1 - cc) + (pully * cohK) * cc * dt;
        vz = vz * sp * (1 - cc) + (pullz * cohK) * cc * dt;
      } else {
        vx *= sp; vy *= sp; vz *= sp;
      }
      let nx = x + vx, ny = y + vy, nz = z + vz;
      // edge reseed: ambient (and released hand) particles that leave the sim box
      // re-enter on the inflow edge -> continuous off-frame flow
      if (cc < 0.02 && (nx < -SIMX || nx > SIMX || ny < -SIMY || ny > SIMY || nz < -1.2 || nz > 1.2)) {
        const p = this._ambientPos(i, true);
        nx = p.x; ny = p.y; nz = p.z;
        this.PX[i] = nx; this.PY[i] = ny; this.PZ[i] = nz; // no streak across the jump
      }
      this.X[i] = nx; this.Y[i] = ny; this.Z[i] = nz;
    }
  }

  draw(ctx, alpha) {
    const n = this.n || 0; if (!n) return;
    const W = this.w, H = this.h, cx = W / 2, cy = H / 2;
    const R = Math.min(W, H) * 0.5; // world ±1 maps to half-min-dimension (sim ±1.6 bleeds off)
    const cX = Math.cos(TILT), sX = Math.sin(TILT);
    // project + brightness band
    for (let i = 0; i < n; i++) {
      const project = (wx, wy, wz) => {
        const ty = wy * cX - wz * sX;
        return [cx + wx * R, cy - ty * R];
      };
      const a = project(this.PX[i], this.PY[i], this.PZ[i]);
      const b = project(this.X[i], this.Y[i], this.Z[i]);
      this.psx[i] = a[0]; this.psy[i] = a[1]; this.sx[i] = b[0]; this.sy[i] = b[1];
      // depth 0..1
      let d = this.Z[i] * 0.5 + 0.5; if (d < 0) d = 0; else if (d > 1) d = 1;
      const hi = this._h(i * 7 + 99);
      const isHand = hi < this.p('recruit');
      const bv = (isHand ? 0.7 : 0.32) * (0.45 + 0.55 * d);
      let band = (bv * BANDS) | 0; if (band >= BANDS) band = BANDS - 1; if (band < 0) band = 0;
      this.sband[i] = band; this.sval[i] = 1;
    }
    const fg = (this.palette && this.palette.fg) || [240, 240, 240];
    const fr = Math.round(fg[0]), fgc = Math.round(fg[1]), fb = Math.round(fg[2]);
    const thread = this.p('thread');
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (let band = 0; band < BANDS; band++) {
      const bc = (band + 0.5) / BANDS;
      ctx.lineWidth = thread * (0.4 + 0.9 * bc);
      ctx.strokeStyle = `rgba(${fr},${fgc},${fb},${(0.05 + 0.5 * bc) * alpha})`;
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        if (this.sval[i] && this.sband[i] === band) {
          ctx.moveTo(this.psx[i], this.psy[i]);
          ctx.lineTo(this.sx[i], this.sy[i]);
        }
      }
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }
}
```

- [ ] **Step 4: Run the Scene test to verify it passes**

Run: `node --test tests/dots/purposeMaker.test.mjs`
Expected: PASS (3 tests). If `SimplexNoise` import path/shape differs, fix per `FlowField.js`.

- [ ] **Step 5: Register the scene**

Modify `src/scenes/registry.js`: add the import after the FlowField import, and insert into the array after `new ParticleField()`:
```js
import { PurposeMaker } from './dots/PurposeMaker.js';
```
```js
    new ParticleField(),
    new PurposeMaker(),
```

- [ ] **Step 6: Write the registry test**

`tests/dots/purposeMaker.test.mjs` (append):
```js
import { createScenes } from '../../src/scenes/registry.js';

test('PurposeMaker is registered in the scene list', () => {
  const ids = createScenes().map((s) => s.id);
  assert.ok(ids.includes('purposeMaker'), 'registry includes purposeMaker');
});
```

- [ ] **Step 7: Run the full suite (ensure nothing broke)**

Run: `node --test`
Expected: all tests PASS (existing ~220 + new).

- [ ] **Step 8: Commit**

```bash
git add src/scenes/dots/PurposeMaker.js src/scenes/registry.js tests/dots/purposeMaker.test.mjs
git commit -m "feat(purposemaker): Scene (ambient turbulence + recruited hands) + register / PurposeMaker scene

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TDo59SJjRsGDawtwgz2oFi"
```

---

## Task 9: Headless visual verification & live tuning (manual gate)

**Files:** none committed except possible tuning of default param values in `PurposeMaker.js` and `this.trail`.

This task is the [[verify-visual-before-claiming]] gate. It is NOT a `node --test` test — it renders the real Scene in a real browser via the headless harness and confirms the look.

- [ ] **Step 1: Start the dev server** (if not running): `npm run dev` (or the project's static server on `:8125`).

- [ ] **Step 2: Render the three holds and the transition** using `.superpowers/sdd/devshot/shot.mjs`. Drive the engine to the `purposeMaker` scene, set `modeIndex` to 1/2/3 (Right/Left/Both) for crisp holds, and for the cycle set `clock.time` to a hold midpoint. Capture PNGs to `shots/`. Example eval (adapt to the harness API used elsewhere in this repo):
```
window.__vj.engine.start(); window.__vj.scenes.goto('purposeMaker');
const sc = window.__vj.scenes.currentScene(); sc.setMode ? sc.setMode(3) : (sc.modeIndex = 3); // Both
```

- [ ] **Step 3: View the screenshots** (Read the PNGs). Confirm:
  - Hands read clearly (Right / Left / Both, fingertips meeting in Both).
  - White-on-black mono, additive glow (no color).
  - **Ambient turbulence fills the frame and bleeds off all edges, present even during hold** (the key video-fidelity requirement).
  - Gather/disperse read as smoky emergence/dissolution (filament streaks), not a round puff.

- [ ] **Step 4: Tune defaults if needed** — adjust `recruit`, `flow`, `scale`, `cohesion`, `thread`, `this.trail`, and the placement constants (`spanX/spanY/TILT`, Both vertical offset) in `PurposeMaker.js`; re-render; re-view. Iterate until it matches the source video's feel. Commit any default changes:
```bash
git add src/scenes/dots/PurposeMaker.js
git commit -m "tune(purposemaker): visual defaults after headless review / look tuning

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TDo59SJjRsGDawtwgz2oFi"
```

- [ ] **Step 5: Deliver screenshots to the user** for sign-off before any deploy. Do NOT bump `sw.js` or push to main — deploy is a separate, user-gated step.

---

## Deploy (user-gated, after sign-off — NOT part of implementation)
1. Bump `sw.js` `CACHE_VERSION` `vj-v33` → `vj-v34`.
2. Bilingual commit, `git push` the branch / merge to `main` per the user's decision (GitHub Pages). PWA updates on reload.

---

## Self-Review (plan vs spec)

**Spec coverage:** mono/additive (Tasks 8,9) ✓; determinism — hashed seeds + clock choreography + baked assets, no Math.random/Date at runtime (Tasks 7,8) ✓; ambient turbulence wider-than-viewport with edge reseed (Task 8) ✓; video-derived profile drives ambient (Tasks 5,6,8) ✓; recruit split (Task 8) ✓; hand point-clouds baked from drawings (Tasks 3,4) ✓; R→L→Both seamless (Task 7) ✓; modes Cycle/Right/Left/Both + Audio group (Task 8) ✓; params incl. recruit (Task 8) ✓; registry (Task 8) ✓; node --test green (every task) ✓; SW bump deferred to deploy (Task 9/Deploy) ✓; headless visual gate (Task 9) ✓; pmCodec shared by bake+runtime (Task 1) ✓; dependency-free PNG (Task 2) ✓; bake namespace tools/pmbake (Tasks 2-6) ✓.

**Placeholder scan:** no TBD/TODO; every code step has complete code; test code is concrete. Task 9 is intentionally a manual visual gate (the spec mandates it) with concrete acceptance criteria, not a vague step.

**Type consistency:** `decodeHandTargets()` → `{A:{n,u,v},B}` used in Task 8 `_targetFor` ✓; `decodeTurbProfile()` → `{dim,density,flowAngle,coherence,scale,streakLen,...}` used in Task 8 `_ambientPos`/`update` ✓; `cohesionAt(time,{pace})→{station,cR,cL,phase}` used in Task 8 ✓; `importanceSample(...)→{n,u:Int16Array,v:Int16Array}` consumed by `bakeHands` packInt16 ✓; `measureTurb→{density:Uint8Array,...}` consumed by `extractTurb` packUint8 ✓; `pmCodec` pack/unpack pairs match ✓.
