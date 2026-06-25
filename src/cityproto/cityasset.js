import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Load the baked city (glTF + manifest) and return the named layers. Every mesh
// material is swapped to the proto's unlit monochrome MeshBasicMaterial (the
// baked AO×light is already in the vertex colours); the terrain-grid lines get
// the Plan-1 lattice style. Reveal metadata rides on userData for Plan 3.
export async function loadCity(glbUrl, manifestUrl) {
  const loader = new GLTFLoader();
  const [gltf, manifest] = await Promise.all([
    loader.loadAsync(glbUrl),
    fetch(manifestUrl).then((r) => r.json()),
  ]);

  const found = {};
  gltf.scene.traverse((o) => {
    if (o.isMesh) {
      o.material = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
    } else if (o.isLineSegments || o.isLine) {
      o.material = new THREE.LineBasicMaterial({ color: 0xc2cad6, transparent: true, opacity: 0.16 });
    }
    if (o.name) found[o.name] = o;
  });

  if (found.buildings) found.buildings.userData.perBuilding = manifest.buildings;
  if (found.landmark) found.landmark.userData.type = 'landmark';

  return {
    terrain: found.terrain, terrainGrid: found.terrainGrid, buildings: found.buildings,
    landmark: found.landmark, station: found.station, manifest,
  };
}
