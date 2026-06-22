// Register the service worker for offline use. Relative scope so it works
// under a GitHub Pages project subpath (https://user.github.io/<repo>/).
export function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((e) => {
      // Offline support is optional; surface failures off localhost for debugging.
      if (location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
        console.warn('[VJ] Service Worker registration failed; offline mode unavailable:', e && e.message);
      }
    });
  });
}
