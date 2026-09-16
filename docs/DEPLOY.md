# Deploy GropBox

One guided command handles the database, application keys, Google provider, production URLs, and Vercel deployment. No SQL to paste or tables to inspect. You still authorize the two providers and create a Google OAuth client once.

This first-install helper uses a **new, dedicated Supabase project** and creates a **new Vercel project**. It can resume its own interrupted installation; it does not take over existing deployments, change plans, buy domains, or manage upgrades. For those cases, use the [dashboard/self-hosting guide](DEPLOY_MANUAL.md).

## 1. Run setup

Install [Node.js](https://nodejs.org/en/download) 22.12+ on a computer you control. [Download and extract GropBox](https://github.com/hadan8977/GropBox/archive/refs/heads/main.zip), open a terminal in the extracted folder, and run:

```sh
npm run deploy
```

Windows PowerShell and Linux are supported by the same script. No `npm install`, Git, Docker, or provider CLI is needed for this command. Your computer does not host the finished app and can be turned off afterward.

## 2. Authorize and choose projects

The wizard reuses supplied environment credentials or an existing local Vercel CLI login, then asks only for missing access:

- **Supabase deployment access:** create a short-lived [personal access token](https://supabase.com/dashboard/account/tokens) and paste it into the hidden prompt. If you have no empty project, create one in the [dashboard](https://supabase.com/dashboard) first, choosing its region and plan. Leave its tables and Google provider untouched. The database password stays in your password manager; **it is not an API key**.
- **Vercel deployment access:** if no usable CLI login exists, create a short-lived [Vercel token](https://vercel.com/account/settings/tokens) scoped to the intended team and paste it into the hidden prompt.
- Select the Supabase project and Vercel team from the lists, choose an unused Vercel project name, and enter your Google email.

These are management permissions, not application API keys. Tokens stay in this process; they are not saved or sent to the other provider. Review your provider plans: the tool never upgrades them, but usage may still incur charges under an existing paid plan.

Using only an agent chat, without a terminal? See [credential access](DEPLOY_AGENT.md#credential-access). Do not assume a secret-input feature exists or set up a Drive token handoff.

<details>
<summary>Token permissions / HTTP 403</summary>

Supabase needs access to list projects, read the selected project's settings and API keys (including revealed secret values), execute database queries, and read/write Auth configuration. Restrict project-specific permissions to this new project where supported. Vercel needs access to the selected team, project creation, environment variables, domains, and deployments. Use short expirations and revoke the deployment tokens afterward. Do not revoke the project's application keys.

An expired, read-only, or incorrectly scoped token stops setup. Do not solve a permission error by sharing tokens in chat or granting unrelated accounts access. [Supabase token permissions](https://supabase.com/docs/guides/platform/personal-access-tokens)

</details>

## 3. Import Google and finish

The wizard displays your exact Google callback. Complete the [one-time Google setup below](#google-setup), download the Web client's JSON, and give the wizard its **local file path**, not its contents. Confirm the named deployment targets when prompted.

The tool retrieves application keys, generates separate encryption/cron secrets, creates/configures Vercel, then initializes the database and checks RLS/Realtime. It sets Google Auth and redirect URLs and deploys using Vercel's assigned production domain. If necessary, a setup-only build obtains the domain before the final build. You do not copy domains between dashboards.

The read-only plan checks selected resources, not future write acceptance or build success. Vercel configuration failures now happen before SQL; later failures may still leave the approved project or database initialized. Resume using the saved state rather than deleting resources.

Open the returned URL and sign in with Google. Send a small file and a message, then open the same URL on a second device. The app creates its own `GropBox` Drive folder. These real checks are still necessary: a successful build is not proof of Google consent, Drive access, or cross-device sync.

## Google setup

Use these direct **Google Auth Platform** links and check the project selector on each page. Dashboard labels vary by language. Complete initial app registration if prompted, then return to the linked page. See Google's [current consent guide](https://developers.google.com/workspace/guides/configure-oauth-consent) and [client guide](https://support.google.com/cloud/answer/15549257?hl=en).

1. In [Google Cloud](https://console.cloud.google.com/), create/select your project and [enable the Drive API](https://console.cloud.google.com/apis/library/drive.googleapis.com).
2. In [Branding](https://console.cloud.google.com/auth/branding), set the app name and contact emails. In [Audience](https://console.cloud.google.com/auth/audience), personal Gmail accounts use **External**; while in **Testing**, add your email to the test users.
3. In [Data Access](https://console.cloud.google.com/auth/scopes), add `openid`, `https://www.googleapis.com/auth/userinfo.email`, `https://www.googleapis.com/auth/userinfo.profile`, and `https://www.googleapis.com/auth/drive.file`. Do not request full-Drive access.
4. In [Clients](https://console.cloud.google.com/auth/clients), create a **Web application**, paste the wizard's callback into **Authorized redirect URIs**, and leave JavaScript origins empty. Download the JSON **at creation time** and save it privately outside the repository: the secret may not be downloadable later. For an existing client, retain its secret; after changing a callback in Google, update only `web.redirect_uris` in the private JSON to match. Do not rotate a live secret just to download credentials again.

For long-lived use, review Google's publishing requirements: an External app in Testing with Drive scopes receives refresh tokens that expire after seven days. Production status does not guarantee permanent access. [Token expiration](https://developers.google.com/identity/protocols/oauth2#expiration)

## If interrupted

Run `npm run deploy` again in the **same folder**. Keep `.gropbox/deploy-state.json` private and intact: it stores the target IDs, generated application secrets, and progress, but not management tokens. The command preserves existing `.env.local`, refuses unrelated databases/projects, and does not rerun a completed migration or rotate saved keys. After a completed installation, rerunning the same source leaves it unchanged; this is not an upgrade command.

If a process crashed, `.gropbox/deploy.lock` may remain. Only remove that specific lock after checking that no setup process is still running; keep the state file. If a project-creation response was lost, inspect the named project rather than deleting it or choosing another name blindly. A schema mismatch, lost state, or changed production domain needs review, not automatic reinitialization.

The command uploads only application/build inputs from this checkout. It does not create or push a GitHub repository or configure Git auto-deployments. For later releases, use the [dashboard guide](DEPLOY_MANUAL.md) with the same project and existing environment; do not rotate its encryption key. The default-domain helper does not support custom Supabase auth domains or private-network-only databases.

[Dashboard-only deployment and self-hosting](DEPLOY_MANUAL.md) · [Agent instructions](DEPLOY_AGENT.md)
