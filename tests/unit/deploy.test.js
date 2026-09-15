import { mkdtemp, readFile, writeFile, mkdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { deploy, deploymentFiles, googleClient, providerApi, migrationQuery } from "../../scripts/deploy-core.mjs";
import { main } from "../../scripts/deploy.mjs";

const terminal = vi.hoisted(() => ({ answers: [], question: vi.fn(), close: vi.fn() }));
vi.mock("node:readline/promises", () => ({ createInterface: () => ({ question: label => { terminal.question(label); return Promise.resolve(terminal.answers.shift() ?? ""); }, close: terminal.close }) }));
const repo = fileURLToPath(new URL("../../", import.meta.url));
const ref = "abcdefghijklmnopqrst", teamId = "team_test", projectId = "prj_test";
const tokens = { supabaseToken: "sbp_private_test_token", vercelToken: "vercel_private_test_token" };
const google = { web: { client_id: "test.apps.googleusercontent.com", client_secret: "google_private_secret", redirect_uris: [`https://${ref}.supabase.co/auth/v1/callback`] } };
const cleanups = [];
const ttyDescriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
afterEach(async () => {
  vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); terminal.answers = []; terminal.question.mockClear();
  if (ttyDescriptor) Object.defineProperty(process.stdin, "isTTY", ttyDescriptor); else delete process.stdin.isTTY;
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function scenario({ delayedDomain = false, failFinal = false, occupied = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), "gropbox-deploy-test-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  for (const directory of ["src", "public", "supabase/migrations"]) await mkdir(join(root, directory), { recursive: true });
  for (const file of ["package.json", "package-lock.json", "next.config.ts", "next-env.d.ts", "tsconfig.json", "vercel.json"]) await writeFile(join(root, file), "{}");
  await writeFile(join(root, "src/page.tsx"), "export default function Page() { return null; }");
  await writeFile(join(root, "public/icon.svg"), "<svg></svg>");
  const sql = await readFile(join(repo, "supabase/migrations/001_gropbox.sql"), "utf8");
  await writeFile(join(root, "supabase/migrations/001_gropbox.sql"), sql);
  await writeFile(join(root, "client_secret_test.json"), JSON.stringify(google));
  await writeFile(join(root, ".env.local"), "USER_OWNED_CONFIGURATION=keep");
  const config = { supabaseRef: ref, vercelTeamId: teamId, projectName: "gropbox-test", email: "owner@example.com", googleCredentials: join(root, "client_secret_test.json") };
  const db = new PGlite({ extensions: { pg_trgm } }); cleanups.push(() => db.close());
  await db.exec(`create schema auth; create schema extensions; create role anon; create role authenticated; create role service_role bypassrls;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create publication supabase_realtime;`);
  if (occupied) await db.exec("create table public.important_data(value text); insert into public.important_data values ('keep');");
  const cloud = { project: null, env: {}, keys: [{ type: "publishable", api_key: "sb_publishable_test_value" }, { type: "secret", api_key: "sb_secret_private_value" }], failedEnv: false, auth: { external_google_enabled: false, uri_allow_list: "https://existing.example.com/callback", site_url: "http://localhost:3000" }, deployments: [], writes: [], calls: [], migrationCount: 0, failFinal, delayedDomain };
  const fetcher = vi.fn(async (address, options) => {
    const url = new URL(address), body = options.body ? JSON.parse(options.body) : undefined;
    cloud.calls.push({ url, options, body });
    expect(options.redirect).toBe("error");
    expect(options.headers.Authorization).toBe(`Bearer ${url.hostname === "api.supabase.com" ? tokens.supabaseToken : tokens.vercelToken}`);
    if (options.method !== "GET" && !body?.read_only) cloud.writes.push({ path: url.pathname, body });
    const json = value => Response.json(value);
    if (url.hostname === "api.supabase.com") {
      if (url.pathname === "/v1/projects") return json([{ id: "internal_project_id", ref, name: "New database", status: "ACTIVE_HEALTHY" }]);
      if (url.pathname === `/v1/projects/${ref}`) return json({ id: "internal_project_id", ref, name: "New database", status: "ACTIVE_HEALTHY" });
      if (url.pathname.endsWith("/database/query")) {
        if (body.read_only) return json((await db.query(body.query)).rows);
        cloud.migrationCount++;
        try { await db.exec(body.query); } catch (error) { await db.exec("rollback;"); throw error; }
        return json([]);
      }
      if (url.pathname.endsWith("/api-keys")) {
        expect(url.searchParams.get("reveal")).toBe("true");
        return json(cloud.keys);
      }
      if (url.pathname.endsWith("/config/auth")) {
        if (options.method === "PATCH") Object.assign(cloud.auth, body);
        return json(cloud.auth);
      }
    } else if (url.hostname === "api.vercel.com") {
      if (url.pathname === "/v2/teams") return json({ teams: [{ id: teamId, name: "Personal" }] });
      expect(url.searchParams.get("teamId")).toBe(teamId);
      if (url.pathname === `/v2/teams/${teamId}`) return json({ id: teamId, name: "Personal" });
      if (url.pathname === "/v9/projects/gropbox-test") return cloud.project ? json(cloud.project) : Response.json({}, { status: 404 });
      if (url.pathname === "/v11/projects") {
        expect(cloud.project).toBeNull();
        cloud.project = { id: projectId, accountId: teamId };
        cloud.env = Object.fromEntries(body.environmentVariables.map(e => [e.key, e.value]));
        return json(cloud.project);
      }
      if (url.pathname.endsWith("/domains")) return json({ domains: cloud.delayedDomain && !cloud.deployments.length ? [] : [{ name: "gropbox-real-name.vercel.app", verified: true, gitBranch: null, redirect: null }] });
      if (url.pathname.endsWith("/env")) {
        expect(url.searchParams.get("upsert")).toBe("true");
        for (const entry of body) { expect(entry.target).toEqual(["production"]); expect(entry.type).toBe("encrypted"); cloud.env[entry.key] = entry.value; }
        return json({ created: body.map(e => ({ key: e.key })), failed: cloud.failedEnv ? [{ error: { code: "forbidden", message: "private provider details" } }] : [] });
      }
      if (url.pathname === "/v13/deployments") {
        expect(body.project).toBe(projectId); expect(body.target).toBe("production");
        expect(body.projectSettings).toMatchObject({ nodeVersion: "24.x", installCommand: "npm ci", buildCommand: "npm run build" });
        expect(body.files.map(f => f.file)).not.toContain(".env.local");
        expect(body.files.every(f => !f.file.includes("client_secret") && !f.file.includes(".gropbox"))).toBe(true);
        const result = { id: `dpl_${cloud.deployments.length}`, projectId, target: "production", readyState: cloud.failFinal && cloud.env.APP_URL ? "ERROR" : "READY", aliasAssigned: true };
        cloud.deployments.push(result); return json(result);
      }
      if (url.pathname.startsWith("/v13/deployments/")) return json(cloud.deployments.find(d => d.id === url.pathname.split("/").at(-1)));
    }
    throw new Error(`Unexpected mock route: ${url.hostname}${url.pathname}`);
  });
  const log = vi.fn();
  const options = { root, ...tokens, fetcher, pause: async () => {}, confirm: async () => true, log };
  return { root, config, db, cloud, fetcher, log, options, state: async () => JSON.parse(await readFile(join(root, ".gropbox/deploy-state.json"), "utf8")) };
}

describe("deployment walkthrough with mocked providers and real local PostgreSQL", () => {
  it("runs a first installation without copying keys, SQL, or the domain, then is read-only on repeat", async () => {
    const s = await scenario();
    expect(await deploy(s.config, s.options)).toEqual({ status: "deployed", url: "https://gropbox-real-name.vercel.app", liveChecks: "not_verified" });
    expect(s.cloud.migrationCount).toBe(1); expect(s.cloud.deployments).toHaveLength(1);
    expect(s.cloud.auth).toMatchObject({ external_google_enabled: true, external_google_client_id: google.web.client_id, external_google_secret: google.web.client_secret, site_url: "https://gropbox-real-name.vercel.app", uri_allow_list: "https://existing.example.com/callback,https://gropbox-real-name.vercel.app/api/auth/callback" });
    expect(s.cloud.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY).toBe("sb_publishable_test_value");
    expect(s.cloud.env.SUPABASE_SECRET_KEY).toBe("sb_secret_private_value");
    expect(s.cloud.env.TOKEN_ENCRYPTION_KEY).not.toBe(s.cloud.env.CRON_SECRET);
    const saved = await s.state(), writes = s.cloud.writes.length;
    await deploy(s.config, s.options);
    expect(s.cloud.writes).toHaveLength(writes); expect(await s.state()).toEqual(saved);
    expect(await readFile(join(s.root, ".env.local"), "utf8")).toBe("USER_OWNED_CONFIGURATION=keep");
    const logs = JSON.stringify(s.log.mock.calls), stateText = JSON.stringify(saved);
    for (const secret of Object.values(tokens).concat([google.web.client_secret, s.cloud.env.TOKEN_ENCRYPTION_KEY, s.cloud.env.SUPABASE_SECRET_KEY])) expect(logs).not.toContain(secret);
    for (const token of Object.values(tokens)) expect(stateText).not.toContain(token);
    if (process.platform !== "win32") expect((await stat(join(s.root, ".gropbox/deploy-state.json"))).mode & 0o777).toBe(0o600);
  });

  it("handles an unknown domain with a setup-only deployment before the final configured build", async () => {
    const s = await scenario({ delayedDomain: true }); await deploy(s.config, s.options);
    expect(s.cloud.deployments).toHaveLength(2);
    const writes = s.cloud.writes.map(w => w.path);
    expect(writes.indexOf("/v13/deployments")).toBeLessThan(writes.indexOf(`/v10/projects/${projectId}/env`));
    expect(s.cloud.env.APP_URL).toBe("https://gropbox-real-name.vercel.app");
  });

  it("retains keys and skips SQL when resuming a failed final build", async () => {
    const s = await scenario({ failFinal: true });
    await expect(deploy(s.config, s.options)).rejects.toThrow("build failed");
    const saved = await s.state(); expect(saved.pending.kind).toBe("final");
    s.cloud.failFinal = false; await deploy(s.config, s.options);
    expect(s.cloud.migrationCount).toBe(1); expect(s.cloud.deployments).toHaveLength(2);
    expect((await s.state()).env).toEqual(saved.env);
    await expect(stat(join(s.root, ".gropbox/deploy.lock"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not mutate cloud or local state when the user declines the plan", async () => {
    const s = await scenario();
    expect((await deploy(s.config, { ...s.options, confirm: async () => false })).status).toBe("planned");
    expect(s.cloud.writes).toEqual([]);
    await expect(stat(join(s.root, ".gropbox"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not overwrite state saved by another setup after preflight", async () => {
    const s = await scenario();
    const statePath = join(s.root, ".gropbox/deploy-state.json");
    await expect(deploy(s.config, { ...s.options, confirm: async () => {
      await mkdir(join(s.root, ".gropbox"));
      await writeFile(statePath, "another setup's private state");
      return true;
    } })).rejects.toThrow("Another setup changed");
    expect(s.cloud.writes).toEqual([]);
    expect(await readFile(statePath, "utf8")).toBe("another setup's private state");
  });

  it("rejects mixed public/server keys before initializing the database", async () => {
    const s = await scenario();
    s.cloud.keys = [{ type: "publishable", api_key: "sb_secret_private_value" }, { type: "secret", api_key: "sb_secret_private_value" }];
    await expect(deploy(s.config, s.options)).rejects.toThrow("separate Supabase public/server keys");
    expect(s.cloud.writes).toEqual([]);
    await expect(s.state()).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("stops on a partially failed environment update and resumes without rotating keys", async () => {
    const s = await scenario(); s.cloud.failedEnv = true;
    await expect(deploy(s.config, s.options)).rejects.toThrow("did not accept all environment variables");
    const saved = await s.state();
    expect(s.cloud.auth.external_google_enabled).toBe(false);
    expect(s.cloud.deployments).toEqual([]);
    expect(JSON.stringify(s.log.mock.calls)).not.toContain("private provider details");
    s.cloud.failedEnv = false;
    await deploy(s.config, s.options);
    expect(s.cloud.deployments).toHaveLength(1); expect(s.cloud.migrationCount).toBe(1);
    expect((await s.state()).env).toEqual(saved.env);
  });

  it("protects an occupied database and an unrelated existing Vercel project", async () => {
    const s = await scenario({ occupied: true });
    await expect(deploy(s.config, s.options)).rejects.toThrow("already contains"); expect(s.cloud.writes).toEqual([]);
    expect((await s.db.query("select * from important_data")).rows).toEqual([{ value: "keep" }]);
    s.cloud.project = { id: "prj_someone_else", accountId: teamId };
    await expect(deploy(s.config, s.options)).rejects.toThrow("already exists"); expect(s.cloud.writes).toEqual([]);
  });

  it("rejects a mismatched Google JSON, changed targets, and changed database state", async () => {
    const s = await scenario();
    await writeFile(s.config.googleCredentials, JSON.stringify({ installed: google.web }));
    await expect(deploy(s.config, s.options)).rejects.toThrow("Web application"); expect(s.fetcher).not.toHaveBeenCalled();
    await writeFile(s.config.googleCredentials, JSON.stringify(google)); await deploy(s.config, s.options);
    const writes = s.cloud.writes.length;
    await expect(deploy({ ...s.config, email: "different@example.com" }, s.options)).rejects.toThrow("targets differ");
    await s.db.exec("alter table public.messages disable row level security;");
    await expect(deploy(s.config, s.options)).rejects.toThrow("RLS/Realtime"); expect(s.cloud.writes).toHaveLength(writes);
  });

  it("rolls back the installation as one transaction and cannot run the migration over existing data", async () => {
    const s = await scenario();
    const marker = `gropbox:11111111-1111-4111-8111-111111111111:${"a".repeat(64)}`;
    await expect(s.db.exec(migrationQuery("create table public.partial_install(id int); select nonexistent_function();", marker))).rejects.toThrow();
    await s.db.exec("rollback");
    expect((await s.db.query("select to_regclass('public.partial_install') as table_name")).rows[0].table_name).toBeNull();
    await s.db.exec("create table public.keep_me(id int)");
    await expect(s.db.exec(migrationQuery("select 1;", marker))).rejects.toThrow("Database is not empty"); await s.db.exec("rollback");
  });

  it("simulates the manual terminal entry and the agent plan/apply entry through the same implementation", async () => {
    const s = await scenario();
    vi.spyOn(process, "cwd").mockReturnValue(s.root); vi.stubGlobal("fetch", s.fetcher);
    vi.stubEnv("SUPABASE_ACCESS_TOKEN", tokens.supabaseToken); vi.stubEnv("VERCEL_TOKEN", tokens.vercelToken);
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
    const output = vi.spyOn(console, "log").mockImplementation(() => {});
    const inputPath = join(s.root, "agent-input.json"); await writeFile(inputPath, JSON.stringify(s.config));
    await main(["--config", inputPath]); expect(s.cloud.writes).toEqual([]);
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    terminal.answers = ["1", "1", s.config.projectName, s.config.email, s.config.googleCredentials, "y"];
    await main([]); expect(s.cloud.deployments).toHaveLength(1); expect(terminal.answers).toEqual([]);
    const writes = s.cloud.writes.length;
    await main(["--config", inputPath, "--apply"]); expect(s.cloud.writes).toHaveLength(writes);
    expect(JSON.stringify(output.mock.calls)).not.toContain(google.web.client_secret);
  });
});

describe("deployment input boundaries", () => {
  it("rejects a foreign callback and never follows JSON-provided URLs", () => {
    expect(() => googleClient({ web: { ...google.web, redirect_uris: ["https://elsewhere.example/callback"] } }, ref)).toThrow("callback");
    expect(googleClient({ web: { ...google.web, token_uri: "https://attacker.example" } }, ref)).toEqual({ GOOGLE_CLIENT_ID: google.web.client_id, GOOGLE_CLIENT_SECRET: google.web.client_secret });
  });
  it("sanitizes provider failures and refuses unexpected hosts", async () => {
    const fetcher = vi.fn(async () => Response.json({ error: google.web.client_secret }, { status: 403 }));
    const api = providerApi({ ...tokens, teamId, fetcher });
    await expect(api("supabase", "/v1/projects")).rejects.toThrow("HTTP 403");
    await expect(api("supabase", "https://attacker.example/")).rejects.toThrow("unexpected API host");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("uploads the real application inputs but excludes docs, test fixtures, and private configuration", async () => {
    const files = await deploymentFiles(repo);
    expect(files.some(f => f.file === "src/app/page.tsx")).toBe(true);
    expect(files.every(f => !/^(docs|tests|scripts|\.env|\.gropbox)\b/.test(f.file))).toBe(true);
    expect(files.some(f => f.file === "package-lock.json")).toBe(true);
  });
});
