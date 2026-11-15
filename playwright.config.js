import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: './test/browser', timeout: 20000, workers: 1, use: { headless: true }, reporter: 'list' });
