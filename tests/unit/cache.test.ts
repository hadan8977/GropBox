import "fake-indexeddb/auto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DriveCache } from "@/lib/cache";
import { SyncEngine } from "@/lib/sync";
import type { Mutation } from "@/lib/model";

let db: DriveCache;
beforeEach(() => { db = new DriveCache(crypto.randomUUID()); vi.stubGlobal("navigator", { onLine: false }); });
afterEach(async () => { await db.delete(); vi.unstubAllGlobals(); });
const mutation = (): Mutation => ({ id: crypto.randomUUID(), operationId: crypto.randomUUID(), expectedVersion: 0, kind: "message", format: "text", body: "Offline draft", title: "", pinned: false, deleted: false, attachments: [] });

describe("local outbox transaction", () => {
  it.each([null, "another-account"])("does not send a cached outbox for an unconfirmed or different session: %s", async account => {
    vi.stubGlobal("navigator", { onLine: true });
    const request = vi.fn(); vi.stubGlobal("fetch", request);
    const engine = new SyncEngine(db, {} as SupabaseClient, "user");
    engine.setSessionAccount(account);
    const m = mutation();
    await engine.enqueue(m); await engine.flush(); await engine.sync(); await engine.archive();
    expect(request).not.toHaveBeenCalled();
    expect((await db.pending.get(m.operationId))?.mutation).toEqual(m);
  });
  it("consumes a draft only in the same transaction as durable enqueue", async () => {
    const m = mutation(); await db.drafts.put({ id: "composer", body: m.body, attachments: [] });
    const engine = new SyncEngine(db, {} as SupabaseClient, "user");
    await engine.enqueue(m, { draftId: "composer" });
    expect((await db.pending.get(m.operationId))?.mutation).toEqual(m);
    expect(await db.drafts.get("composer")).toBeUndefined();
    expect(engine.getSnapshot().messages[0]).toMatchObject({ body: m.body, pending: true });
  });
  it("preserves a draft on invalid input and rejects two queued edits of one message", async () => {
    const m = mutation(); await db.drafts.put({ id: "composer", body: "keep me", attachments: [] });
    const engine = new SyncEngine(db, {} as SupabaseClient, "user");
    await expect(engine.enqueue({ ...m, expectedVersion: -1 }, { draftId: "composer" })).rejects.toThrow();
    expect((await db.drafts.get("composer"))?.body).toBe("keep me");
    const results = await Promise.allSettled([m, { ...m, operationId: crypto.randomUUID() }].map((record) => engine.enqueue(record)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    expect(await db.pending.count()).toBe(1);
  });
});
