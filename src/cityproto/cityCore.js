// cityCore — the shared, DOM/mic/RAF-free scene core for the WebGL city. Lifted verbatim
// out of proto.js: it owns the THREE scene-graph (built from the baked glb), the per-frame
// director/driver/cityScope update, and the live-tuning rebuilds. It does NOT own the
// renderer (injected), the RAF loop, the DOM veil/HUD, the mic, or window.__proto — those
// stay in the consumer (proto.js today; a CityScene tomorrow, feeding the main app's audio).
//
// The audio source is injected per-frame: update() receives the `driver` (liveDriver-compat:
// isLive()/frame()/clock) and the `live`/`intro` flags. When intro:false (the body scene),
// the authored INTRO director block is skipped and the camera is parked at the ④ full-city
// framing, running only the LIVE driver + shotDir + cityScope.
import { buildAvenues } from './avenues.js';
import { buildStation, buildRailway } from './station.js';
import { planLayout, buildTrees } from './trees.js';
import { planEmit, buildParticles } from './particles.js';
import { setChromaVariant } from './seasons.js';
import { loadCity } from './cityasset.js';
import { makeKeyframes } from './camrig.js';
import { createDirector } from './director.js';
import { installReveal } from './reveal.js';
import { installIntroLayers } from './intro.js';
import { createShotDirector } from './shotDirector.js';
import { makeGroundSampler } from './groundSampler.js';
import { buildScopeGeom, createCityScope } from './cityScope.js';

export function createCityCore({ THREE, renderer }) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
  const params = { camX: -5.1, camY: 55.3, camZ: 50, fov: 50, lookX: -5.1, lookY: 0, lookV: 23.0 }; // ④ 国立市全域フレーミング
  function applyCamera() {
    camera.fov = params.fov;
    camera.position.set(params.camX, params.camY, params.camZ);
    camera.lookAt(params.lookX, params.lookY, params.lookV);
    camera.updateProjectionMatrix();
  }

  function resize(w, h) {
    // updateStyle:true pins the canvas BOX to w×h CSS px (inline style), matching how the 2D
    // #stage is sized from window.innerHeight. Relying on CSS `height:100vh`/`inset:0` instead
    // lets iOS Safari stretch the fixed canvas past the visual viewport, clipping the bottom.
    renderer.setSize(w, h, true);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  // --- Plan 3 reveal director (camera + building ripple; season leg wires in later) ---
  let director = null;     // set once the city + keyframes exist
  let reveal = null;       // building ripple controller (installReveal)
  let introLayers = null;  // terrain-lattice + road opacity reveals (installIntroLayers)
  let tSec = 0;            // director clock (seconds) — scrubbable
  let paused = false;      // freeze the clock to inspect a framing
  let parallax = false;    // straight dolly (false) vs micro-parallax (true), A/B by looking
  let trees = null;        // seasonal 並木 controller (buildTrees → {group, update, setMode})
  let particles = null;    // falling petals/leaves/snow along the 並木 (buildParticles → {points, update})
  let mode = 0;            // 0 = monochrome (step-4 default); 1 = chroma (step-6 C key)
  let strobeEnabled = false; // strobe gate (S key / panel). Default OFF (光感受性 safety)
  let strobeAllSeasons = false; // 常時ストロボ: ONで全季節（OFFは proto の冬限定 white strobe）

  // Live-tuning state (step 6). Initial values reproduce the current look EXACTLY — they
  // only move when a setter fires. Kept at core scope so the rebuild helpers can reach them.
  let terrainRef = null;     // DEM mesh, kept for particle rebuilds (setPetals)
  let manifestRef = null;    // baked manifest, kept for the rebuilds
  let kfInputs = null;       // {full,landmark,station} snapshot for keyframe rebuilds
  let petalOpts = { perColumn: 9, stride: 1 }; // emit density (live via setPetals)
  let framingOpts = {};      // camrig DEF overrides (live via setFraming); {} = DEF
  let timingOpts = {};       // director DEFAULTS overrides (live via setTiming); {} = DEFAULTS
  const fallDist = 0.40;     // canopy-height fall distance (step5 visual tune)
  // Beat-driven 俯瞰⇔アップ shot switcher (shared by INTRO + LIVE). Built once the 並木
  // centerline is known (load). shotOpts accumulates the live slider overrides.
  let shotDir = null;
  let shotOpts = {};
  // 音反応 建物変調レイヤ（CityScope）。城ロード後に生成。scopeOpts は HUD の上書きを蓄積。
  let cityScope = null;
  let scopeOpts = {};

  // Per-frame body. The caller owns the RAF loop, computes dt, and injects the audio `driver`
  // (liveDriver-compat) + the `live`/`intro` flags + a setOverlayIntensity sink. renderer.render
  // and the DOM overlay/debug live in the caller, not here.
  function update(dt, now, opts) {
    const { driver, live, intro: introMode, setOverlayIntensity } = opts;
    if (!director) return;
    const f = director.update(tSec, { parallax });
    // musical time for the shot switcher (1-frame lag in INTRO is imperceptible; LIVE reads
    // it fresh inside driver.frame after the clock ticks). Runs on the internal clock pre-mic.
    const beat = { beatsFloat: driver.clock.beats + driver.clock.beatPhase };
    if (introMode) {
      if (!live) {
        // Phase 1 INTRO: the authored staged-zoom seasonal reveal owns camera/season/reveal.
        if (!paused) tSec += dt;
        Object.assign(params, f.cam);
        // beat-driven 俯瞰⇔アップ overlay — only once the 並木 has finished revealing, so an
        // アップ cut never lands on a bare avenue (the build-in zoom plays untouched).
        if (shotDir && f.reveal.trees >= 0.99) shotDir.apply(params, beat, dt);
        applyCamera();
        if (reveal) reveal.setProgress(f.reveal.buildings); // intro ripple; latches at 1
        if (introLayers) { introLayers.setTerrain(f.reveal.terrain); introLayers.setRoads(f.reveal.roads); } // 格子 → 通電
        if (trees) { trees.update(f.season, mode, dt, { strobe: strobeEnabled }); trees.uniforms.uAppear.value = f.reveal.trees; } // 並木 seasons + 冬 strobe + reveal-in after buildings
        if (particles) { particles.update(f.season, mode, dt); particles.uniforms.uAppear.value = f.reveal.petals; } // 花びら/落ち葉/雪 (GPU fall, sweep-synced) + 粒子専用のゆるやか出現(treeと別ランプ=バースト回避)
      }
    } else {
      // Body scene (intro:false): no authored INTRO. Park the camera at ④ full-city framing
      // and run only the LIVE driver + the beat-driven shot switcher + cityScope.
      Object.assign(params, kfInputs ? kfInputs.full : params);
      if (shotDir) shotDir.apply(params, beat, dt);
      applyCamera();
      // No authored INTRO to animate the reveal channels, so latch every gate fully open
      // (the body scene is always the complete city). Idempotent cheap uniform writes; the
      // LIVE driver.frame below still drives seasonal trees/particles + cityScope per-building.
      if (reveal) reveal.setProgress(1);
      if (introLayers) { introLayers.setTerrain(1); introLayers.setRoads(1); }
      if (trees) trees.uniforms.uAppear.value = 1;
      if (particles) particles.uniforms.uAppear.value = 1;
    }
    // The driver layers audio accents in INTRO, and OWNS camera/season/uMode/density in LIVE
    // (where the authored writes above are suppressed). tSec is frozen at handoff (no advance).
    driver.frame(dt, now, {
      director, directorCam: f.cam, tSec, trees, particles, params, applyCamera,
      setOverlayIntensity,
      strobe: strobeEnabled,
      strobeAll: strobeAllSeasons,
      shotDir, beat, // LIVE applies the same beat-driven 俯瞰⇔アップ overlay onto the parked cam
      cityScope, // LIVE で建物 scope を駆動（INTRO は無効のまま）
    });
  }

  function render() { renderer.render(scene, camera); }

  // Rebuild helpers for the live knobs. Both reuse the pure planners + THREE builders and
  // neither resets the director clock (tSec), so tuning is seamless. No-op until the city loads.
  function rebuildParticles() {
    if (!particles || !terrainRef || !manifestRef) return;
    scene.remove(particles.points);
    particles.points.geometry.dispose();
    particles.points.material.dispose();
    const { avenue } = planLayout(manifestRef);
    particles = buildParticles(planEmit(avenue, petalOpts), terrainRef, manifestRef, { renderer, fallDist });
    scene.add(particles.points);
  }
  function rebuildDirector() {
    if (!kfInputs) return;
    const keyframes = makeKeyframes(kfInputs, framingOpts);
    director = createDirector({ keyframes, tuning: timingOpts });
  }

  // Swap the procedural city for the baked OSM/DEM/AO asset. Layers are added in
  // reveal order (terrain → roads → buildings → trees) so Plan 3's reveal anim
  // can drive them. onProgress forwards the glb download % to the caller's load bar.
  function load(onProgress) {
    return loadCity('./tools/citybake/dist/city.glb', './tools/citybake/dist/city.manifest.json', onProgress).then((city) => {
      const { terrain, terrainGrid, buildings, landmark, station, manifest } = city;
      terrainRef = terrain; manifestRef = manifest;    // keep for the live-tuning rebuilds (setPetals/setFraming/setTiming)
      if (terrain) scene.add(terrain);                 // 1. terrain (DEM relief) — always visible (the stage)
      if (terrainGrid) scene.add(terrainGrid);         //    fine lattice baked onto the DEM (reveals in)
      const avenuesGroup = buildAvenues(manifest); scene.add(avenuesGroup); // 2. roads (manifest polylines)
      const railGroup = buildRailway(manifest); scene.add(railGroup);
      if (buildings) scene.add(buildings);             // 3. buildings (real footprints + baked AO)
      if (buildings) reveal = installReveal(THREE, buildings, manifest.buildings); // ripple from the station
      if (landmark) scene.add(landmark);
      if (station) scene.add(station);
      scene.add(buildStation(manifest));               // station glow accent (runtime canvas texture)
      if (terrain) {                                   // 4. 木々 (green zones + 大学通り 並木 + 空き地, seasonal)
        // 空き地の木: hand planLayout the building vertex WORLD positions so it can find the
        // building carpet's interior gaps (vacant lots) and plant damped greenery there.
        // KHR-quantized geometry → world via matrixWorld. Cost is a one-time load-pass.
        let buildingPositions = null;
        if (buildings) {
          buildings.updateWorldMatrix(true, false);
          const bp = buildings.geometry.attributes.position, _v = new THREE.Vector3();
          buildingPositions = new Float32Array(bp.count * 3);
          for (let i = 0; i < bp.count; i++) { _v.fromBufferAttribute(bp, i).applyMatrix4(buildings.matrixWorld); buildingPositions[i * 3] = _v.x; buildingPositions[i * 3 + 1] = _v.y; buildingPositions[i * 3 + 2] = _v.z; }
        }
        trees = buildTrees(manifest, terrain, { vacantDensity: 0.26, buildingPositions });
        scene.add(trees.group);
      }
      if (terrain) {                                    // 5. falling particles along the 並木 (reuse the avenue layout)
        const { avenue } = planLayout(manifest);        // pure + deterministic → byte-identical to buildTrees' avenue
        particles = buildParticles(planEmit(avenue, petalOpts), terrain, manifest, { renderer, fallDist });
        scene.add(particles.points);
      }

      // Keyframes: ④ = the current full-city params; ① is the 旧駅舎 (landmark) hero.
      const { SCALE, VSCALE, vOffset } = manifest.scale;
      const s = manifest.station || { u: 0, v: 0, h: 0 };
      const stationW = { x: s.u * SCALE, z: (s.v - vOffset) * SCALE };
      let landmarkW = { x: stationW.x, y: 0, z: stationW.z };       // fallback: station
      if (landmark) {
        landmark.updateMatrixWorld(true);
        const c = new THREE.Box3().setFromObject(landmark).getCenter(new THREE.Vector3());
        landmarkW = { x: c.x, y: c.y, z: c.z };
      }
      kfInputs = { full: { ...params }, landmark: landmarkW, station: stationW }; // snapshot ④ before the loop mutates params
      rebuildDirector();                               // builds keyframes + director from kfInputs / framingOpts / timingOpts

      // 並木 centerline for the beat-driven shot switcher: avenue (u,v) → world + DEM height,
      // ordered south→north, subsampled to a smooth ~40-pt line the pure shotDirector glides along.
      if (terrain) {
        const groundY = makeGroundSampler(terrain);
        const avPts = planLayout(manifest).avenue
          .map((a) => { const x = a.u * SCALE, z = (a.v - vOffset) * SCALE; return { x, y: groundY(x, z), z }; })
          .sort((p, q) => q.z - p.z);                  // south (large +Z) → north (station)
        const step = Math.max(1, Math.floor(avPts.length / 40));
        const centerline = avPts.filter((_, i) => i % step === 0);
        shotDir = createShotDirector(centerline, shotOpts);
      }

      // CityScope geom: 建物の world Z で並木軸を、revealKey で半径を正規化。world 位置は
      // trees と同じ matrixWorld 経由（KHR 量子化 → world）。reveal が scope テクスチャの sink。
      if (buildings && reveal) {
        buildings.updateWorldMatrix(true, false);
        const bp = buildings.geometry.attributes.position, _w = new THREE.Vector3();
        const worldZ = new Float32Array(bp.count);
        for (let i = 0; i < bp.count; i++) { _w.fromBufferAttribute(bp, i).applyMatrix4(buildings.matrixWorld); worldZ[i] = _w.z; }
        const geom = buildScopeGeom(manifest.buildings, (i) => worldZ[i]);
        cityScope = createCityScope(geom, reveal, scopeOpts);
      }

      // Intro reveals: the 格子 lattice fades up, then the roads electrify (the symbolic
      // white avenues + 中央線 lead, the grey network fills behind them).
      const roadMaterials = [];
      for (const g of [avenuesGroup, railGroup]) g.traverse((o) => {
        if (o.material) roadMaterials.push({ material: o.material, phase: o.renderOrder <= 6 ? 0.35 : 0.0 });
      });
      introLayers = installIntroLayers({ gridMaterials: terrainGrid ? [terrainGrid.material] : [], roadMaterials });

      _city = city;
    });
  }

  let _city = null;

  // --- live-tuning setters (delegated from the consumer's HUD/keys/window.__proto) ---
  function seek(t) { tSec = Math.max(0, t); }                       // jump the director clock (seconds)
  // Tuning shortcut: jump straight into the audio-reactive LIVE phase (skip the ~76s intro).
  // Lands just inside the winter hold4 window so the next frame's `past` fallback hands off
  // with the camera parked cleanly at ④ (no need to make a sound to trigger the handoff).
  function goLive(driver) { const c = driver.modeConfig; tSec = c.winterCycleStart + c.hold4Start + c.hold4Dur - 0.05; }
  function setPaused(b) { paused = !!b; }
  function setParallax(b) { parallax = !!b; }
  function setMode(b) { mode = b ? 1 : 0; }                          // 0 mono / 1 chroma (also the C key)
  function setStrobe(b) { strobeEnabled = !!b; }                     // strobe gate (also the S key)
  function setStrobeAll(b) { strobeAllSeasons = !!b; }              // 常時ストロボ（全季節）: panel から
  function setStrobeRate(hz) { if (trees) trees.uniforms.uStrobeRate.value = Math.max(0, Math.min(3, hz)); } // ≤3Hz (守る線)
  function setPetals(partial) { Object.assign(petalOpts, partial); rebuildParticles(); }   // particle emit density
  function setTiming(partial) { Object.assign(timingOpts, partial); rebuildDirector(); }   // director 緩急 overrides
  function setFraming(partial) { Object.assign(framingOpts, partial); rebuildDirector(); } // camrig framing overrides
  function setShot(partial) { Object.assign(shotOpts, partial); if (shotDir) shotDir.setConfig(shotOpts); } // beat-driven 俯瞰⇔アップ camera
  function setScope(partial) { Object.assign(scopeOpts, partial); if (cityScope) cityScope.setConfig(scopeOpts); } // 音反応 建物変調
  // 全体COLOR tint：建物(reveal shader)＋地形DEM(material.color 乗算)へ控えめ着色。
  // strength0 で恒等＝現状一致。tint={r,g,b,strength}（0..1 LINEAR乗数・luma≈1）。
  function setTint(tint) {
    if (reveal && reveal.setTint) reveal.setTint(tint);
    const s = Math.max(0, Math.min(1, (tint && tint.strength) || 0));
    if (terrainRef && terrainRef.material && terrainRef.material.color) {
      const tr = tint && tint.r != null ? tint.r : 1;
      const tg = tint && tint.g != null ? tint.g : 1;
      const tb = tint && tint.b != null ? tint.b : 1;
      // mix(1, tint, s) — vertexColors の乗数（既定 white=恒等）
      terrainRef.material.color.setRGB(1 + (tr - 1) * s, 1 + (tg - 1) * s, 1 + (tb - 1) * s);
    }
  }
  // Manual season override for the body scene (intro:false). INTRO season is owned by the
  // director; LIVE season is owned by the driver — so this is a stub seam for the future
  // CityScene and a no-op on the authored INTRO path that proto.js drives today.
  let seasonOverride = null;
  function setSeason(i) { seasonOverride = i | 0; }

  function state() { return { tSec, paused, parallax, mode, strobeEnabled, seasonOverride }; }

  function refs() { return { trees, particles, reveal, intro: introLayers, director, shotDir, cityScope, manifest: manifestRef, terrain: terrainRef, city: _city }; }

  // Free GPU resources. New (proto.js never disposed); exercised by the future CityScene teardown.
  function dispose() {
    scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      const mats = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
      for (const m of mats) {
        for (const k in m) { const v = m[k]; if (v && v.isTexture) v.dispose(); }
        if (m.dispose) m.dispose();
      }
    });
    scene.clear();
  }

  return {
    scene, camera, params, applyCamera,
    resize, load, update, render,
    setShot, setScope, setTint,
    setMode, setStrobe, setStrobeAll, setStrobeRate, setPetals, setTiming, setFraming,
    setSeason, setChromaVariant: (name) => setChromaVariant(name),
    seek, goLive, setPaused, setParallax,
    state, refs, dispose,
  };
}
