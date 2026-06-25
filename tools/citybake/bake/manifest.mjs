// Build the runtime manifest: scene scale, primary-road + chuo polylines (so
// the renderer draws roads on top and they never get buried), green rects,
// per-building reveal keys/types (for the terrain→roads→buildings→trees reveal),
// the landmark node name, and the OSM/GSI attribution strings.
const CHUO_RE = /中央/;

const within = (u, v, b) => u > b.u0 - 0.2 && u < b.u1 + 0.2 && v > b.v0 - 0.2 && v < b.v1 + 0.2;

function median(arr) { const s = [...arr].sort((a, b) => a - b); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : 0; }

export function buildManifest({ osm, projector, perBuilding, params }) {
  const { SCALE, VSCALE, vexag, bounds, bbox, vOffset } = params;
  const toUV = (p) => { const { u, v } = projector.toPlan(p.lat, p.lon); return [u, v]; };

  // primary avenues (drop ones fully outside the frame)
  const roads = [];
  for (const r of osm.roads) {
    if (!r.primary) continue;
    const points = r.points.map(toUV);
    if (points.some(([u, v]) => within(u, v, bounds))) roads.push({ name: r.name, primary: true, points });
  }

  // chuo railway: collapse the (dead-straight) 中央 line to one horizontal segment
  const railPts = [];
  for (const rail of osm.rails) if (CHUO_RE.test(rail.name)) for (const p of rail.points) railPts.push(toUV(p));
  if (railPts.length) {
    const us = railPts.map((p) => p[0]).filter((u) => Number.isFinite(u));
    const vMed = median(railPts.map((p) => p[1]));
    const uMin = Math.max(bounds.u0, Math.min(...us)), uMax = Math.min(bounds.u1, Math.max(...us));
    roads.push({ name: 'chuo', primary: true, points: [[uMin, vMed], [uMax, vMed]] });
  }

  // green as plan-space AABB rects
  const green = [];
  for (const g of osm.green) {
    const uv = g.ring.map(toUV);
    const us = uv.map((p) => p[0]), vs = uv.map((p) => p[1]);
    const rect = [Math.min(...us), Math.min(...vs), Math.max(...us), Math.max(...vs)];
    if (within((rect[0] + rect[2]) / 2, (rect[1] + rect[3]) / 2, bounds)) green.push(rect);
  }

  const station = osm.station && osm.station.point
    ? (([u, v]) => ({ u, v }))(toUV(osm.station.point)) : null;

  return {
    bbox, origin: { lat: projector.origin.lat, lon: projector.origin.lon },
    scale: { SCALE, VSCALE, metersPerUnit: projector.metersPerUnit, vexag, thetaDeg: projector.thetaDeg, vOffset },
    roads, green,
    buildings: perBuilding.map((b) => ({ revealKey: b.revealKey, type: b.type, vStart: b.vStart, vCount: b.vCount })),
    landmarkNode: 'landmark',
    station,
    attribution: ['© OpenStreetMap contributors', '地理院タイル（標高タイル）を加工して作成'],
  };
}
