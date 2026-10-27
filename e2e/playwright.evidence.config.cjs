const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./tests",
  testMatch: "**/capture-evidence.cjs",
  testIgnore: [],
  timeout: 150_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { trace: "off", channel: "chrome" },
  globalSetup: require.resolve("./setup/embedded-setup.cjs"),
});
