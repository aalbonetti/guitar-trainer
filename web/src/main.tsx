import { render } from 'preact';
import { App } from './app';
import './styles.css';
import { registerServiceWorker } from './update';
import { initTheme } from './theme';

initTheme();

render(<App />, document.getElementById('app')!);

// Offline support + update banner (update.ts).
if (import.meta.env.PROD) addEventListener('load', registerServiceWorker);
// Ask Chrome not to evict stored data (progress will live here from M3).
if (navigator.storage && navigator.storage.persist) void navigator.storage.persist();
