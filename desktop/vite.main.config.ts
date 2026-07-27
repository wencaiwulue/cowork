import { resolve } from 'node:path'

const external = [
  'electron',
  'node-pty',
  'node:child_process',
  'node:crypto',
  'node:events',
  'node:fs',
  'node:fs/promises',
  'node:module',
  'node:os',
  'node:path',
  'node:url',
  'node:util',
]

export default {
  build: {
    emptyOutDir: true,
    outDir: resolve(__dirname, 'dist/main'),
    rollupOptions: {
      external,
      input: {
        main: resolve(__dirname, 'main/main.ts'),
      },
      output: {
        entryFileNames: '[name].js',
        format: 'es',
      },
    },
    target: 'node22',
  },
}
