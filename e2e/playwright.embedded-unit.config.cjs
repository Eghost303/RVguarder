const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({ testDir: './tests', testMatch: 'embedded-lifecycle.spec.cjs', workers: 1, timeout: 30000, use: { channel: 'chrome' }, reporter: [['list']] });
