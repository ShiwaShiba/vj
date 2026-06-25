import assert from 'node:assert';
import { test } from 'node:test';
import { parse } from '../../vendor/txml.mjs';
import { parsePlateau, dropNear } from '../../geo/plateau.mjs';
import { makeProjector } from '../../geo/project.mjs';

const GML = `<?xml version="1.0"?>
<core:CityModel xmlns:core="c" xmlns:bldg="b" xmlns:gml="g">
 <core:cityObjectMember>
  <bldg:Building gml:id="bld-1">
   <bldg:measuredHeight uom="m">31.4</bldg:measuredHeight>
   <bldg:lod0RoofEdge><gml:MultiSurface><gml:surfaceMember><gml:Polygon><gml:exterior><gml:LinearRing>
     <gml:posList>35.6990 139.4460 40 35.6992 139.4460 40 35.6992 139.4464 40 35.6990 139.4464 40 35.6990 139.4460 40</gml:posList>
   </gml:LinearRing></gml:exterior></gml:Polygon></gml:surfaceMember></gml:MultiSurface></bldg:lod0RoofEdge>
  </bldg:Building>
 </core:cityObjectMember>
 <core:cityObjectMember>
  <bldg:Building gml:id="bld-noheight">
   <bldg:lod0RoofEdge><gml:Polygon><gml:exterior><gml:LinearRing>
     <gml:posList>35.70 139.45 0 35.70 139.451 0 35.701 139.451 0</gml:posList>
   </gml:LinearRing></gml:exterior></gml:Polygon></bldg:lod0RoofEdge>
  </bldg:Building>
 </core:cityObjectMember>
</core:CityModel>`;

test('parsePlateau: posList is lat lon (EPSG:6697), height from measuredHeight', () => {
  const { footprints } = parsePlateau(GML);
  assert.strictEqual(footprints.length, 1, 'height-less building dropped');
  const f = footprints[0];
  assert.strictEqual(f.id, 'bld-1');
  assert.strictEqual(f.heightM, 31.4);
  assert.ok(Math.abs(f.ring[0].lat - 35.6990) < 1e-9, `lat-first: got ${f.ring[0].lat}`);
  assert.ok(Math.abs(f.ring[0].lon - 139.4460) < 1e-9, `lon-second: got ${f.ring[0].lon}`);
  assert.strictEqual(f.ring.length, 4, 'closing duplicate vertex removed');
  // 軸順が逆なら緯度に経度(139)が入り投影が暴れる — 投影サニティで二重に守る
  const proj = makeProjector({ origin: { lat: 35.6992, lon: 139.4465 }, metersPerUnit: 420 });
  const c = proj.toPlan(f.centroid.lat, f.centroid.lon);
  assert.ok(Math.abs(c.u) < 1 && Math.abs(c.v) < 1, `centroid near origin: u=${c.u} v=${c.v}`);
});

test('parsePlateau: bbox filters by centroid', () => {
  const inside = parsePlateau(GML, { bbox: { s: 35.69, w: 139.44, n: 35.70, e: 139.45 } });
  assert.strictEqual(inside.footprints.length, 1);
  const outside = parsePlateau(GML, { bbox: { s: 35.80, w: 139.50, n: 35.81, e: 139.51 } });
  assert.strictEqual(outside.footprints.length, 0);
});

test('dropNear removes footprints within radius of guard points', () => {
  const at = (lat, lon) => ({ id: `${lat},${lon}`, ring: [{ lat, lon }], heightM: 6, centroid: { lat, lon } });
  const fps = [at(35.6988, 139.4462), at(35.6995, 139.4470)]; // 1つ目は旧駅舎近傍
  const guards = [{ lat: 35.6988, lon: 139.4462 }];           // 旧駅舎centroid
  const kept = dropNear(fps, guards, 25);
  assert.strictEqual(kept.length, 1);
  assert.strictEqual(kept[0].centroid.lat, 35.6995, 'far building kept, near building dropped');
});

test('vendored txml parses a namespaced element tree', () => {
  const tree = parse('<a:Root xmlns:a="x"><a:Kid v="1">hi</a:Kid></a:Root>');
  const root = tree.find((n) => n && n.tagName === 'a:Root');
  assert.ok(root, 'root found');
  const kid = root.children.find((n) => n && n.tagName === 'a:Kid');
  assert.strictEqual(kid.attributes.v, '1');
  assert.strictEqual(kid.children[0], 'hi');
});
