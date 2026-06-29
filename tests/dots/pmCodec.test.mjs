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
