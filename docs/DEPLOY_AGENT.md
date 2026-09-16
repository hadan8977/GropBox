# Deploy with an agent

Your job is to **perform the deployment**, not give the user a deployment checklist. Use the same executable workflow as the manual entry. Read [AGENTS.md](../AGENTS.md), [DEPLOY.md](DEPLOY.md), and [the deployment helper](../scripts/deploy-core.mjs) from the same checkout. Read [the SQL migration](../supabase/migrations/001_gropbox.sql) before approving initialization. Do not start by reciting the dashboard fallback.

## Establish access, then execute

1. **Inspect before asking.** Check this checkout's saved state, `.vercel/project.json`, environment variable presence (not values), connected provider tools, and documented Vercel CLI credentials. The helper reuses that login automatically. Read only required fields and report project/account identifiers, not secrets. Do not recursively search a home directory or read unrelated backup/rclone credentials. If an existing config is in scope only to identify a project, extract only its non-secret project/client ID; never dump the entire file.
2. Ask once for decisions still missing: Google email, new versus existing installation, target owners/projects, and spending limit. Reuse decisions already given. Create the dedicated Supabase project through an authorized tool if available, otherwise ask for that one dashboard action. Do not ask for table counts, application API keys, or an unassigned domain. Use an [available credential channel](#credential-access), not an invented one.
3. Provide the exact Supabase callback and the direct [Google Auth Platform links](DEPLOY.md#google-setup). Verify the selected project and actual localized screen instead of guessing translated menu names. The user supplies a privately downloaded Web client JSON by local path. Ask only for Google actions that actually need the owner; do not create another client if a suitable approved one exists.
4. Run the read-only plan and obtain one scoped approval if not already authorized, then apply. Read-only success is **not a write dry-run**: it cannot prove project creation, write permissions, build success, or OAuth. The helper configures Vercel before SQL and saves progress. Never create temporary cloud projects to probe an API. Check official request schemas first; diagnostic writes need their own explicit approval.

Keep progress updates short: current action or blocker, not a transcript of provider settings. Pause only for a real permission, login, consent, or target decision. Never invent credentials or silently switch projects. Existing deployments must retain their keys and data; use [the dashboard guide](DEPLOY_MANUAL.md) only for the unsupported part, not as the default user workload.

## Credential access

Use the first channel that actually exists:

- Authorized provider tools, `SUPABASE_ACCESS_TOKEN` / `VERCEL_TOKEN`, or the user's Vercel CLI login. The helper checks the [documented CLI store](https://vercel.com/docs/project-configuration/global-configuration) and legacy `~/.vercel/auth.json`; `VERCEL_AUTH_FILE` selects a custom CLI file. It does not modify or refresh CLI credentials. Expired credentials need login through the provider's tool.
- A real secret-input facility or hidden terminal prompts, if accessible to the user. A remote chat user may have neither. An MCP login does not automatically expose a token to a shell script.
- An existing, owner-approved private file outside the checkout: set `SUPABASE_ACCESS_TOKEN_FILE` or `VERCEL_TOKEN_FILE` to its path. Each file contains only its corresponding token, read inside the process without printing it. Do not create a shared Drive folder or ask for public credential links. Do not delete the user's original file or CLI login afterward.

**Chat is the only channel:** explain that limitation once and offer the [dashboard route](DEPLOY_MANUAL.md) or an available provider authorization flow. Do not claim pasting secrets is the only option or promise to erase chat history. If the owner nevertheless voluntarily supplies a credential for this task, do not echo it or ask them to resend it. Treat it as exposed, use it only for the approved target, keep it out of source/logs, and ask the owner to revoke temporary management tokens afterward. Removing an agent-created temporary file does not erase the chat copy. Do not casually revoke long-lived application keys or Google credentials: that breaks the deployed app.

Do not embed secrets in saved scripts, command-line arguments, or `.env.local`. Management tokens are distinct from Supabase application keys and the database password. If no usable channel exists, explain the specific blocker without repeated confirmations.

## Executable input

Create `.gropbox/deploy-input.json` with **non-secret** inputs after selecting the actual targets. Replace the examples; do not guess IDs or ask the user to create values that a tool can retrieve:

```json
{
  "supabaseRef": "abcdefghijklmnopqrst",
  "vercelTeamId": "team_REPLACE_WITH_SELECTED_TEAM",
  "projectName": "gropbox-your-name",
  "email": "you@example.com",
  "googleCredentials": "/absolute/path/to/downloaded-google-client.json"
}
```

On Windows, a JSON path can use forward slashes, such as `C:/Users/you/Downloads/client_secret.json`. The Google file stays private. Do not dump provider responses, state files, or environment values into logs to inspect them.

```sh
npm run deploy -- --config .gropbox/deploy-input.json
npm run deploy -- --config .gropbox/deploy-input.json --apply
```

The first command checks targets read-only and displays a plan; it does not test write acceptance, create resources, change provider configuration, or save state. The second applies the approved operations: create/configure Vercel, initialize the selected empty database, configure Google Auth and production environment variables, and deploy. It does not authorize plan upgrades, domain purchases, account administration, deletion, or unrelated changes.

The helper uses fixed official API hosts, imports only client ID/secret from the Google JSON, uploads an explicit set of application/build files, and saves resumable state privately under `.gropbox/`. Do not run a parallel custom provisioning script, overwrite the state, rotate keys, or reapply SQL to work around a refusal. It is first-install/resume automation, not an upgrade or arbitrary-database migration tool.

## Verify and hand off

The helper checks database initialization/RLS/Realtime and waits for the real Vercel build and domain assignment. It **does not** verify Google login, Drive permissions, or second-device sync. Complete those checks with the user's consent at the returned URL: sign in, send one clearly identified test message and small file, download it, and verify arrival on another device. Do not delete user content as cleanup.

If real provider access or another device is unavailable, mark that check **not verified**. Local simulations mock the cloud APIs and use local PostgreSQL; they do not prove live OAuth, hosting quotas, 5 GB transfers, or mobile background transfers. Do not make the user inspect six tables to substitute for a failed tool check.

Hand off the URL, selected projects, completed checks, and any exact remaining action. Stop when the approved deployment is usable, or explain a concrete blocker. Do not expand into billing changes, monitoring, unrelated audits, or a new deployment guide.
