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

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fhadan8977%2FGropBox&project-name=gropbox&repository-name=gropbox&env=APP_URL,NEXT_PUBLIC_SUPABASE_URL,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,SUPABASE_SECRET_KEY,GOOGLE_CLIENT_ID,GOOGLE_CLIENT_SECRET,TOKEN_ENCRYPTION_KEY,CRON_SECRET,ALLOWED_GOOGLE_EMAILS&envDescription=Prepare%20.env.local%20with%20npm%20run%20setup.%20Use%20your%20own%20Google%20email%20for%20a%20personal%20deployment.&envLink=https%3A%2F%2Fgithub.com%2Fhadan8977%2FGropBox%2Fblob%2Fmain%2Fdocs%2FDEPLOY.md)

## Deploy with an agent

Paste this into your coding agent:

```text
Deploy https://github.com/hadan8977/GropBox for my personal use.
Read AGENTS.md and docs/DEPLOY_AGENT.md from the same checkout first.
Follow that guide, confirm the target accounts and costs with me,
and keep secrets out of chat and Git. Report the deployed URL and
which real sign-in, sync, and file-transfer checks passed.
```

[Self-host on Linux or Windows](docs/DEPLOY.md#self-hosting) · [Architecture and limits](docs/MVP_PLAN.md)
