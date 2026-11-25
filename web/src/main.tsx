import { render } from 'preact';
import { App } from './app';
import './styles.css';
import { registerServiceWorker } from './update';
import { initTheme } from './theme';
import { importAll } from './db';
import { isSim } from './audio/engine';

initTheme();
// Test-only (`?sim`): lets the e2e suites seed a backup. The app itself has no restore/upload control.
if (isSim()) (globalThis as any).__gtImport = importAll;

render(<App />, document.getElementById('app')!);

// Offline support + update banner (update.ts).
if (import.meta.env.PROD) addEventListener('load', registerServiceWorker);
// Ask Chrome not to evict stored data (progress will live here from M3).
if (navigator.storage && navigator.storage.persist) void navigator.storage.persist();
