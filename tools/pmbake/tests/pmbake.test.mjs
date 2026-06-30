import assert from 'node:assert';
import { test } from 'node:test';
import { deflateSync } from 'node:zlib';
import { decodePng, toLum } from '../png.mjs';
import { importanceSample, paperLevel } from '../sample.mjs';
import { measureTurb, structureTensor, centroidDrift, downsample } from '../turb.mjs';

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

test('importanceSample rejects near-paper background => no rectangular box around the silhouette', () => {
  // A centered dark blob (the "hand") on a bright paper plateau, surrounded by a border/corner
  // ring a little darker than paper. That ring is the real failure mode: a large near-paper area
  // the old sampler scattered stray points into, drawing the crop rectangle. The plateau (=paper)
  // is the histogram mode, so the ring keeps a small-but-positive ink the old code still accepts.
  const w = 160, h = 120, paper = 240, cx = w / 2, cy = h / 2;
  const inBlob = (x, y) => ((x - cx) / 24) ** 2 + ((y - cy) / 16) ** 2 < 1;
  const isBorder = (x, y) => x < 16 || x > w - 16 || y < 12 || y > h - 12;
  const isCorner = (x, y) => (x < 16 || x > w - 16) && (y < 12 || y > h - 12);
  const lum = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    lum[y * w + x] = inBlob(x, y) ? 40 : isBorder(x, y) ? paper - 12 : paper;
  }
  const { n, u, v } = importanceSample({ w, h, lum }, 6000, 11);
  assert.ok(n > 3500, `still collects plenty of silhouette points (${n})`);
  let corner = 0, blob = 0;
  for (let i = 0; i < n; i++) {
    const px = (u[i] / 32767) * (w - 1), py = (v[i] / 32767) * (h - 1);
    if (isCorner(px, py)) corner++;
    if (inBlob(px, py)) blob++;
  }
  assert.ok(corner / n < 0.005, `<0.5% of points in the corners (got ${(100 * corner / n).toFixed(2)}%)`);
  assert.ok(blob / n > 0.9, `>90% of points inside the silhouette (got ${(100 * blob / n).toFixed(1)}%)`);
});

test('importanceSample margin adapts to low contrast and still rejects background', () => {
  // Soft overall contrast (blob only ~55 below paper) with a darker border ring.
  const w = 100, h = 100, paper = 200, cx = 50, cy = 50;
  const inBlob = (x, y) => ((x - cx) / 20) ** 2 + ((y - cy) / 20) ** 2 < 1;
  // thin border so the bright paper plateau stays the histogram mode (= the scatter target)
  const isBorder = (x, y) => x < 8 || x > w - 8 || y < 8 || y > h - 8;
  const lum = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    lum[y * w + x] = inBlob(x, y) ? paper - 55 : isBorder(x, y) ? paper - 8 : paper;
  }
  const { n, u, v } = importanceSample({ w, h, lum }, 4000, 5);
  let bg = 0;
  for (let i = 0; i < n; i++) {
    const px = (u[i] / 32767) * (w - 1), py = (v[i] / 32767) * (h - 1);
    if (!inBlob(px, py)) bg++;
  }
  assert.ok(bg / n < 0.03, `background scatter rejected at low contrast (got ${(100 * bg / n).toFixed(2)}%)`);
});

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
