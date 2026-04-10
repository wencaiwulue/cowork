import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import renderer from 'vite-plugin-electron-renderer';

export default defineConfig({
  plugins: [
    react(),
    electron({
      entry: 'src/main.ts',
      vite: {
        build: {
          rollupOptions: {
            output: {
              entryFileNames: '[name].cjs',
            },
          },
        },
      },
    }),
    renderer(),
  ],
  root: 'src',
  build: {
    outDir: '../dist',
  },
});
