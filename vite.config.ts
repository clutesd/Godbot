import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  server: { watch: { ignored: ['**/output/**'] } },
  build: {
    rollupOptions: {
      input: {
        main: resolve(process.cwd(), 'index.html'),
        architectureBrowser: resolve(process.cwd(), 'architecture-browser.html'),
        architectureFlagships: resolve(process.cwd(), 'architecture-flagships.html'),
      },
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    maxWorkers: 2,
    // A hang guard, not a performance budget: performance has its own explicit tests, and a
    // 5 s default fails ordinary scenario tests whenever the machine is busy.
    testTimeout: 60_000,
    tags: [
      {
        name: 'soak',
        description: 'Whole-simulation runs over decades or centuries. Excluded from `npm test`; run with `npm run test:soak`.',
        timeout: 45 * 60_000,
      },
    ],
  },
});
