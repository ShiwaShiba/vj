import assert from 'node:assert';
import { test } from 'node:test';
import { bakeAO } from '../../bake/ao.mjs';

// A flat ground (two big triangles) + a small ground patch hugging the east
// wall of a tall box. The patch vertex should be occluded; a far ground corner
// should be open.
function buildScene() {
  const positions = [], indices = [], normals = [];
  const pushV = (x, y, z, nx, ny, nz) => { positions.push(x, y, z); normals.push(nx, ny, nz); return positions.length / 3 - 1; };
  // ground quad [-2,2]^2 at y=0
  const A = pushV(-2, 0, -2, 0, 1, 0), B = pushV(2, 0, -2, 0, 1, 0), C = pushV(2, 0, 2, 0, 1, 0), D = pushV(-2, 0, 2, 0, 1, 0);
  indices.push(A, C, B, A, D, C);
  // small ground patch hugging the box's east wall (x≈0.15)
  const E = pushV(0.15, 0, 0.0, 0, 1, 0), E2 = pushV(0.4, 0, 0.0, 0, 1, 0), E3 = pushV(0.15, 0, 0.25, 0, 1, 0);
  indices.push(E, E2, E3);
  // tall box x[-0.1,0.1] z[-0.1,0.1] y[0,1] — 12 tris, axis normals
  const box = [
    [-0.1, 0, -0.1], [0.1, 0, -0.1], [0.1, 0, 0.1], [-0.1, 0, 0.1],
    [-0.1, 1, -0.1], [0.1, 1, -0.1], [0.1, 1, 0.1], [-0.1, 1, 0.1],
  ];
  const bi = box.map((p) => pushV(p[0], p[1], p[2], 0, 1, 0));
  const quad = (a, b, c, d) => indices.push(bi[a], bi[b], bi[c], bi[a], bi[c], bi[d]);
  quad(4, 5, 6, 7); quad(0, 1, 5, 4); quad(1, 2, 6, 5); quad(2, 3, 7, 6); quad(3, 0, 4, 7);
  return {
    soup: { positions: new Float32Array(positions), indices: new Uint32Array(indices), normals: new Float32Array(normals) },
    OPEN: A, BASE: E,
  };
}

test('open ground is bright, wall-hugging base is darker, output is grey', () => {
  const { soup, OPEN, BASE } = buildScene();
  const col = bakeAO(soup, { rays: 32, radius: 1.5, seed: 1 });
  assert.strictEqual(col.length, soup.positions.length);
  const grey = (i) => col[i * 3];
  assert.ok(grey(OPEN) > grey(BASE) + 0.1, `open ${grey(OPEN).toFixed(3)} should exceed occluded ${grey(BASE).toFixed(3)} by >0.1`);
  for (let i = 0; i < col.length; i += 3) {
    assert.ok(col[i] === col[i + 1] && col[i + 1] === col[i + 2], 'must be grey');
    assert.ok(col[i] >= 0 && col[i] <= 1, 'in [0,1]');
  }
});

test('AO bake is deterministic (no Math.random)', () => {
  const { soup } = buildScene();
  const a = bakeAO(soup, { rays: 16, radius: 1.0, seed: 7 });
  const b = bakeAO(soup, { rays: 16, radius: 1.0, seed: 7 });
  assert.deepStrictEqual(Array.from(a), Array.from(b));
});
