import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deploy, DeployError, providerApi } from "./deploy-core.mjs";

export async function main(args = process.argv.slice(2)) {
  if (args.length === 1 && args[0] === "--help") {
    console.log("npm run deploy                              Interactive first-install wizard");
    console.log("npm run deploy -- --config PATH             Read-only plan for an agent");
    console.log("npm run deploy -- --config PATH --apply     Apply the approved plan");
    console.log("Tokens: hidden terminal prompts, or SUPABASE_ACCESS_TOKEN and VERCEL_TOKEN.");
    console.log("This tool supports a new dedicated Supabase database and a new Vercel project, or resuming its own saved installation. See docs/DEPLOY.md.");
    return;
  }
  const configMode = args[0] === "--config" && args[1] && (args.length === 2 || (args.length === 3 && args[2] === "--apply"));
  if (args.length && !configMode) throw new DeployError("Use npm run deploy -- --help for supported options. Do not pass tokens as arguments.");
  if (!configMode && !process.stdin.isTTY) throw new DeployError("Run npm run deploy in an interactive terminal, or use --config PATH. No changes were made.");
  let muted = false;
  const output = new Writable({ write(chunk, encoding, callback) { if (!muted) process.stdout.write(chunk, encoding); callback(); } });
  const terminal = process.stdin.isTTY ? createInterface({ input: process.stdin, output, terminal: true }) : null;
  async function ask(label, secret = false) {
    if (!terminal) throw new DeployError("Provide tokens through the secret environment before using --config. Never put them in chat.");
    if (secret) { process.stdout.write(label); muted = true; }
    try { return (await terminal.question(secret ? "" : label)).trim(); }
    finally { if (secret) { muted = false; process.stdout.write("\n"); } }
  }
  async function choose(items, label, display) {
    if (!Array.isArray(items) || !items.length) throw new DeployError(`No ${label} available. Create one in the provider dashboard, then retry.`);
    items.forEach((item, index) => console.log(`${index + 1}. ${display(item)}`));
    const index = Number(await ask(`${label} number: `)) - 1;
    if (!Number.isInteger(index) || !items[index]) throw new DeployError("No valid selection. No resources were changed.");
    return items[index];
  }
  try {
    console.log("GropBox setup — no SQL or application API keys to copy.");
    let supabaseToken = process.env.SUPABASE_ACCESS_TOKEN;
    let vercelToken = process.env.VERCEL_TOKEN;
    if (!supabaseToken) { console.log("Supabase deployment access: https://supabase.com/dashboard/account/tokens (not a database password or project API key)"); supabaseToken = await ask("Supabase access token (hidden): ", true); }
    if (!vercelToken) { console.log("Vercel deployment access: https://vercel.com/account/settings/tokens (scope it to your chosen team)"); vercelToken = await ask("Vercel access token (hidden): ", true); }
    let config;
    if (configMode) {
      try { config = JSON.parse(await readFile(resolve(args[1]), "utf8")); }
      catch { throw new DeployError("Cannot read the deployment input JSON. See docs/DEPLOY_AGENT.md for its non-secret fields."); }
    } else {
      try {
        const saved = JSON.parse(await readFile(resolve(".gropbox/deploy-state.json"), "utf8"));
        config = saved.config;
        console.log(`Resume ${config.projectName} / Supabase ${config.supabaseRef}. Existing credentials will be kept.`);
      } catch (error) { if (error.code !== "ENOENT") throw new DeployError("Cannot read saved setup state. Do not replace it to retry."); }
      if (!config) {
        const api = providerApi({ supabaseToken, vercelToken });
        console.log("Choose a NEW, dedicated Supabase project. Create it first if needed: https://supabase.com/dashboard — do not configure its tables or Google provider manually.");
        const project = await choose(await api("supabase", "/v1/projects"), "Supabase project", p => `${p.name} (${p.ref})`);
        const teams = await api("vercel", "/v2/teams?limit=100");
        const team = await choose(teams.teams, "Vercel team", t => `${t.name} (${t.id})`);
        const projectName = await ask("New Vercel project name [gropbox]: ") || "gropbox";
        const email = await ask("Your Google email: ");
        console.log(`Google callback: https://${project.ref}.supabase.co/auth/v1/callback`);
        console.log("Create a Google Web OAuth client once using docs/DEPLOY.md#google-setup. Save the client JSON outside this repository. You do not need a Vercel domain yet.");
        const googleCredentials = (await ask("Google client JSON file path: ")).replace(/^"(.*)"$/, "$1");
        config = { supabaseRef: project.ref, vercelTeamId: team.id, projectName, email, googleCredentials: resolve(googleCredentials) };
      }
    }
    await deploy(config, { supabaseToken, vercelToken, confirm: async plan => {
      console.log(`Supabase: ${plan.supabase.name} (${plan.supabase.ref})`);
      console.log(`Vercel: ${plan.vercel.team} / ${plan.vercel.project}`);
      console.log(`${plan.initializeDatabase ? "Initialize the empty database; " : "Keep existing data; "}${plan.createVercelProject ? "create" : "reuse"} the Vercel project, configure Google sign-in, and deploy.`);
      console.log("Uses your existing provider plans and quotas. No plan upgrades, domains, or other projects will be changed; provider usage can incur charges under your plan.");
      if (configMode) return args.includes("--apply");
      return (await ask("Apply to these targets? [y/N]: ")).toLowerCase() === "y";
    } });
  } finally { terminal?.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => {
  console.error(error instanceof DeployError ? error.message : "Setup stopped because of a local file or runtime error. Check file access and private setup state; no secret details are printed.");
  process.exitCode = 1;
});
