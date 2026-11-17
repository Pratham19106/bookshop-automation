import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development the API runs on :3000 and Vite proxies /api to it, so cookies stay same-origin.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': process.env.BOOKSHOP_DEV_API_TARGET || 'http://localhost:3000' } },
  build: { outDir: 'dist', emptyOutDir: true },
});
