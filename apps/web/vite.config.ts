import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const api = process.env.API_URL ?? 'http://127.0.0.1:8080';

export default defineConfig({
  plugins: [react()],
  server: { host: '127.0.0.1', port: 5173, proxy: { '/api': { target: api, ws: true, changeOrigin: false } } },
  build: { outDir: 'dist', sourcemap: false, target: 'es2022' },
});
