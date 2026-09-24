import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The SPA lives in web/ and is built into dist/client, served by the Worker (assets) or the Bun server.
// Dev: `bun run dev` (API) + `bun run dev:web`; /api is proxied, so cookies stay same-origin.
export default defineConfig({
  root: 'web',
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./web', import.meta.url)) } },
  server: { proxy: { '/api': process.env.API_URL ?? 'http://localhost:3000' } },
  build: { outDir: '../dist/client', emptyOutDir: true },
});
