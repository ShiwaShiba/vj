// Bake entrypoint: deterministic, pure-from-fixtures. Reads the committed
// OSM/GSI fixtures and emits dist/city.glb + dist/city.manifest.json — the asset
// the proto renderer loads. No network. Tunables via env (MPU/VEXAG/RAYS/RADIUS).
//   node tools/citybake/bake.mjs
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseDemTxt, stitchTiles, makeDemSampler, makePlanHeight } from './geo/dem.mjs';
import { makeProjector } from './geo/project.mjs';
import { parseOsm } from './geo/osm.mjs';
import { parsePlateau, dropNear } from './geo/plateau.mjs';
import { assembleCity } from './bake/assemble.mjs';
import { bakeAO } from './bake/ao.mjs';
import { writeGlb } from './bake/glb.mjs';
import { buildManifest } from './bake/manifest.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, 'fixtures'), DIST = join(HERE, 'dist');
const MPU = +process.env.MPU || 420;          // metres per plan unit (frames the scene)
const VEXAG = +process.env.VEXAG || 2.5;       // DEM vertical exaggeration
const RAYS = +process.env.RAYS || 20;          // AO hemisphere rays / vertex
const RADIUS = +process.env.RADIUS || 0.4;     // AO ray length (world units)
const AO_STRENGTH = +process.env.AOSTR || 0.55; // soft contact shadow (reference touch), not heavy darkening
const BOUNDS = { u0: -4.8, u1: 3.1, v0: -1.2, v1: 7.4 }; // 国立市全域（南=谷保天満宮まで延伸・北=中央線少し北で切る）
const NX = 200, NV = 170, SCALE = 6, VSCALE = 5, vOffset = 0.3; // 広域化に合わせ地形メッシュを密に
// Greys are gamma-encoded (linear→sRGB) on output, so keep terrain near-black
// (reference = black ground + white linework) and buildings a bright white carpet.
const BASE_GREY = { terrain: 0.022, generic: 1.0, landmark: 1.15, station: 0.75 };

// --- load fixtures -------------------------------------------------------
const meta = JSON.parse(readFileSync(join(FIX, 'meta.json'), 'utf8'));
const osmData = JSON.parse(readFileSync(join(FIX, 'osm.json'), 'utf8'));
const tiles = meta.dem.tiles.map((t) => ({ x: t.x, y: t.y, grid: parseDemTxt(readFileSync(join(FIX, t.file), 'utf8')) }));
const sampler = makeDemSampler(stitchTiles(tiles, meta.dem.z));

// --- level the Chuo line onto the horizontal axis ------------------------
const M_LAT = 110540, mPerLon = M_LAT * Math.cos(meta.origin.lat * Math.PI / 180);
let thetaDeg = 0;
{
  const railPts = [];
  for (const el of osmData.elements) if ((el.tags || {}).railway === 'rail' && /中央/.test(el.tags.name || '') && el.geometry) railPts.push(...el.geometry);
  if (railPts.length > 1) {
    railPts.sort((a, b) => a.lon - b.lon);
    const A = railPts[0], B = railPts[railPts.length - 1];
    const dxe = (B.lon - A.lon) * mPerLon, dxs = (A.lat - B.lat) * M_LAT;
    thetaDeg = -Math.atan2(dxs, dxe) * 180 / Math.PI;
  }
}

const projector = makeProjector({ origin: meta.origin, metersPerUnit: MPU, thetaDeg });
const refElevation = sampler.elevationAt(meta.origin.lat, meta.origin.lon);
const planHeight = makePlanHeight({ sampler, projector, refElevation, vexag: VEXAG });

// --- assemble + AO bake --------------------------------------------------
const osm = parseOsm(osmData, { origin: meta.origin });

// --- swap generic buildings: OSM → PLATEAU LOD1（実フットプリント＋実測高さ）---------
// 道路/線路/旧駅舎/現駅/緑地は OSM 継続。建物だけ PLATEAU に替える。fixtures は生CityGMLの
// gzip（出所忠実）。gunzip → txml パース → lod0RoofEdge + measuredHeight。
const bbox = { s: meta.bbox[0], w: meta.bbox[1], n: meta.bbox[2], e: meta.bbox[3] };
const plDir = join(FIX, 'plateau');
const plFoot = [];
for (const f of readdirSync(plDir).filter((f) => f.endsWith('.gml.gz')).sort()) // sort＝決定論
  plFoot.push(...parsePlateau(gunzipSync(readFileSync(join(plDir, f))).toString('utf8'), { bbox }).footprints);
const guards = [];
if (osm.landmark && osm.landmark.centroid) guards.push(osm.landmark.centroid);
if (osm.station && osm.station.point) guards.push(osm.station.point);
osm.footprints = dropNear(plFoot, guards, 25); // 旧駅舎/現駅近傍を落として埋没・重複を防ぐ
console.log(`PLATEAU buildings: ${plFoot.length} parsed → ${osm.footprints.length} after dedup (was OSM 976)`);

const params = { SCALE, VSCALE, NX, NV, vOffset, gridStep: 0.06, bounds: BOUNDS };
const city = assembleCity({ osm, projector, planHeight, params });

const triNodes = [
  { name: 'terrain', node: city.terrain, type: 'terrain' },
  { name: 'buildings', node: city.buildings, type: 'generic' },
  ...(city.landmark ? [{ name: 'landmark', node: city.landmark, type: 'landmark' }] : []),
  ...(city.station ? [{ name: 'station', node: city.station, type: 'station' }] : []),
];

// merge into one occluder soup (track per-node vertex ranges) + per-vertex base grey
let NP = 0, NI = 0;
for (const t of triNodes) { NP += t.node.positions.length; NI += t.node.indices.length; }
const positions = new Float32Array(NP), normals = new Float32Array(NP), indices = new Uint32Array(NI), baseGrey = new Float32Array(NP / 3);
let po = 0, io = 0, vb = 0;
for (const t of triNodes) {
  positions.set(t.node.positions, po); normals.set(t.node.normals, po);
  for (let k = 0; k < t.node.indices.length; k++) indices[io + k] = t.node.indices[k] + vb;
  const vcount = t.node.positions.length / 3;
  // per-building type can override (landmark/station nodes are single-type here)
  baseGrey.fill(BASE_GREY[t.type] ?? 0.8, vb, vb + vcount);
  t.range = { start: vb, count: vcount };
  po += t.node.positions.length; io += t.node.indices.length; vb += vcount;
}

const t0 = Date.now();
const colors = bakeAO({ positions, indices, normals }, { rays: RAYS, radius: RADIUS, seed: 1, baseGrey, aoStrength: AO_STRENGTH });
console.log(`AO bake ${((Date.now() - t0) / 1000).toFixed(1)}s  (${NP / 3} verts, ${NI / 3} tris, ${RAYS} rays r=${RADIUS})`);

// --- glb nodes -----------------------------------------------------------
const glbNodes = [];
for (const t of triNodes) {
  const c = colors.subarray(t.range.start * 3, (t.range.start + t.range.count) * 3);
  glbNodes.push({ name: t.name, positions: t.node.positions, colors: new Float32Array(c), indices: t.node.indices });
}
// terrain grid as a LINES node (pair-stored vertices → identity indices)
const gN = city.terrainGrid.positions.length / 3;
glbNodes.splice(1, 0, { name: 'terrainGrid', mode: 1, positions: city.terrainGrid.positions, indices: Uint32Array.from({ length: gN }, (_, i) => i) });

mkdirSync(DIST, { recursive: true });
const glb = writeGlb({ nodes: glbNodes });
writeFileSync(join(DIST, 'city.glb'), glb);

const manifest = buildManifest({ osm, projector, planHeight, perBuilding: city.buildings.perBuilding, params: { SCALE, VSCALE, vexag: VEXAG, bounds: BOUNDS, bbox: meta.bbox, vOffset } });
writeFileSync(join(DIST, 'city.manifest.json'), JSON.stringify(manifest));

console.log(`✓ city.glb ${(glb.length / 1024).toFixed(0)}KB  | buildings ${city.buildings.perBuilding.length} | grid segs ${gN / 2} | thetaDeg ${thetaDeg.toFixed(2)} | primary roads ${manifest.roads.length}`);
