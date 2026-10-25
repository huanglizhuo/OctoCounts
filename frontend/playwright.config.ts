import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './qa',
  outputDir: process.env.PLAYWRIGHT_OUTPUT_DIR ?? '/tmp/octocounts-playwright',
  workers: process.env.CI ? 2 : undefined,
  webServer: {
    command: 'npm run dev -- --port 5173 --strictPort',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: !process.env.CI,
    env: { VITE_API_BASE: '' },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  use: {
    baseURL: 'http://127.0.0.1:5173',
    headless: true,
  },
  reporter: [['list']],
});
