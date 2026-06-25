# Plan 2 — Offline OSM/DEM/AO Baker → swap into the verified proto renderer

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **On execution, first copy this file to `docs/superpowers/plans/2026-06-25-city-osm-dem-baker.md`** (repo convention; this `~/.claude/plans/` copy is the plan-mode scratch location).

**Goal:** Replace the proto's procedural city with a baked asset built from real OpenStreetMap footprints + GSI DEM terrain + a real raycast ambient-occlusion bake, emitted as glTF (.glb) + manifest.json, then loaded into the existing verified Three.js proto renderer and screenshot-verified against the reference.

**Architecture:** A self-contained Node tool `tools/citybake/` runs in two stages: (1) `fetch.mjs` hits Overpass + GSI once and writes raw responses into committed `fixtures/`; (2) `bake.mjs` is pure-from-fixtures — project lat/lon → plan space, build a DEM heightfield + extruded footprints, cast real hemisphere AO rays (uniform-grid + reused three.js `Raycaster`, no npm deps), bake greyscale AO×light into vertex colors, and emit `dist/city.glb` (terrain + buildings + landmark + current-station meshes) and `dist/city.manifest.json` (bbox/origin/scale, primary-road polylines, green zones, per-building reveal keys + type tags, landmark node id, attribution). The runtime loads the `.glb` with a vendored `GLTFLoader`, swaps every material to the proto's existing `MeshBasicMaterial({vertexColors})` (monochrome, unlit), and builds roads/railway/station-glow from the manifest so primary roads stay un-buried. Reveal order (terrain→roads→buildings→trees) is preserved by add-order + per-building reveal keys.

**Tech Stack:** Node v24 ESM (`"type":"module"`), vendored three.js r160 (reused headless in Node for `Raycaster`), hand-rolled minimal `.glb` writer (avoids DOM-bound `GLTFExporter`), vendored `GLTFLoader` + import map in the browser, `node --test`, preview server `vj` (localhost:8125).

---

## Context (why this change)

Plan 1 proved the *touch* (black ground, white linework, solid carpet vs SE wireframe band, glowing station, crisp double track, film grain) renders in real time on the buildless/iPad WebGL stack. The honest gap (handoff §4): buildings are procedural boxes, AO is faked vertex-color gradient, linework is a uniform grid — not real geography. Per the spec, the remaining "photo-likeness" is **data-dependent**. Plan 2 closes that gap: real OSM footprints, real GSI relief, and a *genuine* raycast AO bake (the user explicitly rejected faked AO), swapped into the renderer Plan 1 already validated.

### Locked decisions (this session)
- **Output format = glTF `.glb` + `manifest.json`** (vendor `GLTFLoader`; buildless via import map; vertex AO in `COLOR_0`).
- **Data acquisition = commit raw Overpass/GSI responses as `fixtures/`**; `bake.mjs` is deterministic-from-fixtures; `node --test` never touches the network.
- **旧駅舎 (old station building) = identify + tag + distinct visible block** this Plan; triangular-roof craft deferred to Plan 3.

### Constraints that must not break (守る線)
- **Monochrome only** — greys, no chroma, no rainbow glow.
- **旧駅舎 = #1 landmark**, *separate* from the functional JR station (may be scaled), never buried.
- **Primary roads** (大学通り / 富士見通り / 旭通り / 中央線) always legible — built from manifest as runtime lines with `depthTest:false`, `renderOrder` high.
- **iPad PWA / buildless ESM** — no bundler, no build step; new deps are vendored ESM files only.
- **Reveal order terrain→roads→buildings→trees** — preserved by scene add-order + per-building reveal-distance keys (animation itself is Plan 3).
- **Plan space contract (unchanged):** `u`=east(+)/west(−), `v`=north(−)/south(+), apex(station)=(0,0); world=`(u*SCALE, h*VSCALE, (v−0.3)*SCALE)`, `SCALE=6`, `VSCALE=5`.

### Research reference (verified 2026-06-25)
- **GSI DEM tiles:** `https://cyberjapandata.gsi.go.jp/xyz/dem5a/{z}/{x}/{y}.txt` (z=15, laser, best for flat Kunitachi); 404-fallback `https://cyberjapandata.gsi.go.jp/xyz/dem/{z}/{x}/{y}.txt` (DEM10B, z=14). Body = 256×256 comma-separated **meters**; no-data = literal `e`. Station tiles: z15 center `29076/12903`, z14 `14538/6451` (re-derive in code from chosen center). Attribution: **「地理院タイル（標高タイル）を加工して作成」**.
- **Overpass:** endpoint `https://overpass-api.de/api/interpreter`, bbox order `south,west,north,east` = `35.690,139.435,35.705,139.458`. Query pulls `building`, named `highway`, `railway=rail`, `railway=station`, `leisure=park`, `landuse~grass|forest|...`, `natural=wood|tree`, `historic`. Attribution: **「© OpenStreetMap contributors」** (ODbL). Fetch once, cache.
- **旧駅舎 identification rule:** the feature near `35.6990,139.4462` with a `historic=*` tag and/or `name` containing **「旧」**, and **no** `railway=station` tag — distinct from the functional station (which has `railway=station` / `building=train_station`). Confirm exact element by inspecting the fetched JSON.
- **Geometry confirmed:** home-plate fan from the south rotary — 大学通り straight **south** (spine), 富士見 **W/SW** (longer arm), 旭 **E/SE** (shorter arm); 学園通り is **not** a fan radial (exclude). 中央線 ≈ **horizontal** (WNW–ESE, few-degree tilt) → align to the u-axis. Current station ≈ `35.6992,139.4462`.

---

## File Structure

**New — offline baker (`tools/citybake/`):**
- `geo/project.mjs` — pure projection: lat/lon ↔ plan `(u,v)`; bbox→plan extent; `METERS_PER_PLAN_UNIT`, rotation θ. **Tested.**
- `geo/dem.mjs` — parse GSI `.txt` tile (256×256, `e`=NaN), stitch a tile block, bilinear `sampleElevation(lat,lon)`, `planHeight(u,v)` with vertical exaggeration. **Tested.**
- `geo/osm.mjs` — parse Overpass JSON → `{footprints[], roads[], green[], landmark, station}`; ring assembly from `geometry`; height estimate; primary/secondary road split by name; landmark/station identification. **Tested.**
- `bake/assemble.mjs` — build plan-space triangle soup: DEM terrain grid mesh + extruded footprint prisms (conformed to DEM), with per-building attrs (centroid u/v, height, reveal-distance key, type). **Tested (counts/bounds).**
- `bake/ao.mjs` — uniform XZ grid over the soup + hemisphere AO via reused three `Raycaster` against per-cell candidate meshes; combine AO × slope-light → greyscale vertex colors. **Tested (open plane ≈ no occlusion; covered vertex ≈ high occlusion).**
- `bake/glb.mjs` — minimal conformant `.glb` writer: `POSITION`+`COLOR_0`+indices accessors, one node per layer (terrain/buildings/landmark/station), unlit material. **Tested (re-parse header/chunks/accessor counts).**
- `bake/manifest.mjs` — assemble `manifest.json` (bbox, origin, scale params, road polylines in plan space, green rects, per-building reveal keys+types, landmark node name, attribution strings). **Tested (schema/shape).**
- `fetch.mjs` — one-time: Overpass POST + GSI tile GETs → `fixtures/osm.json`, `fixtures/dem/*.txt`, `fixtures/meta.json`. Network; **not** run by tests.
- `bake.mjs` — entrypoint: read fixtures → assemble → AO → write `dist/city.glb` + `dist/city.manifest.json`. Pure-from-fixtures.
- `fixtures/` — committed raw responses (deterministic input).
- `dist/` — committed baked output (`city.glb`, `city.manifest.json`) so the proto loads without re-baking.
- `tests/citybake/*.test.mjs` — Node tests for every pure module above.

**New — vendored runtime loader deps:**
- `src/vendor/three-addons/loaders/GLTFLoader.js`, `.../utils/BufferGeometryUtils.js` (GLTFLoader's dep) — copied from three r160 examples/jsm, unmodified.
- `city-proto.html` — add `<script type="importmap">` mapping `"three"`→`./src/vendor/three.module.js` and `"three/addons/"`→`./src/vendor/three-addons/`.

**Modified — runtime:**
- `src/cityproto/cityasset.js` (new) — `async loadCity()` → `{terrain, buildings, landmark, station, manifest}`; GLTFLoader load + traverse-and-swap to `MeshBasicMaterial({vertexColors:true})`.
- `src/cityproto/avenues.js` — generalize to build primary-road `Line`s from manifest polylines (keep `depthTest:false`, `renderOrder:10`); `buildAvenues(manifest)`.
- `src/cityproto/station.js` — `buildRailway(manifest)` from manifest chuo polyline; keep the runtime glow sprite (canvas texture, browser-only) anchored at manifest station.
- `src/cityproto/proto.js` — become `async`: `await loadCity()`, add layers in reveal order, keep overlay + camera + `window.__proto`. Procedural `terrain.js`/`buildings.js` stay in-repo as fallback but are no longer called.

**Unchanged contract:** `src/cityproto/geo.js` (plan-space constants/helpers + its tests) remains the coordinate authority; the baker imports `SCALE`/`VSCALE` semantics from it where useful.

---

## Phase A — Offline baker (Node, fully testable without a browser)

### Task A1: Projection (lat/lon ↔ plan space)

**Files:** Create `tools/citybake/geo/project.mjs`; Test `tools/citybake/tests/citybake/project.test.mjs`

- [ ] **Step 1 — Write the failing test**
```js
import assert from 'node:assert';
import { test } from 'node:test';
import { makeProjector } from '../../geo/project.mjs';

const ORIGIN = { lat: 35.6991, lon: 139.4462 }; // 国立駅
const P = makeProjector({ origin: ORIGIN, metersPerUnit: 420, thetaDeg: 0 });

test('station projects to the apex (0,0)', () => {
  const { u, v } = P.toPlan(ORIGIN.lat, ORIGIN.lon);
  assert.ok(Math.hypot(u, v) < 1e-6, `apex off: ${u},${v}`);
});
test('south of the station is +v (south), within scale', () => {
  const south = P.toPlan(ORIGIN.lat - 420 / 110540, ORIGIN.lon); // ~420 m south
  assert.ok(south.v > 0.9 && south.v < 1.1, `v=${south.v}`);
  assert.ok(Math.abs(south.u) < 1e-3, `u=${south.u}`);
});
test('east of the station is +u (east)', () => {
  const east = P.toPlan(ORIGIN.lat, ORIGIN.lon + 420 / (110540 * Math.cos(ORIGIN.lat * Math.PI / 180)));
  assert.ok(east.u > 0.9 && east.u < 1.1, `u=${east.u}`);
});
test('round-trips toPlan→toLatLon', () => {
  const ll = P.toLatLon(0.7, -0.3);
  const back = P.toPlan(ll.lat, ll.lon);
  assert.ok(Math.hypot(back.u - 0.7, back.v + 0.3) < 1e-6);
});
```
- [ ] **Step 2 — Run, expect FAIL** — `node --test tools/citybake/tests/citybake/project.test.mjs` → "makeProjector is not a function".
- [ ] **Step 3 — Implement**
```js
// Plan space: u=east(+), v=south(+) (north is -v); apex=origin=(0,0).
const M_PER_DEG_LAT = 110540;
export function makeProjector({ origin, metersPerUnit, thetaDeg = 0 }) {
  const lat0 = origin.lat, lon0 = origin.lon;
  const mPerLon = 110540 * Math.cos(lat0 * Math.PI / 180); // ~ equirectangular
  const th = thetaDeg * Math.PI / 180, c = Math.cos(th), s = Math.sin(th);
  return {
    metersPerUnit, origin,
    toPlan(lat, lon) {
      const xe = (lon - lon0) * mPerLon;          // east metres
      const xs = (lat0 - lat) * M_PER_DEG_LAT;    // south metres (north→negative)
      const xr = c * xe - s * xs, sr = s * xe + c * xs; // rotate to align chuo horizontal
      return { u: xr / metersPerUnit, v: sr / metersPerUnit };
    },
    toLatLon(u, v) {
      const xr = u * metersPerUnit, sr = v * metersPerUnit;
      const xe = c * xr + s * sr, xs = -s * xr + c * sr;
      return { lat: lat0 - xs / M_PER_DEG_LAT, lon: lon0 + xe / mPerLon };
    },
  };
}
```
- [ ] **Step 4 — Run, expect PASS.**
- [ ] **Step 5 — Commit** `feat(citybake): lat/lon ↔ plan-space projector`.

### Task A2: GSI DEM parse + heightfield sampler

**Files:** Create `tools/citybake/geo/dem.mjs`; Test `tools/citybake/tests/citybake/dem.test.mjs`

- [ ] **Step 1 — Failing test** (uses a tiny synthetic 2×2-ish .txt string, not a real tile):
```js
import assert from 'node:assert';
import { test } from 'node:test';
import { parseDemTxt, bilinear } from '../../geo/dem.mjs';

test('parses comma grid in metres and marks `e` as NaN', () => {
  const grid = parseDemTxt('10,20\n30,e');     // 2 rows × 2 cols
  assert.deepStrictEqual(grid.rows, 2);
  assert.deepStrictEqual(grid.cols, 2);
  assert.strictEqual(grid.values[0], 10);
  assert.ok(Number.isNaN(grid.values[3]));     // the `e`
});
test('bilinear interpolates, skipping NaN gracefully', () => {
  const grid = { rows: 2, cols: 2, values: [0, 10, 0, 10] }; // east gradient
  assert.ok(Math.abs(bilinear(grid, 0.5, 0) - 5) < 1e-9);    // fx=0.5 → 5
  assert.ok(Math.abs(bilinear(grid, 0, 0) - 0) < 1e-9);
});
```
- [ ] **Step 2 — Run, expect FAIL.**
- [ ] **Step 3 — Implement** `parseDemTxt` (split lines/commas, `'e'`→`NaN`, record rows/cols), `bilinear(grid, fx, fy)` (fractional col/row, ignore NaN corners by falling back to nearest valid), plus `stitchTiles(tileMap)` (assemble a z-tile block into one grid keyed by world tile px) and `makeDemSampler({grid, tileOrigin, z})` exposing `elevationAt(lat,lon)` via slippy-map px math, and `planHeightFactory({sampler, projector, refElevation, vexag})` returning `planHeight(u,v) = (sampler.elevationAt(...) - refElevation)/metersPerUnit * vexag`. Provide tests for `elevationAt` against a stitched synthetic grid and for `planHeight` sign (higher elevation → larger `h`).
- [ ] **Step 4 — Run, expect PASS.**
- [ ] **Step 5 — Commit** `feat(citybake): GSI DEM parse + bilinear heightfield sampler`.

### Task A3: OSM parse → footprints / roads / green / landmark / station

**Files:** Create `tools/citybake/geo/osm.mjs`; Test `tools/citybake/tests/citybake/osm.test.mjs`

- [ ] **Step 1 — Failing test** against a small inline Overpass-shaped JSON object (a couple of building ways with `geometry`, one named highway, one `railway=station`, one `historic`+「旧」building, one `leisure=park`):
```js
import assert from 'node:assert';
import { test } from 'node:test';
import { parseOsm, estimateLevels, classifyRoad } from '../../geo/osm.mjs';

test('estimateLevels: explicit building:levels wins, else low-rise default', () => {
  assert.strictEqual(estimateLevels({ 'building:levels': '4' }), 4);
  assert.ok(estimateLevels({ building: 'house' }) <= 3);
});
test('classifyRoad: named 大学通り is primary', () => {
  assert.strictEqual(classifyRoad({ name: '大学通り', highway: 'secondary' }).primary, true);
  assert.strictEqual(classifyRoad({ name: '名無し小路', highway: 'residential' }).primary, false);
});
test('parseOsm separates landmark (historic+旧, no railway=station) from station', () => {
  const out = parseOsm(SAMPLE); // inline fixture defined in the test file
  assert.ok(out.landmark, 'old station building found');
  assert.ok(!out.landmark.tags.railway, 'landmark is not the functional station');
  assert.ok(out.station, 'functional station found');
  assert.ok(out.footprints.length >= 1 && out.roads.length >= 1);
});
```
- [ ] **Step 2 — Run, expect FAIL.**
- [ ] **Step 3 — Implement**: ring assembly from way `geometry` (array of `{lat,lon}`), `estimateLevels` (`building:levels` → else map `building`/area heuristic to 1–3 + deterministic seeded jitter), `classifyRoad` (primary iff `name ∈ {大学通り, 富士見通り, 旭通り}` or `railway`), `inferHeight(levels)=levels*levelMeters`, green extraction (`leisure=park`/`landuse`), landmark detection (`tags.historic || /旧/.test(name)` AND no `railway=station`; pick nearest to origin), station detection (`railway=station`/`building=train_station`). Return `{footprints:[{ring,levels,height,name,tags}], roads:[{points,primary,name}], green:[{ring}], landmark, station}`. Determinism: any jitter seeded from OSM id.
- [ ] **Step 4 — Run, expect PASS.**
- [ ] **Step 5 — Commit** `feat(citybake): Overpass JSON → footprints/roads/green/landmark/station`.

### Task A4: Geometry assembly (DEM terrain + extruded footprints → triangle soup)

**Files:** Create `tools/citybake/bake/assemble.mjs`; Test `tools/citybake/tests/citybake/assemble.test.mjs`

- [ ] **Step 1 — Failing test** (feed a projector, a flat `planHeight=()=>0`, two footprints, a road): assert it returns `{terrain:{positions,indices}, buildings:{positions,indices,perBuilding}}`, that `perBuilding[i]` carries `{u,v,height,revealKey,type}`, that `revealKey` increases with plan distance from `(0,0)`, and that building base vertices sit on the DEM (`y≈planHeight*VSCALE`). Assert terrain vertex count = `(NX+1)*(NV+1)`.
- [ ] **Step 2 — Run, expect FAIL.**
- [ ] **Step 3 — Implement**: `buildTerrainSoup({planHeight, bounds, NX, NV, SCALE, VSCALE})` (same grid math as `src/cityproto/terrain.js`, but heights from DEM `planHeight`); `buildTerrainGridLines({planHeight, bounds, step, SCALE, VSCALE})` — the fine lattice (Plan-1 reveal layer 1) sampled **on the DEM surface** so it conforms to real relief (returns `{positions}` for `LineSegments`); `extrudeFootprint(ring→plan polygon, baseH, topH)` (triangulate the footprint cap via ear-clipping or fan for convex-ish rings + extruded side quads; conform base to `planHeight` at centroid); `assembleCity({osm, projector, planHeight, params})` → `{terrain, terrainGrid, buildings, perBuilding}` where `perBuilding` carries `{u,v,height,revealKey,type}` (`type ∈ generic|landmark|station`, `revealKey = hypot(u,v)`). Landmark and station extruded as **distinct** nodes (separate index ranges) so they can be tagged/scaled. Reuse `SCALE/VSCALE` semantics from `src/cityproto/geo.js`. (Test also asserts `terrainGrid.positions.length > 0` and grid vertices lie on the DEM, `y≈planHeight*VSCALE`.)
- [ ] **Step 4 — Run, expect PASS.**
- [ ] **Step 5 — Commit** `feat(citybake): assemble DEM terrain + extruded footprints into triangle soup`.

### Task A5: Real raycast AO bake (the core "touch" source)

**Files:** Create `tools/citybake/bake/ao.mjs`; Test `tools/citybake/tests/citybake/ao.test.mjs`

- [ ] **Step 1 — Failing test** — build a soup of one flat ground quad + one tall box; assert: (a) a vertex on open ground far from the box has AO occlusion ≈ 0 (bright); (b) a ground vertex pressed against the box base is significantly occluded (darker); (c) all output greys ∈ [0,1] and are equal across R/G/B (monochrome).
```js
import assert from 'node:assert';
import { test } from 'node:test';
import { bakeAO } from '../../bake/ao.mjs';
// helper buildScene() returns { positions, indices, normals } for a ground quad + a box
test('open ground is bright, occluded base is darker, output is grey', () => {
  const soup = buildScene();
  const col = bakeAO(soup, { rays: 24, radius: 1.0, seed: 1 }); // Float32 rgb per vertex
  const open = greyAt(col, OPEN_VERTEX_INDEX), shaded = greyAt(col, BASE_VERTEX_INDEX);
  assert.ok(open > shaded + 0.1, `open ${open} should exceed occluded ${shaded}`);
  for (let i = 0; i < col.length; i += 3)
    assert.ok(col[i] === col[i+1] && col[i+1] === col[i+2], 'must be grey');
});
```
- [ ] **Step 2 — Run, expect FAIL.**
- [ ] **Step 3 — Implement**: `buildGrid(soup, cell)` bins triangle indices into XZ cells (key by `floor(x/cell),floor(z/cell)`); for each vertex, gather candidate triangles from cells within `radius`, build a small `THREE.BufferGeometry`+`Mesh`, and cast `rays` cosine-weighted hemisphere directions about the vertex normal using a **reused `THREE.Raycaster`** (`far=radius`), counting hits → `ao = 1 - occluded/rays`. Combine with the proto's slope-light term (`max(0, n·L)`, `L=(-0.45,0.82,-0.35)`) and a base grey per `type` (buildings brightest, terrain a dark quiet base — matching Plan 1) → `grey = clamp(baseGrey * (ambient + light) * ao)`. Determinism: hemisphere directions from a seeded low-discrepancy sequence (no `Math.random`). Cache per-cell candidate `Mesh`es; reuse one `Raycaster` instance. (Headless three confirmed: `Raycaster.intersectObject` returns hits in Node.)
- [ ] **Step 4 — Run, expect PASS.**
- [ ] **Step 5 — Commit** `feat(citybake): real grid-accelerated hemisphere raycast AO bake`.

### Task A6: Minimal conformant `.glb` writer

**Files:** Create `tools/citybake/bake/glb.mjs`; Test `tools/citybake/tests/citybake/glb.test.mjs`

- [ ] **Step 1 — Failing test** — write a tiny mesh (`positions`, `colors`, `indices`, one node) → `Uint8Array`; re-parse: assert magic `0x46546C67` ("glTF"), version 2, two chunks (JSON `0x4E4F534A`, BIN `0x004E4942`), JSON has `accessors` for `POSITION`+`COLOR_0`+indices with the right `count`, and `meshes/nodes/scenes` reference them.
- [ ] **Step 2 — Run, expect FAIL.**
- [ ] **Step 3 — Implement** `writeGlb({nodes})` where each node = `{name, mode?, positions:Float32Array, colors?:Float32Array, indices:Uint32Array}` (`mode` = `4` TRIANGLES default, `1` LINES for the `terrainGrid` node) → build `bufferViews`/`accessors` (with `min`/`max` for POSITION as glTF requires; `COLOR_0` optional — the grid line node has none), a single unlit material (`{pbrMetallicRoughness:{baseColorFactor:[1,1,1,1]}, extensions:{KHR_materials_unlit:{}}}`, `extensionsUsed:["KHR_materials_unlit"]`), pack BIN (4-byte aligned, pad with `0x00`/spaces), assemble the 12-byte header + JSON chunk + BIN chunk. Emit one node each named `terrain`, `terrainGrid` (mode 1), `buildings`, `landmark`, `station`. Hand-rolled to avoid the DOM-bound `GLTFExporter`. (Even though we swap materials at load time, emitting `KHR_materials_unlit` keeps the file correct in third-party viewers.) Test also asserts a LINES-mode primitive is present.
- [ ] **Step 4 — Run, expect PASS.**
- [ ] **Step 5 — Commit** `feat(citybake): minimal conformant .glb writer (POSITION/COLOR_0/indices)`.

### Task A7: Manifest writer

**Files:** Create `tools/citybake/bake/manifest.mjs`; Test `tools/citybake/tests/citybake/manifest.test.mjs`

- [ ] **Step 1 — Failing test** — assert `buildManifest({...})` returns the required keys with correct shapes: `bbox`, `origin{lat,lon}`, `scale{SCALE,VSCALE,metersPerUnit,vexag,thetaDeg}`, `roads:[{name,primary,points:[[u,v],...]}]` including `大学通り`/`富士見通り`/`旭通り` primaries + a `chuo` railway polyline, `green:[[u0,v0,u1,v1],...]`, `buildings:[{revealKey,type}]` aligned to glb node order, `landmarkNode:'landmark'`, `station:{u,v}`, `attribution:['© OpenStreetMap contributors','地理院タイル（標高タイル）を加工して作成']`. Assert roads are sorted/clamped to plan bounds and the railway polyline is ≈ horizontal (|Δv| across it small).
- [ ] **Step 2 — Run, expect FAIL.**
- [ ] **Step 3 — Implement** `buildManifest({osm, projector, perBuilding, params})` mapping road points through `projector.toPlan`, splitting primary vs secondary, emitting per-building `{revealKey,type}` in glb node order, carrying attribution. (Secondary/parcel lines may be included as a separate low-α array for Plan 3; primaries are the must-not-bury set.)
- [ ] **Step 4 — Run, expect PASS.**
- [ ] **Step 5 — Commit** `feat(citybake): manifest writer (roads/green/reveal keys/attribution)`.

### Task A8: One-time fetch → committed fixtures

**Files:** Create `tools/citybake/fetch.mjs`, `tools/citybake/fixtures/.gitkeep`

- [ ] **Step 1 — Implement** `fetch.mjs`: POST the Overpass query (research §2) to `overpass-api.de`; compute the z15 GSI tile block covering the bbox, GET each `dem5a` tile (on 404 fall back to `dem` z14), write `fixtures/osm.json`, `fixtures/dem/{z}_{x}_{y}.txt`, and `fixtures/meta.json` (origin, bbox, tile list, fetch provenance). Use only Node built-ins (`fetch`, `fs`). Print a one-line summary per resource.
- [ ] **Step 2 — Run it once.** Run: `node tools/citybake/fetch.mjs`.
  - Expected: `fixtures/osm.json` (non-trivial size, contains `building` + `historic` near `35.699,139.446`), several `fixtures/dem/*.txt` (256-line bodies).
  - **If this sandbox has no network egress**, this step is handed to the user: *"run `node tools/citybake/fetch.mjs` once and commit `tools/citybake/fixtures/`."* All later tasks consume the committed fixtures and need no network.
- [ ] **Step 3 — Inspect** the fetched `osm.json`: confirm the landmark element near the station carries `historic`/「旧」 and **no** `railway=station`; note its element id. Confirm 大学通り/富士見通り/旭通り appear as named ways.
- [ ] **Step 4 — Commit** the fixtures: `chore(citybake): commit raw OSM/GSI fixtures (ODbL/GSI attributed)`.

### Task A9: Bake entrypoint → committed `dist/` + full test sweep

**Files:** Create `tools/citybake/bake.mjs`, `tools/citybake/dist/.gitkeep`

- [ ] **Step 1 — Implement** `bake.mjs`: read fixtures → `makeProjector` (origin from meta; `metersPerUnit≈420`, `thetaDeg` from the railway bearing; `vexag` param) → DEM sampler + `planHeight` → `parseOsm` → `assembleCity` → `bakeAO` → `writeGlb` → `buildManifest` → write `dist/city.glb` + `dist/city.manifest.json`. Print vertex/triangle/building counts and output bytes.
- [ ] **Step 2 — Run** `node tools/citybake/bake.mjs`. Expected: both files written; counts sane (terrain `(NX+1)*(NV+1)` verts; buildings = OSM footprint count; landmark + station present).
- [ ] **Step 3 — Run the whole suite** `node --test`. Expected: all `tools/citybake/tests/**` + existing `tests/cityproto/geo.test.mjs` PASS.
- [ ] **Step 4 — Commit** baked output + entrypoint: `feat(citybake): bake entrypoint → dist/city.glb + manifest`.

---

## Phase B — Swap the baked asset into the verified proto renderer

### Task B1: Vendor GLTFLoader + import map

**Files:** Create `src/vendor/three-addons/loaders/GLTFLoader.js`, `src/vendor/three-addons/utils/BufferGeometryUtils.js` (verbatim from three r160 examples/jsm); Modify `city-proto.html`

- [ ] **Step 1 — Vendor** the two files unmodified (GLTFLoader imports `three` + `three/addons/utils/BufferGeometryUtils.js`, both resolved by the import map).
- [ ] **Step 2 — Add the import map** to `city-proto.html` **before** the module script:
```html
<script type="importmap">
{ "imports": {
  "three": "./src/vendor/three.module.js",
  "three/addons/": "./src/vendor/three-addons/"
} }
</script>
```
- [ ] **Step 3 — Verify no module duplication**: `../vendor/three.module.js` (relative, existing imports) and `three` (mapped) resolve to the **same absolute URL** → one module instance. Leave existing `import * as THREE from '../vendor/three.module.js'` as-is.
- [ ] **Step 4 — Commit** `chore: vendor GLTFLoader + BufferGeometryUtils + import map`.

### Task B2: Runtime city-asset loader

**Files:** Create `src/cityproto/cityasset.js`

- [ ] **Step 1 — Implement** `export async function loadCity(glbUrl, manifestUrl)`: `GLTFLoader().loadAsync(glbUrl)`, fetch+parse the manifest, traverse and **swap materials by type** — `isMesh` → `new THREE.MeshBasicMaterial({ vertexColors:true, side:THREE.DoubleSide })` (monochrome, unlit, identical to the proto's building material); `isLineSegments` (the `terrainGrid` node) → `new THREE.LineBasicMaterial({ color:0xc2cad6, transparent:true, opacity:0.16 })` (Plan-1 lattice style). Find nodes by name (`terrain`, `terrainGrid`, `buildings`, `landmark`, `station`), attach `userData.revealKey`/`type`, return `{ terrain, terrainGrid, buildings, landmark, station, manifest }`.
- [ ] **Step 2 — Smoke-load in the browser** via preview (Task B5 harness): `window.__city = await loadCity(...)` and confirm no console errors, meshes present, materials are `MeshBasicMaterial`.
- [ ] **Step 3 — Commit** `feat(cityproto): GLTFLoader-based baked-city loader with monochrome material swap`.

### Task B3: Build roads/railway/green from the manifest

**Files:** Modify `src/cityproto/avenues.js`, `src/cityproto/station.js`

- [ ] **Step 1 — `buildAvenues(manifest)`**: iterate `manifest.roads.filter(r=>r.primary && r.name!=='chuo')`, map plan `[u,v]`→world (lift off terrain), build white `Line`s with `depthTest:false`, `renderOrder:10`, opacity per road — preserving the un-buried guarantee. Keep secondary roads (if present) as a separate low-α `LineSegments`.
- [ ] **Step 2 — `buildRailway(manifest)`**: build the crisp double track from the `chuo` polyline (offset ±track gauge in `v`) + faint center line, `depthTest:false`. Keep `buildStation(manifest)`'s runtime glow sprite (canvas texture) anchored at `manifest.station`.
- [ ] **Step 3 — Commit** `feat(cityproto): roads/railway from baked manifest (primary roads stay un-buried)`.

### Task B4: Rewrite proto.js to load the baked asset

**Files:** Modify `src/cityproto/proto.js`

- [ ] **Step 1 — Make the bootstrap async** and add layers in **reveal order**:
```js
const { terrain, terrainGrid, buildings, landmark, station, manifest } = await loadCity(
  './tools/citybake/dist/city.glb', './tools/citybake/dist/city.manifest.json');
scene.add(terrain);                 // 1. terrain (DEM relief)
scene.add(terrainGrid);             //    fine lattice baked onto the DEM (reveal layer 1)
scene.add(buildAvenues(manifest));  // 2. roads (manifest polylines, depthTest:false)
scene.add(buildRailway(manifest));
scene.add(buildings);               // 3. buildings (real footprints + baked AO)
scene.add(landmark); scene.add(station);
scene.add(buildStation(manifest));  // station glow sprite (runtime canvas texture)
// 4. trees — Plan 3
```
- [ ] **Step 2 — Keep** the overlay, camera params/`applyCamera`, resize, loop, and `window.__proto` (add `manifest`). The procedural `buildTerrain`/`buildBuildings` are no longer called (left in repo as fallback). Wrap top-level `await` in an `async` IIFE or rely on module top-level await.
- [ ] **Step 3 — Commit** `feat(cityproto): load baked OSM/DEM/AO city; reveal-order add; procedural path retired`.

### Task B5: Preview + screenshot verification (the gate)

**Files:** none (verification only)

- [ ] **Step 1 — Start preview** `vj` and open `http://localhost:8125/city-proto.html` (via the `preview_*` MCP tools, never Bash).
- [ ] **Step 2 — Check** `preview_console_logs` for errors (GLTFLoader parse, material swap, manifest fetch).
- [ ] **Step 3 — `preview_screenshot`** and verify against the reference **before claiming anything works** (memory rule):
  - Monochrome only (no chroma); black ground; baked AO gives soft contact shadows + readable relief.
  - Real footprints (not a uniform grid); 大学通り straight south, 富士見 long-W, 旭 short-E; **中央線 horizontal**.
  - Primary roads legible / not buried; **旧駅舎 a distinct, visible block** separate from the functional station.
- [ ] **Step 4 — Tune** `metersPerUnit` / `vexag` / `thetaDeg` / camera (`window.__proto.params` + `applyCamera()`) live; if structural, fix in `bake.mjs` params and re-bake (Task A9), reload. Re-screenshot until the framing matches Plan 1's validated composition with real data.
- [ ] **Step 5 — Commit** any tuning: `chore(cityproto): tune bake scale/exaggeration + camera to reference framing`.

---

## Verification (end-to-end)

- **Unit:** `node --test` → all `tools/citybake/tests/**` (projection, DEM, OSM, assemble, AO, glb, manifest) + existing `tests/cityproto/geo.test.mjs` green.
- **Bake reproducibility:** `node tools/citybake/bake.mjs` twice → byte-identical `dist/city.glb` (determinism: no `Math.random`; seeded jitter/AO sequence).
- **Visual (the gate):** preview `vj` → `city-proto.html` → `preview_screenshot`; confirm monochrome, real footprints, baked AO/relief, primary roads legible, 中央線 horizontal, 旧駅舎 distinct. **No "it works" claim without a screenshot.**
- **Attribution:** manifest carries `© OpenStreetMap contributors` + `地理院タイル（標高タイル）を加工して作成` (rendered into the HUD in Plan 3; present in data now).
- **Constraints audit:** monochrome ✓, 旧駅舎 distinct/un-buried ✓, primary roads un-buried ✓, buildless ESM (vendored loader + import map, no build step) ✓, reveal order add-order + per-building keys ✓.

## Out of scope (→ Plan 3)
Reveal **animation**, audio reactivity, trees/green instancing, 旧駅舎 triangular-roof craft, HUD scanner UI + on-screen attribution, SceneManager/PWA/SW integration, distance LOD + `quality` perf tiers.

## Open items / risks
- **Network egress for `fetch.mjs`** — if unavailable in-session, the user runs it once (Task A8); everything downstream is fixture-driven.
- **AO bake runtime** — offline; if slow, reduce ray count / vertex density or coarsen the AO grid (quality is offline-tunable, runtime cost is zero).
- **Footprint triangulation** — ear-clipping must handle non-convex rings; fall back to a robust fan only for convex rings, else a small ear-clip. Covered by an assemble test with a concave ring.
- **DEM tile coverage** — `dem5a` is patchy; `dem` (z14) fallback + `e`-as-no-data handling required (Task A2/A8).
