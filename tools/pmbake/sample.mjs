// Importance-sample a luminance grid into normalized points with density ∝ darkness.
// Equal-weight points: tone emerges from point DENSITY, so no per-point weight is stored.
export function paperLevel(lum) {
  const hist = new Uint32Array(256);
  for (let i = 0; i < lum.length; i++) hist[Math.max(0, Math.min(255, lum[i] | 0))]++;
  let best = 0, paper = 230;
  for (let v = 150; v < 256; v++) if (hist[v] > best) { best = hist[v]; paper = v; }
  return paper;
}

// deterministic xorshift32 from a seed
function rng(seed) {
  let s = (seed | 0) || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) / 4294967296); };
}

export function importanceSample({ w, h, lum }, K, seed, opts) {
  const o = opts || {};
  const paper = paperLevel(lum);
  let maxd = 1;
  for (let i = 0; i < lum.length; i++) { const d = paper - lum[i]; if (d > maxd) maxd = d; }
  // Reject pixels that are only marginally darker than paper. Without this, the near-paper
  // background (a vast area just below the histogram peak) keeps a small-but-positive accept
  // probability and scatters stray points across the whole crop rectangle => a "pasted box"
  // boundary instead of the hand silhouette. The margin scales with contrast (and a floor),
  // and we renormalize over the remaining ink band so interior tone is preserved.
  const margin = o.margin != null ? o.margin : Math.max(10, 0.12 * maxd);
  const denom = Math.max(1, maxd - margin);
  const rand = rng(seed);
  const u = new Int16Array(K), v = new Int16Array(K);
  let n = 0, guard = 0, guardMax = K * 200; // rejecting background lengthens the loop
  while (n < K && guard++ < guardMax) {
    const x = (rand() * (w - 1)) | 0, y = (rand() * (h - 1)) | 0;
    const ink = paper - lum[y * w + x];
    if (ink <= margin) continue; // background -> reject (kills the rectangular scatter)
    const dk = (ink - margin) / denom;
    if (rand() < Math.pow(dk, 1.2)) {
      u[n] = Math.round((x / (w - 1)) * 32767);
      v[n] = Math.round((y / (h - 1)) * 32767);
      n++;
    }
  }
  return { n, u: u.subarray(0, n), v: v.subarray(0, n) };
}
