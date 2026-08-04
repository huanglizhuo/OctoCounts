import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  // Live GitHub pages: one worker, generous timeouts, and a retry so a single
  // slow page load cannot open a bug report about a GitHub redesign.
  workers: 1,
  retries: 1,
  timeout: 120_000,
  expect: { timeout: 30_000 },
  reporter: [['line'], ['html', { open: 'never', outputFolder: 'report' }]],
  outputDir: 'results',
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
