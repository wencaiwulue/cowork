import { resolve } from 'node:path'

export default {
  build: {
    emptyOutDir: false,
    outDir: resolve(__dirname, 'dist/preload'),
    rollupOptions: {
      external: ['electron'],
      input: {
        preload: resolve(__dirname, 'preload/preload.ts'),
      },
      output: {
        entryFileNames: '[name].cjs',
        format: 'cjs',
      },
    },
    target: 'node22',
  },
}
