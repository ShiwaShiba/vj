import assert from 'node:assert';
import { test } from 'node:test';
import { formatSliderValue } from '../../src/ui/Sliders.js';

test('formatSliderValue shows exactly the precision the step implies', () => {
  assert.strictEqual(formatSliderValue(1.6, 0.1), '1.6');   // gain
  assert.strictEqual(formatSliderValue(8, 1), '8');         // phase (integer)
  assert.strictEqual(formatSliderValue(0.12, 0.01), '0.12'); // core
  assert.strictEqual(formatSliderValue(3, 0.25), '3.00');   // thickness (2-dp step)
  assert.strictEqual(formatSliderValue(2.2, 0.1), '2.2');   // range
  assert.strictEqual(formatSliderValue(0, 0.05), '0.00');   // drive at zero
  assert.strictEqual(formatSliderValue(-0.5, 0.02), '-0.50'); // rotate (signed)
});

test('formatSliderValue tolerates a missing step (defaults to integer)', () => {
  assert.strictEqual(formatSliderValue(4, undefined), '4');
});
