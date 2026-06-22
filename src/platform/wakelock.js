// Keep the screen awake during a performance (iOS 16.4+). Re-acquires the
// lock when the tab becomes visible again, since locks drop on hide.
let lock = null;
let wanted = false;

export async function requestWakeLock() {
  wanted = true;
  if (!('wakeLock' in navigator)) return false;
  try {
    lock = await navigator.wakeLock.request('screen');
    lock.addEventListener('release', () => { lock = null; });
    return true;
  } catch {
    return false;
  }
}

export function releaseWakeLock() {
  wanted = false;
  if (lock) { lock.release().catch(() => {}); lock = null; }
}

export function isWakeLockActive() { return !!lock; }
export function isWakeLockSupported() { return 'wakeLock' in navigator; }

document.addEventListener('visibilitychange', () => {
  if (wanted && document.visibilityState === 'visible' && !lock) requestWakeLock();
});
