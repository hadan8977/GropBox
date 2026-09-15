import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import type { Message, Mutation, Attachment } from "../../src/lib/model";

// All provider traffic is mocked here. These tests verify UI integration, not deployed OAuth/Drive.
const userId = "11111111-1111-4111-8111-111111111111";
const user = { id: userId, aud: "authenticated", role: "authenticated", email: "demo@example.com", app_metadata: { provider: "google" }, user_metadata: { name: "Alex" }, created_at: "2026-09-15T00:00:00Z" };
function sessionCookie() {
  const token = [ { alg: "HS256", typ: "JWT" }, { sub: userId, aud: "authenticated", role: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 } ].map((part) => Buffer.from(JSON.stringify(part)).toString("base64url")).join(".") + "." + Buffer.from("test-signature").toString("base64url");
  return `base64-${Buffer.from(JSON.stringify({ access_token: token, refresh_token: "test-session-refresh", token_type: "bearer", expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, user })).toString("base64url")}`;
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
test("preserves failed content and accepts a small file upload", async ({ page, context }) => {
  const rows: Message[] = []; await connect(context, rows, true); await open(page);
  await page.locator('input[aria-label="Choose files"]').setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello drive") });
  await expect(page.getByText("Ready", { exact: false })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("textbox", { name: "Message" }).fill("Keep these unsent changes."); await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("status", { name: "Not sent" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Messages" }).getByText("Keep these unsent changes.", { exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Message" })).toHaveValue(""); expect(rows).toHaveLength(0);
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
  await expect(page.locator(".main-panel")).toHaveCSS("background-color", "rgba(26, 33, 49, 0.92)");
  await expect(page.locator(".composer")).toHaveCSS("transition-duration", "0s");
  await page.screenshot({ path: info.outputPath("dark.png"), fullPage: true });
  const session = await context.newCDPSession(page);
  await session.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-transparency", value: "reduce" }, { name: "prefers-contrast", value: "more" }] });
  await expect(page.locator(".composer")).toHaveCSS("backdrop-filter", "none");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("drag target and floating queue follow real transfer state", async ({ page, context }, info) => {
  await connect(context, []); await open(page);
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
    await expect(page.locator(".upload-list")).toHaveCSS("position", "absolute");
    await expect(page.getByRole("button", { name: "Pause Travel.txt" })).toBeVisible();
    release();
    await expect(progress).toHaveAttribute("aria-valuenow", "100");
    await expect(page.locator(".transfer-check")).toHaveCSS("opacity", "1");
    await expect(page.locator(".upload-list")).toHaveCSS("transform", "none");
    const ring = (await progress.boundingBox())!, check = (await page.locator(".transfer-check").boundingBox())!;
    expect(Math.abs(check.y + check.height / 2 - ring.y - ring.height / 2)).toBeLessThan(1);
    await page.screenshot({ path: info.outputPath("queue.png"), fullPage: true });
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.getByRole("status", { name: "Sent", exact: true })).toBeVisible();
    await expect(progress).toHaveCount(0);
  } finally { release(); await transfer.dispose(); }
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
