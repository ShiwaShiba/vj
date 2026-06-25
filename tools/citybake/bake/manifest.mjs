// Build the runtime manifest: scene scale, primary-road + chuo polylines (so
// the renderer draws roads on top and they never get buried), green rects,
// per-building reveal keys/types (for the terrain→roads→buildings→trees reveal),
// the landmark node name, and the OSM/GSI attribution strings.
const CHUO_RE = /中央/;

// Named arterials become the secondary tier (drawn under the primary avenues).
// Minor capillaries (residential/footway/cycleway/service/construction/proposed) stay dropped.
const SECONDARY_CLASSES = new Set([
  'motorway', 'motorway_link', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified',
]);

const within = (u, v, b) => u > b.u0 - 0.2 && u < b.u1 + 0.2 && v > b.v0 - 0.2 && v < b.v1 + 0.2;

// 国立停車場谷保線 forks near 谷保駅: the straight run continues to 谷保駅 (kept), while
// these two ways branch SW to 谷保天満宮. They share the same name + secondary class as
// the kept run, so only the OSM id distinguishes them — drop both entirely (neither
// white primary nor grey secondary) so the 谷保天満宮 branch never draws.
const DROP_IDS = new Set([322205618, 28213299]);

const STATION_R = 0.6; // plan units (~250m) — the fan avenues approach the station plaza

// Among the avenue-name candidates (r.primary from osm), keep only those whose
// connected component (shared endpoints) reaches the station. Prunes same-named
// roads elsewhere (a far 富士見通り in 谷保) and stray footways — the single source
// of truth for which avenues render as bright primary lines. Demoted candidates
// fall through to the secondary tier (or drop if their class isn't an arterial).
function stationPrimarySet(roads, projector) {
  const cand = roads.filter((r) => r.primary && r.points && r.points.length);
  const parent = new Map();
  const find = (x) => { let r = x; while (parent.get(r) !== r) r = parent.get(r); while (parent.get(x) !== r) { const n = parent.get(x); parent.set(x, r); x = n; } return r; };
  const uni = (a, b) => { parent.set(find(a), find(b)); };
  const key = (p) => p.lat.toFixed(4) + ',' + p.lon.toFixed(4); // ~11m node grid
  for (const r of cand) {
    const ks = r.points.map(key);
    for (const k of ks) if (!parent.has(k)) parent.set(k, k);
    for (let i = 1; i < ks.length; i++) uni(ks[i - 1], ks[i]);
  }
  const nearRoots = new Set();
  for (const r of cand) for (const p of r.points) { const { u, v } = projector.toPlan(p.lat, p.lon); if (Math.hypot(u, v) < STATION_R) nearRoots.add(find(key(p))); }
  return new Set(cand.filter((r) => nearRoots.has(find(key(r.points[0])))));
}

function median(arr) { const s = [...arr].sort((a, b) => a - b); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : 0; }

export function buildManifest({ osm, projector, planHeight = () => 0, perBuilding, params }) {
  const { SCALE, VSCALE, vexag, bounds, bbox, vOffset } = params;
  // [u, v, h] — height baked in so the runtime can hug roads to the DEM surface.
  const toUVH = (p) => { const { u, v } = projector.toPlan(p.lat, p.lon); return [u, v, planHeight(u, v)]; };

  // white avenues = 大学通り / 富士見通り / 旭通り (駅連結) + 大学通り's 谷保駅 continuation;
  // every other named arterial is the grey secondary tier.
  const primarySet = stationPrimarySet(osm.roads, projector);
  const roads = [];
  for (const r of osm.roads) {
    if (DROP_IDS.has(r.id)) continue; // 国立停車場谷保線 の谷保天満宮分岐 → 描かない（白でもグレーでも）
    const points = r.points.map(toUVH);
    const isPrimary = primarySet.has(r); // 駅連結の名前付き avenue → 白
    if (!isPrimary && !(r.name && SECONDARY_CLASSES.has(r.highway))) continue;
    if (!points.some(([u, v]) => within(u, v, bounds))) continue;
    if (isPrimary) {
      if (points.length >= 2) roads.push({ name: r.name, primary: true, points });
    } else {
      roads.push({ name: r.name, primary: false, highway: r.highway, points });
    }
  }

  // chuo railway: collapse the (dead-straight) 中央 line to one horizontal segment
  const railPts = [];
  for (const rail of osm.rails) if (CHUO_RE.test(rail.name)) for (const p of rail.points) railPts.push(toUVH(p));
  if (railPts.length) {
    const us = railPts.map((p) => p[0]).filter((u) => Number.isFinite(u));
    const vMed = median(railPts.map((p) => p[1]));
    const uMin = Math.max(bounds.u0, Math.min(...us)), uMax = Math.min(bounds.u1, Math.max(...us));
    roads.push({ name: 'chuo', primary: true, points: [[uMin, vMed, planHeight(uMin, vMed)], [uMax, vMed, planHeight(uMax, vMed)]] });
  }

  // green as plan-space AABB rects
  const green = [];
  for (const g of osm.green) {
    const uv = g.ring.map(toUVH);
    const us = uv.map((p) => p[0]), vs = uv.map((p) => p[1]);
    const rect = [Math.min(...us), Math.min(...vs), Math.max(...us), Math.max(...vs)];
    if (within((rect[0] + rect[2]) / 2, (rect[1] + rect[3]) / 2, bounds)) green.push(rect);
  }

  const station = osm.station && osm.station.point
    ? (([u, v, h]) => ({ u, v, h }))(toUVH(osm.station.point)) : null;

  return {
    bbox, origin: { lat: projector.origin.lat, lon: projector.origin.lon },
    scale: { SCALE, VSCALE, metersPerUnit: projector.metersPerUnit, vexag, thetaDeg: projector.thetaDeg, vOffset },
    roads, green,
    buildings: perBuilding.map((b) => ({ revealKey: b.revealKey, type: b.type, vStart: b.vStart, vCount: b.vCount })),
    landmarkNode: 'landmark',
    station,
    attribution: ['© OpenStreetMap contributors', '地理院タイル（標高タイル）を加工して作成', '3D都市モデル（Project PLATEAU／国土交通省）'],
  };
}
