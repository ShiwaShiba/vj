// Best-effort fullscreen. iPad Safari needs the webkit-prefixed path; iPhone
// Safari has no Fullscreen API (installing as a PWA is the real fix there).
export function toggleFullscreen(el) {
  const doc = document;
  const isFs = doc.fullscreenElement || doc.webkitFullscreenElement;
  if (isFs) {
    (doc.exitFullscreen || doc.webkitExitFullscreen || (() => {})).call(doc);
    return false;
  }
  const target = el || doc.documentElement;
  const req = target.requestFullscreen || target.webkitRequestFullscreen;
  if (req) { try { req.call(target); return true; } catch { /* ignore */ } }
  return false;
}

export function isFullscreenSupported() {
  const el = document.documentElement;
  const hasMethod = !!(el.requestFullscreen || el.webkitRequestFullscreen);
  // iPadOS 13+ reports as MacIntel with touch points.
  const iOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = window.navigator.standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches;
  // On iOS the Fullscreen API is a no-op in Safari tabs; only offer it in a PWA.
  return hasMethod && (standalone || !iOS);
}
