// Browser end-to-end tests: the built web app served by the real server in mock mode, on a throwaway data dir.
// Uses the system Edge/Chrome (no browser download): `npm run test:e2e` (set E2E_CHANNEL=chrome to switch).
import { defineConfig } from '@playwright/test';

const port = 8791;
const dataDir = `.e2e-data/${Date.now()}`;

export default defineConfig({
  testDir: 'e2e',
  timeout: 180_000,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    channel: process.env.E2E_CHANNEL ?? 'msedge',
    viewport: { width: 1280, height: 800 },
    trace: 'retain-on-failure',
    actionTimeout: 10_000,
  },
  webServer: {
    command: 'npm run build -w apps/web && npx tsx apps/server/src/main.ts',
    url: `http://127.0.0.1:${port}/api/health`,
    timeout: 120_000,
    reuseExistingServer: false,
    env: { MODE: 'mock', PORT: String(port), DATA_DIR: dataDir, SEED: '7' },
  },
});
