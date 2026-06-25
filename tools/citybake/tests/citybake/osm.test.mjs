import assert from 'node:assert';
import { test } from 'node:test';
import { parseOsm, estimateLevels, classifyRoad } from '../../geo/osm.mjs';

// Overpass-shaped sample (mirrors the real Kunitachi data: a landmark way
// 旧国立駅舎, a decoy 旧守衛所, a station node, a compound-named avenue, a
// side street, a rail line, a park).
const SAMPLE = {
  elements: [
    { type: 'way', id: 1, tags: { building: 'yes' },
      geometry: [{ lat: 35.6990, lon: 139.4460 }, { lat: 35.6990, lon: 139.4465 }, { lat: 35.6985, lon: 139.4465 }, { lat: 35.6985, lon: 139.4460 }] },
    { type: 'way', id: 2, tags: { building: 'yes', historic: 'building', name: '旧国立駅舎' },
      geometry: [{ lat: 35.6989, lon: 139.4461 }, { lat: 35.6989, lon: 139.4463 }, { lat: 35.6987, lon: 139.4463 }, { lat: 35.6987, lon: 139.4461 }] },
    { type: 'way', id: 3, tags: { building: 'yes', name: '旧守衛所', heritage: '3' },
      geometry: [{ lat: 35.7010, lon: 139.4500 }, { lat: 35.7010, lon: 139.4502 }, { lat: 35.7008, lon: 139.4502 }, { lat: 35.7008, lon: 139.4500 }] },
    { type: 'node', id: 4, lat: 35.6992, lon: 139.4462, tags: { railway: 'station', name: '国立' } },
    { type: 'way', id: 5, tags: { highway: 'secondary', name: '立川国分寺線;旭通り' },
      geometry: [{ lat: 35.6990, lon: 139.4460 }, { lat: 35.6980, lon: 139.4470 }] },
    { type: 'way', id: 6, tags: { highway: 'residential', name: '名無し小路' },
      geometry: [{ lat: 35.7000, lon: 139.4400 }, { lat: 35.7010, lon: 139.4410 }] },
    { type: 'way', id: 7, tags: { railway: 'rail', name: '中央本線' },
      geometry: [{ lat: 35.6995, lon: 139.4400 }, { lat: 35.6996, lon: 139.4500 }] },
    { type: 'way', id: 8, tags: { leisure: 'park', name: '円形公園' },
      geometry: [{ lat: 35.6985, lon: 139.4459 }, { lat: 35.6985, lon: 139.4463 }, { lat: 35.6982, lon: 139.4463 }, { lat: 35.6982, lon: 139.4459 }] },
  ],
};

test('estimateLevels: explicit building:levels wins, else low-rise default', () => {
  assert.strictEqual(estimateLevels({ 'building:levels': '4' }), 4);
  assert.ok(estimateLevels({ building: 'house' }) <= 3);
  assert.ok(estimateLevels({ building: 'house' }) >= 1);
});

test('classifyRoad: named avenue (substring, compound names) is primary', () => {
  assert.strictEqual(classifyRoad({ name: '大学通り', highway: 'secondary' }).primary, true);
  assert.strictEqual(classifyRoad({ name: '立川国分寺線;旭通り', highway: 'secondary' }).primary, true);
  assert.strictEqual(classifyRoad({ name: '名無し小路', highway: 'residential' }).primary, false);
});

test('parseOsm separates the 旧駅舎 landmark from the functional station + decoys', () => {
  const out = parseOsm(SAMPLE);
  assert.ok(out.landmark, 'old station building found');
  assert.strictEqual(out.landmark.name, '旧国立駅舎'); // preferred over 旧守衛所
  assert.ok(!out.landmark.tags.railway, 'landmark is not the functional station');
  assert.ok(out.landmark.ring && out.landmark.ring.length >= 3, 'landmark has a footprint ring');
  assert.ok(out.station, 'functional station found');
  assert.ok(out.station.point, 'station is a point');
  assert.strictEqual(out.station.tags.railway, 'station');
});

test('parseOsm yields footprints (minus landmark), roads, rails, green', () => {
  const out = parseOsm(SAMPLE);
  // buildings 1 + 3 (landmark 2 is pulled out), decoy 旧守衛所 stays as a generic building
  assert.strictEqual(out.footprints.length, 2);
  assert.ok(out.footprints.every((f) => f.ring && Number.isFinite(f.heightM)));
  assert.ok(out.roads.length >= 2);
  assert.ok(out.roads.some((r) => r.primary), 'at least one primary avenue');
  assert.ok(out.rails.length >= 1, 'the Chuo rail line');
  assert.ok(out.green.length >= 1, 'the park');
});
