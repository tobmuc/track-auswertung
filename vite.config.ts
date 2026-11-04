import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig(({ command }) => ({
  // relative paths in the build: runs from any sub-path, e.g. GitHub Pages (user.github.io/track-auswertung/)
  base: command === 'build' ? './' : '/',
  plugins: [vue()],
  worker: { format: 'es' },
  // igc-xc-score (flatbush deps) expects Node's global
  define: { global: 'globalThis' },
  // maplibre-gl v6 loads its own worker relative to import.meta.url; prebundling breaks that path
  optimizeDeps: { exclude: ['maplibre-gl'] },
  // fixed port: activities live in the browser storage of exactly this origin
  server: { port: 5173, strictPort: true },
}));
