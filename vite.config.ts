import { cpSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

// Production CSP for the app page: it makes no network requests
// (connect-src 'none'), so images cannot leave the browser. Not applied in dev,
// where Vite needs inline scripts and a websocket, nor to the parity pages,
// which fetch fixtures.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "worker-src 'self'",
  "img-src 'self' blob: data:",
  "style-src 'self' 'unsafe-inline'",
  "connect-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
].join('; ');

const cspPlugin: Plugin = {
  name: 'csp-meta',
  apply: 'build',
  transformIndexHtml: (_html, ctx) =>
    ctx.path === '/index.html'
      ? [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP }, injectTo: 'head-prepend' }]
      : [],
};

// `npm run parity`: a production build that also contains the dev pages and the
// fixtures they read, served by `vite preview` for testing in other browsers.
// The private tier (gitignored) is included only when present locally.
const PARITY_DIRS = ['goldens', 'example_logos', 'test_images', 'private_fixtures', 'goldens_private'];
const parityFixtures = (outDir: string): Plugin => ({
  name: 'parity-fixtures',
  apply: 'build',
  closeBundle() {
    for (const d of PARITY_DIRS) {
      if (existsSync(resolve(__dirname, d))) cpSync(resolve(__dirname, d), resolve(__dirname, outDir, d), { recursive: true });
    }
  },
  configurePreviewServer(server) {
    server.httpServer?.once('listening', () => {
      setTimeout(() => console.log('\n  Parity page: http://localhost:4174/dev/parity.html  (private tier: ?tier=private)\n'), 50);
    });
  },
});

export default defineConfig(({ mode }) => {
  const parity = mode === 'parity';
  return {
    // GitHub Pages project page: the workflow sets BASE_PATH=/<repo-name>/.
    base: parity ? '/' : (process.env.BASE_PATH ?? '/'),
    plugins: [react(), cspPlugin, ...(parity ? [parityFixtures('dist-parity')] : [])],
    worker: { format: 'es' },
    build: parity
      ? {
          outDir: 'dist-parity',
          rollupOptions: {
            input: {
              main: resolve(__dirname, 'index.html'),
              parity: resolve(__dirname, 'dev/parity.html'),
              perf: resolve(__dirname, 'dev/perf.html'),
            },
          },
        }
      : {},
    preview: parity ? { port: 4174, strictPort: true } : {},
    test: {
      environment: 'node',
      include: ['tests/**/*.test.ts'],
      globalSetup: ['tests/globalSetup.ts'],
      testTimeout: 120_000,
    },
  };
});
