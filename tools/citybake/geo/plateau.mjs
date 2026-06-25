// PLATEAU CityGML (EPSG:6697 = JGD2011 緯度経度 + T.P.標高) → 緯度経度フットプリント。
// gml:posList は "lat lon height lat lon height …"。投影は projector.toPlan(lat,lon) に委譲。
import { parse } from '../vendor/txml.mjs';

const isEl = (n) => n && typeof n === 'object' && n.tagName;
function* walk(nodes) { for (const n of nodes) if (isEl(n)) { yield n; if (n.children) yield* walk(n.children); } }
const findAll = (nodes, tag) => { const o = []; for (const n of walk(nodes)) if (n.tagName === tag) o.push(n); return o; };
const findFirst = (node, tag) => { for (const n of walk(node.children || [])) if (n.tagName === tag) return n; return null; };
const textOf = (node) => (node.children || []).filter((c) => typeof c === 'string').join(' ').trim();
const centroidLL = (ring) => { let lat = 0, lon = 0; for (const p of ring) { lat += p.lat; lon += p.lon; } return { lat: lat / ring.length, lon: lon / ring.length }; };
const inBbox = (c, b) => c.lat >= b.s && c.lat <= b.n && c.lon >= b.w && c.lon <= b.e;

export function parsePlateau(xml, { bbox = null } = {}) {
  const root = parse(xml);
  const footprints = [];
  for (const b of findAll(root, 'bldg:Building')) {
    const mh = findFirst(b, 'bldg:measuredHeight');
    const heightM = mh ? parseFloat(textOf(mh)) : NaN;
    const edge = findFirst(b, 'bldg:lod0RoofEdge') || findFirst(b, 'bldg:lod0FootPrint');
    const posNode = edge ? findFirst(edge, 'gml:posList') : null;
    if (!posNode || !Number.isFinite(heightM) || heightM <= 0) continue; // 高さ/輪郭欠落は除外
    const nums = textOf(posNode).split(/\s+/).map(Number);
    const ring = [];
    for (let i = 0; i + 2 < nums.length; i += 3) ring.push({ lat: nums[i], lon: nums[i + 1] }); // lat, lon（標高は捨てる）
    if (ring.length > 1) { const a = ring[0], z = ring[ring.length - 1]; if (a.lat === z.lat && a.lon === z.lon) ring.pop(); }
    if (ring.length < 3) continue;
    const centroid = centroidLL(ring);
    if (bbox && !inBbox(centroid, bbox)) continue;
    footprints.push({ id: (b.attributes && b.attributes['gml:id']) || '', ring, heightM, centroid });
  }
  return { footprints };
}

// 旧駅舎ランドマーク/現駅を埋没・重複させないため、ガード点近傍のPLATEAU建物を落とす。
const M_LAT = 110540;
export function dropNear(footprints, guards, meters) {
  if (!guards.length) return footprints;
  const mPerLon = M_LAT * Math.cos((guards[0].lat) * Math.PI / 180);
  const near = (c) => guards.some((g) => Math.hypot((c.lat - g.lat) * M_LAT, (c.lon - g.lon) * mPerLon) < meters);
  return footprints.filter((f) => !near(f.centroid));
}
