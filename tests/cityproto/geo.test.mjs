import assert from 'node:assert';
import { test } from 'node:test';
import { terrainHeight, inHomePlate, AVENUES } from '../../src/cityproto/geo.js';

test('terrain is gentle (|h| < 0.08 over the field)', () => {
  for (let u = -1.8; u <= 1.7; u += 0.3)
    for (let v = -0.4; v <= 1.25; v += 0.3)
      assert.ok(Math.abs(terrainHeight(u, v)) < 0.08, `h too large at ${u},${v}`);
});

test('home-plate fan is wider on the west (Fujimi) side', () => {
  assert.ok(inHomePlate(-0.7, 0.6), 'west should be inside');
  assert.ok(!inHomePlate(0.7, 0.6), 'east should be outside (shorter)');
});

test('AVENUES has the four named roads with correct asymmetry', () => {
  const names = AVENUES.map((a) => a.name);
  assert.deepStrictEqual(names, ['daigaku', 'fujimi', 'asahi', 'chuo']);
  const fujimi = AVENUES.find((a) => a.name === 'fujimi');
  const asahi = AVENUES.find((a) => a.name === 'asahi');
  const len = (a) => Math.hypot(a.bx - a.ax, a.bv - a.av);
  assert.ok(len(fujimi) > len(asahi) * 1.4, 'fujimi must be the long side');
});
