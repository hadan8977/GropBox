# Dashboard deployment fallback

Prefer the [guided deployment command](DEPLOY.md). This longer route is for dashboard-only setup, existing installations, or environments where the deployment helper is unavailable. It does not require granting management tokens to the helper.

Three stages, with the dashboard steps below. You need your own Google Cloud, Supabase, GitHub, and Vercel accounts, but **you do not need a domain or any project credentials before starting**. Use dedicated projects and confirm the plan before creating resources. Google sign-in and consent require the account owner.

Follow this order: Supabase database and callback → Google OAuth client → Supabase Google provider → local configuration → Vercel domain → final redirects → sign-in. The providers exchange values; they cannot be configured independently in any order.

Already have an installation? Keep its projects, database, credentials, and encryption key. Resume at the first incomplete step; do not recreate resources or rerun the initial SQL. Dashboard labels can change; use the linked provider documentation if a field has moved.

## 1. Connect your services

### A. Supabase: create the database and get its callback

1. Open the [Supabase dashboard](https://supabase.com/dashboard), select your organization, then **New project**. Choose a name such as `gropbox`, your preferred region, and a database password. Keep the password in your password manager; it is **not** an API key and does not belong in GropBox's environment variables. Wait for the project to be ready.
2. In that new project, open **SQL Editor → New query**. Paste the complete [001_gropbox.sql](../supabase/migrations/001_gropbox.sql) and select **Run** once. Expect a successful result. In **Table Editor**, confirm the `public` schema contains `app_accounts`, `google_credentials`, `messages`, `attachments`, `drive_folders`, and `archive_jobs`. The SQL also enables RLS and configures functions and message Realtime; do not disable RLS or rerun the SQL after an error without checking what was applied.
3. Open the project's **Connect** dialog for the project URL. Open **Settings → API Keys** for the publishable and server secret keys; create a key there if none exists. Legacy `anon` and `service_role` keys also work. Save values privately for stage 2, not in chat. Use the HTTPS project URL, not the PostgreSQL connection string. [Key locations and types](https://supabase.com/docs/guides/getting-started/api-keys#find-your-keys)
4. Open **Authentication → Sign In / Providers → Google** and copy the displayed **Callback URL (for OAuth)**. Leave this tab open; enable the provider after creating the Google client. With the default Supabase domain, the callback looks like:

```text
https://PROJECT_REF.supabase.co/auth/v1/callback
```

Use the actual callback shown in your dashboard, not the placeholder above. **Ready for Google:** the SQL succeeded, and you have the Supabase URL, keys, and callback. No Vercel domain is needed yet.

### B. Google Cloud: create the OAuth client

1. Open [Google Cloud Console](https://console.cloud.google.com/). Use the project selector to create a dedicated project or select the approved existing one. Check this selection before each following action.
2. Open the [Google Drive API page](https://console.cloud.google.com/apis/library/drive.googleapis.com) for that project and select **Enable**. If already enabled, leave it enabled.
3. Open [Google Auth Platform](https://console.cloud.google.com/auth/overview) and complete registration if prompted. In [Branding](https://console.cloud.google.com/auth/branding), enter an app name such as `GropBox`, support email, and developer contact email. In [Audience](https://console.cloud.google.com/auth/audience), personal Gmail accounts need **External**; **Internal** is only for a qualifying Workspace organization. In **Testing**, add your email to the test users. Labels vary by language: use these direct pages and check the project selector.
4. In [Data Access](https://console.cloud.google.com/auth/scopes), select or manually add the scopes below, then save. `drive.file` limits access to files the app creates or the user explicitly grants; do not replace it with full-Drive access. [Drive scope reference](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)

   ```text
   openid
   https://www.googleapis.com/auth/userinfo.email
   https://www.googleapis.com/auth/userinfo.profile
   https://www.googleapis.com/auth/drive.file
   ```

5. In [Clients](https://console.cloud.google.com/auth/clients), create a **Web application** named `GropBox Web`. Paste the exact Supabase callback from step A into **Authorized redirect URIs**, not the future Vercel URL. Leave JavaScript origins empty for this server-side flow. [Current client setup](https://support.google.com/cloud/answer/15549257?hl=en)
6. Save the client ID, secret, and downloaded JSON privately **at creation time**: the secret may not be downloadable later. Do not commit credentials or rotate an existing live secret just to download another copy.

**Ready to connect:** Drive API is enabled, your intended account is allowed by the audience settings, and a Web OAuth client exists with the Supabase callback.

### C. Supabase: enable Google sign-in

Return to the Google provider tab from step A. Enable **Sign in with Google**, paste the Client ID and Client secret from step B, and **Save**. Keep security options at their defaults. Use this **same client pair** in GropBox in stage 2; creating a second client for Vercel would break the token-refresh configuration. [Supabase Google provider setup](https://supabase.com/docs/guides/auth/social-login/auth-google)

**Stage complete:** Supabase shows the saved Google provider as enabled. This confirms configuration was saved, not that sign-in has been tested. Leave **Site URL** and the app's redirect URL until the real app domain is known in stage 3.

For long-lived use, resolve Google's audience/publishing requirements: external apps in Testing with Drive access can receive refresh tokens that expire after seven days. Production status does not guarantee permanent authorization. [Google token expiration](https://developers.google.com/identity/protocols/oauth2#expiration)

## 2. Prepare your configuration

On a computer you control, with Node.js 22.12+ and Git, run these commands on Linux or Windows PowerShell. If already in a checkout, skip cloning and run the setup command there.

```sh
git clone https://github.com/hadan8977/GropBox.git
cd GropBox
npm run setup
```

The dependency-free setup command creates `.env.local` from [.env.example](../.env.example), generates separate encryption/cron secrets, and never overwrites an existing file. It makes no network calls and does not print credentials. Keep this ignored file private, including its filesystem permissions on shared computers.

Open `.env.local` in your editor and fill the remaining values:

| Field | Where it comes from |
| --- | --- |
| `APP_URL` | An already confirmed production HTTPS origin, with no path or trailing slash. If not known yet, keep the local default **in this local file only** until stage 3; do not copy it into Vercel |
| `NEXT_PUBLIC_SUPABASE_URL` | Step A: HTTPS project URL from Connect |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Step A: publishable key, or legacy anon key; never the server key |
| `SUPABASE_SECRET_KEY` | Step A: server secret, or legacy service_role key; never the database password |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Step B: the same Web client pair saved to the Supabase Google provider |
| `ALLOWED_GOOGLE_EMAILS` | Your Google email; separate multiple allowed accounts with commas |

Keep generated `TOKEN_ENCRYPTION_KEY` and `CRON_SECRET` as-is. Do not rotate the encryption key on redeploy: stored Google credentials depend on it. Use literal values, not environment-variable references.

```sh
npm run setup:check
```

This checks local format without printing secrets. It does **not** verify cloud credentials, migrations, or connectivity. With the local default `APP_URL`, the production warning is expected: the printed localhost Site URL/app callback are for local development, **not** values to register for production. Replace them with the real domain in stage 3. A blank email allowlist permits any Google account to join; set yours for personal use.

**Stage complete:** the configuration check succeeds, secrets are saved privately, and your own email is allowed. A not-yet-assigned Vercel domain does not block the next step.

## 3. Deploy and sign in

### A. Vercel: deploy and identify the production domain

**New project, no domain yet:**

1. Open the [Deploy with Vercel button below](#deploy-button). Sign in to Vercel, choose your own team/account, connect your GitHub account, and choose the owner and name of the repository copy. The button creates that copy and a Next.js project; it does not create Supabase tables or configure Google.
2. Copy the requested values from `.env.local` into the deployment form. The button deliberately **does not request `APP_URL`**: leave it unset in Vercel until the domain is known. Do not upload the local file to Git or use localhost or a guessed domain as a production value. Select **Next.js**, repository root, Node.js **24.x**, install command `npm ci`, and build command `npm run build` in the available project/build settings. No custom output directory is needed. [Vercel build settings](https://vercel.com/docs/builds/configure-a-build)
3. Deploy and wait for **Ready**. Open the project **Settings → Domains** and copy the domain assigned to **Production**. Use its HTTPS origin, not a commit-specific or Preview deployment URL. The assigned name may differ from your chosen project name; copy it rather than guessing. Vercel provides a `.vercel.app` domain, so purchasing a domain is not required. [Vercel domains](https://vercel.com/docs/domains/working-with-domains)

Without `APP_URL`, GropBox deliberately displays **Setup required**. This first deployment establishes the domain; it is **not a usable deployment yet**. Do not attempt sign-in until step B is complete. If Vercel's build fails, inspect the first relevant build error; a failed build is not this expected setup screen.

**Existing project or confirmed custom domain:** reuse the approved project and its current secrets. If a stable domain is already assigned to this project's Production environment, use it immediately in step B; no setup-only deployment is necessary. Merely owning a domain is not the same as assigning it to Vercel. For a new project with an unassigned custom domain, follow the new-project path first; only change DNS with the owner's approval. Do not create a duplicate project with the deploy button.

### B. Complete the URLs and redeploy

Use the confirmed HTTPS origin from step A wherever the table says `https://YOUR-PRODUCTION-DOMAIN`. Do not include a path or trailing slash in the origin.

| Setting | Value |
| --- | --- |
| Local `.env.local` → `APP_URL` | `https://YOUR-PRODUCTION-DOMAIN` |
| Vercel project → Settings → Environment Variables → `APP_URL`, **Production** | `https://YOUR-PRODUCTION-DOMAIN` |
| Supabase → Authentication → URL Configuration → **Site URL** | `https://YOUR-PRODUCTION-DOMAIN` |
| Same Supabase page → **Redirect URLs** → Add URL | `https://YOUR-PRODUCTION-DOMAIN/api/auth/callback` |

Save both dashboards. In Vercel, also confirm every other variable from stage 2 is set for **Production**; Preview-only variables do not configure the production deployment. Keep server secrets out of `NEXT_PUBLIC_*` fields. Run `npm run setup:check` again locally: it should now print these production URLs without the localhost warning. Its Google callback output assumes the default Supabase domain; if you use a custom Supabase auth domain, keep the actual provider callback from stage 1.

Google's redirect URI still points to Supabase, not this app route. Keep redirect URLs exact; do not add broad production wildcards. [Redirect configuration](https://supabase.com/docs/guides/auth/redirect-urls)

In Vercel, open **Deployments**, select the latest production deployment's menu, and **Redeploy** to Production with the saved configuration. Wait for **Ready**, then reopen the stable production URL. Saving environment variables alone does not update a deployment; `NEXT_PUBLIC_*` changes also require rebuilding. [Vercel environment settings](https://vercel.com/docs/environment-variables/managing-environment-variables)

**Ready for sign-in:** the production page shows **Continue with Google**, all URL fields refer to the same origin, and the latest production deployment uses the saved environment. If **Setup required** remains, use the troubleshooting table below; do not report deployment success yet.

### C. Sign in and verify

Select **Continue with Google**, use the account allowed in stage 2, and approve identity and Drive access. Send a short message and a small test file. Open the same production URL on a second device, sign in with the same Google account, and confirm the message and downloadable file arrive. In Google Drive, confirm the file is inside `GropBox`; the app creates the folder as it writes data, so you do not need to create or share a folder manually. If Google does not issue an offline grant, use **Settings → Reconnect Google** and approve consent again.

**Complete:** real Google sign-in, cross-device sync, and a small-file upload/download work. A build or setup check alone is not enough. Report untested checks explicitly if another device or provider access is unavailable.

[vercel.json](../vercel.json) schedules daily archive catch-up. `CRON_SECRET` protects that endpoint; Vercel supplies the authorization header. Online use also processes bounded archive batches. Cron is not the message synchronization channel. [Cron limits](https://vercel.com/docs/cron-jobs/usage-and-pricing)

## Self-hosting

The same configuration works on Linux or Windows with Node.js 22.12+. Set a stable HTTPS origin and the same Supabase redirect configuration, then run:

```sh
npm ci
npm run build
npm start
```

Use your platform's HTTPS reverse proxy and process manager. For local development, use `npm run dev` instead and allow `http://localhost:3000/api/auth/callback` in Supabase. Supabase and Google Drive remain external services. There is no exe or static-only/GitHub Pages deployment. Vercel cron does not run on a standalone Node server; online archive batches still work.

## If something fails

| Symptom | Check |
| --- | --- |
| Setup required on the first Vercel deployment | Expected only while `APP_URL` is unset; complete stage 3B and redeploy |
| Setup required after stage 3B | Run `npm run setup:check`; compare all Production environment values and rebuild |
| Google redirect mismatch | The Google client redirect must be the Supabase `/auth/v1/callback` URL |
| Google access blocked while testing | Check the selected Google Cloud project, Audience, and Test users |
| Returned to the wrong site | Match `APP_URL`, Supabase Site URL, and the app's exact allowed callback |
| Database setup required | Confirm the migration ran on the same project as the configured keys |
| Account not allowed | Check `ALLOWED_GOOGLE_EMAILS` and existing `app_accounts.active` status |
| Drive reconnect required | Enable the Drive API, check consent/token lifetime, and reconnect Google |
| Sync fails after inactivity | Check the Supabase project's status and quotas; free projects may pause |

Files transfer directly to Drive, not through Vercel function bodies. Google API access, Supabase HTTPS/WebSocket access, and the app domain must work on both devices; access to drive.google.com alone is insufficient. See [architecture and limits](MVP_PLAN.md) before promising background transfers or always-on availability.

## Deploy button

For a new dashboard-only deployment, complete stages 1 and 2 above before using this button. It does not initialize the database or configure Google for you.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fhadan8977%2FGropBox&project-name=gropbox&repository-name=gropbox&env=NEXT_PUBLIC_SUPABASE_URL,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,SUPABASE_SECRET_KEY,GOOGLE_CLIENT_ID,GOOGLE_CLIENT_SECRET,TOKEN_ENCRYPTION_KEY,CRON_SECRET,ALLOWED_GOOGLE_EMAILS&envDescription=Complete%20stages%201%20and%202%20of%20the%20dashboard%20guide%20first.&envLink=https%3A%2F%2Fgithub.com%2Fhadan8977%2FGropBox%2Fblob%2Fmain%2Fdocs%2FDEPLOY_MANUAL.md)
