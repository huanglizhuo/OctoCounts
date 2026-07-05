import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './qa',
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
