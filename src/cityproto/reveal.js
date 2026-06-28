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

// Overlapping-footprint clustering (load-bearing for the intro). In dense areas the
// PLATEAU LOD1 source stacks several building parts on the SAME footprint (nested /
// duplicate solids). Because revealKey = distance-from-station, two such parts get
// slightly different keys and rise at slightly different times — so the earlier one
// momentarily pokes through the later one's walls (visible "めり込み" during the intro
// sweep, which resolves once both reach full height). Fix: union buildings whose XZ
// footprints overlap by >= overlapFrac of the smaller, then give the whole cluster the
// MIN key so they rise in lockstep (proportional heights → no transient poke-through).
// Pure & deterministic (index-ordered union-find, no RNG/Date). getX/getZ(i) → raw
// local XZ of vertex i. Returns a per-building Float64Array of the assigned reveal key.
export function clusterRevealKeys(perBuilding, getX, getZ, overlapFrac = 0.5) {
  const n = perBuilding.length;
  const x0 = new Float64Array(n), z0 = new Float64Array(n), x1 = new Float64Array(n), z1 = new Float64Array(n), area = new Float64Array(n);
  let gx0 = Infinity, gz0 = Infinity, gx1 = -Infinity, gz1 = -Infinity; // global XZ bounds (for cell sizing)
  for (let b = 0; b < n; b++) {
    const pb = perBuilding[b], end = pb.vStart + pb.vCount;
    let ax0 = Infinity, az0 = Infinity, ax1 = -Infinity, az1 = -Infinity;
    for (let i = pb.vStart; i < end; i++) {
      const x = getX(i), z = getZ(i);
      if (x < ax0) ax0 = x; if (x > ax1) ax1 = x;
      if (z < az0) az0 = z; if (z > az1) az1 = z;
    }
    x0[b] = ax0; z0[b] = az0; x1[b] = ax1; z1[b] = az1;
    area[b] = Math.max(0, ax1 - ax0) * Math.max(0, az1 - az0);
    if (ax0 < gx0) gx0 = ax0; if (ax1 > gx1) gx1 = ax1;
    if (az0 < gz0) gz0 = az0; if (az1 > gz1) gz1 = az1;
  }
  // Cell sized from the OVERALL coordinate span → the hash holds ~n buckets and each AABB
  // spans only a handful of cells, REGARDLESS of coordinate scale. Load-bearing: installReveal
  // feeds RAW KHR_mesh_quantization positions (range ~0..65535, not world units). A fixed
  // world-scale cell (the old Math.min(4,…)) made AABBs span millions of cells at that scale,
  // blowing the Map past V8's ~16.7M limit ("Map maximum size exceeded") and failing the load.
  // span/√n is scale-invariant: quantized OR world both yield ~n cells. Clustering itself is
  // cell-size-independent (two overlapping AABBs always share a covered cell), so only the
  // grid memory changes, not the result.
  const span = Math.max(gx1 - gx0, gz1 - gz0);
  const cell = span > 0 ? span / Math.sqrt(n) : 1;
  const grid = new Map();
  const key = (gx, gz) => gx * 73856093 ^ gz * 19349663; // pair-hash into one bucket map
  for (let b = 0; b < n; b++) {
    const cx0 = Math.floor(x0[b] / cell), cx1 = Math.floor(x1[b] / cell);
    const cz0 = Math.floor(z0[b] / cell), cz1 = Math.floor(z1[b] / cell);
    for (let gx = cx0; gx <= cx1; gx++) for (let gz = cz0; gz <= cz1; gz++) {
      const k = key(gx, gz); let arr = grid.get(k); if (!arr) grid.set(k, arr = []); arr.push(b);
    }
  }
  // union-find
  const par = new Int32Array(n); for (let i = 0; i < n; i++) par[i] = i;
  const find = (a) => { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; };
  const union = (a, b) => { a = find(a); b = find(b); if (a !== b) par[Math.max(a, b)] = Math.min(a, b); };
  const seen = new Set();
  for (const arr of grid.values()) {
    for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) {
      const a = arr[i], b = arr[j];
      const pk = a < b ? a * n + b : b * n + a;
      if (seen.has(pk)) continue; seen.add(pk);
      const ix = Math.min(x1[a], x1[b]) - Math.max(x0[a], x0[b]);
      const iz = Math.min(z1[a], z1[b]) - Math.max(z0[a], z0[b]);
      if (ix <= 0 || iz <= 0) continue;
      const ov = ix * iz, mn = Math.min(area[a], area[b]);
      if (mn > 0 && ov >= overlapFrac * mn) union(a, b);
    }
  }
  // assign each cluster its MIN revealKey
  const clusterMin = new Map();
  for (let b = 0; b < n; b++) { const r = find(b); const k = perBuilding[b].revealKey; const cur = clusterMin.get(r); if (cur === undefined || k < cur) clusterMin.set(r, k); }
  const keys = new Float64Array(n);
  for (let b = 0; b < n; b++) keys[b] = clusterMin.get(find(b));
  return keys;
}

// Pure: build the per-vertex attributes from the manifest's per-building ranges.
// getY(i) returns the raw local Y of vertex i. count = total vertex count. When
// opts.getX/getZ are supplied, overlapping footprints are clustered to a shared key
// (see clusterRevealKeys) so nested parts rise in lockstep; otherwise each building
// keeps its own revealKey (legacy behaviour, used by the pure unit tests).
export function buildRevealAttributes(perBuilding, getY, count, opts = {}) {
  const aReveal = new Float32Array(count);
  const aBaseY = new Float32Array(count);
  let maxRevealKey = 0;
  const keys = (opts.getX && opts.getZ)
    ? clusterRevealKeys(perBuilding, opts.getX, opts.getZ, opts.overlapFrac ?? 0.5)
    : null;
  for (let bi = 0; bi < perBuilding.length; bi++) {
    const b = perBuilding[bi];
    const end = b.vStart + b.vCount;
    let minY = Infinity;
    for (let i = b.vStart; i < end; i++) { const y = getY(i); if (y < minY) minY = y; }
    const rk = keys ? keys[bi] : b.revealKey;
    for (let i = b.vStart; i < end; i++) { aReveal[i] = rk; aBaseY[i] = minY; }
    if (b.revealKey > maxRevealKey) maxRevealKey = b.revealKey; // sweep target = farthest ORIGINAL key
  }
  return { aReveal, aBaseY, maxRevealKey };
}

// 頂点 → 所属建物 index（scope テクスチャ lookup 用）。純・決定論。
export function buildIndexAttribute(perBuilding, count) {
  const aIdx = new Float32Array(count);
  for (let bi = 0; bi < perBuilding.length; bi++) {
    const b = perBuilding[bi], end = b.vStart + b.vCount;
    for (let i = b.vStart; i < end; i++) aIdx[i] = bi;
  }
  return aIdx;
}

// Patch the buildings mesh: add the attributes and inject the rise into the unlit
// material. Returns { material, setProgress, maxRevealKey }. setProgress(p∈[0,1])
// sweeps the reveal; p=1 is fully built. THREE is passed in so this module stays
// import-free (node-testable via buildRevealAttributes above).
export function installReveal(THREE, mesh, perBuilding, { band = 0.6 } = {}) {
  const geo = mesh.geometry;
  const pos = geo.attributes.position;
  const { aReveal, aBaseY, maxRevealKey } = buildRevealAttributes(perBuilding, (i) => pos.getY(i), pos.count,
    { getX: (i) => pos.getX(i), getZ: (i) => pos.getZ(i) });
  geo.setAttribute('aReveal', new THREE.BufferAttribute(aReveal, 1));
  geo.setAttribute('aBaseY', new THREE.BufferAttribute(aBaseY, 1));

  // scope テクスチャ: 建物ごとの reveal 係数を毎フレ書く RGBA8（.r に scope, nearest）。
  // CityScope（音→建物変調）が writeScope/setScopeEnabled で駆動。uScopeEnabled=0（INTRO/既定）
  // のとき scope=1 で現状ピクセル一致。
  const n = perBuilding.length;
  const side = Math.max(1, Math.ceil(Math.sqrt(n)));
  geo.setAttribute('aBuildIndex', new THREE.BufferAttribute(buildIndexAttribute(perBuilding, pos.count), 1));
  const scopeBytes = new Uint8Array(side * side * 4).fill(255);   // 既定 1.0（OFF=全フル）
  const scopeTex = new THREE.DataTexture(scopeBytes, side, side, THREE.RGBAFormat);
  scopeTex.magFilter = THREE.NearestFilter; scopeTex.minFilter = THREE.NearestFilter;
  scopeTex.needsUpdate = true;
  const uScopeTex = { value: scopeTex };
  const uScopeSize = { value: side };
  const uScopeEnabled = { value: 0 };   // INTRO/既定は無効＝現状一致

  const uReveal = { value: 0 };
  const uBand = { value: band };
  const uCityTint = { value: new THREE.Vector3(1, 1, 1) }; // 全体COLOR tint（既定 恒等）
  const uCityTintStr = { value: 0 };                       // 強さ 0=現状ピクセル一致（守る線）
  const mat = mesh.material;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uReveal = uReveal;
    shader.uniforms.uBand = uBand;
    shader.uniforms.uScopeTex = uScopeTex;
    shader.uniforms.uScopeSize = uScopeSize;
    shader.uniforms.uScopeEnabled = uScopeEnabled;
    shader.uniforms.uCityTint = uCityTint;
    shader.uniforms.uCityTintStr = uCityTintStr;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aReveal;\nattribute float aBaseY;\nattribute float aBuildIndex;\nuniform float uReveal;\nuniform float uBand;\nuniform sampler2D uScopeTex;\nuniform float uScopeSize;\nuniform float uScopeEnabled;\nvarying float vReveal;')
      .replace('#include <begin_vertex>',
        '#include <begin_vertex>\n'
        + 'float _scope = 1.0;\n'
        + 'if (uScopeEnabled > 0.5) {\n'
        + '  float _sx = mod(aBuildIndex, uScopeSize);\n'
        + '  float _sy = floor(aBuildIndex / uScopeSize);\n'
        + '  vec2 _suv = (vec2(_sx, _sy) + 0.5) / uScopeSize;\n'
        + '  _scope = texture2D(uScopeTex, _suv).r;\n'
        + '}\n'
        + 'float _rv = smoothstep(aReveal - uBand, aReveal, uReveal) * _scope;\n'
        + 'vReveal = _rv;\n'
        + 'transformed.y = mix(aBaseY, transformed.y, _rv);');
    // Hide a building until the sweep actually reaches it. Before reveal it is collapsed to its
    // floor (aBaseY) — a flat AO-shaded cap lying on the terrain — which read as grey "shards"
    // across the whole un-revealed ring. Discarding while _rv≈0 means un-reached buildings show
    // nothing (bare terrain); each then sprouts from the ground as the wavefront passes. The
    // settled state (_rv=1) is untouched, so the final/approved look is byte-identical.
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vReveal;\nuniform vec3 uCityTint;\nuniform float uCityTintStr;')
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif (vReveal < 0.03) discard;')
      // 全体COLOR：建物のmono明度はそのまま色相だけ淡く掛ける（uCityTintStr=0 で恒等）。
      // reveal.js:12 の monochrome-safe 制約をここで意図的に緩める（控えめ・単一色相・虹色化しない）。
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * uCityTint, uCityTintStr)');
  };
  mat.needsUpdate = true; // force a recompile if the material already compiled

  return {
    material: mat,
    maxRevealKey,
    uBand,
    setProgress: (p) => { uReveal.value = Math.max(0, p) * maxRevealKey; },
    scopeCount: n,
    setScopeEnabled: (b) => { uScopeEnabled.value = b ? 1 : 0; },
    setTint: (tint) => {
      uCityTint.value.set(
        tint && tint.r != null ? tint.r : 1,
        tint && tint.g != null ? tint.g : 1,
        tint && tint.b != null ? tint.b : 1,
      );
      uCityTintStr.value = Math.max(0, Math.min(1, (tint && tint.strength) || 0));
    },
    writeScope: (scope) => {
      const m = Math.min(n, scope.length);
      for (let b = 0; b < m; b++) {
        const v = scope[b] < 0 ? 0 : scope[b] > 1 ? 255 : (scope[b] * 255 + 0.5) | 0;
        scopeBytes[b * 4] = v;            // .r に格納（mono）
      }
      scopeTex.needsUpdate = true;
    },
  };
}
