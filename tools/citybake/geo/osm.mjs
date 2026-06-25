// Overpass JSON → typed city features (footprints, roads, rails, green, the
// 旧駅舎 landmark, the functional station). Pure: lat/lon in, no projection.
const LEVEL_M = 3.2;
// Avenue-name candidates. The home-plate fan (大学/富士見/旭) + 国立停車場谷保線
// (大学通り's southward continuation to 谷保). さくら通り stays in the secondary
// (grey) tier per user direction. Same-named roads elsewhere (e.g. a far 富士見通り
// in 谷保) are pruned later in manifest.mjs by the station-connectivity gate, so
// listing a name here is only a candidacy, not a guarantee of primary.
const PRIMARY_NAMES = ['大学通り', '富士見通り', '旭通り', '国立停車場谷保線'];
const GREEN_LANDUSE = new Set(['grass', 'forest', 'recreation_ground', 'cemetery', 'meadow']);

function rng(seed) {
  let a = (seed >>> 0) || 1;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export function estimateLevels(tags, id = 0) {
  const explicit = parseInt(tags['building:levels'], 10);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  const b = tags.building || 'yes';
  const base = /apartment|commercial|retail|office|hotel|public|civic/.test(b) ? 3
    : /house|detached|residential|hut|garage|shed/.test(b) ? 1 : 2;
  const jit = Math.floor(rng(id || 1)() * 2); // 0..1, deterministic per id
  return Math.max(1, Math.min(3, base + jit));
}

export function classifyRoad(tags) {
  const name = tags.name || '';
  const primary = !!tags.railway || PRIMARY_NAMES.some((n) => name.includes(n));
  return { primary, name, highway: tags.highway };
}

const dedupeRing = (geom) => {
  const r = geom.map((p) => ({ lat: p.lat, lon: p.lon }));
  if (r.length > 1) { const a = r[0], b = r[r.length - 1]; if (a.lat === b.lat && a.lon === b.lon) r.pop(); }
  return r;
};
const centroidLL = (ring) => {
  let lat = 0, lon = 0; for (const p of ring) { lat += p.lat; lon += p.lon; } return { lat: lat / ring.length, lon: lon / ring.length };
};

export function inferHeightM(levels) { return levels * LEVEL_M; }

export function parseOsm(data, { origin = null } = {}) {
  const els = data.elements || [];
  const buildings = [], roads = [], rails = [], green = [];
  const landmarkCandidates = [];
  let station = null;

  for (const el of els) {
    const tags = el.tags || {};
    const isStation = tags.railway === 'station' || tags.building === 'train_station' || tags.public_transport === 'station';
    if (isStation && !station) {
      const point = el.type === 'node' ? { lat: el.lat, lon: el.lon }
        : el.geometry ? centroidLL(dedupeRing(el.geometry)) : null;
      if (point) { station = { point, tags, name: tags.name || '国立' }; continue; }
    }
    if (tags.building && el.geometry && el.geometry.length >= 3) {
      const ring = dedupeRing(el.geometry);
      const levels = estimateLevels(tags, el.id);
      const f = { id: el.id, ring, centroid: centroidLL(ring), levels, heightM: inferHeightM(levels), name: tags.name || '', tags };
      const isOldStation = (tags.historic || /旧/.test(tags.name || '')) && !isStation;
      if (isOldStation) landmarkCandidates.push(f); else buildings.push(f);
      continue;
    }
    if (tags.highway && el.geometry) { const c = classifyRoad(tags); roads.push({ id: el.id, points: dedupeRing(el.geometry), primary: c.primary, name: c.name, highway: c.highway }); continue; }
    if (tags.railway === 'rail' && el.geometry) { rails.push({ id: el.id, points: dedupeRing(el.geometry), name: tags.name || '' }); continue; }
    if ((tags.leisure === 'park' || GREEN_LANDUSE.has(tags.landuse) || tags.natural === 'wood') && el.geometry && el.geometry.length >= 3) {
      green.push({ id: el.id, ring: dedupeRing(el.geometry), name: tags.name || '' });
    }
  }

  // Pick the landmark: prefer a name containing 駅舎, then containing 国立駅,
  // then (if origin given) the nearest to the station; demote 旧守衛所-style decoys.
  const score = (f) => (/駅舎/.test(f.name) ? 100 : 0) + (/国立駅/.test(f.name) ? 50 : 0)
    + (origin ? -Math.hypot(f.centroid.lat - origin.lat, f.centroid.lon - origin.lon) : 0);
  landmarkCandidates.sort((a, b) => score(b) - score(a));
  const landmark = landmarkCandidates[0] || null;
  // Any landmark candidates we didn't pick stay as generic buildings.
  for (let i = 1; i < landmarkCandidates.length; i++) buildings.push(landmarkCandidates[i]);

  return { footprints: buildings, roads, rails, green, landmark, station };
}
