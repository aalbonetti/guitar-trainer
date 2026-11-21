import { render } from 'preact';
import { App } from './app';
import './styles.css';

render(<App />, document.getElementById('app')!);

// Offline support: the service worker caches the app and catalog after the first visit.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  addEventListener('load', () => { navigator.serviceWorker.register('./sw.js').catch(() => { /* offline cache is optional */ }); });
}
// Ask Chrome not to evict stored data (progress will live here from M3).
if (navigator.storage && navigator.storage.persist) void navigator.storage.persist();
