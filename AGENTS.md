# GropBox

- Keep repository documentation, UI text, and contributor-facing messages in English. Unicode test fixtures are intentional.
- For deployment tasks, read [docs/DEPLOY_AGENT.md](docs/DEPLOY_AGENT.md) first. Follow [docs/DEPLOY.md](docs/DEPLOY.md) for configuration; do not duplicate it here.
- Use `npm ci` with the lockfile. `npm run setup` creates an ignored local template without replacing existing files; `npm run setup:check` validates local format only.
- Use targeted `npm test -- <test-file>` checks. `npm run build` includes TypeScript validation. Browser test details and product boundaries are in [docs/MVP_PLAN.md](docs/MVP_PLAN.md).
- Preserve user changes and stable storage identifiers. Do not rotate existing encryption keys, apply remote migrations, change visibility, incur charges, or deploy without authorization for the specific target.
- Never put real credentials in Git, logs, screenshots, or chat. Do not treat mocked tests as proof of deployed OAuth, Realtime, or Drive access.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
