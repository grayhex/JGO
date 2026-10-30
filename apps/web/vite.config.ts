import { readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const api = process.env.API_URL ?? 'http://127.0.0.1:8080';

/** The skins' lossless PNG exports are the source for the WebP files the app uses; the release does not need them. */
function pruneSkinPng(): Plugin {
  let out = 'dist';
  return {
    name: 'prune-skin-png',
    apply: 'build',
    configResolved(c) { out = path.resolve(c.root, c.build.outDir); },
    closeBundle() {
      const dir = path.join(out, 'phones');
      let ids: string[] = [];
      try { ids = readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { return; }
      for (const id of ids) for (const f of ['body.png', 'zoom.png']) rmSync(path.join(dir, id, f), { force: true });
    },
  };
}

export default defineConfig({
  plugins: [react(), pruneSkinPng()],
  server: { host: '127.0.0.1', port: 5173, proxy: { '/api': { target: api, ws: true, changeOrigin: false } } },
  build: { outDir: 'dist', sourcemap: false, target: 'es2022' },
});
