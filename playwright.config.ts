import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  workers: 1,
  timeout: 45000,
  expect: { timeout: 15000 },
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:5188",
    viewport: { width: 1280, height: 800 },
    headless: true,
    screenshot: "only-on-failure",
    launchOptions: {
      args:
        process.platform === "darwin"
          ? ["--enable-webgl", "--use-angle=metal"]
          : ["--enable-webgl"],
    },
  },
  webServer: {
    command:
      "node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5188 --open false",
    url: "http://127.0.0.1:5188",
    reuseExistingServer: !process.env.CI,
  },
});
