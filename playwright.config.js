const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: 'http://localhost:3000',
  },
  webServer: [
    {
      command: 'npx serve website -p 3000 --no-clipboard',
      port: 3000,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'npx serve client-sites/507-air -p 3001 --no-clipboard',
      port: 3001,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
