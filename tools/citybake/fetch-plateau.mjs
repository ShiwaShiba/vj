// 一度きり: PLATEAU 国立市2023 v4 CityGML zip → bbox被覆の3次メッシュbldg .gml を fixtures/plateau/ へ。
//   node tools/citybake/fetch-plateau.mjs
// 出所: 3D都市モデル（Project PLATEAU／国土交通省）, dataset plateau-13215-kunitachi-shi-2023, EPSG:6697。
import { writeFileSync, readFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, 'fixtures'), OUT = join(FIX, 'plateau');
const BBOX = { s: 35.690, w: 139.435, n: 35.705, e: 139.458 }; // fetch.mjs と一致させる
const ZIP_URL = 'https://assets.cms.plateau.reearth.io/assets/fe/8aa8a6-0d53-4d20-bcb9-c0a1299b0536/13215_kunitachi-shi_pref_2023_citygml_2_op.zip';

// 標準地域3次メッシュコード（約1km）
function mesh3(lat, lon) {
  const p = Math.floor(lat * 1.5), u = Math.floor(lon - 100);
  const la1 = lat * 60 - p * 40, lo1 = (lon - 100 - u) * 60;
  const q = Math.floor(la1 / 5), v = Math.floor(lo1 / 7.5);
  const la2 = la1 - q * 5, lo2 = lo1 - v * 7.5;
  const r = Math.floor(la2 * 2), w = Math.floor(lo2 * 60 / 45);
  return `${p}${u}${q}${v}${r}${w}`;
}
const codes = new Set();
for (let lat = BBOX.s; lat <= BBOX.n + 1e-9; lat += 0.001)
  for (let lon = BBOX.w; lon <= BBOX.e + 1e-9; lon += 0.001) codes.add(mesh3(lat, lon));

function findDir(base, name) {
  for (const e of readdirSync(base)) {
    const p = join(base, e);
    if (statSync(p).isDirectory()) { if (e === name) return p; const r = findDir(p, name); if (r) return r; }
  }
  return null;
}

const tmp = join(HERE, '.plateau-tmp');
mkdirSync(tmp, { recursive: true }); mkdirSync(OUT, { recursive: true });
const zipPath = join(tmp, 'kunitachi.zip');
console.log('→ download', ZIP_URL);
const res = await fetch(ZIP_URL);
if (!res.ok) throw new Error('download ' + res.status);
writeFileSync(zipPath, Buffer.from(await res.arrayBuffer()));
console.log('→ unzip');
execFileSync('unzip', ['-o', '-q', zipPath, '-d', tmp]); // macOS/Linux の system unzip（fetch時のみ・no shell）
const bldgDir = findDir(tmp, 'bldg');
if (!bldgDir) throw new Error('udx/bldg not found in zip');
// 生CityGMLは全LOD2込みで巨大(~286MB)。実際に使うのはlod0RoofEdge+measuredHeightだけだが
// 出所忠実のため生をgzipで保存(~13MB)。bakeはgunzip+txmlでパースする。
let copied = 0;
for (const f of readdirSync(bldgDir).sort()) {
  if (!f.endsWith('.gml')) continue;
  if ([...codes].some((c) => f.startsWith(c))) {
    writeFileSync(join(OUT, f + '.gz'), gzipSync(readFileSync(join(bldgDir, f)), { level: 9 }));
    copied++;
  }
}
writeFileSync(join(OUT, 'plateau.meta.json'), JSON.stringify({
  dataset: 'plateau-13215-kunitachi-shi-2023', spec: 'v4', source: ZIP_URL,
  crs: 'EPSG:6697 (JGD2011 lat/lon + T.P. height)', bbox: [BBOX.s, BBOX.w, BBOX.n, BBOX.e],
  meshCodes: [...codes].sort(), fetchedAt: new Date().toISOString(),
  license: 'Project PLATEAU site policy（商用可）／出典表示: 国土交通省',
}, null, 2));
console.log(`✓ copied ${copied} bldg meshes → ${OUT}（meshes: ${[...codes].sort().join(', ')}）`);
