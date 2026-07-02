// Network-first service worker for offline use. Bump CACHE_VERSION on deploy to
// invalidate. All paths are relative so it works under a GitHub Pages subpath.
const CACHE_VERSION = 'vj-v52';

const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './src/main.js',
  './src/config.js',
  './src/lib/math.js',
  './src/lib/noise.js',
  './src/engine/Canvas.js',
  './src/engine/Engine.js',
  './src/engine/Clock.js',
  './src/render/Overlay.js',
  './src/audio/AudioEngine.js',
  './src/audio/BeatDetector.js',
  './src/audio/smoothing.js',
  './src/color/palettes.js',
  './src/color/PaletteManager.js',
  './src/scenes/Scene.js',
  './src/scenes/SceneManager.js',
  './src/scenes/registry.js',
  './src/scenes/dots/SineGrid.js',
  './src/scenes/dots/Lissajous.js',
  './src/scenes/dots/FlowField.js',
  './src/scenes/dots/Moire.js',
  './src/scenes/dots/ParticleField.js',
  './src/scenes/dots/Tunnel.js',
  './src/scenes/dots/FallingCubes.js',
  './src/scenes/dots/Kaleidoscope.js',
  './src/scenes/dots/SpectrumBars.js',
  './src/scenes/dots/Oscilloscope.js',
  './src/scenes/dots/Datamatrix.js',
  './src/scenes/dancers/DancersScene.js',
  './src/scenes/dancers/DancerRig.js',
  './src/scenes/dancers/moves.js',
  './src/scenes/dancers/Choreographer.js',
  './src/scenes/dancers/spring.js',
  './src/scenes/dancers/poses.js',
  './src/scenes/dancers/groove.js',
  './src/scenes/dancers/couplings.js',
  './src/scenes/dancers/audioMap.js',
  './src/ui/ui.css',
  './src/ui/ControlPanel.js',
  './src/ui/SceneGrid.js',
  './src/ui/Sliders.js',
  './src/ui/Toggles.js',
  './src/sync/RemoteAudio.js',
  './src/sync/snapshot.js',
  './src/sync/link.js',
  './src/platform/wakelock.js',
  './src/platform/fullscreen.js',
  './src/platform/pwa.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_VERSION).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  // Network-FIRST with HTTP-cache BYPASS ({cache:'reload'}): GitHub Pages stamps every asset with
  // `cache-control: max-age=600`, so a plain fetch() can return a <=10-min-stale copy and hide a
  // fresh deploy even though we're online. 'reload' forces each GET to hit the network, so a single
  // reload always shows the latest code — no DevTools/unregister dance. Each success still refreshes
  // the Cache Storage copy, so the PWA works offline; only when the network fails do we fall back to
  // cache → index.html.
  e.respondWith(
    fetch(e.request, { cache: 'reload' }).then((res) => {
      const copy = res.clone();
      caches.open(CACHE_VERSION).then((c) => c.put(e.request, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match(e.request).then((hit) => hit || caches.match('./index.html')))
  );
});
