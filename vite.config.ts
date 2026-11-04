import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

/** Version shown in the sidebar footer: package version, build number (commit count), commit and build date */
function buildInfo() {
  const git = (cmd: string) => {
    try {
      return execSync(`git ${cmd}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    } catch {
      return '';
    }
  };
  const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };
  // "+" marks a build with uncommitted changes, so the commit alone does not describe it
  const dirty = git('status --porcelain --untracked-files=no') ? '+' : '';
  return {
    version,
    build: git('rev-list --count HEAD'),
    commit: git('rev-parse --short HEAD') + dirty,
    date: new Date().toISOString(),
  };
}

export default defineConfig(({ command }) => ({
  // relative paths in the build: runs from any sub-path, e.g. GitHub Pages (user.github.io/track-auswertung/)
  base: command === 'build' ? './' : '/',
  plugins: [vue()],
  worker: { format: 'es' },
  define: {
    // igc-xc-score (flatbush deps) expects Node's global
    global: 'globalThis',
    __BUILD__: JSON.stringify(buildInfo()),
  },
  // maplibre-gl v6 loads its own worker relative to import.meta.url; prebundling breaks that path
  optimizeDeps: { exclude: ['maplibre-gl'] },
  // fixed port: activities live in the browser storage of exactly this origin
  server: { port: 5173, strictPort: true },
}));
