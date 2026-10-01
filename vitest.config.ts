import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.ts', 'apps/server/src/**/*.test.ts', 'apps/web/src/**/*.test.ts'],
    testTimeout: 600_000,
    hookTimeout: 900_000,
  },
});
