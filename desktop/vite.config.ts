import { resolve } from 'node:path'

export default {
  root: resolve(__dirname, 'renderer'),
  base: './',
  build: {
    outDir: resolve(__dirname, 'dist/renderer'),
    emptyOutDir: true,
  },
  server: {
    host: '127.0.0.1',
    port: 5174,
    strictPort: true,
  },
  // ---------------------------------------------------------------------------
  // Zod version investigation (design doc §5.5 / §6.3, risk R1):
  //
  // Root zod is 4.4.3. @a2ui/react and @a2ui/web_core both have their own
  // nested node_modules/zod@3.25.76 (confirmed by inspecting
  //   node_modules/@a2ui/react/node_modules/zod/package.json → 3.25.76
  //   node_modules/@a2ui/web_core/node_modules/zod/package.json → 3.25.76
  //
  // npm's standard resolution picks the nearest node_modules/zod for each
  // importer, so @a2ui/* packages resolve to their own nested zod v3 and
  // the root code resolves to zod v4. A blanket resolve.alias { zod: v3 }
  // would BREAK any renderer code that explicitly uses zod v4 and is
  // unnecessary because the nested packages already have their own zod.
  //
  // Conclusion: NO alias is added. The bundle is safe without it.
  // If z.string-is-not-a-function appears at runtime, the fallback is a
  // targeted Vite plugin that rewrites 'zod' only when the importer path
  // contains 'node_modules/@a2ui' (see design doc §7 risk R1 mitigation).
  // ---------------------------------------------------------------------------
}
