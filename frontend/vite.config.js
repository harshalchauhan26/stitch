import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Two pages: the app at / and the public landing page at /landing/ (its "Early access" link opens the app).
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': 'http://localhost:4000' } },
  build: { rollupOptions: { input: { app: resolve(import.meta.dirname, 'index.html'), landing: resolve(import.meta.dirname, 'landing/index.html') } } },
});
