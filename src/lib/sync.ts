import type { SupabaseClient, RealtimeChannel } from "@supabase/supabase-js";
import { DriveCache, type PendingRecord } from "./cache";
import { PAGE_SIZE, mergeMessages, mutationSchema, type Mutation, type Message, type VisibleMessage } from "./model";
import { api, readableError, RequestError } from "./api";

const COLUMNS = "id,user_id,kind,format,title,body,attachments,pinned,deleted,version,archive_version,created_at,updated_at";
const META_COLUMNS = "id,user_id,version,archive_version,deleted,created_at,updated_at";
type MessageMeta = Pick<Message, "id" | "user_id" | "version" | "archive_version" | "deleted" | "created_at" | "updated_at">;
export type SyncState = { messages: VisibleMessage[]; ready: boolean; busy: boolean; realtime: boolean; online: boolean; hasMore: boolean; error?: string; syncedAt?: string; archiveError?: string };
export function escapeLike(value: string) { return value.replace(/[\\%_]/g, (char) => `\\${char}`); }

export class SyncEngine {
  private state: SyncState = { messages: [], ready: false, busy: false, realtime: false, online: true, hasMore: true };
  private listeners = new Set<() => void>();
  private channel?: RealtimeChannel;
  private timer?: ReturnType<typeof setInterval>;
  private syncPromise?: Promise<void>;
  private flushPromise?: Promise<void>;
  private archivePromise?: Promise<void>;
  private archiveNext = 0;
  private dirty = false;
  private stopped = false;
  private generation = 0;
  private oldest?: MessageMeta;
  private loaded = new Set<string>();
  private sessionAccount: string | null = null;
  constructor(public db: DriveCache, private client: SupabaseClient, private userId: string) {}
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.state;
  setSessionAccount(account: string | null) {
    this.sessionAccount = account;
    if (account === this.userId && this.state.ready) this.connect();
  }
  private patch(update: Partial<SyncState>) { if (this.stopped) return; this.state = { ...this.state, ...update }; this.listeners.forEach((fn) => fn()); }
  private wake = () => { this.patch({ online: navigator.onLine }); if (!document.hidden && navigator.onLine) void this.sync(); };

  async start() {
    this.stopped = false;
    const generation = ++this.generation;
    this.patch({ online: navigator.onLine });
    const recent = await this.db.messages.orderBy("created_at").reverse().limit(PAGE_SIZE).toArray();
    recent.forEach((m) => this.loaded.add(m.id));
    await this.reload();
    if (this.stopped || generation !== this.generation) return;
    this.connect();
  }
  private connect() {
    if (this.stopped || this.channel || this.sessionAccount !== this.userId) return;
    this.channel = this.client.channel(`messages:${this.userId}`).on("postgres_changes", { event: "*", schema: "public", table: "messages", filter: `user_id=eq.${this.userId}`, select: ["id", "version", "archive_version", "deleted"] }, () => {
      // Re-query, rather than treating change payloads as a durable or complete source of truth.
      void this.sync();
    }).subscribe((status) => { this.patch({ realtime: status === "SUBSCRIBED" }); if (status === "SUBSCRIBED") void this.sync(); });
    window.addEventListener("online", this.wake); window.addEventListener("offline", this.wake); document.addEventListener("visibilitychange", this.wake);
    this.timer = setInterval(() => {
      if (!this.syncPromise && !document.hidden && navigator.onLine && (!this.state.realtime || !this.state.syncedAt || Date.now() - Date.parse(this.state.syncedAt) > 30_000)) void this.sync();
    }, 4000);
    void this.sync();
  }
  stop() {
    this.stopped = true; this.generation++; clearInterval(this.timer);
    window.removeEventListener("online", this.wake); window.removeEventListener("offline", this.wake); document.removeEventListener("visibilitychange", this.wake);
    if (this.channel) void this.client.removeChannel(this.channel);
    this.channel = undefined;
  }
  private async reload() {
    if (this.stopped) return;
    const messages = (await this.db.messages.bulkGet([...this.loaded])).filter((m): m is Message => Boolean(m));
    const pending = await this.db.pending.toArray();
    this.patch({ messages: mergeMessages(messages, pending, this.userId), ready: true });
  }
  private async accept(messages: Message[]) {
    if (this.stopped) return;
    await this.db.transaction("rw", this.db.messages, async () => {
      for (const message of messages) {
        const current = await this.db.messages.get(message.id);
        if (!current || message.version > current.version || (message.version === current.version && message.archive_version > current.archive_version)) await this.db.messages.put(message);
      }
    });
    messages.forEach((m) => this.loaded.add(m.id));
  }
  private async acceptHeaders(headers: (Message | MessageMeta)[]) {
    if (this.stopped) return;
    const missing: string[] = [], reused: Message[] = [];
    const cached = await this.db.messages.bulkGet(headers.map((m) => m.id));
    for (let i = 0; i < headers.length; i++) {
      const header = headers[i], previous = cached[i];
      if ("body" in header) reused.push(header);
      else if (previous && previous.version === header.version) reused.push({ ...previous, ...header });
      else missing.push(header.id);
    }
    await this.accept(reused);
    for (let i = 0; i < missing.length; i += 100) {
      const result = await this.client.from("messages").select(COLUMNS).in("id", missing.slice(i, i + 100));
      if (result.error) throw new Error("Some messages couldn't load. Retry.");
      await this.accept(result.data as Message[]);
    }
  }
  sync(): Promise<void> {
    if (this.stopped || this.sessionAccount !== this.userId) return Promise.resolve();
    if (this.syncPromise) { this.dirty = true; return this.syncPromise; }
    this.syncPromise = this.runSync().finally(() => { this.syncPromise = undefined; if (this.dirty && !this.stopped) { this.dirty = false; void this.sync(); } });
    return this.syncPromise;
  }
  private async runSync() {
    this.patch({ busy: true, online: navigator.onLine });
    try {
      if (!navigator.onLine) return;
      // Message RLS already enforces account ownership and active status.
      const result = await this.client.from("messages").select(this.loaded.size ? META_COLUMNS : COLUMNS).eq("user_id", this.userId).eq("deleted", false).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(PAGE_SIZE).overrideTypes<(Message | MessageMeta)[], { merge: false }>();
      if (result.error) throw new Error("Sync failed. Check your connection or Supabase project.");
      const recent = result.data as (Message | MessageMeta)[];
      if (!this.oldest && recent.length) this.oldest = recent.at(-1);
      if (!this.oldest) this.patch({ hasMore: false });
      await this.acceptHeaders(recent);
      await this.reload();
      // Refresh loaded rows including tombstones and edits, not only the latest page.
      const recentIds = new Set(recent.map((m) => m.id));
      const ids = [...this.loaded].filter((id) => !recentIds.has(id));
      for (let i = 0; i < ids.length; i += 100) {
        const check = await this.client.from("messages").select(META_COLUMNS).in("id", ids.slice(i, i + 100));
        if (check.error) throw new Error("History update failed. Retry.");
        await this.acceptHeaders(check.data as MessageMeta[]);
      }
      await this.reload();
      this.patch({ error: undefined, syncedAt: new Date().toISOString() });
      // A slow queued write must not delay displaying incoming messages.
      void this.flush();
      if (Date.now() >= this.archiveNext) void this.archive();
    } catch (error) { this.patch({ error: readableError(error) }); }
    finally { this.patch({ busy: false }); }
  }
  async loadMore() {
    if (!this.oldest || this.state.busy || this.sessionAccount !== this.userId) return;
    this.patch({ busy: true });
    try {
      const { created_at, id } = this.oldest;
      const result = await this.client.from("messages").select(COLUMNS).eq("user_id", this.userId).eq("deleted", false)
        .or(`created_at.lt.${created_at},and(created_at.eq.${created_at},id.lt.${id})`).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(PAGE_SIZE);
      if (result.error) throw new Error("Couldn't load history. Retry.");
      const messages = result.data as Message[];
      if (messages.length) this.oldest = messages.at(-1);
      await this.accept(messages); await this.reload(); this.patch({ hasMore: messages.length === PAGE_SIZE, error: undefined });
    } catch (error) { this.patch({ error: readableError(error) }); }
    finally { this.patch({ busy: false }); }
  }
  async search(text: string, filter: "all" | "files" | "documents" | "pinned" = "all"): Promise<Message[]> {
    if (!navigator.onLine || this.sessionAccount !== this.userId) return (await this.db.messages.toArray()).filter((m) => !m.deleted && (filter !== "files" || m.attachments.length > 0) && (filter !== "documents" || m.kind === "document") && (filter !== "pinned" || m.pinned) && JSON.stringify([m.title, m.body, m.attachments]).toLowerCase().includes(text.toLowerCase())).slice(0, 100);
    let query = this.client.from("messages").select(COLUMNS).eq("deleted", false).ilike("search_text", `%${escapeLike(text.slice(0, 100))}%`);
    if (filter === "files") query = query.neq("attachments", "[]");
    if (filter === "documents") query = query.eq("kind", "document");
    if (filter === "pinned") query = query.eq("pinned", true);
    const result = await query.order("created_at", { ascending: false }).limit(100).abortSignal(AbortSignal.timeout(10_000));
    if (result.error) throw new Error("Search failed. Shorten your query or retry.");
    return result.data as Message[];
  }
  async enqueue(mutation: Mutation, consume: { draftId?: string; uploadIds?: string[] } = {}) {
    const valid = mutationSchema.parse(mutation);
    const queued = await this.db.transaction("rw", this.db.pending, this.db.drafts, this.db.uploads, async () => {
      // Claim completed uploads in the same transaction as the outbox write.
      // Another tab may already have sent them while this tab was restoring.
      if (consume.uploadIds?.length && (await this.db.uploads.bulkGet(consume.uploadIds)).some((job) => !job)) return false;
      if ((await this.db.pending.toArray()).some((p) => p.mutation.id === valid.id)) throw new Error("Resolve pending changes first.");
      await this.db.pending.put({ id: valid.operationId, mutation: valid, createdAt: new Date().toISOString() });
      if (consume.draftId) await this.db.drafts.delete(consume.draftId);
      if (consume.uploadIds?.length) await this.db.uploads.bulkDelete(consume.uploadIds);
      return true;
    });
    await this.reload(); void this.flush();
    return queued;
  }
  async discard(id: string) { await this.db.pending.where("id").equals(id).delete(); await this.reload(); }
  async retry(id: string) { await this.db.pending.update(id, { error: undefined, blocked: false }); void this.flush(); }
  flush(): Promise<void> {
    if (this.flushPromise) return this.flushPromise;
    const run = async () => {
      while (!this.stopped && this.sessionAccount === this.userId && navigator.onLine) {
        const item = (await this.db.pending.toArray()).find((p) => !p.blocked);
        if (!item) break;
        try {
          const message = await api<Message>("/api/messages", item.mutation);
          if (this.stopped) return;
          await this.accept([message]); await this.db.pending.delete(item.id); await this.reload();
          this.archiveNext = 0;
        } catch (error) {
          if (this.stopped) return;
          await this.db.pending.update(item.id, { error: readableError(error), blocked: error instanceof RequestError && [400, 403, 409, 413].includes(error.status) });
          await this.reload(); break;
        }
      }
    };
    const locked = async () => { if (navigator.locks) await navigator.locks.request(`paseo-send:${this.userId}`, run); else await run(); };
    this.flushPromise = locked().catch((error) => this.patch({ error: readableError(error) })).finally(() => { this.flushPromise = undefined; if (!this.stopped && this.sessionAccount === this.userId && navigator.onLine && this.archiveNext === 0) void this.archive(); });
    return this.flushPromise;
  }
  async pendingFor(messageId: string): Promise<PendingRecord | undefined> { return (await this.db.pending.toArray()).find((p) => p.mutation.id === messageId); }
  archive(): Promise<void> {
    if (this.stopped || this.sessionAccount !== this.userId || !navigator.onLine) return Promise.resolve();
    if (this.archivePromise) return this.archivePromise;
    this.archiveNext = Date.now() + 30_000;
    this.archivePromise = api<{ completed: number; failed: number }>("/api/archive", {}, 310_000).then((result) => {
      this.patch({ archiveError: result.failed ? "Archive delayed. Messages are saved." : undefined });
    }).catch(() => this.patch({ archiveError: "Archive delayed. Will retry." })).finally(() => { this.archivePromise = undefined; });
    return this.archivePromise;
  }
}
