// Building ripple reveal for Plan 3. The baked buildings are ONE merged geometry
// with footprints in OSM order (not distance order), so setDrawRange can't ripple
// outward from the station. Instead we tag every vertex with its building's
// revealKey (= distance from the station) and its floor Y, then a shader uniform
// uReveal sweeps outward — each building rises from its floor as the sweep passes.
//
// Quantization note (load-bearing): the glb is KHR_mesh_quantization, so the
// vertex shader's `position.y` is a RAW 0..65535 local value; world height comes
// from the node/model matrix applied AFTER the shader. So aBaseY must be the raw
// local floor (min position.y over the building's verts) and we edit `transformed.y`
// (still local) — the model matrix then maps the sunken floor to the right world Y.
// Monochrome-safe: only .y is touched, never the baked AO×light vertex colours.

// Pure: build the per-vertex attributes from the manifest's per-building ranges.
// getY(i) returns the raw local Y of vertex i. count = total vertex count.
export function buildRevealAttributes(perBuilding, getY, count) {
  const aReveal = new Float32Array(count);
  const aBaseY = new Float32Array(count);
  let maxRevealKey = 0;
  for (const b of perBuilding) {
    const end = b.vStart + b.vCount;
    let minY = Infinity;
    for (let i = b.vStart; i < end; i++) { const y = getY(i); if (y < minY) minY = y; }
    for (let i = b.vStart; i < end; i++) { aReveal[i] = b.revealKey; aBaseY[i] = minY; }
    if (b.revealKey > maxRevealKey) maxRevealKey = b.revealKey;
  }
  return { aReveal, aBaseY, maxRevealKey };
}

// Patch the buildings mesh: add the attributes and inject the rise into the unlit
// material. Returns { material, setProgress, maxRevealKey }. setProgress(p∈[0,1])
// sweeps the reveal; p=1 is fully built. THREE is passed in so this module stays
// import-free (node-testable via buildRevealAttributes above).
export function installReveal(THREE, mesh, perBuilding, { band = 0.6 } = {}) {
  const geo = mesh.geometry;
  const pos = geo.attributes.position;
  const { aReveal, aBaseY, maxRevealKey } = buildRevealAttributes(perBuilding, (i) => pos.getY(i), pos.count);
  geo.setAttribute('aReveal', new THREE.BufferAttribute(aReveal, 1));
  geo.setAttribute('aBaseY', new THREE.BufferAttribute(aBaseY, 1));

  const uReveal = { value: 0 };
  const uBand = { value: band };
  const mat = mesh.material;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uReveal = uReveal;
    shader.uniforms.uBand = uBand;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aReveal;\nattribute float aBaseY;\nuniform float uReveal;\nuniform float uBand;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nfloat _rv = smoothstep(aReveal - uBand, aReveal, uReveal);\ntransformed.y = mix(aBaseY, transformed.y, _rv);');
  };
  mat.needsUpdate = true; // force a recompile if the material already compiled

  return {
    material: mat,
    maxRevealKey,
    uBand,
    setProgress: (p) => { uReveal.value = Math.max(0, p) * maxRevealKey; },
  };
}
