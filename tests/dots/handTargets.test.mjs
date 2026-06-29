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
