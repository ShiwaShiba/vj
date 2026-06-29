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
  // The cropped feminine fixtures keep the hand + a short forearm STUB at the entry edge:
  // Hand_A's stub is at high u (reaches the RIGHT), Hand_B's at low u (reaches the LEFT).
  // That edge — not the hand-mass centroid — is what fixes which side each hand enters from,
  // so we assert it directly: A has more far-RIGHT ink, B more far-LEFT. (A swap flips both.)
  // Orientation also verified by headless render (Right = right-entering hand, Left = left).
  const { A, B } = decodeHandTargets();
  const frac = (c, lo, hi) => { let k = 0; for (let i = 0; i < c.n; i++) { const u = c.u[i] / 32767; if (u >= lo && u < hi) k++; } return k / c.n; };
  assert.ok(frac(A, 0.8, 1.01) > frac(B, 0.8, 1.01) + 0.05, 'A arm-stub reaches the RIGHT edge more than B');
  assert.ok(frac(B, 0, 0.2) > frac(A, 0, 0.2) + 0.05, 'B arm-stub reaches the LEFT edge more than A');
});
