import { mkdtemp, readFile, writeFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { parseEnv } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const script = fileURLToPath(new URL("../../scripts/setup.mjs", import.meta.url));
const template = await readFile(new URL("../../.env.example", import.meta.url), "utf8");
let directory: string;
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), "gropbox-setup-")); await writeFile(join(directory, ".env.example"), template); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });
const run = (...args: string[]) => spawnSync(process.execPath, [script, ...args], { cwd: directory, encoding: "utf8" });
const config = () => ({ APP_URL: "https://gropbox.example.com", NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test", SUPABASE_SECRET_KEY: "sb_secret_not_for_logs", GOOGLE_CLIENT_ID: "example.apps.googleusercontent.com", GOOGLE_CLIENT_SECRET: "test-google-secret", TOKEN_ENCRYPTION_KEY: "a".repeat(64), CRON_SECRET: "b".repeat(64), ALLOWED_GOOGLE_EMAILS: "owner@example.com" });
const save = (values: Record<string, string>) => writeFile(join(directory, ".env.local"), Object.entries(values).map(([key, value]) => `${key}=${value}`).join("\n"));

describe("local setup command", () => {
  it("generates independent secrets without printing them or changing existing configuration", async () => {
    const result = run(); expect(result.status).toBe(0);
    const text = await readFile(join(directory, ".env.local"), "utf8"), values = parseEnv(text);
    expect(values.TOKEN_ENCRYPTION_KEY).toMatch(/^[a-f0-9]{64}$/);
    expect(values.CRON_SECRET).toMatch(/^[a-f0-9]{64}$/);
    expect(values.CRON_SECRET).not.toBe(values.TOKEN_ENCRYPTION_KEY);
    expect(result.stdout + result.stderr).not.toContain(values.TOKEN_ENCRYPTION_KEY);
    expect(result.stdout + result.stderr).not.toContain(values.CRON_SECRET);
    const again = run(); expect(again.status).toBe(0); expect(again.stdout).toContain("unchanged");
    expect(await readFile(join(directory, ".env.local"), "utf8")).toBe(text);
    if (process.platform !== "win32") expect((await stat(join(directory, ".env.local"))).mode & 0o777).toBe(0o600);
  });
  it("reports missing values without pretending that setup is complete", () => {
    run(); const result = run("--check");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Missing GOOGLE_CLIENT_SECRET");
    expect(result.stdout).not.toContain("valid");
  });
  it("checks format and produces the exact two callback URLs without cloud claims", async () => {
    const values = config(); await save(values); const result = run("--check");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Cloud credentials and services have NOT been verified");
    expect(result.stdout).toContain("https://example.supabase.co/auth/v1/callback");
    expect(result.stdout).toContain("https://gropbox.example.com/api/auth/callback");
    expect(result.stdout + result.stderr).not.toContain(values.SUPABASE_SECRET_KEY);
    expect(result.stdout + result.stderr).not.toContain(values.GOOGLE_CLIENT_SECRET);
  });
  it("rejects credential-bearing origins, insecure production URLs, and server keys in public fields", async () => {
    for (const bad of [
      { APP_URL: "https://user:password@example.com" },
      { APP_URL: "http://example.com" },
      { APP_URL: "https://example.com/path" },
      { NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_secret_do_not_expose" },
      { NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: `x.${Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url")}.x` },
      { TOKEN_ENCRYPTION_KEY: "invalid" },
      { CRON_SECRET: "a".repeat(64) },
    ]) {
      const values = { ...config(), ...bad }; await save(values);
      const result = run("--check"); expect(result.status).toBe(1);
      expect(result.stdout + result.stderr).not.toContain(values.SUPABASE_SECRET_KEY);
      expect(result.stdout + result.stderr).not.toContain("password@example.com");
    }
  });
  it("accepts legacy anon keys and warns when personal access is unrestricted", async () => {
    const values = { ...config(), NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: `x.${Buffer.from(JSON.stringify({ role: "anon" })).toString("base64url")}.x`, APP_URL: "http://localhost:3000", ALLOWED_GOOGLE_EMAILS: "" };
    await save(values); const result = run("--check"); expect(result.status).toBe(0);
    expect(result.stdout).toContain("For production"); expect(result.stdout).toContain("any Google account may join");
  });
  it("is read-only in check mode and rejects unknown arguments", async () => {
    expect(run("--check").status).toBe(1);
    await expect(stat(join(directory, ".env.local"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(run("--overwrite").status).toBe(1);
    await expect(stat(join(directory, ".env.local"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});
