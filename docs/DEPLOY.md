# Deploy GropBox

Three setup stages, not three clicks. You need your own Google Cloud, Supabase, GitHub, and Vercel accounts. Google consent and account verification cannot be automated away. Start with dedicated projects; check plan costs before creating paid resources.

## 1. Connect your services

**Supabase:** [Create a project](https://supabase.com/dashboard). Open its SQL Editor and run [001_gropbox.sql](../supabase/migrations/001_gropbox.sql) once on the new database. It creates the schema, RLS policies, transactional functions, and message Realtime publication. Do not rerun this initial migration against an existing installation.

**Google Cloud:** [Enable the Drive API](https://console.cloud.google.com/apis/library/drive.googleapis.com), configure the OAuth consent screen, and create a **Web application** OAuth client. Add this authorized redirect URI, replacing `PROJECT_REF` with your Supabase project reference:

```text
https://PROJECT_REF.supabase.co/auth/v1/callback
```

Use identity scopes (`openid`, email, profile) and `https://www.googleapis.com/auth/drive.file`, not full-Drive access. Add your Google account as a test user if the consent screen is in Testing. In Supabase, open **Authentication → Sign In / Providers → Google**, enable it, and enter that client's ID and secret. Keep the same pair for the app configuration below. [Google provider setup](https://supabase.com/docs/guides/auth/social-login/auth-google)

For long-lived use, resolve Google's audience/publishing requirements: external apps in Testing with Drive access can receive refresh tokens that expire after seven days. Production status does not guarantee permanent authorization. [Google token expiration](https://developers.google.com/identity/protocols/oauth2#expiration)

## 2. Prepare your configuration

With Node.js 22.12+ and Git, run these commands on Linux or Windows PowerShell:

```sh
git clone https://github.com/hadan8977/GropBox.git
cd GropBox
npm run setup
```

The dependency-free setup command creates `.env.local` from [.env.example](../.env.example), generates separate encryption/cron secrets, and never overwrites an existing file. It makes no network calls and does not print credentials. Keep this ignored file private, including its filesystem permissions on shared computers.

Open `.env.local` in your editor and fill the remaining values:

| Field | Where it comes from |
| --- | --- |
| `APP_URL` | Your final HTTPS production origin, with no path; use `http://localhost:3000` only for local development |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase publishable key, or legacy anon key; never the server key |
| `SUPABASE_SECRET_KEY` | Supabase server secret, or legacy service_role key |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | The same Web application client used by the Supabase Google provider |
| `ALLOWED_GOOGLE_EMAILS` | Your Google email; separate multiple allowed accounts with commas |

Keep generated `TOKEN_ENCRYPTION_KEY` and `CRON_SECRET` as-is. Do not rotate the encryption key on redeploy: stored Google credentials depend on it. Use literal values, not environment-variable references.

```sh
npm run setup:check
```

This checks local format and prints the exact callback URLs to copy, without printing secrets. It does **not** verify cloud credentials, migrations, or provider connectivity. A blank email allowlist permits any Google account to join; set yours for personal use.

## 3. Deploy and sign in

Use the **Deploy with Vercel** button in the [README](../README.md#deploy-yourself). It creates your own repository copy and Next.js project; it does not configure Google or apply the Supabase migration. Choose a unique project name, fill the requested environment fields from `.env.local`, and deploy. You can also manage these values in [project environment settings](https://vercel.com/docs/environment-variables/managing-environment-variables). Never commit `.env.local` or put its values in a deployment URL.

Use Node.js **24.x**, install command `npm ci`, and build command `npm run build`. After Vercel assigns the production domain, make sure `APP_URL` exactly matches it; update the environment and redeploy if needed. Changes to `NEXT_PUBLIC_*` values always require rebuilding.

In Supabase **Authentication → URL Configuration**, set:

| Setting | Value |
| --- | --- |
| Site URL | `https://YOUR-PRODUCTION-DOMAIN` |
| Redirect URLs | `https://YOUR-PRODUCTION-DOMAIN/api/auth/callback` |

Google's redirect URI still points to Supabase, not this app route. Keep redirect URLs exact; do not add broad production wildcards. [Redirect configuration](https://supabase.com/docs/guides/auth/redirect-urls)

Open the production site and select **Continue with Google**. Send a short message and small file; open a second device with the same Google account to confirm both arrive. Check Drive for the `GropBox` folder. If Google does not issue an offline grant, use **Settings → Reconnect Google** and approve consent again.

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
| Setup required | Run `npm run setup:check`; compare the configured production environment and rebuild |
| Google redirect mismatch | The Google client redirect must be the Supabase `/auth/v1/callback` URL |
| Returned to the wrong site | Match `APP_URL`, Supabase Site URL, and the app's exact allowed callback |
| Database setup required | Confirm the migration ran on the same project as the configured keys |
| Account not allowed | Check `ALLOWED_GOOGLE_EMAILS` and existing `app_accounts.active` status |
| Drive reconnect required | Enable the Drive API, check consent/token lifetime, and reconnect Google |
| Sync fails after inactivity | Check the Supabase project's status and quotas; free projects may pause |

Files transfer directly to Drive, not through Vercel function bodies. Google API access, Supabase HTTPS/WebSocket access, and the app domain must work on both devices; access to drive.google.com alone is insufficient. See [architecture and limits](MVP_PLAN.md) before promising background transfers or always-on availability.
