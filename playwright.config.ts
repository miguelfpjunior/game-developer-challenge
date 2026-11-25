import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;

export default defineConfig({
  testDir: './e2e',
  snapshotPathTemplate: '{testDir}/__screenshots__/{testFilePath}/{arg}-{projectName}{ext}',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // WebGL runs in software in headless Chromium: keep parallelism moderate.
  workers: process.env.CI ? 2 : 4,
  timeout: 90_000,
  expect: { timeout: 10_000, toHaveScreenshot: { maxDiffPixelRatio: 0.02, animations: 'disabled' } },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'desktop-chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
      grepInvert: /@perf|@mobile-only/,
    },
    {
      name: 'mobile-chromium',
      // Landscape phone: the supported mobile orientation.
      use: { ...devices['Pixel 7 landscape'] },
      grep: /@mobile|@smoke/,
      grepInvert: /@perf/,
    },
    {
      name: 'perf',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1600, height: 900 } },
      grep: /@perf/,
      timeout: 15 * 60_000,
    },
  ],
  // Tests run against the optimized production build, with MSW mocks active (as deployed).
  webServer: {
    command: 'npm run build && npm run preview',
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
