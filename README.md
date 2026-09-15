# GropBox

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

A web transfer assistant for your devices. Files in Google Drive; messages synced with Supabase.

<table>
  <tr>
    <td width="77%"><img src="docs/images/desktop.png" alt="GropBox on desktop" /></td>
    <td width="23%"><img src="docs/images/mobile.png" alt="GropBox on mobile" /></td>
  </tr>
</table>

<sub>Actual interface, with sample content.</sub>

## Deploy yourself

1. [Connect Google and Supabase](docs/DEPLOY.md#1-connect-your-services).
2. [Generate your configuration](docs/DEPLOY.md#2-prepare-your-configuration) with `npm run setup`.
3. [Deploy to Vercel](docs/DEPLOY.md#3-deploy-and-sign-in) and sign in.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fhadan8977%2FGropBox&project-name=gropbox&repository-name=gropbox&env=NEXT_PUBLIC_SUPABASE_URL,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,SUPABASE_SECRET_KEY,GOOGLE_CLIENT_ID,GOOGLE_CLIENT_SECRET,TOKEN_ENCRYPTION_KEY,CRON_SECRET,ALLOWED_GOOGLE_EMAILS&envDescription=Copy%20the%20requested%20values%20from%20.env.local.%20After%20the%20first%20deploy%2C%20set%20APP_URL%20to%20your%20assigned%20domain%20and%20follow%20stage%203%20of%20the%20guide.&envLink=https%3A%2F%2Fgithub.com%2Fhadan8977%2FGropBox%2Fblob%2Fmain%2Fdocs%2FDEPLOY.md)

## Deploy with an agent

Paste this into your coding agent:

```text
Deploy https://github.com/hadan8977/GropBox for my personal use.
Read AGENTS.md and docs/DEPLOY_AGENT.md from the same checkout first.
First check what I already have, then guide me one step at a time
through Supabase, Google, and Vercel, including domain setup.
Do not ask for credentials or a domain before helping me obtain them.
Confirm target accounts and costs; keep secrets out of chat and Git.
Report the deployed URL and which real sign-in, sync, and file-transfer checks passed.
```

[Self-host on Linux or Windows](docs/DEPLOY.md#self-hosting) · [Architecture and limits](docs/MVP_PLAN.md)
