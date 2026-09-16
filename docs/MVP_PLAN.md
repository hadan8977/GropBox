# Architecture and product boundaries

GropBox is a browser-based transfer assistant. The interface, repository documentation, and contributor-facing text are English. No desktop executable is required.

## Data ownership

| Component | Responsibility |
| --- | --- |
| Next.js / Vercel | Web interface, authenticated APIs, OAuth callback, token renewal, bounded archive jobs |
| Supabase | Google sign-in, Realtime, authoritative message/note content, attachment metadata, version checks, archive queue, encrypted provider credentials |
| Google Drive | Original attachments and asynchronous JSON archives |
| Browser IndexedDB | Per-account recent history, drafts, outbox, upload checkpoints; no Google tokens or large file blobs |

Supabase is not just an index of Drive IDs. Drive is not a second editable message database. Direct edits to archives are not imported back.

Files live under `GropBox/Files/YYYY-MM`; versioned message and note archives use `History` and `Notes`. Stored Drive IDs, not folder names, identify resources. Legacy internal IDs stay unchanged to preserve existing drafts and folders.

## Interaction and synchronization

- One self-chat timeline with plain text, notes, files, search, pinning, edits, and logical deletion.
- Consecutive bubbles have a 4 px gap. A five-minute gap or local date change starts a time group. New-message counts are session-local, not persistent cross-device read receipts.
- The anonymous shell is prerendered and cached with its boot assets. Account-scoped IndexedDB history renders before a slow session refresh; a display-only account hint never authorizes network operations. Incoming messages do not wait for queued writes. No Drive scan is needed.
- Realtime signals trigger an authenticated re-query. Reconnection, foregrounding, and periodic checks reconcile missed changes; polling falls back to approximately four seconds in the foreground.
- Latest pages use 30 records. Cursor pagination uses server timestamps and IDs; repeat syncs compare versions before fetching changed bodies.
- Writes enter a durable local outbox. Only database acknowledgement means sent; only archive completion means archived.
- Operation IDs deduplicate retries. Atomic expected-version checks preserve conflicting local drafts instead of silently overwriting remote edits.
- Search matches message text, note titles, and filenames across online history, with at most 100 results. Offline search covers cached records. Short substrings may require scans. No attachment-body search, OCR, or semantic search.

## Files and archives

Uploads go directly from browser to Drive in 8 MiB chunks, with up to two concurrent uploads and 30 queued files. A file becomes visible on other devices after upload completion and Send. Upload progress is not a delivery receipt.

Folder drops recursively collect files, including nested directories, into the existing monthly Drive folder. Source directory hierarchy and empty folders are not recreated. Unreadable or over-limit folders are rejected before starting a partial upload.

Reopening a paused upload may require selecting the original file again. Background tabs and locked phones may suspend work. File downloads use streaming where supported, otherwise bounded buffers or the Drive page.

Archiving is queued in the same transaction as a message mutation. Online requests process bounded batches; Vercel's daily cron supplements them. Leases, retries, and stable IDs protect against interrupted jobs. Archive lag is possible; JSON archives are not a complete database backup or an automatic restore facility.

Deletion hides the timeline entry, but does not delete Drive originals or prior archives. Signing out clears this device's drafts, cache, and upload checkpoints, not cloud content or other sessions.

## Security boundaries

- Google OAuth uses PKCE and the minimum `drive.file` scope. Provider refresh tokens are encrypted with AES-256-GCM and removed from browser session/cookie output.
- Supabase RLS isolates accounts. Credential and archive tables are not browser-readable or published to Realtime. Server APIs still validate ownership when using service credentials.
- Allowlisting controls sign-in and API admission. To disable an existing account's online database access, set `app_accounts.active=false`; removing an email alone does not revoke issued tokens or erase device caches.
- Requests validate origin, content size/format, attachment ownership, and Google upload URL destinations. HTML/SVG uploads are not executed as app content. API responses are not publicly cached.
- This is not end-to-end encryption: authorized database administrators can read message content. Transfer only data you are authorized to move.

## Availability and verification

Free services have quotas and may pause after inactivity; consult [Supabase pricing](https://supabase.com/pricing) and [Vercel plans](https://vercel.com/docs/plans). Do not promise permanent free availability or work around plan restrictions with artificial keepalive traffic.

Google consent is required initially. Sessions can renew, but revoked grants, policy changes, or expired refresh tokens require reconnection. [External OAuth apps in Testing can issue seven-day refresh tokens](https://developers.google.com/identity/protocols/oauth2#expiration) when Drive access is requested.

After an online visit caches the production shell/assets and account history, they can reopen offline. First visits, cleared/evicted storage, and uncached previews still need the network. The fallback distinguishes an offline device from an unreachable app; it does not claim drafts were saved without loading them. PWA share-target input accepts text and links, not arbitrary shared files. There is no local-network device discovery, Office editor, collaborative editing, or background-upload guarantee.

```sh
npm test
npm run build
```

The build includes TypeScript checks. Unit tests include a local PostgreSQL-compatible PGlite migration/RLS test; they do not prove a deployed Supabase instance is configured.

`npm run test:e2e` builds with test-only provider settings and starts a production server on port 3100, testing caching without development HMR traffic. It includes build/TypeScript validation; a separate build for the same changes is unnecessary. With an existing Chrome installation, set `PLAYWRIGHT_CHANNEL=chrome` (PowerShell: `$env:PLAYWRIGHT_CHANNEL='chrome'`). Otherwise install the project's Playwright Chromium browser first. Provider traffic is mocked only in tests; mobile viewport emulation is not an iOS Safari device test.

Real Google sign-in, deployed RLS/Realtime, company-network access, phone behavior, and multi-gigabyte transfers require real accounts and devices. Do not claim measured latency or real 5 GB upload success from local mocks.

## Design references

The web interface adapts navigation-layer material, restraint, and motion principles from [Apple Design Skill](https://github.com/naplesblue/apple-design-skill), [Liquid Glass Skills](https://github.com/SohrabZ/liquid-glass-skills), and [Awesome Liquid Glass](https://github.com/GetStream/awesome-liquid-glass). CSS glass is not Apple's native material renderer; reduced motion, transparency, and contrast preferences have explicit fallbacks.
