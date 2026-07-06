import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Ports: client 5173, server 8080. Vite proxy /api → http://localhost:8080.
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
});
