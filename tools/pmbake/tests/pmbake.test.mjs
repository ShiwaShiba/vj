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
