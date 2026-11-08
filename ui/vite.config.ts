import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  build: {
    rollupOptions: {
      input: {
        index: resolve(here, 'index.html'),
        board: resolve(here, 'board.html'),
      },
    },
  },
  server: {
    port: 5180,
    proxy: {
      '/ws': { target: 'ws://127.0.0.1:17730', ws: true },
      '/api': { target: 'http://127.0.0.1:17730' },
    },
  },
});
