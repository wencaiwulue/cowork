/**
 * Vitest configuration for renderer (jsdom) integration tests.
 *
 * This config is independent of desktop/vitest.config.ts (which runs in node
 * environment for static source-analysis tests). This config exercises the
 * actual A2UI React renderer modules at runtime in a jsdom environment.
 *
 * No zod alias is added here — per design doc §5.5 and the comment in
 * desktop/vite.config.ts: @a2ui/* packages carry their own nested
 * zod@3.25.76 in node_modules/@a2ui/react/node_modules/zod and
 * node_modules/@a2ui/web_core/node_modules/zod, so npm's standard
 * nearest-node_modules resolution picks the correct v3 for them and v4
 * for root code. A blanket alias would break renderer code that uses zod/v4.
 * The conformance tests serve as runtime proof that nested resolution works.
 */
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['desktop/tests/renderer/**/*.test.tsx'],
    setupFiles: ['desktop/tests/renderer/setup.ts'],
  },
})
