import { defineConfig, devices } from "@playwright/test";

const baseURL = "https://127.0.0.1:3110";

export default defineConfig({
    testDir: "./tests/e2e",
    timeout: 45_000,
    expect: { timeout: 10_000 },
    fullyParallel: false,
    workers: 1,
    forbidOnly: Boolean(process.env.CI),
    retries: process.env.CI ? 1 : 0,
    outputDir: "test-results",
    reporter: [["list"], ["html", { open: "never" }]],
    use: {
        baseURL,
        ignoreHTTPSErrors: true,
        httpCredentials: { username: "e2e-local", password: "synthetic-e2e-workspace-password-32-characters" },
        trace: "retain-on-failure",
        screenshot: "only-on-failure",
    },
    webServer: {
        command: "node tests/e2e/server.mjs",
        url: `${baseURL}/api/health`,
        reuseExistingServer: false,
        ignoreHTTPSErrors: true,
        timeout: 180_000,
        gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
        stdout: "pipe",
        stderr: "pipe",
    },
    projects: [
        { name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
        { name: "firefox", use: { ...devices["Desktop Firefox"], viewport: { width: 1440, height: 900 } } },
        { name: "webkit", use: { ...devices["Desktop Safari"], viewport: { width: 1440, height: 900 } } },
        { name: "mobile-chromium", use: { browserName: "chromium", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
    ],
});
