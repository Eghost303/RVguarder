const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./tests",
  testIgnore: ["**/dsh-ui.spec.cjs", "**/guard-ui.spec.cjs"],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    trace: "retain-on-failure",
    channel: "chrome",
  },
  globalSetup: require.resolve("./setup/embedded-setup.cjs"),
});
