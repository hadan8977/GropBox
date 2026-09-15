import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e", timeout: 30_000, fullyParallel: false, workers: 1,
  use: { baseURL: "http://localhost:3100", headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || undefined, trace: "retain-on-failure" },
  projects: [{ name: "desktop", use: { ...devices["Desktop Chrome"] } }, { name: "mobile", use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" } }],
  webServer: { command: "npm run dev -- --port 3100", url: "http://localhost:3100", reuseExistingServer: false, timeout: 60_000,
    env: { APP_URL: "http://localhost:3100", NEXT_PUBLIC_SUPABASE_URL: "https://gropbox-test.supabase.co", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "test-publishable-key", SUPABASE_SECRET_KEY: "test-server-only-key", GOOGLE_CLIENT_ID: "test-client", GOOGLE_CLIENT_SECRET: "test-secret", TOKEN_ENCRYPTION_KEY: "a".repeat(64) },
  },
});
