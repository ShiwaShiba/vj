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

test('hands are oriented A=enters-right / B=enters-left (not swapped)', () => {
  // The feminine reference drawings carry most ink in the HAND (palm + fingers), which
  // sits OPPOSITE the thin forearm/entry edge: Hand_A's hand-mass is on the LEFT (arm
  // exits right), Hand_B's is on the RIGHT (arm exits left). So A's ink skews LEFT of B's,
  // while A still reaches the RIGHT frame edge more than B (its arm root). Orientation was
  // also verified by headless render (Right shows a right-entering hand, Left a left one).
  const { A, B } = decodeHandTargets();
  const meanU = (c) => { let s = 0; for (let i = 0; i < c.n; i++) s += c.u[i]; return s / c.n / 32767; };
  const farRight = (c) => { let k = 0; for (let i = 0; i < c.n; i++) if (c.u[i] / 32767 > 0.85) k++; return k / c.n; };
  assert.ok(meanU(A) + 0.03 < meanU(B), `A hand-mass sits left of B (${meanU(A).toFixed(3)} < ${meanU(B).toFixed(3)})`);
  assert.ok(farRight(A) > farRight(B), 'A arm-root reaches the right frame edge more than B');
});
