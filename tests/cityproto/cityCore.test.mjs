import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const src = readFileSync(fileURLToPath(new URL('../../src/cityproto/cityCore.js', import.meta.url)), 'utf8');

test('cityCore は DOM/window/mic/RAF を参照しない（注入式）', () => {
  assert.ok(!/getElementById/.test(src), 'no getElementById');
  assert.ok(!/document\./.test(src), 'no document.*');
  assert.ok(!/requestAnimationFrame/.test(src), 'no RAF (caller owns the loop)');
  assert.ok(!/getUserMedia|AudioContext|createLiveDriver/.test(src), 'no mic ownership');
  assert.ok(/export function createCityCore/.test(src), 'exports createCityCore');
});
