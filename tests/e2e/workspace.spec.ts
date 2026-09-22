import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Message, Mutation, Attachment } from "../../src/lib/model";

// All provider traffic is mocked here. These tests verify UI integration, not deployed OAuth/Drive.
const userId = "11111111-1111-4111-8111-111111111111";
const user = { id: userId, aud: "authenticated", role: "authenticated", email: "demo@example.com", app_metadata: { provider: "google" }, user_metadata: { name: "Alex" }, created_at: "2026-09-15T00:00:00Z" };
function sessionCookie(lifetime = 3600) {
  const token = [ { alg: "HS256", typ: "JWT" }, { sub: userId, aud: "authenticated", role: "authenticated", exp: Math.floor(Date.now() / 1000) + lifetime } ].map((part) => Buffer.from(JSON.stringify(part)).toString("base64url")).join(".") + "." + Buffer.from("test-signature").toString("base64url");
  return `base64-${Buffer.from(JSON.stringify({ access_token: token, refresh_token: "test-session-refresh", token_type: "bearer", expires_at: Math.floor(Date.now() / 1000) + lifetime, expires_in: 3600, user })).toString("base64url")}`;
}
async function connect(context: BrowserContext, rows: Message[], conflict = false) {
  await context.addCookies([{ name: "sb-gropbox-test-auth-token", value: sessionCookie(), domain: "localhost", path: "/", sameSite: "Lax" }]);
  await context.routeWebSocket("wss://gropbox-test.supabase.co/**", (ws) => ws.close());
  await context.route("https://gropbox-test.supabase.co/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/user")) return route.fulfill({ json: user });
    if (url.pathname.includes("/app_accounts")) return route.fulfill({ json: { user_id: userId } });
    if (url.pathname.includes("/messages")) {
      let found = [...rows];
      const ids = url.searchParams.get("id"); if (ids?.startsWith("in.")) found = found.filter((m) => ids.includes(m.id));
      if (url.searchParams.get("deleted") === "eq.false") found = found.filter((m) => !m.deleted);
      const search = url.searchParams.get("search_text")?.replace(/^ilike\.%|%$/g, "");
      if (search) found = found.filter((m) => JSON.stringify([m.title, m.body, m.attachments]).includes(search));
      if (url.searchParams.get("kind") === "eq.document") found = found.filter((m) => m.kind === "document");
      if (url.searchParams.get("pinned") === "eq.true") found = found.filter((m) => m.pinned);
      if (url.searchParams.has("attachments")) found = found.filter((m) => m.attachments.length > 0);
      found.sort((a, b) => b.created_at.localeCompare(a.created_at));
      return route.fulfill({ json: found.slice(0, Number(url.searchParams.get("limit") ?? 1000)) });
    }
    return route.fulfill({ json: [] });
  });
  await context.route("**/api/messages", async (route) => {
    const mutation = route.request().postDataJSON() as Mutation;
    if (conflict) return route.fulfill({ status: 409, json: { error: "Edited on another device. Changes kept locally." } });
    const prior = rows.find((r) => r.id === mutation.id), time = new Date().toISOString();
    const saved: Message = { ...mutation, user_id: userId, created_at: prior?.created_at ?? time, updated_at: time, version: (prior?.version ?? 0) + 1, archive_version: 0 };
    const index = rows.findIndex((m) => m.id === saved.id); if (index < 0) rows.push(saved); else rows[index] = saved;
    await route.fulfill({ json: saved });
  });
  await context.route("**/api/archive", (route) => route.fulfill({ json: { completed: 0, failed: 0 } }));
  await context.route("**/api/drive/token", (route) => route.fulfill({ json: { token: "test-google-access", expiresAt: Date.now() + 3600_000 } }));
  let attachment: Attachment;
  await context.route("**/api/drive/uploads", (route) => {
    const input = route.request().postDataJSON();
    if (input.action === "prepare") { attachment = { id: "test-file-id", name: input.name, size: input.size, mimeType: input.mimeType }; return route.fulfill({ json: { fileId: attachment.id, folderId: "test-folder" } }); }
    return route.fulfill({ json: attachment });
  });
  await context.route("https://www.googleapis.com/upload/drive/v3/files**", (route) => {
    const headers = { "access-control-allow-origin": "*", "access-control-expose-headers": "Location,Range", "access-control-allow-headers": "*" };
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers });
    if (route.request().method() === "POST") return route.fulfill({ status: 200, headers: { ...headers, location: "https://www.googleapis.com/upload/drive/v3/files?upload_id=test" } });
    return route.fulfill({ json: attachment, headers });
  });
}
async function open(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("textbox", { name: "Message" })).toBeEditable();
  await expect(page.getByRole("status", { name: "Loading" })).toHaveCount(0);
}

test("shows Google login without fake history", async ({ page }) => {
  await page.route("https://gropbox-test.supabase.co/**", (route) => route.fulfill({ json: [] }));
  await page.goto("/"); await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "GropBox" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator("body")).not.toHaveText(/test-server-only-key|test-secret/);
});
test("sends, reloads and searches a real UI record; responsive layout fits", async ({ page, context }, info) => {
  const rows: Message[] = []; await connect(context, rows); await open(page);
  await page.getByRole("textbox", { name: "Message" }).fill("The link I need on my phone.");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("status", { name: "Sent", exact: true }).first()).toBeVisible(); expect(rows).toHaveLength(1);
  await page.reload(); await expect(page.getByText("The link I need on my phone.", { exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "Search" }).fill("phone");
  await expect(page.getByText("1 result")).toBeVisible();
  await expect(page.getByRole("region", { name: "Messages" }).getByText("The link I need on my phone.", { exact: true })).toBeInViewport();
  await expect(page.getByRole("region", { name: "Messages" }).getByText("The link I need on my phone.", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("workspace.png"), fullPage: true });
});
test("queues offline text and sends after reconnection", async ({ page, context }) => {
  const rows: Message[] = []; await connect(context, rows); await open(page); await context.setOffline(true);
  await page.getByRole("textbox", { name: "Message" }).fill("Keep this while offline."); await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("status", { name: "Pending" })).toBeVisible(); expect(rows).toHaveLength(0);
  await context.setOffline(false); await expect(page.getByRole("status", { name: "Sent", exact: true }).first()).toBeVisible({ timeout: 10_000 }); expect(rows).toHaveLength(1);
});

test("shows cached history before a stalled session refresh, then clears it on sign-out", async ({ page, context }) => {
  await connect(context, history(1)); await open(page);
  await expect(page.getByText("Saved message 1", { exact: true })).toBeVisible();
  let release!: () => void, requested = false;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await context.route("https://gropbox-test.supabase.co/auth/v1/token**", async route => {
    requested = true; await pending;
    await route.fulfill({ json: JSON.parse(Buffer.from(sessionCookie().slice(7), "base64url").toString()) });
  });
  await context.addCookies([{ name: "sb-gropbox-test-auth-token", value: sessionCookie(-60), domain: "localhost", path: "/", sameSite: "Lax" }]);
  try {
    await page.reload();
    await expect(page.getByText("Saved message 1", { exact: true })).toBeVisible({ timeout: 2000 });
    await expect.poll(() => requested).toBe(true);
    await expect(page.getByRole("textbox", { name: "Message" })).toBeEditable();
  } finally { release(); }
  await expect.poll(async () => JSON.parse(Buffer.from((await context.cookies()).find(c => c.name === "sb-gropbox-test-auth-token")!.value.slice(7), "base64url").toString()).expires_at).toBeGreaterThan(Math.floor(Date.now() / 1000));
  await context.clearCookies(); await page.reload();
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
  await expect(page.getByText("Saved message 1", { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('gropbox:account:https://gropbox-test.supabase.co'))).toBeNull();
});

test("incoming messages do not wait for a stalled outgoing write", async ({ page, context }) => {
  const rows = history(1); await connect(context, rows); await open(page);
  await expect(page.getByText("Saved message 1", { exact: true })).toBeVisible();
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await context.route("**/api/messages", async route => { await pending; await route.fallback(); });
  try {
    await page.getByRole("textbox", { name: "Message" }).fill("Slow outgoing message");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    rows.push({ ...rows[0], id: "55555555-5555-4555-8555-555555555554", body: "Incoming now", created_at: "2026-09-16T08:00:00Z" });
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await expect(page.getByText("Incoming now", { exact: true })).toBeVisible({ timeout: 2000 });
    await expect(page.getByRole("status", { name: "Pending", exact: true })).toBeVisible();
  } finally { release(); }
  await expect(page.getByRole("status", { name: "Sent", exact: true }).last()).toBeVisible();
});

test("cached app and history reopen offline without caching private responses", async ({ page, context }) => {
  await connect(context, history(1)); await open(page);
  await expect(page.getByText("Saved message 1", { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(async () => Boolean(navigator.serviceWorker.controller && await (await caches.open('gropbox-shell-v3')).match('/'))), { timeout: 15000 }).toBe(true);
  const cache = await page.evaluate(async () => {
    const store = await caches.open('gropbox-shell-v3');
    return { html: await (await store.match('/'))!.text(), paths: (await store.keys()).map(request => new URL(request.url).pathname) };
  });
  expect(cache.html).not.toMatch(/demo@example.com|test-session-refresh|test-server-only-key/);
  expect(cache.paths.every(path => path === '/' || path === '/offline.html' || path === '/icon.svg' || path.startsWith('/_next/static/'))).toBe(true);
  await context.setOffline(true);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByText("Saved message 1", { exact: true })).toBeVisible({ timeout: 3000 });
  await expect(page.getByRole("textbox", { name: "Message" })).toBeEditable();
  await expect(page.getByRole("heading", { name: "Offline", exact: true })).toHaveCount(0);
});

test("folder drops upload nested file contents instead of a directory placeholder", async ({ page, context }, info) => {
  const rows: Message[] = []; await connect(context, rows); await open(page);
  await page.getByRole("textbox", { name: "Message" }).fill("Keep this draft.");
  const folder = info.outputPath("Folder");
  await mkdir(join(folder, "Nested"), { recursive: true });
  await writeFile(join(folder, "Nested", "inside.txt"), "inside");
  const session = await context.newCDPSession(page);
  const area = (await page.locator(".timeline").boundingBox())!;
  for (const type of ["dragEnter", "dragOver", "drop"] as const) await session.send("Input.dispatchDragEvent", { type, x: area.x + 60, y: area.y + 60, data: { items: [], files: [folder], dragOperationsMask: 1 } });
  await expect(page.getByText("inside.txt", { exact: true })).toBeVisible();
  await expect(page.locator(".upload-list").getByText("Folder", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("status", { name: "Sent", exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Message" })).toHaveValue("Keep this draft.");
  expect(rows).toHaveLength(1); expect(rows[0].body).toBe("");
  expect(rows[0].attachments).toEqual([{ id: "test-file-id", name: "inside.txt", size: 6, mimeType: "text/plain" }]);
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Message" })).toHaveValue("Keep this draft.");
  await expect(page.getByRole("button", { name: "Download inside.txt" })).toBeVisible();
  expect(rows).toHaveLength(1);
});
test("preserves failed content and accepts a small file upload", async ({ page, context }) => {
  const rows: Message[] = []; await connect(context, rows, true); await open(page);
  await page.locator('input[aria-label="Choose files"]').setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello drive") });
  await expect(page.getByRole("region", { name: "Attachments", exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "Message" }).fill("Keep these unsent changes."); await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("status", { name: "Not sent" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Messages" }).getByText("Keep these unsent changes.", { exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Message" })).toHaveValue(""); expect(rows).toHaveLength(0);
});
for (const source of ["picker", "paste", "composer drop"] as const) test(`${source} stages attachments until one Send uploads and publishes the message`, async ({ page, context }, info) => {
  const rows: Message[] = []; await connect(context, rows);
  let starts = 0, release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await context.route("**/api/drive/uploads", async route => {
    if (route.request().postDataJSON().action === "prepare") { starts++; await gate; }
    await route.fallback();
  });
  try {
    await open(page);
    const composer = page.getByRole("textbox", { name: "Message" });
    await composer.fill("Caption for this file.");
    if (source === "picker") {
      const selecting = page.waitForEvent("filechooser");
      await page.getByRole("button", { name: "Attach files" }).click();
      await (await selecting).setFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello drive") });
    } else {
      const data = await page.evaluateHandle(() => { const data = new DataTransfer(); data.items.add(new File(["hello drive"], "notes.txt", { type: "text/plain" })); return data; });
      try {
        if (source === "paste") await composer.evaluate((element, clipboardData) => {
          element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }));
        }, data);
        else {
          await page.locator(".app-shell").dispatchEvent("dragover", { dataTransfer: data });
          await composer.dispatchEvent("dragover", { dataTransfer: data });
          await expect(page.locator(".drop-overlay")).toHaveCount(0);
          await expect(page.locator(".composer-zone")).toHaveAttribute("data-dragging", "true");
          await composer.dispatchEvent("drop", { dataTransfer: data });
        }
      } finally { await data.dispose(); }
    }
    await expect(page.locator(".composer").getByRole("region", { name: "Attachments", exact: true })).toBeVisible();
    await expect(page.getByRole("img", { name: "Attached notes.txt" })).toBeVisible();
    expect(starts).toBe(0); expect(rows).toHaveLength(0);
    if (source === "composer drop") {
      await expect(page.locator(".upload-list")).toHaveCSS("opacity", "1");
      await expect(page.locator(".upload-list")).toHaveCSS("transform", "none");
      await page.screenshot({ path: info.outputPath("staged.png"), fullPage: true });
    }
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect.poll(() => starts).toBe(1);
    await expect(page.getByRole("button", { name: "Send", exact: true })).toBeDisabled();
    await expect(page.getByRole("progressbar", { name: "Upload notes.txt" })).toBeVisible();
    expect(rows).toHaveLength(0);
    release();
    await expect(page.getByRole("status", { name: "Sent", exact: true })).toBeVisible();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ body: "Caption for this file.", attachments: [{ name: "notes.txt", size: 11 }] });
    await expect(composer).toHaveValue("");
    await expect(page.locator(".upload-list")).toHaveCount(0);
  } finally { release(); }
});
test("creates a document with plain-text editing", async ({ page, context }) => {
  const rows: Message[] = []; await connect(context, rows); await open(page);
  await page.getByRole("button", { name: "New note", exact: true }).last().click();
  await page.getByRole("textbox", { name: "Title" }).fill("Shopping list");
  await page.getByRole("textbox", { name: "Note text" }).fill("Coffee\nMilk");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Note" })).toHaveCount(0);
  await expect(page.getByText("Shopping list", { exact: true })).toBeVisible(); expect(rows[0]).toMatchObject({ kind: "document", title: "Shopping list", body: "Coffee\nMilk" });
});

test("another browser retrieves the new message without a manual refresh", async ({ page, context, browser }) => {
  const rows: Message[] = []; await connect(context, rows); await open(page);
  const second = await browser.newContext({ baseURL: "http://localhost:3100", viewport: { width: 390, height: 844 } });
  try {
    await connect(second, rows); const receiver = await second.newPage(); await open(receiver);
    await page.getByRole("textbox", { name: "Message" }).fill("Available on the other device.");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(receiver.getByRole("region", { name: "Messages" }).getByText("Available on the other device.", { exact: true })).toBeVisible({ timeout: 10_000 });
    expect(rows).toHaveLength(1);
  } finally { await second.close(); }
});

test("file downloads go to the browser without a save picker or blob buffering", async ({ page, context }) => {
  const rows = history(1), link = "https://drive.google.com/uc?id=download-file&export=download";
  rows[0].attachments = [{ id: "download-file", name: "Archive.zip", mimeType: "application/zip", size: 5 * 1024 ** 3 }];
  await connect(context, rows);
  await context.addInitScript(() => Object.defineProperty(window, "showSaveFilePicker", { value: () => { throw new Error("The app must not open a save picker"); } }));
  let mediaRequests = 0;
  await context.route("https://www.googleapis.com/drive/v3/files/download-file**", route => {
    if (new URL(route.request().url()).searchParams.has("alt")) mediaRequests++;
    return route.fulfill({ json: { webContentLink: link }, headers: { "access-control-allow-origin": "*" } });
  });
  await context.route(link, route => {
    expect(route.request().headers().authorization).toBeUndefined();
    return route.fulfill({ body: "download fixture", contentType: "application/zip", headers: { "content-disposition": 'attachment; filename="Archive.zip"' } });
  });
  await open(page);
  const completed = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download Archive.zip" }).click();
  const download = await completed;
  expect(download.url()).toBe(link); expect(download.suggestedFilename()).toBe("Archive.zip");
  expect(readFileSync((await download.path())!, "utf8")).toBe("download fixture");
  expect(mediaRequests).toBe(0);
  await expect(page.getByRole("textbox", { name: "Message" })).toBeVisible();
});

for (const delayed of [false, true]) test(`file sharing passes the actual file to the system${delayed ? " after a fresh tap" : " immediately"}`, async ({ page, context }, info) => {
  const rows = history(1);
  rows[0].attachments = [{ id: "share-file", name: "Note.txt", mimeType: "text/plain", size: 5 }];
  await connect(context, rows);
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "canShare", { configurable: true, value: (data: ShareData) => data.files?.[0]?.type === "text/plain" });
    Object.defineProperty(navigator, "share", { configurable: true, value: async (data: ShareData) => {
      if (!navigator.userActivation.isActive) throw new DOMException("Fresh tap required", "NotAllowedError");
      const file = data.files![0];
      Object.assign(window, { sharedFile: { name: file.name, type: file.type, text: await file.text(), url: data.url } });
    } });
  });
  let reads = 0;
  await context.route("https://www.googleapis.com/drive/v3/files/share-file**", route => { reads++; return route.fulfill({ body: "hello", contentType: "text/plain", headers: { "access-control-allow-origin": "*" } }); });
  await open(page);
  if (delayed) await page.evaluate(() => Object.defineProperty(navigator, "userActivation", { configurable: true, value: { isActive: false } }));
  await page.getByRole("button", { name: "Share Note.txt" }).click();
  if (delayed) {
    await expect(page.getByRole("status").filter({ hasText: "Tap Share to continue" })).toBeVisible();
    await page.screenshot({ path: info.outputPath("share-ready.png"), fullPage: true });
    expect(await page.evaluate(() => "sharedFile" in window)).toBe(false);
    await page.evaluate(() => Object.defineProperty(navigator, "userActivation", { configurable: true, value: { isActive: true } }));
    await page.getByRole("button", { name: "Share Note.txt" }).click();
  }
  await expect.poll(() => page.evaluate(() => (window as unknown as { sharedFile?: unknown }).sharedFile)).toEqual({ name: "Note.txt", type: "text/plain", text: "hello", url: undefined });
  expect(reads).toBe(1);
  await expect(page.getByText("Tap Share to continue")).toHaveCount(0);
});

test("file sharing treats cancellation quietly and reports a blocked fresh tap", async ({ page, context }) => {
  const rows = history(1);
  rows[0].attachments = [{ id: "share-file", name: "Note.txt", mimeType: "text/plain", size: 5 }];
  await connect(context, rows);
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "canShare", { value: () => true });
    Object.defineProperty(navigator, "share", { value: async () => { throw new DOMException("Share rejected", (window as unknown as { blockShare?: boolean }).blockShare ? "NotAllowedError" : "AbortError"); } });
  });
  let reads = 0;
  await context.route("https://www.googleapis.com/drive/v3/files/share-file**", route => { reads++; return route.fulfill({ body: "hello", contentType: "text/plain", headers: { "access-control-allow-origin": "*" } }); });
  await open(page);
  const button = page.getByRole("button", { name: "Share Note.txt" });
  await button.click(); await expect(button).toBeEnabled();
  await expect(page.locator(".notice")).toHaveCount(0);
  await expect(page.getByText("Tap Share to continue")).toHaveCount(0);
  await page.evaluate(() => Object.assign(window, { blockShare: true }));
  await button.click(); await expect(page.getByText("Tap Share to continue")).toBeVisible();
  await button.click(); await expect(page.getByText("Sharing blocked. Download the file instead.")).toBeVisible();
  expect(reads).toBe(2);
});

test("unsupported file sharing is hidden", async ({ page, context }) => {
  const rows = history(1);
  rows[0].attachments = [{ id: "share-file", name: "Note.txt", mimeType: "text/plain", size: 5 }];
  await connect(context, rows);
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "share", { value: async () => { throw new Error("Unsupported share must not run"); } });
    Object.defineProperty(navigator, "canShare", { value: () => false });
  });
  await open(page);
  await expect(page.getByRole("button", { name: "Download Note.txt" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Share Note.txt" })).toHaveCount(0);
});

test("downloads notes as plain text", async ({ page, context }) => {
  await connect(context, []); await open(page);
  await page.getByRole("button", { name: "New note", exact: true }).click();
  await page.getByRole("textbox", { name: "Title" }).fill("Export");
  await expect(page.getByRole("textbox", { name: "Note text" })).toBeEditable();
  const content = "<script>alert('not executable')</script>";
  await page.getByRole("textbox", { name: "Note text" }).fill(content);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download note" }).click(); const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("Export.txt");
  expect(readFileSync((await download.path())!, "utf8")).toBe(content);
});

test("plain composer preserves line breaks, composition and pasted text", async ({ page, context }, info) => {
  const rows: Message[] = []; await connect(context, rows); await open(page);
  const input = page.getByRole("textbox", { name: "Message", exact: true });
  await expect(page.getByRole("toolbar")).toHaveCount(0);
  await input.fill("Line one"); await input.press("Shift+Enter"); await input.press("End"); await input.press("L"); await input.press("2");
  await expect(input).toHaveValue("Line one\nL2");
  await input.dispatchEvent("keydown", { key: "Enter", code: "Enter", isComposing: true });
  expect(rows).toHaveLength(0);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.evaluate(async () => {
    await navigator.clipboard.write([new ClipboardItem({
      "text/html": new Blob(["<b>bold</b>"], { type: "text/html" }),
      "text/plain": new Blob(["bold"], { type: "text/plain" }),
    })]);
  });
  await input.press("Control+V");
  await expect(input).toHaveValue("Line one\nL2bold");
  await expect(page.locator('[contenteditable="true"]')).toHaveCount(0);
  if (info.project.name === "mobile") {
    await input.press("Enter");
    expect(rows).toHaveLength(0);
    await input.press("Control+Enter");
  } else {
    await input.press("Enter");
  }
  await expect(page.getByRole("status", { name: "Sent", exact: true })).toBeVisible();
  expect(rows[0].format).toBe("text");
  expect(rows[0].body).toBe(info.project.name === "mobile" ? "Line one\nL2bold\n" : "Line one\nL2bold");
});

test("minimal English library and settings", async ({ page, context }, info) => {
  const base = { user_id: userId, kind: "message" as const, format: "text" as const, title: "", pinned: false, deleted: false, version: 1, archive_version: 1, created_at: "2026-09-15T08:41:00Z", updated_at: "2026-09-15T08:41:00Z", attachments: [] };
  const rows: Message[] = [
    { ...base, id: "44444444-4444-4444-8444-444444444441", body: "https://developer.apple.com/design/" },
    { ...base, id: "44444444-4444-4444-8444-444444444442", body: "A few things for tomorrow.", created_at: "2026-09-15T08:42:00Z" },
    { ...base, id: "44444444-4444-4444-8444-444444444443", body: "", created_at: "2026-09-15T08:43:00Z", attachments: [{ id: "design-notes", name: "Design notes.pdf", size: 2457600, mimeType: "application/pdf" }] },
  ];
  await connect(context, rows); await open(page);
  await expect(page.getByText("Design notes.pdf", { exact: true })).toBeVisible();
  await expect(page.locator("body")).not.toHaveText(/[\p{Script=Han}]/u);
  await expect(page.locator("body")).not.toContainText(/Only you|Send to yourself|Archive automatically|Messages sync first/i);
  await expect(page.getByRole("toolbar")).toHaveCount(0);
  await expect(page.locator(".time-divider")).toHaveCount(1);
  const bubbles = page.locator(".message-bubble");
  const first = (await bubbles.nth(0).boundingBox())!, next = (await bubbles.nth(1).boundingBox())!;
  expect(next.y - first.y - first.height).toBeCloseTo(4, 0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const shell = (await page.locator(".app-shell").boundingBox())!;
  expect(shell).toEqual({ x: 0, y: 0, ...page.viewportSize()! });
  await expect(page.locator(".app-shell")).toHaveCSS("border-radius", "0px");
  await page.screenshot({ path: info.outputPath("gropbox.png"), fullPage: true });
  await page.getByRole("button", { name: "Settings", exact: true }).filter({ visible: true }).click();
  await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Settings" })).toHaveCSS("opacity", "1");
  await expect(page.getByText("Google Drive", { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath("settings.png"), fullPage: true });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Settings" })).toHaveCount(0);
});

function history(count: number): Message[] {
  return Array.from({ length: count }, (_, index) => {
    const time = new Date(Date.UTC(2026, 8, 14, 8, index)).toISOString();
    return { id: `44444444-4444-4444-8444-${String(index).padStart(12, "0")}`, user_id: userId, kind: "message", format: "text", title: "", body: `Saved message ${index + 1}`, attachments: [], pinned: false, deleted: false, version: 1, archive_version: 1, created_at: time, updated_at: time };
  });
}

test("copies message text in one click, including offline notes and attachment captions", async ({ page, context }, info) => {
  const rows = history(4);
  const text = "First line\n\n第二行 👋\nhttps://example.com/?a=1&b=2";
  rows[0].body = text;
  rows[1] = { ...rows[1], kind: "document", format: "rich", title: "Note title", body: { type: "doc", content: [
    { type: "paragraph", content: [{ type: "text", text: "Bold text", marks: [{ type: "bold" }] }, { type: "hardBreak" }, { type: "text", text: "Next line" }] },
    { type: "paragraph", content: [{ type: "text", text: "Another paragraph" }] },
  ] } };
  const file: Attachment = { id: "copy-test-file", name: "Reference.pdf", size: 100, mimeType: "application/pdf" };
  rows[2] = { ...rows[2], body: "Keep this caption.", attachments: [file] };
  rows[3] = { ...rows[3], body: "", attachments: [{ ...file, id: "file-only", name: "File only.pdf" }] };
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: "http://localhost:3100" });
  await connect(context, rows); await open(page);
  await expect(page.getByText("File only.pdf", { exact: true })).toBeVisible();
  await context.setOffline(true);
  const cards = page.getByRole("article");
  await expect(page.getByRole("button", { name: "Copy text", exact: true })).toHaveCount(3);
  for (const [index, expected] of [text, "Bold text\nNext line\nAnother paragraph", "Keep this caption."].entries()) {
    const card = cards.nth(index), copy = card.getByRole("button", { name: "Copy text", exact: true });
    await expect(copy).toBeVisible();
    await expect(copy).toHaveCSS("opacity", "1");
    const target = (await copy.boundingBox())!;
    expect(target.width).toBeGreaterThanOrEqual(44); expect(target.height).toBeGreaterThanOrEqual(44);
    const before = (await card.locator(".message-bubble").boundingBox())!;
    if (info.project.name === "mobile") await copy.tap(); else await copy.click();
    await expect(card.getByRole("status").filter({ hasText: "Copied" })).toHaveText("Copied");
    await expect(copy).toHaveAttribute("title", "Copied");
    expect(await page.evaluate(async () => (await navigator.clipboard.readText()).replace(/\r\n/g, "\n"))).toBe(expected);
    expect((await card.locator(".message-bubble").boundingBox())!.height).toBe(before.height);
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("copy-text.png"), fullPage: true });
  await expect(cards.nth(2).getByRole("button", { name: "Copy text" })).toHaveAttribute("title", "Copy text");
  await cards.nth(3).getByRole("button", { name: "Message actions" }).click();
  await expect(page.getByRole("dialog").getByRole("button", { name: "Copy", exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});

for (const failure of ["denied", "unavailable"] as const) {
  test(`copy text handles ${failure} clipboard access and supports keyboard retry`, async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: "http://localhost:3100" });
    await connect(context, history(1)); await open(page);
    await page.evaluate((mode) => {
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: mode === "unavailable" ? undefined : {
        writeText: () => Promise.reject(new DOMException("Clipboard blocked", "NotAllowedError")),
      } });
    }, failure);
    const copy = page.getByRole("button", { name: "Copy text", exact: true });
    const notice = page.getByRole("alert").filter({ hasText: "Could not copy." });
    await copy.focus(); await page.keyboard.press("Enter");
    await expect(notice).toHaveText("Could not copy. Select the text to copy manually.");
    await expect(copy).toBeEnabled();
    await expect(copy).toHaveAttribute("title", "Copy text");
    await expect(page.getByRole("status").filter({ hasText: "Copied" })).toHaveCount(0);
    await expect(page.getByText("Saved message 1", { exact: true })).toBeVisible();
    await page.evaluate(() => { Reflect.deleteProperty(navigator, "clipboard"); });
    await page.getByRole("button", { name: "Dismiss", exact: true }).click();
    await copy.focus(); await page.keyboard.press("Space");
    await expect(copy).toHaveAttribute("title", "Copied");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("Saved message 1");
    await expect(notice).toHaveCount(0);
  });
}

test("groups by time and keeps actions out of message spacing", async ({ page, context }, info) => {
  const rows = history(3);
  rows[2].created_at = "2026-09-14T08:07:00Z";
  await connect(context, rows); await open(page);
  await expect(page.getByText("Saved message 3", { exact: true })).toBeVisible();
  await expect(page.locator(".time-divider")).toHaveCount(2);
  const bubble = page.locator(".message-bubble").first(), before = (await bubble.boundingBox())!;
  await page.getByRole("button", { name: "Message actions", exact: true }).first().click();
  const menu = page.getByRole("dialog", { name: "Message actions" });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("button", { name: "Copy", exact: true })).toBeVisible();
  await expect(menu.getByRole("button", { name: "Edit", exact: true })).toBeVisible();
  expect((await bubble.boundingBox())!.height).toBe(before.height);
  await expect(menu).toHaveCSS("opacity", "1");
  await menu.getByRole("button", { name: "Copy", exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(menu.getByRole("button", { name: "Pin", exact: true })).toBeFocused();
  await expect.poll(() => menu.evaluate(element => {
    const highlight = element.querySelector(".bui-action-highlight")!.getBoundingClientRect();
    const button = document.activeElement!.getBoundingClientRect();
    return Math.abs(highlight.top - button.top);
  })).toBeLessThan(1);
  await page.screenshot({ path: info.outputPath("actions.png"), fullPage: true });
  await menu.getByRole("button", { name: "Pin", exact: true }).click();
  await expect(menu).toHaveCount(0);
  await expect.poll(() => rows[0].pinned).toBe(true);
  await page.getByRole("button", { name: "Message actions", exact: true }).first().click();
  await expect(menu.getByRole("button", { name: "Unpin", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Message actions", exact: true }).first()).toBeFocused();
  await page.getByRole("button", { name: "Message actions", exact: true }).first().click();
  await menu.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByRole("textbox", { name: "Note text" }).fill("Edited from actions");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() => rows[0].body).toBe("Edited from actions");
});

test("new arrivals preserve history scroll and provide a jump to the unread boundary", async ({ page, context }, info) => {
  const rows = history(28);
  await connect(context, rows); await open(page);
  await expect(page.getByText("Saved message 28", { exact: true })).toBeVisible();
  await expect(page.getByText("Saved message 28", { exact: true })).toBeInViewport();
  const scroller = page.locator('[data-virtuoso-scroller="true"]');
  await scroller.evaluate((element) => { element.scrollTop = 160; });
  await expect(page.getByRole("button", { name: "Latest", exact: true })).toBeVisible();
  const before = await scroller.evaluate((element) => element.scrollTop);
  rows.push({ ...rows[0], id: "55555555-5555-4555-8555-555555555551", body: "Just arrived one", created_at: "2026-09-14T08:28:00Z" }, { ...rows[0], id: "55555555-5555-4555-8555-555555555552", body: "Just arrived two", created_at: "2026-09-14T08:29:00Z" });
  const jump = page.getByRole("button", { name: "2 new messages", exact: true });
  await expect(jump).toBeVisible({ timeout: 10_000 });
  expect(Math.abs(await scroller.evaluate((element) => element.scrollTop) - before)).toBeLessThan(3);
  await page.screenshot({ path: info.outputPath("new-messages.png"), fullPage: true });
  await jump.click();
  await expect(page.getByRole("separator", { name: "New messages" })).toBeInViewport();
  await expect(page.getByText("Just arrived one", { exact: true })).toBeInViewport();
  await expect(jump).toHaveCount(0);
  await page.screenshot({ path: info.outputPath("new-boundary.png"), fullPage: true });
  rows.push({ ...rows[0], id: "55555555-5555-4555-8555-555555555553", body: "Follow while at bottom", created_at: "2026-09-14T08:30:00Z" });
  await expect(page.getByText("Follow while at bottom", { exact: true })).toBeInViewport({ timeout: 10_000 });
  await expect(page.getByRole("button", { name: /\d+ new messages/ })).toHaveCount(0);
});

test("glass adapts to dark mode and reduced effects", async ({ page, context }, info) => {
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await connect(context, history(3)); await open(page);
  await expect(page.getByText("Saved message 3", { exact: true })).toBeVisible();
  await expect(page.getByText("Saved message 3", { exact: true })).toBeInViewport();
  await expect(page.locator(".main-panel")).toHaveCSS("background-color", "rgb(23, 23, 23)");
  await expect(page.locator(".composer")).toHaveCSS("transition-duration", "0s");
  await expect(page.locator(".liquid-material canvas")).toHaveCount(0);
  await page.screenshot({ path: info.outputPath("dark.png"), fullPage: true });
  const session = await context.newCDPSession(page);
  await session.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-transparency", value: "reduce" }, { name: "prefers-contrast", value: "more" }] });
  await expect(page.locator(".composer")).toHaveCSS("backdrop-filter", "none");
  await expect(page.locator(".liquid-material")).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("liquid material renders once, responds to focus and settles without affecting input", async ({ page, context }, info) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  const rows = history(3);
  rows[0].body = "Flight details for Friday\nMeet at Terminal 2, 09:30.";
  rows[1].body = "https://example.com/itinerary";
  rows[2].body = "Keep the original spreadsheet too.";
  await connect(context, rows); await open(page);
  const material = page.locator(".liquid-material"), input = page.getByRole("textbox", { name: "Message", exact: true });
  await expect(material).toHaveAttribute("data-material", "ready");
  await expect(material.locator("canvas")).toHaveCount(1);
  const frame = () => material.evaluate(element => (element as import("@paper-design/shaders").PaperShaderElement).paperShaderMount!.getCurrentFrame());
  const initial = await frame();
  await page.waitForTimeout(200);
  expect(await frame()).toBe(initial);
  const pixels = await material.locator("canvas").evaluate(canvas => (canvas as HTMLCanvasElement).width * (canvas as HTMLCanvasElement).height);
  expect(pixels).toBeGreaterThan(0); expect(pixels).toBeLessThanOrEqual(181_000);
  await input.focus();
  await expect.poll(frame).toBeGreaterThan(initial);
  await input.fill("Send the final version when you arrive.");
  await page.waitForTimeout(1600);
  const settled = await frame();
  await input.pressSequentially(" Thanks.");
  await page.waitForTimeout(200);
  expect(await frame()).toBe(settled);
  await expect(page.getByRole("button", { name: "Send", exact: true })).toBeEnabled();
  await page.getByRole("textbox", { name: "Search" }).focus();
  await page.screenshot({ path: info.outputPath("pearl-light.png"), fullPage: true });
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(material).toHaveAttribute("data-material", "ready");
  await expect(page.locator(".main-panel")).toHaveCSS("background-color", "rgb(23, 23, 23)");
  await page.screenshot({ path: info.outputPath("pearl-dark.png"), fullPage: true });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(material.locator("canvas")).toHaveCount(0);
  await expect(input).toHaveValue("Send the final version when you arrive. Thanks.");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect.poll(() => rows.length).toBe(4);
  expect(errors).toEqual([]);
});

test("liquid material falls back after context loss and blocked GPU access", async ({ page, context }) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  const rows = history(1); await connect(context, rows); await open(page);
  const material = page.locator(".liquid-material");
  await expect(material).toHaveAttribute("data-material", "ready");
  await material.locator("canvas").evaluate(canvas => (canvas as HTMLCanvasElement).getContext("webgl2")!.getExtension("WEBGL_lose_context")!.loseContext());
  await expect(material).toHaveAttribute("data-material", "static");
  await expect(material.locator("canvas")).toHaveCount(0);
  await context.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...args: unknown[]) {
      return type.startsWith("webgl") ? null : Reflect.apply(getContext, this, [type, ...args]);
    } as typeof getContext;
  });
  const fallback = page.waitForEvent("console", { predicate: message => message.text().includes("Liquid material unavailable") });
  await page.reload(); await fallback;
  await expect(material).toHaveAttribute("data-material", "static");
  await expect(material.locator("canvas")).toHaveCount(0);
  await page.getByRole("textbox", { name: "Message", exact: true }).fill("Works without a GPU");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect.poll(() => rows.at(-1)?.body).toBe("Works without a GPU");
  expect(errors).toEqual([]);
});

test("drag target and transfer queue auto-send after upload", async ({ page, context }, info) => {
  const rows: Message[] = []; await connect(context, rows); await open(page);
  let release!: () => void;
  const prepared = new Promise<void>((resolve) => { release = resolve; });
  await context.route("**/api/drive/uploads", async (route) => {
    if (route.request().postDataJSON().action === "prepare") await prepared;
    await route.fallback();
  });
  const transfer = await page.evaluateHandle(() => {
    const data = new DataTransfer();
    data.items.add(new File(["A note for the other device."], "Travel.txt", { type: "text/plain" }));
    return data;
  });
  try {
    await page.locator(".app-shell").dispatchEvent("dragover", { dataTransfer: transfer });
    await expect(page.getByRole("heading", { name: "Drop files" })).toBeVisible();
    await expect(page.locator(".drop-overlay")).toHaveCSS("opacity", "1");
    await page.screenshot({ path: info.outputPath("drop.png"), fullPage: true });
    await page.locator(".app-shell").dispatchEvent("drop", { dataTransfer: transfer });
    await expect(page.getByRole("heading", { name: "Drop files" })).toHaveCount(0);
    const progress = page.getByRole("progressbar", { name: "Upload Travel.txt" });
    await expect(progress).toHaveAttribute("aria-valuenow", "0");
    const timeline = (await page.getByRole("region", { name: "Messages", exact: true }).boundingBox())!;
    const queue = (await page.getByRole("region", { name: "Transfers", exact: true }).boundingBox())!;
    expect(queue.y).toBeGreaterThanOrEqual(timeline.y + timeline.height);
    await expect(page.getByRole("button", { name: "Pause Travel.txt" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Send", exact: true })).toBeDisabled();
    expect(rows).toHaveLength(0);
    await expect(page.locator(".upload-list")).toHaveCSS("transform", "none");
    await page.screenshot({ path: info.outputPath("queue.png"), fullPage: true });
    release();
    await expect(page.getByRole("status", { name: "Sent", exact: true })).toBeVisible();
    await expect(progress).toHaveCount(0);
    expect(rows).toHaveLength(1); expect(rows[0].attachments[0].name).toBe("Travel.txt");
  } finally { release(); await transfer.dispose(); }
});

test("transfer dock separates drafts, folds accessibly and exposes failed transfers for retry", async ({ page, context }, info) => {
  const rows = history(1); await connect(context, rows);
  const first = "Reference.pdf", second = "Meeting-recording.m4a";
  const staged = "Flight-comparison-Singapore-to-London-September-2026.xlsx";
  const prepared: string[] = [];
  let releaseFirst!: () => void, releaseSecond!: () => void, failFirst = true;
  const firstGate = new Promise<void>(resolve => { releaseFirst = resolve; });
  const secondGate = new Promise<void>(resolve => { releaseSecond = resolve; });
  await context.route("**/api/drive/uploads", async route => {
    const input = route.request().postDataJSON();
    expect(input.action).toBe("prepare");
    prepared.push(input.name);
    if (input.name === first) {
      await firstGate;
      if (failFirst) { failFirst = false; return route.fulfill({ status: 503, json: { error: "Drive unavailable. Try again." } }); }
    }
    if (input.name === second) await secondGate;
    const attachment = { id: input.uploadId, name: input.name, size: input.size, mimeType: input.mimeType };
    await route.fulfill({ json: { fileId: attachment.id, folderId: "test-folder", attachment } });
  });
  try {
    await open(page);
    const input = page.getByRole("textbox", { name: "Message", exact: true });
    await input.fill("Compare these flights.\nKeep the original dates.");
    await page.locator('input[aria-label="Choose files"]').setInputFiles([
      { name: staged, mimeType: "application/octet-stream", buffer: Buffer.from("comparison") },
      { name: "Itinerary.txt", mimeType: "text/plain", buffer: Buffer.from("dates") },
    ]);
    const attachments = page.getByRole("region", { name: "Attachments", exact: true });
    await expect(attachments.getByText(staged, { exact: true })).toBeVisible();
    const fold = attachments.getByRole("button", { name: "Collapse attachments" });
    await fold.focus(); await page.keyboard.press("Enter");
    await expect(attachments.getByRole("button", { name: "Expand attachments" })).toHaveAttribute("aria-expanded", "false");
    await expect(attachments.getByRole("button", { name: `Remove ${staged}` })).toHaveCount(0);
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Attach files", exact: true })).toBeFocused();
    await attachments.getByRole("button", { name: "Expand attachments" }).click();
    expect(prepared).toHaveLength(0);

    const data = await page.evaluateHandle(({ first, second }) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File(["reference"], first, { type: "application/pdf" }));
      transfer.items.add(new File(["audio"], second, { type: "audio/mp4" }));
      return transfer;
    }, { first, second });
    try { await page.locator(".timeline").dispatchEvent("drop", { dataTransfer: data }); }
    finally { await data.dispose(); }
    const transfers = page.getByRole("region", { name: "Transfers", exact: true });
    await expect(transfers.getByRole("button", { name: `Pause ${second}` })).toBeVisible();
    await expect.poll(() => prepared.length).toBe(2);
    expect(prepared).not.toContain(staged);
    await expect(attachments.getByRole("img", { name: `Attached ${staged}` })).toBeVisible();
    expect(await page.evaluate(() => {
      const timeline = document.querySelector(".timeline")!.getBoundingClientRect();
      const dock = document.querySelector(".transfer-queue")!.getBoundingClientRect();
      return dock.top >= timeline.bottom;
    })).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    for (const button of await page.locator(".upload-actions button").all()) {
      const box = (await button.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(44); expect(box.height).toBeGreaterThanOrEqual(44);
    }
    await expect.poll(() => attachments.evaluate(element => element.getAnimations({ subtree: true }).filter(animation => animation.playState === "running").length)).toBe(0);
    await expect(page.getByText("Saved message 1", { exact: true })).toBeInViewport();
    await expect(page.getByRole("button", { name: "Send", exact: true })).toBeInViewport({ ratio: 1 });
    await page.screenshot({ path: info.outputPath("transfer-dock.png"), fullPage: true });
    await transfers.getByRole("button", { name: "Collapse transfers" }).click();
    releaseFirst();
    await expect(transfers.getByText("1 failed", { exact: true })).toBeVisible();
    await expect(transfers.getByRole("button", { name: "Expand transfers" })).toHaveAttribute("aria-expanded", "false");
    await transfers.getByRole("button", { name: "Expand transfers" }).click();
    await expect(transfers.getByText("Drive unavailable. Try again.")).toBeVisible();
    await page.emulateMedia({ colorScheme: "dark" });
    await expect.poll(() => transfers.evaluate(element => element.getAnimations({ subtree: true }).filter(animation => animation.playState === "running").length)).toBe(0);
    await page.screenshot({ path: info.outputPath("transfer-dock-dark.png"), fullPage: true });
    await input.fill("A longer message\n".repeat(12));
    await expect(page.getByRole("button", { name: "Send", exact: true })).toBeInViewport({ ratio: 1 });
    await input.fill("Compare these flights.\nKeep the original dates.");
    await transfers.getByRole("button", { name: `Retry ${first}` }).click();
    await expect.poll(() => rows.length).toBe(2);
    await expect(transfers.getByRole("button", { name: `Pause ${second}` })).toBeVisible();
    releaseSecond();
    await expect(transfers).toHaveCount(0);
    await expect.poll(() => rows.length).toBe(3);
    await expect(input).toHaveValue("Compare these flights.\nKeep the original dates.");
    expect(rows.slice(1).every(row => row.body === "" && row.attachments.length === 1)).toBe(true);
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect.poll(() => rows.length).toBe(4);
    expect(rows[3].attachments.map(file => file.name)).toEqual([staged, "Itinerary.txt"]);
    expect(rows[3].body).toBe("Compare these flights.\nKeep the original dates.");
    await expect(input).toHaveValue("");
    await expect(attachments).toHaveCount(0);
  } finally { releaseFirst(); releaseSecond(); }
});

test("opens image preview without leaving the conversation", async ({ page, context }, info) => {
  const rows = history(3);
  rows[0].body = "A little inspiration for the weekend.";
  rows[1].body = "Keep the original here.";
  rows[2].body = "";
  rows[2].attachments = [{ id: "preview-file", name: "Coast.png", mimeType: "image/png", size: 204800 }];
  const data = await page.evaluate(() => {
    const canvas = document.createElement("canvas"); canvas.width = 960; canvas.height = 600;
    const ctx = canvas.getContext("2d")!;
    const sky = ctx.createLinearGradient(0, 0, 0, 600); sky.addColorStop(0, "#b8c5e5"); sky.addColorStop(0.55, "#f4d2bf"); sky.addColorStop(1, "#789caf");
    ctx.fillStyle = sky; ctx.fillRect(0, 0, 960, 600);
    ctx.fillStyle = "#ffeade"; ctx.beginPath(); ctx.arc(630, 245, 48, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#7598ae"; ctx.beginPath(); ctx.moveTo(0, 370); ctx.bezierCurveTo(340, 380, 670, 340, 960, 355); ctx.lineTo(960, 600); ctx.lineTo(0, 600); ctx.fill();
    ctx.fillStyle = "#4c6b7d"; ctx.beginPath(); ctx.moveTo(0, 450); ctx.bezierCurveTo(420, 370, 620, 640, 960, 470); ctx.lineTo(960, 600); ctx.lineTo(0, 600); ctx.fill();
    return canvas.toDataURL("image/png").split(",")[1];
  });
  await connect(context, rows);
  await context.route("https://www.googleapis.com/drive/v3/files/preview-file**", (route) => route.fulfill({ contentType: "image/png", body: Buffer.from(data, "base64"), headers: { "access-control-allow-origin": "*" } }));
  await open(page);
  const preview = page.getByRole("button", { name: "Preview Coast.png" });
  await expect(preview).toBeVisible();
  await preview.scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath("glass-workspace.png"), fullPage: true });
  await preview.click();
  const dialog = page.getByRole("dialog", { name: "Preview Coast.png" });
  await expect(dialog).toHaveCSS("opacity", "1");
  await expect(dialog.getByRole("img", { name: "Coast.png" })).toBeVisible();
  await page.screenshot({ path: info.outputPath("preview.png"), fullPage: true });
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(preview).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
