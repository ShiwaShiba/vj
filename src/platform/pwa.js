// Register the service worker for offline use. Relative scope so it works
// under a GitHub Pages project subpath (https://user.github.io/<repo>/).
export function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  // We deliberately do NOT auto-reload when a newer SW takes control. This is a LIVE
  // VJ tool: a mid-session reload throws the operator back to the "TAP TO START" screen
  // and drops the running scene/state (the reported bug). A fresh deploy still applies on
  // the next natural relaunch, and because the fetch handler is network-FIRST
  // ({cache:'reload'}), an online client already pulls the latest assets on that next
  // load — so nothing forces (or needs) a reload out from under a running set.
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
