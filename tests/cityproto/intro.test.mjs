import assert from 'node:assert';
import { test } from 'node:test';
import { stagger, installIntroLayers } from '../../src/cityproto/intro.js';

test('stagger ramps a delayed item from 0 to 1 over its span', () => {
  assert.strictEqual(stagger(0, 0, 1), 0);
  assert.strictEqual(stagger(1, 0, 1), 1);
  assert.strictEqual(stagger(0.5, 0, 1), 0.5);
  assert.strictEqual(stagger(0.2, 0.5, 0.5), 0, 'before its phase → still 0');
  assert.strictEqual(stagger(1.0, 0.5, 0.5), 1, 'after phase+span → full');
});

test('installIntroLayers starts everything hidden and reveals to base opacity', () => {
  const grid = { opacity: 0.16 };
  const white = { opacity: 0.9 };
  const secondary = { opacity: 0.68 };
  const io = installIntroLayers({
    gridMaterials: [grid],
    roadMaterials: [{ material: white, phase: 0 }, { material: secondary, phase: 0.3 }],
    span: 0.5,
  });
  assert.strictEqual(grid.opacity, 0, 'grid hidden on install');
  assert.strictEqual(white.opacity, 0, 'roads hidden on install');
  assert.strictEqual(grid.transparent, true);

  io.setTerrain(0.5); assert.ok(Math.abs(grid.opacity - 0.08) < 1e-9, 'grid ramps to half base');
  io.setTerrain(1);   assert.ok(Math.abs(grid.opacity - 0.16) < 1e-9, 'grid back to base');

  io.setRoads(0.3);
  assert.ok(Math.abs(white.opacity - 0.9 * 0.6) < 1e-9, 'lead road already lighting');
  assert.strictEqual(secondary.opacity, 0, 'delayed road not started yet (通電 sweep)');
  io.setRoads(1);
  assert.ok(Math.abs(white.opacity - 0.9) < 1e-9 && Math.abs(secondary.opacity - 0.68) < 1e-9, 'all roads at base when done');
});
