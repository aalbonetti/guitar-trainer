import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

// base './' keeps every path relative, so the same build works at any address
// (username.github.io/guitar-trainer today, a neutral name later).
const version = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');

export default defineConfig({
  base: './',
  define: { __APP_VERSION__: JSON.stringify(version) },
  plugins: [preact()],
  build: { outDir: 'dist', emptyOutDir: true, sourcemap: false },
  test: { environment: 'node' },
});
