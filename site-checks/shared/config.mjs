// Generated from YIPG/health runner/shared; edit the source and resync.
import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';

export default defineConfig({
  testDir: resolve('site-checks'),
  testMatch: 'scenarios.mjs',
  outputDir: resolve('.site-checks/results'),
  timeout: 180_000,
  expect: { timeout: 30_000 },
  workers: 2,
  retries: 0,
  reporter: [['list'], ['json', { outputFile: resolve('.site-checks/playwright.json') }]],
  use: { navigationTimeout: 30_000, actionTimeout: 20_000, screenshot: 'off', video: 'off', trace: 'off' },
  projects: ['chromium', 'webkit'].flatMap(browserName => [
    { name: `${browserName}-desktop`, use: { browserName, viewport: { width: 1280, height: 900 } } },
    { name: `${browserName}-mobile`, use: {
      browserName, viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    } },
  ]),
});
