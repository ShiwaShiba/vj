import assert from 'node:assert';
import { test } from 'node:test';
import { linear, easeInOutCubic, easeOutCubic, easeInOutSine, easeOutQuint, byName } from '../../src/cityproto/ease.js';

const ALL = { linear, easeInOutCubic, easeOutCubic, easeInOutSine, easeOutQuint };

test('every easing pins the endpoints 0->0 and 1->1', () => {
  for (const [name, fn] of Object.entries(ALL)) {
    assert.ok(Math.abs(fn(0) - 0) < 1e-9, `${name}(0) should be 0`);
    assert.ok(Math.abs(fn(1) - 1) < 1e-9, `${name}(1) should be 1`);
  }
});

test('linear is the identity', () => {
  assert.strictEqual(linear(0.37), 0.37);
});

test('easeInOutCubic is symmetric and slow at the start (溜め→引き)', () => {
  assert.ok(Math.abs(easeInOutCubic(0.5) - 0.5) < 1e-9, 'midpoint stays 0.5');
  assert.ok(easeInOutCubic(0.25) < 0.25, 'ease-in: behind linear early');
  assert.ok(easeInOutCubic(0.75) > 0.75, 'ease-out: ahead of linear late');
});

test('easeOutCubic decelerates (ahead of linear throughout)', () => {
  assert.ok(easeOutCubic(0.5) > 0.5, 'fast start then settle');
});

test('byName resolves known eases and falls back to linear', () => {
  assert.strictEqual(byName('easeInOutSine'), easeInOutSine);
  assert.strictEqual(byName('nope'), linear);
});
