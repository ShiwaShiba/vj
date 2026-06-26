// Shared test scene: flat ground + a small patch hugging a tall box's wall.
// BASE hugs the wall (occluded / near a contact occluder); OPEN is a far corner.
export function buildScene() {
  const positions = [], indices = [], normals = [];
  const pushV = (x, y, z, nx, ny, nz) => { positions.push(x, y, z); normals.push(nx, ny, nz); return positions.length / 3 - 1; };
  const A = pushV(-2, 0, -2, 0, 1, 0), B = pushV(2, 0, -2, 0, 1, 0), C = pushV(2, 0, 2, 0, 1, 0), D = pushV(-2, 0, 2, 0, 1, 0);
  indices.push(A, C, B, A, D, C);
  const E = pushV(0.15, 0, 0.0, 0, 1, 0), E2 = pushV(0.4, 0, 0.0, 0, 1, 0), E3 = pushV(0.15, 0, 0.25, 0, 1, 0);
  indices.push(E, E2, E3);
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
