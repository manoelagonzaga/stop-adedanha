import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/

export default defineConfig(({ mode }) => {
  const isDev = mode === 'development';

  return {
    plugins: [react(), tailwindcss()],
    base: './',
    server: {
      proxy: {
        '/rooms': {
          target: isDev ? 'http://localhost:8787' : 'https://stop-adedanha-worker.manoela-gonzaga.workers.dev',
          ws: true,
          changeOrigin: true,
        },
      },
    },
  };
});
