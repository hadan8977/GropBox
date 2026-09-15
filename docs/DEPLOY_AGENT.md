# Agent deployment guide

Outcome: deploy the user's own GropBox instance and report a real, usable URL. This guide is not permission to deploy to the upstream maintainer's accounts.

## Read and establish scope

Read [AGENTS.md](../AGENTS.md), [DEPLOY.md](DEPLOY.md), [.env.example](../.env.example), and the initial [SQL migration](../supabase/migrations/001_gropbox.sql) from the same checkout before acting. Pin the checkout's commit for the deployment; do not mix unreviewed files from another branch. Read [architecture and limits](MVP_PLAN.md) before making availability or security claims.

Ask one compact set of questions for missing decisions:

- Which Vercel team/project and production domain?
- Which Supabase project and Google Cloud project/OAuth client? New or existing?
- Which Google emails may sign in? What region and spending limit are approved?

Use authenticated provider tools/CLIs when available and verify the selected account. Creating resources, applying SQL, adding credentials, and deploying need approval for those exact targets. Do not enable paid plans, move domains, change repository visibility, delete resources, or affect other projects without additional authorization.

An existing GitHub login is not permission to use that account. An existing Supabase project is not necessarily an empty database. Preserve unrelated working changes and do not switch branches or overwrite environment files to simplify the task.

## Execute the same three stages

1. **Connect services.** Follow stage 1 of DEPLOY.md. Inspect the target migration history/schema read-only. On an approved new database, apply `001_gropbox.sql` once. For an existing installation, identify the actual migration state and stop if applying this initial migration could collide with existing objects. Configure the Supabase Google provider using the approved Web OAuth client. Automate with supported provider APIs/tools only where permissions are available; otherwise give the user the exact dashboard field and value. Never automate consent, bypass account verification, or weaken RLS.

2. **Prepare configuration.** Run `npm run setup` only when creating a new local configuration. It preserves existing `.env.local` and generates secrets without displaying them. Have the user enter credentials through a secret manager, provider UI, or their local editor—not chat, prompts, command-line arguments, screenshots, or Git. Use the same Google client in Supabase and GropBox. For an existing deployment, preserve its encryption key and cron secret. Run `npm run setup:check`; it validates local format, not live credentials. Import only the documented variables into the approved hosting project. Never set server credentials as `NEXT_PUBLIC_*`.

3. **Deploy and verify.** Use the approved repository copy and stable production domain, install with `npm ci`, and build with `npm run build`. Set Vercel's Node runtime to 24.x. Build success is required, but does not prove cloud configuration. Deploy only to the confirmed project. Match the final domain to `APP_URL`, Supabase Site URL, and the exact allowed app callback, rebuilding after environment changes. Keep Google's callback pointing to Supabase. Do not assume a marketplace integration applied this migration or configured OAuth for you.

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
