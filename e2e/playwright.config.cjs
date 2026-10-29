const { defineConfig, devices } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./tests",
  testIgnore: ["**/dsh-ui.spec.cjs", "**/dsh-embedded-settings.spec.cjs", "**/embedded-lifecycle.spec.cjs"],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  reporter: [["list"]],
  use: {
    trace: "retain-on-failure",
    // 本机回归使用系统 Chrome；Chromium/Frefox 需 `npm run install:browsers`。
    channel: "chrome"
  },
  globalSetup: require.resolve("./setup/global-setup.cjs"),
  globalTeardown: require.resolve("./setup/global-teardown.cjs"),
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } }
  ]
});

