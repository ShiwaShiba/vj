// Register the service worker for offline use. Relative scope so it works
// under a GitHub Pages project subpath (https://user.github.io/<repo>/).
export function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  // Auto-update: when a newer SW activates and takes control, reload ONCE so the freshly-deployed
  // code actually runs — no manual cache clear. Guarded so it never loops and never fires on the
  // first-ever install (no previous controller = nothing stale to replace).
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    reloading = true;
    location.reload();
  });
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').then((reg) => {
      reg.update();                                 // check for a newer SW on every load
      setInterval(() => reg.update(), 60 * 1000);   // and periodically while the tab stays open
    }).catch((e) => {
      // Offline support is optional; surface failures off localhost for debugging.
      if (location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
        console.warn('[VJ] Service Worker registration failed; offline mode unavailable:', e && e.message);
      }
    });
  });
}
