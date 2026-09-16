import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile, writeFile, rename, mkdir, readdir, lstat, open, unlink } from "node:fs/promises";
import { join } from "node:path";

export class DeployError extends Error {}
const requireValue = (ok, message) => { if (!ok) throw new DeployError(message); };
const buildSettings = { framework: "nextjs", installCommand: "npm ci", buildCommand: "npm run build" };
const deploymentSettings = { ...buildSettings, nodeVersion: "24.x" };
const sqlPath = "supabase/migrations/001_gropbox.sql";

export function validateConfig(config) {
  requireValue(/^[a-z]{20}$/.test(config.supabaseRef), "Choose a hosted Supabase project reference (20 lowercase letters).");
  requireValue(/^team_[a-zA-Z0-9]+$/.test(config.vercelTeamId), "Choose the Vercel team that will own the deployment.");
  requireValue(/^[a-z0-9][a-z0-9-]{0,60}$/.test(config.projectName), "Use a Vercel project name containing lowercase letters, numbers, or hyphens.");
  requireValue(typeof config.email === "string" && /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(config.email), "Enter one Google email for this personal deployment.");
  requireValue(typeof config.googleCredentials === "string" && config.googleCredentials.length > 0, "Select the downloaded Google Web client JSON file.");
  return { supabaseRef: config.supabaseRef, vercelTeamId: config.vercelTeamId, projectName: config.projectName, email: config.email.toLowerCase(), googleCredentials: config.googleCredentials };
}

export function googleClient(json, ref) {
  const client = json?.web;
  requireValue(client && typeof client.client_id === "string" && client.client_id.endsWith(".apps.googleusercontent.com") && typeof client.client_secret === "string" && client.client_secret.length > 0, "Import a Google Web application client JSON, not a service-account or desktop-client file.");
  requireValue(client.redirect_uris?.includes(`https://${ref}.supabase.co/auth/v1/callback`), "The Google client JSON must include this Supabase project's callback. Save it in Google, then update web.redirect_uris in your private JSON to match without changing its secret.");
  return { GOOGLE_CLIENT_ID: client.client_id, GOOGLE_CLIENT_SECRET: client.client_secret };
}

export function providerApi({ supabaseToken, vercelToken, teamId, fetcher = fetch }) {
  requireValue(typeof supabaseToken === "string" && supabaseToken.trim() && typeof vercelToken === "string" && vercelToken.trim(), "Authorize Supabase and Vercel through the hidden prompts or SUPABASE_ACCESS_TOKEN and VERCEL_TOKEN. Never put tokens in command arguments.");
  return async (provider, path, { method = "GET", body, allowMissing = false } = {}) => {
    const url = new URL(path, provider === "supabase" ? "https://api.supabase.com" : "https://api.vercel.com");
    requireValue(url.origin === (provider === "supabase" ? "https://api.supabase.com" : "https://api.vercel.com"), "Refusing an unexpected API host.");
    if (provider === "vercel" && teamId) url.searchParams.set("teamId", teamId);
    let response;
    try {
      response = await fetcher(url.toString(), { method, redirect: "error", signal: AbortSignal.timeout(30_000), headers: { Authorization: `Bearer ${provider === "supabase" ? supabaseToken : vercelToken}`, "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    } catch { throw new DeployError(`${provider}: network request failed or timed out. No automatic write retry was attempted; rerun to inspect saved progress.`); }
    if (response.status === 404 && allowMissing) return null;
    requireValue(response.ok, `${provider}: ${method} ${url.pathname} failed (HTTP ${response.status}). Check the target, token permissions, and provider dashboard. Response bodies are hidden to protect credentials.`);
    // Provider errors can echo submitted secrets. Never include raw response bodies in errors.
    try { return await response.json(); } catch { throw new DeployError(`${provider}: invalid API response. Inspect the provider dashboard before retrying.`); }
  };
}

// Only application/build inputs are uploaded, never the checkout's private setup files.
export async function deploymentFiles(root) {
  const files = [];
  async function add(relative) {
    const info = await lstat(join(root, relative));
    requireValue(!info.isSymbolicLink(), "Deployment inputs must not contain symbolic links.");
    if (info.isDirectory()) {
      for (const entry of (await readdir(join(root, relative))).sort()) await add(`${relative}/${entry}`);
    } else {
      requireValue(info.isFile() && !/(^|\/)\.|client_secret|\.(pem|key|p12)$/i.test(relative), "A private or unsupported file was found inside the application upload paths.");
      requireValue(info.size < 2_000_000, "An application file is too large for this small-project deploy helper. Use the dashboard deployment path.");
      files.push({ file: relative, data: (await readFile(join(root, relative))).toString("base64"), encoding: "base64" });
    }
  }
  for (const file of ["package.json", "package-lock.json", "next.config.ts", "next-env.d.ts", "tsconfig.json", "vercel.json", "src", "public"]) await add(file);
  requireValue(Buffer.byteLength(JSON.stringify(files)) < 4_000_000, "Application upload exceeds this helper's limit. Use the dashboard deployment path.");
  return files;
}

export function migrationQuery(sql, marker) {
  requireValue(/^gropbox:[a-f0-9-]{36}:[a-f0-9]{64}$/.test(marker), "Invalid installation state.");
  return `begin;
select pg_advisory_xact_lock(1783408977);
do $gropbox_guard$ begin
  if exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p','v','m','S'))
    or exists (select 1 from auth.users) then raise exception 'Database is not empty'; end if;
end $gropbox_guard$;
${sql}
comment on table public.messages is '${marker}';
commit;`;
}

const inspectionQuery = `select
  (select count(*)::int from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p','v','m','S')) as objects,
  (select count(*)::int from auth.users) as users,
  obj_description(to_regclass('public.messages'),'pg_class') as marker,
  (select count(*)::int from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p') and c.relrowsecurity) as rls_tables,
  exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='messages') as realtime;`;

export async function deploy(input, { root = process.cwd(), supabaseToken, vercelToken, fetcher = fetch, confirm = async () => false, log = console.log, pause = (ms) => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  const config = validateConfig(input);
  const api = providerApi({ supabaseToken, vercelToken, teamId: config.vercelTeamId, fetcher });
  const refPath = `/v1/projects/${config.supabaseRef}`;
  const query = (sql, readOnly = true) => api("supabase", `${refPath}/database/query`, { method: "POST", body: { query: sql, read_only: readOnly } });
  let client;
  try { client = googleClient(JSON.parse(await readFile(config.googleCredentials, "utf8")), config.supabaseRef); }
  catch (error) { if (error instanceof DeployError) throw error; throw new DeployError("Cannot read the Google client JSON. Choose its local file path; do not paste its contents in chat."); }
  const sql = (await readFile(join(root, sqlPath), "utf8")).replace(/\r\n/g, "\n");
  const schemaHash = createHash("sha256").update(sql).digest("hex");
  const files = await deploymentFiles(root);
  const sourceHash = createHash("sha256").update(JSON.stringify(files)).digest("hex");
  const directory = join(root, ".gropbox"), statePath = join(directory, "deploy-state.json");
  let state, stateSnapshot = null;
  try {
    requireValue(!(await lstat(directory)).isSymbolicLink() && !(await lstat(statePath)).isSymbolicLink(), "The private setup directory and state must not be symlinks.");
    stateSnapshot = await readFile(statePath, "utf8");
    state = JSON.parse(stateSnapshot);
  } catch (error) { if (error.code !== "ENOENT") throw error instanceof DeployError ? error : new DeployError("Cannot read private deployment state. Do not replace or delete it to retry."); }
  if (state) {
    requireValue(state.version === 1 && state.config.supabaseRef === config.supabaseRef && state.config.vercelTeamId === config.vercelTeamId && state.config.projectName === config.projectName && state.config.email === config.email, "Saved deployment targets differ. Use the original configuration or a separate checkout for a new installation.");
    requireValue(state.env?.GOOGLE_CLIENT_ID === client.GOOGLE_CLIENT_ID && state.env?.GOOGLE_CLIENT_SECRET === client.GOOGLE_CLIENT_SECRET && /^[a-f0-9]{64}$/.test(state.env?.TOKEN_ENCRYPTION_KEY) && /^[a-f0-9]{64}$/.test(state.env?.CRON_SECRET) && state.env.CRON_SECRET !== state.env.TOKEN_ENCRYPTION_KEY, "Saved credentials differ or are invalid. This installer never rotates existing credentials.");
    requireValue(state.schemaHash === schemaHash, "Database migration changed. Use an explicit upgrade procedure; do not reinitialize an existing installation.");
  }
  log("Checking selected projects (read-only)...");
  const [supabase, team, existing, auth, rows] = await Promise.all([
    api("supabase", refPath), api("vercel", `/v2/teams/${config.vercelTeamId}`),
    api("vercel", `/v9/projects/${config.projectName}`, { allowMissing: true }),
    api("supabase", `${refPath}/config/auth`), query(inspectionQuery),
  ]);
  requireValue(supabase.ref === config.supabaseRef && supabase.status === "ACTIVE_HEALTHY", "The selected Supabase project is not ready. Wait for it to be healthy, then retry.");
  requireValue(team.id === config.vercelTeamId, "Vercel returned a different team. No changes made.");
  requireValue(!existing || (state?.projectId === existing.id && existing.accountId === config.vercelTeamId), "That Vercel project already exists and is not owned by this setup state. Choose a new name; use the dashboard guide for an existing installation.");
  requireValue(!state?.projectId || existing?.id === state.projectId, "The saved Vercel project is missing or was replaced. Refusing to recreate it automatically.");
  const marker = state ? `gropbox:${state.installId}:${schemaHash}` : null;
  const db = rows?.[0];
  requireValue(db && Number.isInteger(db.objects) && Number.isInteger(db.users), "Supabase returned an unexpected database inspection result.");
  const ours = marker && db.marker === marker;
  requireValue(!state?.initialized || ours, "The previously initialized database was changed or removed. Refusing automatic reinitialization.");
  requireValue(ours || (db.objects === 0 && db.users === 0 && !db.marker), "This database already contains an installation or other data. Nothing was overwritten. Use a new, dedicated Supabase project or resume with its original setup state.");
  requireValue(!auth.external_google_enabled || (ours && auth.external_google_client_id === client.GOOGLE_CLIENT_ID), "Google sign-in is already configured outside this installation. Refusing to replace it.");
  requireValue(!ours || (db.rls_tables === 6 && db.realtime === true), "The installed RLS/Realtime configuration has changed. Inspect it before deploying.");
  requireValue(!state?.completedSource || state.completedSource === sourceHash, "This first-install helper does not upgrade completed deployments. Use the existing deployment's release process; saved data and keys were left unchanged.");
  const plan = { supabase: { ref: supabase.ref, name: supabase.name }, vercel: { team: team.name, teamId: team.id, project: config.projectName }, initializeDatabase: !ours, createVercelProject: !existing };
  if (!await confirm(plan)) { log("Not applied. No cloud resources or configuration were changed."); return { status: "planned", plan }; }
  if (state?.completedSource) {
    log(`Existing deployment: ${state.env.APP_URL}. No configuration was changed.`);
    log("Real Google sign-in, Drive access, and second-device sync remain user verification steps.");
    return { status: "deployed", url: state.env.APP_URL, liveChecks: "not_verified" };
  }

  await mkdir(directory, { recursive: true, mode: 0o700 });
  requireValue(!(await lstat(directory)).isSymbolicLink(), "The private setup directory must not be a symlink.");
  let lock;
  try { lock = await open(join(directory, "deploy.lock"), "wx", 0o600); }
  catch { throw new DeployError("Another setup may be running. If it was interrupted, verify it has stopped before removing .gropbox/deploy.lock."); }
  async function save() {
    const temporary = join(directory, `state-${randomUUID()}.tmp`);
    await writeFile(temporary, JSON.stringify(state, null, 2), { flag: "wx", mode: 0o600 });
    await rename(temporary, statePath);
  }
  const environment = () => Object.entries(state.env).map(([key, value]) => ({ key, value, type: "encrypted", target: ["production"] }));
  async function waitFor(id) {
    for (let attempt = 0; attempt < 180; attempt++) {
      const result = await api("vercel", `/v13/deployments/${encodeURIComponent(id)}`);
      requireValue(result.projectId === state.projectId && result.target === "production", "Deployment target differs from the selected project.");
      if (result.readyState === "READY" && result.aliasAssigned) return result;
      requireValue(!["ERROR", "CANCELED"].includes(result.readyState), "Vercel build failed or was canceled. Inspect its build log in the dashboard, fix the cause, and rerun. Saved keys will be retained.");
      if (attempt % 12 === 0) log(`Vercel: ${result.readyState ?? "pending"}...`);
      await pause(5000);
    }
    throw new DeployError("Vercel is still building or assigning its domain. Rerun later; the pending deployment ID is saved.");
  }
  async function startDeployment(kind) {
    const result = await api("vercel", "/v13/deployments", { method: "POST", body: { name: config.projectName, project: state.projectId, target: "production", projectSettings: deploymentSettings, files } });
    requireValue(typeof result.id === "string", "Vercel did not return a deployment ID. Inspect the project before retrying.");
    state.pending = { id: result.id, kind, sourceHash };
    await save();
    return result.id;
  }
  try {
    let currentSnapshot = null;
    try { currentSnapshot = await readFile(statePath, "utf8"); } catch (error) { if (error.code !== "ENOENT") throw error; }
    requireValue(currentSnapshot === stateSnapshot, "Another setup changed the saved state. Rerun to read its progress; no credentials were replaced.");
    if (!state) {
      const keys = await api("supabase", `${refPath}/api-keys?reveal=true`);
      const keyFor = (type, legacy) => keys.find(k => k.type === type && k.api_key)?.api_key ?? keys.find(k => k.name === legacy && k.api_key)?.api_key;
      const publicKey = keyFor("publishable", "anon"), secretKey = keyFor("secret", "service_role");
      const role = key => { try { return JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString()).role; } catch { return null; } };
      requireValue(typeof publicKey === "string" && (publicKey.startsWith("sb_publishable_") || role(publicKey) === "anon") && typeof secretKey === "string" && (secretKey.startsWith("sb_secret_") || role(secretKey) === "service_role") && publicKey !== secretKey, "Cannot retrieve separate Supabase public/server keys. Check API-key read permissions and that keys exist; the database password is not an API key.");
      state = { version: 1, installId: randomUUID(), config, schemaHash, env: { NEXT_PUBLIC_SUPABASE_URL: `https://${config.supabaseRef}.supabase.co`, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publicKey, SUPABASE_SECRET_KEY: secretKey, ...client, TOKEN_ENCRYPTION_KEY: randomBytes(32).toString("hex"), CRON_SECRET: randomBytes(32).toString("hex"), ALLOWED_GOOGLE_EMAILS: config.email } };
      await save();
    }
    if (!state.projectId) {
      log("Creating the approved Vercel project...");
      const project = await api("vercel", "/v11/projects", { method: "POST", body: { name: config.projectName, ...buildSettings, environmentVariables: environment() } });
      requireValue(typeof project.id === "string" && project.accountId === config.vercelTeamId, "Unexpected Vercel project response. Inspect the selected team before retrying.");
      state.projectId = project.id; await save();
    }
    // Creation and update have different schemas. Configure the approved project
    // before touching SQL; a rejected Vercel configuration must leave the DB empty.
    await api("vercel", `/v9/projects/${state.projectId}`, { method: "PATCH", body: { nodeVersion: deploymentSettings.nodeVersion } });
    if (!ours) {
      log("Initializing the empty database...");
      await query(migrationQuery(sql, `gropbox:${state.installId}:${schemaHash}`), false);
      const installed = (await query(inspectionQuery))[0];
      requireValue(installed?.marker === `gropbox:${state.installId}:${schemaHash}` && installed.rls_tables === 6 && installed.realtime === true, "Database initialization did not pass its RLS/Realtime checks. Do not rerun SQL manually; inspect the selected project.");
    }
    state.initialized = true; await save();
    if (state.pending) {
      const pending = state.pending;
      const result = await api("vercel", `/v13/deployments/${encodeURIComponent(pending.id)}`);
      requireValue(result.projectId === state.projectId && result.target === "production", "Saved deployment target differs from the selected project.");
      if (["ERROR", "CANCELED"].includes(result.readyState)) { state.pending = null; await save(); }
      else {
        await waitFor(pending.id);
        if (pending.kind === "final") state.completedSource = pending.sourceHash;
        state.pending = null; await save();
      }
    }
    const getDomain = async () => {
      const result = await api("vercel", `/v9/projects/${state.projectId}/domains`);
      return result.domains?.find(d => d.verified && !d.gitBranch && !d.redirect && !d.customEnvironmentId && /^[a-z0-9-]+\.vercel\.app$/.test(d.name))?.name;
    };
    let domain = await getDomain();
    if (!domain) {
      log("Obtaining the production domain (setup-only deployment)...");
      await waitFor(await startDeployment("bootstrap"));
      state.pending = null; await save();
      domain = await getDomain();
    }
    requireValue(domain, "No verified default production domain is assigned yet. Check Vercel Domains, then rerun.");
    const origin = `https://${domain}`;
    requireValue(!state.env.APP_URL || state.env.APP_URL === origin, "The production domain changed. Refusing to rewrite live callbacks automatically.");
    state.env.APP_URL = origin; await save();
    log("Setting production environment and Google sign-in...");
    const envResult = await api("vercel", `/v10/projects/${state.projectId}/env?upsert=true`, { method: "POST", body: environment() });
    requireValue(Array.isArray(envResult.failed) && envResult.failed.length === 0, "Vercel did not accept all environment variables. Inspect its environment settings, then rerun with the saved state.");
    const currentAuth = await api("supabase", `${refPath}/config/auth`);
    requireValue(!currentAuth.external_google_enabled || (currentAuth.external_google_client_id === client.GOOGLE_CLIENT_ID && currentAuth.site_url === origin), "Google provider or production origin changed during setup. Refusing to overwrite it.");
    const redirects = new Set((currentAuth.uri_allow_list ?? "").split(",").map(x => x.trim()).filter(Boolean));
    redirects.add(`${origin}/api/auth/callback`);
    await api("supabase", `${refPath}/config/auth`, { method: "PATCH", body: { external_google_enabled: true, external_google_client_id: client.GOOGLE_CLIENT_ID, external_google_secret: client.GOOGLE_CLIENT_SECRET, site_url: origin, uri_allow_list: [...redirects].join(",") } });
    if (state.completedSource !== sourceHash) {
      log("Deploying the configured application...");
      await waitFor(await startDeployment("final"));
      state.completedSource = sourceHash; state.pending = null; await save();
    }
    log(`Deployment ready: ${origin}`);
    log("Google sign-in, Drive upload/download, and second-device sync still require real user verification. Provider build success is not proof of those checks.");
    return { status: "deployed", url: origin, liveChecks: "not_verified" };
  } finally { await lock.close(); await unlink(join(directory, "deploy.lock")); }
}
