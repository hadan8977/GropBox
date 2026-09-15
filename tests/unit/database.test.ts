import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Mutation, type Message } from "@/lib/model";

const user1 = "11111111-1111-4111-8111-111111111111", user2 = "22222222-2222-4222-8222-222222222222";
const db = new PGlite({ extensions: { pg_trgm } });
const mutation = (): Mutation => ({ id: crypto.randomUUID(), operationId: crypto.randomUUID(), expectedVersion: 0, kind: "message", format: "text", title: "", body: "中文搜索与跨设备同步", attachments: [], pinned: false, deleted: false });
async function save(m: Mutation, user = user1, hash = JSON.stringify(m)) {
  return (await db.query<{ message: Message }>("select public.save_message($1,$2::jsonb,$3,$4) as message", [user, JSON.stringify(m), String(m.body), hash])).rows[0].message;
}
beforeAll(async () => {
  await db.exec(`create schema auth; create schema extensions; create role anon; create role authenticated; create role service_role bypassrls;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth,public to authenticated,service_role; grant execute on function auth.uid() to authenticated;
    insert into auth.users values ('${user1}'),('${user2}');`);
  await db.exec(readFileSync(new URL("../../supabase/migrations/001_gropbox.sql", import.meta.url), "utf8"));
  await db.exec(`insert into public.app_accounts(user_id,google_sub) values ('${user1}','google-1'),('${user2}','google-2'); set role service_role;`);
}, 30_000);
afterAll(async () => { await db.close(); });

describe("migration, permission and transaction behavior on local PostgreSQL (PGlite)", () => {
  it("commits message and archive together, and deduplicates a lost-response retry", async () => {
    const m = mutation(); const first = await save(m); const second = await save(m);
    expect(second).toEqual(first); expect(first).toMatchObject({ id: m.id, version: 1, body: m.body, archive_version: 0 });
    const count = await db.query<{ count: number }>("select count(*)::int as count from archive_jobs where message_id=$1", [m.id]);
    expect(count.rows[0].count).toBe(1);
    await expect(save({ ...m, body: "different" })).rejects.toThrow("OPERATION_REUSED");
  });
  it("rejects stale concurrent edits and preserves the winning version", async () => {
    const m = mutation(); await save(m);
    const edits = ["设备一", "设备二"].map((body) => ({ ...m, operationId: crypto.randomUUID(), expectedVersion: 1, body }));
    const results = await Promise.allSettled(edits.map((m) => save(m)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    const rows = await db.query<{ version: number }>("select version from messages where id=$1", [m.id]); expect(rows.rows[0].version).toBe(2);
  });
  it("rejects attachment spoofing without creating a message", async () => {
    const m = { ...mutation(), attachments: [{ id: "someone-elses-file", name: "private.txt", size: 1, mimeType: "text/plain" }] };
    await expect(save(m)).rejects.toThrow("ATTACHMENT_NOT_READY");
    expect((await db.query("select * from messages where id=$1", [m.id])).rows).toEqual([]);
  });
  it("isolates users, denies direct writes and never exposes credential tables", async () => {
    const m = mutation(); await save(m);
    await expect(save({ ...m, operationId: crypto.randomUUID(), expectedVersion: 1 }, user2)).rejects.toThrow("VERSION_CONFLICT");
    await db.exec(`reset role; set role authenticated; set request.jwt.claim.sub = '${user2}';`);
    try {
      expect((await db.query("select * from messages where id=$1", [m.id])).rows).toEqual([]);
      await expect(db.query("select * from google_credentials")).rejects.toThrow("permission denied");
      await expect(db.query("delete from messages")).rejects.toThrow("permission denied");
      await expect(save(m)).rejects.toThrow("permission denied");
    } finally { await db.exec("reset role; set role service_role;"); }
  });
  it("uses one workspace reservation across concurrent initialization", async () => {
    const a = { root: "root-a" }, b = { root: "root-b" };
    const results = await Promise.all([a,b].map((value) => db.query<{ workspace: unknown }>("select reserve_workspace($1,$2) as workspace", [user1, value])));
    expect(results[0].rows[0].workspace).toEqual(results[1].rows[0].workspace);
  });
  it("archives only with the current lease and updates archived version atomically", async () => {
    const lease = crypto.randomUUID();
    const jobs = await db.query<{ user_id: string; operation_id: string; message_id: string; version: number }>("select * from claim_archives($1,$2)", [user1,lease]);
    expect(jobs.rows.length).toBeGreaterThan(0); const job = jobs.rows[0];
    await db.query("select finish_archive($1,$2,$3)", [user1, job.operation_id, crypto.randomUUID()]);
    expect((await db.query<{ done: boolean }>("select done from archive_jobs where operation_id=$1", [job.operation_id])).rows[0].done).toBe(false);
    await db.query("select finish_archive($1,$2,$3)", [user1, job.operation_id, lease]);
    expect((await db.query<{ archive_version: number }>("select archive_version from messages where id=$1", [job.message_id])).rows[0].archive_version).toBe(job.version);
  });
  it("finds Chinese substrings across history and persists deletion tombstones", async () => {
    const m = mutation(); await save(m);
    const results = await db.query("select id from messages where user_id=$1 and search_text ilike $2", [user1,"%搜索%"]);
    expect(results.rows).toContainEqual({ id: m.id });
    await save({ ...m, operationId: crypto.randomUUID(), expectedVersion: 1, deleted: true });
    expect((await db.query<{ deleted: boolean }>("select deleted from messages where id=$1", [m.id])).rows[0].deleted).toBe(true);
  });
});
