// One-time fetch of the real source data into committed fixtures/ so the bake is
// deterministic and `node --test` never touches the network. Run once:
//   node tools/citybake/fetch.mjs
// Sources (attribute in the HUD, Plan 3):
//   OSM via Overpass — © OpenStreetMap contributors (ODbL)
//   GSI 標高タイル (DEM) — 地理院タイル（標高タイル）
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { lonLatToGlobalPx } from './geo/dem.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, 'fixtures');
const BBOX = { s: 35.690, w: 139.435, n: 35.705, e: 139.458 }; // ~1.5km around 国立駅

const OVERPASS = 'https://overpass-api.de/api/interpreter';
const UA = 'citybake/1.0 (kunitachi-vj render)'; // Overpass rejects requests without a User-Agent (406)
const QUERY = `[out:json][timeout:90][bbox:${BBOX.s},${BBOX.w},${BBOX.n},${BBOX.e}];
(
  way["building"]; relation["building"];
  way["highway"]["name"];
  way["railway"="rail"]; node["railway"="station"]; way["railway"="station"];
  way["leisure"="park"]; relation["leisure"="park"];
  way["landuse"~"^(grass|forest|recreation_ground|cemetery|meadow)$"];
  way["natural"="wood"]; node["natural"="tree"];
  way["historic"]; node["historic"];
);
out body geom;`;

mkdirSync(join(FIX, 'dem'), { recursive: true });

console.log('→ Overpass …');
const osmRes = await fetch(OVERPASS, {
  method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
  body: 'data=' + encodeURIComponent(QUERY),
});
if (!osmRes.ok) throw new Error('Overpass ' + osmRes.status);
const osmText = await osmRes.text();
writeFileSync(join(FIX, 'osm.json'), osmText);
const osm = JSON.parse(osmText);
console.log('  osm.json', osm.elements.length, 'elements');

// origin = the functional station node (single source of truth)
let origin = { lat: (BBOX.s + BBOX.n) / 2, lon: (BBOX.w + BBOX.e) / 2 };
for (const el of osm.elements) { const t = el.tags || {}; if (el.type === 'node' && t.railway === 'station') { origin = { lat: el.lat, lon: el.lon }; break; } }
console.log('  origin (station)', origin);

async function fetchTiles(z, urlFor) {
  const tl = lonLatToGlobalPx(BBOX.n, BBOX.w, z), br = lonLatToGlobalPx(BBOX.s, BBOX.e, z);
  const x0 = Math.floor(tl.x / 256), x1 = Math.floor(br.x / 256), y0 = Math.floor(tl.y / 256), y1 = Math.floor(br.y / 256);
  const tiles = []; let misses = 0;
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
    const r = await fetch(urlFor(z, x, y), { headers: { 'User-Agent': UA } });
    if (r.status !== 200) { misses++; continue; }
    const txt = await r.text();
    const file = `dem/${z}_${x}_${y}.txt`;
    writeFileSync(join(FIX, file), txt);
    tiles.push({ x, y, file });
  }
  return { tiles, misses };
}

console.log('→ GSI DEM (dem5a z15) …');
let z = 15;
let res = await fetchTiles(15, (zz, x, y) => `https://cyberjapandata.gsi.go.jp/xyz/dem5a/${zz}/${x}/${y}.txt`);
if (res.misses > 0 || res.tiles.length === 0) {
  console.log(`  dem5a incomplete (${res.misses} misses) → falling back to DEM10B z14`);
  z = 14;
  res = await fetchTiles(14, (zz, x, y) => `https://cyberjapandata.gsi.go.jp/xyz/dem/${zz}/${x}/${y}.txt`);
}
console.log('  dem z' + z, res.tiles.length, 'tiles');

writeFileSync(join(FIX, 'meta.json'), JSON.stringify({
  origin, bbox: [BBOX.s, BBOX.w, BBOX.n, BBOX.e],
  dem: { z, tiles: res.tiles },
  fetchedAt: new Date().toISOString(),
  source: { osm: '© OpenStreetMap contributors (ODbL)', dem: '地理院タイル（標高タイル）' },
}, null, 2));
console.log('✓ fixtures written to', FIX);
