// App updates: a new version downloads in the background (service worker "waiting"); the app shows a banner,
// and one tap switches to it and reloads. Checks again whenever the app comes back to the foreground.
import { Store } from './store';

export const update = new Store<{ ready: boolean }>({ ready: false });
let reg: ServiceWorkerRegistration | null = null;

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const watch = (w: ServiceWorker | null) => {
    if (!w) return;
    const check = () => { if (w.state === 'installed' && navigator.serviceWorker.controller) update.set({ ready: true }); };
    check(); w.addEventListener('statechange', check);
  };
  navigator.serviceWorker.register('./sw.js').then(r => {
    reg = r;
    watch(r.waiting); watch(r.installing);
    r.addEventListener('updatefound', () => watch(r.installing));
  }).catch(() => { /* offline cache is optional */ });
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (update.get().ready && !reloading) { reloading = true; location.reload(); } });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void reg?.update().catch(() => {}); });
}

/** Switch to the downloaded version now. */
export function applyUpdate() {
  const w = reg?.waiting;
  if (w) w.postMessage('SKIP_WAITING'); else location.reload();
}
