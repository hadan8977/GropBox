# Agent deployment guide

Outcome: deploy the user's own GropBox instance and report a real, usable URL. This guide is not permission to deploy to the upstream maintainer's accounts.

## Read and establish scope

Read [AGENTS.md](../AGENTS.md), [DEPLOY.md](DEPLOY.md), [.env.example](../.env.example), and the initial [SQL migration](../supabase/migrations/001_gropbox.sql) from the same checkout before acting. Pin the checkout's commit for the deployment; do not mix unreviewed files from another branch. Read [architecture and limits](MVP_PLAN.md) before making availability or security claims.

Start with a compact inventory, not a request for credentials. Ask only what is missing:

- Does the user already have a GropBox deployment or any Supabase, Google Cloud, GitHub, or Vercel projects to reuse? "None yet" is a valid answer; help create approved missing projects in the order below.
- Which Google email should be allowed, and which provider accounts/organizations should own the resources? Identify exact project targets when selecting or creating them, not before they exist.
- Which region and spending limit are approved? Offer free-tier-only as a starting choice, without promising unlimited or always-on service. A custom domain is optional; the user can use Vercel's assigned domain.

Do not block on a Client ID, API key, project reference, or production URL that has not been created yet. Explain where each will come from at the step that produces it. If the user only has provider accounts, begin at stage 1A of DEPLOY.md.

Use authenticated provider tools/CLIs when available and verify the selected account. Creating resources, applying SQL, adding credentials, and deploying need approval for those exact targets. Do not enable paid plans, move domains, change repository visibility, delete resources, or affect other projects without additional authorization.

An existing GitHub login is not permission to use that account. An existing Supabase project is not necessarily an empty database. Preserve unrelated working changes and do not switch branches or overwrite environment files to simplify the task.

## Guide the user through each dependency

Keep the dashboard instructions and field mappings in [DEPLOY.md](DEPLOY.md) as the single source of truth. Use this routing order, not three independent provider checklists:

| Step in DEPLOY.md | What must exist first | Evidence that allows the next step |
| --- | --- | --- |
| [1A: Supabase](DEPLOY.md#a-supabase-create-the-database-and-get-its-callback) | Approved owner, region, and project target | Database initialized; URL, keys, and the provider callback located |
| [1B: Google Cloud](DEPLOY.md#b-google-cloud-create-the-oauth-client) | Supabase callback | Drive API enabled; audience/scopes set; Web client created with that callback |
| [1C: Supabase Google provider](DEPLOY.md#c-supabase-enable-google-sign-in) | Google client pair | The same client saved to the enabled provider |
| [2: Local configuration](DEPLOY.md#2-prepare-your-configuration) | Provider values above | Local format check succeeds; existing secrets preserved; domain may still be pending |
| [3A: Vercel](DEPLOY.md#a-vercel-deploy-and-identify-the-production-domain) | Approved repository/project and configuration | A stable Production domain is confirmed; a first setup-only deployment is not completion |
| [3B: URLs and redeploy](DEPLOY.md#b-complete-the-urls-and-redeploy) | Confirmed production origin | Local/Vercel config and Supabase URLs aligned; latest Production deployment ready |
| [3C: Sign-in and verification](DEPLOY.md#c-sign-in-and-verify) | Final URLs and current deployment | Real checks below, or a precise account of what remains unverified |

For steps that need the user, provide **one current action at a time**: the dashboard link and selected project, the page/field, the exact non-secret value or safe source for a secret, and what a successful result looks like. Wait for that result before asking for dependent values. For example, while configuring Google, give the Supabase callback already obtained; do not ask the user to find all three providers' credentials at once or merely say "configure OAuth."

Use supported provider tools/APIs for approved actions when available. Without those permissions, stay useful: guide the user through the corresponding dashboard step. Do not demand provider management tokens as a prerequisite for manual setup. If labels differ, check the current official provider documentation; do not guess fields or ask for screenshots containing secrets.

Track non-secret progress in the conversation: selected projects, completed/current step, and the domain if known. On resumption, verify and reuse completed steps; do not restart setup. If blocked, report the exact missing action or permission and why it is needed. Do not produce an unexplained list of missing environment variables as the handoff.

## Apply the setup branches safely

- **Existing database:** inspect migration history and schema read-only. A manually run SQL Editor migration may have no CLI migration-history entry; missing history alone is not permission to rerun it. Apply `001_gropbox.sql` once only on the approved new database. If existing objects collide or a previous attempt partly applied, pause and determine the actual state; never drop objects or weaken RLS to get past an error.
- **Configuration:** run `npm run setup` from the existing checkout root. It preserves `.env.local`; do not force replacement. Have the user enter credentials through a secret manager, provider UI, or local editor—not chat, prompts, command-line arguments, screenshots, or Git. Preserve an existing deployment's encryption key and cron secret. The database password is not a Supabase API key. Reuse the same Google client pair in Supabase and GropBox. Never set server credentials as `NEXT_PUBLIC_*`.
- **No production domain yet:** follow DEPLOY.md stage 3A's new-project path. The README button omits `APP_URL` on purpose; leave it unset in Vercel for the first deployment. Do not copy the local default, fabricate a domain, or register localhost callbacks for production. Use the domain actually assigned to Production, then complete 3B and redeploy. A local `setup:check` warning about localhost is expected before this step; its printed app callback is not the production callback. The first **Setup required** page is an intermediate state, not success.
- **Existing project/confirmed domain:** reuse it and set the final URLs before the next deployment; do not remove a working `APP_URL` or take the live app back to setup mode. A domain is confirmed only when assigned to the target project's Production environment. Do not assume a guessed `.vercel.app` name is available or buy/attach a custom domain without approval.
- **Deployment:** follow the build settings in DEPLOY.md, use `npm ci` and `npm run build`, and deploy only to the approved project. For dashboard builds, inspect the actual Vercel build result; a duplicate local build is not required. Compare the Production environment with the local template without dumping values, then rebuild after environment changes. `setup:check` only reads the local file; it does not verify Vercel settings or provider connectivity. Do not assume a marketplace integration applied SQL or configured OAuth.

When a provider step needs the user to log in or approve consent, pause that step and request the specific action. Do not invent credentials, use someone else's account, or install broad new tooling merely to avoid asking. Do not download and execute unrelated remote scripts.

## Verify the result, then stop

Use the real deployed site and the user's consent. Create only clearly identified test content approved by the user:

- Open the production URL and confirm the Google sign-in entry, not the unconfigured setup screen.
- Have the user complete Google sign-in. Confirm an allowed account can send a short message and a second authenticated device/session receives it.
- Upload and download a small test file. Confirm it is under the user's `GropBox` Drive folder, not loose in the root.
- Confirm the test message's archive completes or report the actual pending/error state. Check RLS and the message Realtime publication through the authorized Supabase tools; use the app's status/behavior to distinguish Realtime from polling.
- Check unauthenticated APIs reject access and that no server or Google credentials appear in public environment settings, logs, screenshots, or repository changes. Do not dump entire environment variables or token responses to perform this check.

Local PGlite/Playwright tests are supporting evidence, not substitutes for these live checks. Browser tests mock provider traffic. A static screenshot is not a measured sync latency result, and a small-file check is not proof of a 5 GB transfer or mobile background uploading.

If credentials, permissions, a second device, or a real Google consent flow are unavailable, explicitly mark the corresponding check **not verified**. Do not keep generating setup documents or claim success to avoid a blocker. Never delete the user's messages, files, or cloud resources as test cleanup without approval.

Final handoff: production URL, deployed commit, selected provider projects, completed checks, and any exact remaining action. No secrets. Stop when the approved deployment is usable and these checks are complete; do not broaden the task into ongoing monitoring, billing changes, or account administration.
