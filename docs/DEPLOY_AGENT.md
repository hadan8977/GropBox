# Deploy with an agent

Your job is to **perform the deployment**, not give the user a deployment checklist. Use the same executable workflow as the manual entry. Read [AGENTS.md](../AGENTS.md), [DEPLOY.md](DEPLOY.md), and [the deployment helper](../scripts/deploy-core.mjs) from the same checkout. Read [the SQL migration](../supabase/migrations/001_gropbox.sql) before approving initialization. Do not start by reciting the dashboard fallback.

## Establish access, then execute

1. Confirm only missing decisions: the intended Google email, a new installation versus an existing one, the owning accounts/projects, and the spending limit. A free-tier-only preference is valid, but do not promise unlimited service or silently select paid resources. The helper uses an existing empty Supabase project and creates a new Vercel project; create the Supabase project through authorized provider tools if available, otherwise guide the user through that one dashboard action. Do not ask them for SQL results, table counts, application API keys, or an unassigned domain.
2. Prefer the user's already authorized provider tools or secure environment for access. This helper currently needs **Supabase and Vercel management tokens**; an MCP connection or normal browser login does not automatically supply those tokens. If necessary, have the user enter short-lived tokens into the hidden prompts in `npm run deploy`. Never ask them to paste tokens or Google client contents into chat. If the agent has no terminal/provider execution capability, say so once and offer the guided command; do not present a long manual checklist as "automation."
3. Obtain the exact Supabase callback from the selected project. Show only the current [Google setup](DEPLOY.md#google-setup) action that needs the user. With permission, automate supported Google project/API operations; leave client creation, consent, and account verification to the user where required. The user supplies the downloaded Web client JSON by local path. The app's Google callback is Supabase's `/auth/v1/callback`, not the eventual Vercel domain.
4. Run the helper's read-only plan below. Explain its concrete targets and effects, obtain approval once for those scoped operations if not already authorized, then apply it. Respect the execution environment's own tool approvals. Do not add permission requests for already approved operations or ask the user to perform operations the helper handles.

Keep progress updates short: current action or blocker, not a transcript of provider settings. Pause only for a real permission, login, consent, or target decision. Never invent credentials or silently switch projects. Existing deployments must retain their keys and data; use [the dashboard guide](DEPLOY_MANUAL.md) only for the unsupported part, not as the default user workload.

## Executable input

For a user at the terminal, run `npm run deploy` and let its hidden prompts collect tokens. For non-interactive execution, obtain `SUPABASE_ACCESS_TOKEN` and `VERCEL_TOKEN` through the environment's secret-input mechanism. Do not embed them in tool arguments, saved scripts, or `.env.local`. The two providers' management tokens are distinct from Supabase's application keys and the database password.

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

The first command checks targets read-only and displays a plan; it does not create resources, change provider configuration, or save installation state. The second authorizes the helper to initialize the selected empty database, create the named Vercel project, configure Google Auth and production environment variables, and deploy. It does not authorize paid-plan upgrades, domain purchases, account administration, deletion, or changes to unrelated resources.

The helper uses fixed official API hosts, imports only client ID/secret from the Google JSON, uploads an explicit set of application/build files, and saves resumable state privately under `.gropbox/`. Do not run a parallel custom provisioning script, overwrite the state, rotate keys, or reapply SQL to work around a refusal. It is first-install/resume automation, not an upgrade or arbitrary-database migration tool.

## Verify and hand off

The helper checks database initialization/RLS/Realtime and waits for the real Vercel build and domain assignment. It **does not** verify Google login, Drive permissions, or second-device sync. Complete those checks with the user's consent at the returned URL: sign in, send one clearly identified test message and small file, download it, and verify arrival on another device. Do not delete user content as cleanup.

If real provider access or another device is unavailable, mark that check **not verified**. Local simulations mock the cloud APIs and use local PostgreSQL; they do not prove live OAuth, hosting quotas, 5 GB transfers, or mobile background transfers. Do not make the user inspect six tables to substitute for a failed tool check.

Hand off the URL, selected projects, completed checks, and any exact remaining action. Stop when the approved deployment is usable, or explain a concrete blocker. Do not expand into billing changes, monitoring, unrelated audits, or a new deployment guide.
