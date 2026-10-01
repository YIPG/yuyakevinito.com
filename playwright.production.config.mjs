import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/production',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  workers: 2,
  retries: 0,
  reporter: [
    ['list'],
    ['json', { outputFile: '.site-checks/playwright.json' }],
  ],
  use: {
    baseURL: 'https://yuyakevinito.com',
    actionTimeout: 10_000,
    navigationTimeout: 20_000,
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  projects: ['chromium', 'webkit'].flatMap((browserName) => [
    {
      name: `${browserName}-desktop`,
      use: {
        browserName,
        viewport: { width: 1280, height: 900 },
      },
    },
    {
      name: `${browserName}-mobile`,
      use: {
        browserName,
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        video: browserName === 'chromium'
          ? { mode: 'on', size: { width: 390, height: 844 } } : 'off',
      },
    },
  ]),
});
