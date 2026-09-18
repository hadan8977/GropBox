"use client";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { ArrowUp, ArrowDown, FilePlus2, FileText, FolderOpen, Inbox, LoaderCircle, Paperclip, Pin, RefreshCw, Search, UploadCloud, WifiOff, X, Pause, Play, Settings2 } from "lucide-react";
import { browserClient } from "@/lib/supabase/browser";
import { DriveCache, loadAccountHint, saveAccountHint, ACCOUNT_HINT_KEY, type AccountHint } from "@/lib/cache";
import { SyncEngine } from "@/lib/sync";
import { UploadManager, filesFromDrop } from "@/lib/uploads";
import { api, readableError } from "@/lib/api";
import { formatBytes, plainText, type Message, type Mutation, type VisibleMessage } from "@/lib/model";
import { Editor } from "./editor";
import { DocumentPanel } from "./document-panel";
import { MessageCard } from "./message-card";
import { useDialog } from "./use-dialog";
import { useMessageActivity } from "./use-message-activity";
import { startsTimeGroup } from "@/lib/timeline";
import { TransferProgress } from "./transfer-progress";

async function login(reconnect = false) {
  const data = await api<{ url: string }>(`/api/auth/login${reconnect ? "?reconnect=1" : ""}`);
  window.location.assign(data.url);
}
function Brand() { return <div className="brand"><img src="/icon.svg" alt="" /><span>GropBox</span></div>; }

type TimelineContext = { showSearch: boolean; hasMore: boolean; busy: boolean; online: boolean; count: number; engine: SyncEngine };
function HistoryHeader({ context }: { context?: TimelineContext }) {
  return <div className="history-header">{context && (!context.showSearch && context.hasMore
    ? <button disabled={context.busy} onClick={() => void context.engine.loadMore()}>Load earlier</button>
    : context.showSearch ? <span role="status">{context.count} {context.count === 1 ? "result" : "results"}{!context.online ? " · Cached" : context.count === 100 ? " · First 100" : ""}</span> : null)}</div>;
}
// Stable component identities preserve Virtuoso measurements during sync updates.
const timelineComponents = { Header: HistoryHeader };

export function App({ configured }: { configured: boolean }) {
  useEffect(() => {
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) void navigator.serviceWorker.register("/sw.js").catch(() => { console.warn("Offline fallback unavailable."); });
  }, []);
  return configured ? <AuthGate /> : <Welcome configured={false} />;
}
function Welcome({ configured, error }: { configured: boolean; error?: string }) {
  const [busy, setBusy] = useState(false), [localError, setLocalError] = useState("");
  const start = async () => { setBusy(true); try { await login(error === "consent"); } catch (e) { setLocalError(readableError(e)); setBusy(false); } };
  const errors: Record<string, string> = {
    login: "Sign-in failed. Try again.",
    account: "This account isn't allowed.",
    database: "Database setup required.",
    consent: "Reconnect Google to allow Drive access.",
    unavailable: "Can't reach sign-in. Try again.",
  };
  return <main className="welcome">
    <section className="login-panel">
      <img className="login-mark" src="/icon.svg" alt="" />
      <h1>GropBox</h1>
      {configured
        ? <button className="primary login-button" onClick={() => void start()} disabled={busy}>
            {busy && <LoaderCircle className="spin" size={18} />}Continue with Google
          </button>
        : <div className="setup-card"><h2>Setup required</h2><p>Configure Google and Supabase.<br />See README.md.</p></div>}
      {(localError || (error && errors[error])) && <p className="inline-error" role="alert">{localError || errors[error!]}</p>}
    </section>
  </main>;
}
function AuthGate() {
  const [client] = useState(browserClient);
  const [user, setUser] = useState<AccountHint | null>(), [error, setError] = useState<string>();
  const [sessionAccount, setSessionAccount] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    let disposed = false;
    const cached = loadAccountHint();
    if (cached) setUser(cached);
    const failed = () => { if (!disposed) { setUnavailable(true); setError("unavailable"); setUser(current => current === undefined ? null : current); } };
    const timeout = setTimeout(failed, 8000);
    const accept = (account: AccountHint | null) => {
      if (disposed) return;
      clearTimeout(timeout); saveAccountHint(account); setSessionAccount(account?.id ?? null); setUser(account); setUnavailable(false);
    };
    const { data } = client.auth.onAuthStateChange((event, session) => {
      if (session?.user) accept(session.user);
      else if (event === "SIGNED_OUT") accept(null);
    });
    void client.auth.getSession().then(({ data, error }) => { if (error) failed(); else accept(data.session?.user ?? null); }).catch(failed);
    const changed = (event: StorageEvent) => { if (event.key === ACCOUNT_HINT_KEY && !event.newValue && !disposed) setUser(null); };
    window.addEventListener("storage", changed);
    setError(new URLSearchParams(window.location.search).get("auth_error") ?? undefined);
    return () => { disposed = true; clearTimeout(timeout); data.subscription.unsubscribe(); window.removeEventListener("storage", changed); };
  }, [client]);
  if (user === undefined) return <div className="loading-page"><Brand /><LoaderCircle className="spin" /><p>Loading…</p></div>;
  if (!user) return <Welcome configured error={error} />;
  return <Workspace key={user.id} user={user} sessionAccount={sessionAccount} authUnavailable={unavailable} />;
}

function Workspace({ user, sessionAccount, authUnavailable }: { user: AccountHint; sessionAccount: string | null; authUnavailable: boolean }) {
  const [resources] = useState(() => {
    const db = new DriveCache(user.id), engine = new SyncEngine(db, browserClient(), user.id);
    const uploads = new UploadManager(db, async (job) => {
      if (!job.attachment) throw new Error("Upload is not complete.");
      await engine.enqueue({ operationId: job.id, id: job.id, expectedVersion: 0, kind: "message", format: "text", title: "", body: "", attachments: [job.attachment], pinned: false, deleted: false }, { uploadIds: [job.id] });
    });
    return { db, engine, uploads };
  });
  const { db, engine, uploads } = resources;
  const sync = useSyncExternalStore(engine.subscribe, engine.getSnapshot, engine.getSnapshot);
  const jobs = useSyncExternalStore(uploads.subscribe, uploads.getSnapshot, uploads.getSnapshot);
  const [body, setBody] = useState(""), [draftReady, setDraftReady] = useState(false);
  const [sending, setSending] = useState(false), [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "files" | "documents" | "pinned">("all");
  const [results, setResults] = useState<Message[]>([]), [searching, setSearching] = useState(false);
  const [error, setError] = useState(""), [documentState, setDocumentState] = useState<{ message?: Message }>();
  const [settings, setSettings] = useState(false), [dragging, setDragging] = useState<"send" | "attach" | false>(false);
  const showSearch = Boolean(query.trim()) || filter !== "all";
  const activity = useMessageActivity(engine, !showSearch && !settings && !documentState);
  const fileInput = useRef<HTMLInputElement>(null), resumeInput = useRef<HTMLInputElement>(null), resumeId = useRef<string>("");
  const list = useRef<VirtuosoHandle>(null), searchGeneration = useRef(0), sendLock = useRef(false);
  const onError = useCallback((value: string) => setError(value), []);
  const onEdit = useCallback((message: Message) => setDocumentState({ message }), []);
  useEffect(() => { engine.setSessionAccount(sessionAccount); }, [engine, sessionAccount]);
  useEffect(() => {
    let disposed = false;
    void engine.start().catch((e) => onError(`Unable to load local data: ${readableError(e)}`));
    void Promise.all([db.drafts.get("composer"), uploads.restore()]).then(([draft]) => {
      if (disposed) return;
      if (draft) setBody(plainText(draft.body));
      const params = new URLSearchParams(window.location.search);
      const shared = [params.get("share_title"), params.get("share_text"), params.get("share_url")].filter(Boolean).join("\n");
      if (shared) {
        setBody([draft ? plainText(draft.body) : "", shared.slice(0, 100_000)].filter(Boolean).join("\n"));
        window.history.replaceState(null, "", "/");
      }
      setDraftReady(true);
    }).catch((e) => onError(`Unable to load local data: ${readableError(e)}`));
    return () => { disposed = true; engine.stop(); uploads.stop(); };
  }, [db, engine, uploads, onError]);
  useEffect(() => {
    if (!draftReady || sending) return;
    void db.drafts.put({ id: "composer", body, attachments: [] }).catch((e) => onError(readableError(e)));
  }, [body, db, draftReady, sending, onError]);
  useEffect(() => {
    if (!query.trim() && filter === "all") return;
    const generation = ++searchGeneration.current;
    const timer = setTimeout(() => {
      setSearching(true);
      void engine.search(query.trim(), filter).then((rows) => { if (generation === searchGeneration.current) setResults(rows); }).catch((e) => onError(readableError(e))).finally(() => { if (generation === searchGeneration.current) setSearching(false); });
    }, 250);
    return () => { clearTimeout(timer); searchGeneration.current++; };
  }, [query, filter, engine, sync.syncedAt, onError]);
  const addFiles = useCallback((files: File[], sendOnComplete = false) => {
    if (sessionAccount !== user.id) { onError("Waiting for sign-in. Try again shortly."); return; }
    if (!sendOnComplete && sendLock.current) { onError("Wait for this message to finish sending."); return; }
    void uploads.add(files, sendOnComplete).catch((e) => onError(readableError(e)));
  }, [uploads, onError, sessionAccount, user.id]);
  const send = useCallback(async () => {
    if (!draftReady || sendLock.current) return;
    const uploadIds = jobs.filter((job) => !job.sendOnComplete).map((job) => job.id);
    if (!plainText(body).trim() && !uploadIds.length) return;
    sendLock.current = true; setSending(true);
    try {
      const attachments = await uploads.uploadForMessage(uploadIds);
      const mutation: Mutation = { operationId: crypto.randomUUID(), id: crypto.randomUUID(), expectedVersion: 0, kind: "message", format: "text", title: "", body, attachments: attachments.flatMap((j) => j.attachment ? [j.attachment] : []), pinned: false, deleted: false };
      if (!await engine.enqueue(mutation, { draftId: "composer", uploadIds })) throw new Error("Attachments changed in another tab. Reload and try again.");
      uploads.consumeDone();
      setBody(""); setQuery(""); setFilter("all");
      setTimeout(() => list.current?.scrollToIndex({ index: "LAST", behavior: "auto" }), 100);
    } catch (e) { onError(readableError(e)); }
    finally { sendLock.current = false; setSending(false); }
  }, [body, jobs, draftReady, engine, db, uploads, onError]);
  const logout = async () => {
    if (!window.confirm("Sign out and clear local drafts and uploads? Saved messages and Drive files stay.")) return;
    try { await api("/api/auth/logout"); engine.stop(); uploads.stop(); saveAccountHint(null); await db.delete(); window.location.reload(); }
    catch (e) { onError(readableError(e)); }
  };
  const messages: VisibleMessage[] = useMemo(() => showSearch ? [...results].reverse() : sync.messages, [showSearch, results, sync.messages]);
  const status = !sync.online ? "Offline" : sync.error ? "Sync failed" : sync.realtime ? "Live" : "Polling";
  const title = { all: "All", files: "Files", documents: "Notes", pinned: "Pinned" }[filter];
  const filters = [
    { id: "all", name: "All", icon: Inbox },
    { id: "files", name: "Files", icon: FolderOpen },
    { id: "documents", name: "Notes", icon: FileText },
    { id: "pinned", name: "Pinned", icon: Pin },
  ] as const;
  return <div className="app-shell"
    onDragOver={(e) => { if (Array.from(e.dataTransfer.types).includes("Files")) { e.preventDefault(); setDragging("send"); } }}
    onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false); }}
    onDrop={(e) => {
      if (!Array.from(e.dataTransfer.types).includes("Files")) return;
      e.preventDefault(); setDragging(false);
      void filesFromDrop(e.dataTransfer, 30 - jobs.length).then((files) => addFiles(files, true)).catch((e) => onError(readableError(e)));
    }}>
    <aside className="sidebar">
      <Brand />
      <nav aria-label="Library" style={{ "--selection": filters.findIndex((item) => item.id === filter) } as CSSProperties}>
        {filters.map(({ id, name, icon: Icon }) =>
          <button key={id} className={filter === id ? "nav-active" : ""} aria-pressed={filter === id}
            onClick={() => { setFilter(id); setQuery(""); }}><Icon size={20} />{name}</button>)}
      </nav>
      <button className="account" title="Settings" aria-label="Settings" onClick={() => setSettings(true)}>
        <span className="avatar">{(user.email ?? "G")[0].toUpperCase()}</span><span>{user.email}</span><Settings2 size={18} />
      </button>
    </aside>
    <main className="main-panel">
      <header className="topbar">
        <h1 className="desktop-title">{title}</h1><div className="mobile-brand"><Brand /></div>
        <div className="topbar-actions">
          <button className="icon-button" aria-label="Refresh" title={status} onClick={() => void engine.sync()}>
            <RefreshCw size={20} className={sync.busy ? "spin" : ""} />
          </button>
          <button className="icon-button" aria-label="New note" title="New note" onClick={() => setDocumentState({})}><FilePlus2 size={20} /></button>
          <button className="icon-button mobile-settings" aria-label="Settings" onClick={() => setSettings(true)}><Settings2 size={20} /></button>
        </div>
      </header>
      <div className="searchbar">
        <Search size={18} /><input aria-label="Search" placeholder="Search" maxLength={100} value={query} onChange={(e) => setQuery(e.target.value)} />
        {query && <button className="icon-button" aria-label="Clear search" onClick={() => setQuery("")}><X size={17} /></button>}
      </div>
      <nav className="mobile-filters" aria-label="Library" style={{ "--selection": filters.findIndex((item) => item.id === filter) } as CSSProperties}>
        {filters.map(({ id, name }) => <button key={id} className={filter === id ? "active" : ""} aria-pressed={filter === id}
          onClick={() => { setFilter(id); setQuery(""); }}>{name}</button>)}
      </nav>
      {(error || sync.error || sync.archiveError) && <div className="notice" role="alert">
        <span>{error || sync.error || sync.archiveError}</span>
        {error && <button className="icon-button" aria-label="Dismiss" onClick={() => setError("")}><X size={17} /></button>}
      </div>}
      {!sync.online && <div className="offline-banner" role="status"><WifiOff size={15} />Offline</div>}
      {sync.online && authUnavailable && <div className="notice" role="status"><span>Sign-in unavailable. Showing cached items.</span><button onClick={() => window.location.reload()}>Retry</button></div>}
      <section className="timeline" aria-label="Messages">
        {!sync.ready || searching ? <div className="timeline-empty" role="status" aria-label={searching ? "Searching" : "Loading"}><LoaderCircle className="spin" size={24} /></div>
          : !messages.length ? <div className="timeline-empty"><Inbox size={42} /><p>{showSearch ? "No results" : "No items"}</p></div>
          : <Virtuoso<VisibleMessage, TimelineContext> ref={list} data={messages} alignToBottom computeItemKey={(_index, message) => message.id}
              initialTopMostItemIndex={{ index: messages.length - 1, align: "end" }}
              followOutput={(isAtBottom) => isAtBottom ? "auto" : false} atBottomStateChange={activity.bottomChanged} atBottomThreshold={32} increaseViewportBy={300}
              components={timelineComponents} context={{ showSearch, hasMore: sync.hasMore, busy: sync.busy, online: sync.online, count: messages.length, engine }}
              itemContent={(index, message) => {
                const groupStart = startsTimeGroup(message, messages[index - 1]);
                const newMessages = !showSearch && message.id === activity.divider;
                return <>
                  {groupStart && <div className="time-divider"><time dateTime={message.created_at}>{new Date(message.created_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</time></div>}
                  {newMessages && <div className="new-divider" role="separator" aria-label="New messages"><span>New messages</span></div>}
                  <MessageCard message={message} grouped={!groupStart && !newMessages} engine={engine} uploads={uploads} onEdit={onEdit} onError={onError} />
                </>;
              }} />}
        {messages.length > 0 && (!activity.atBottom || (!showSearch && activity.unread.length > 0)) && <button className={`jump-latest icon-button ${!showSearch && activity.unread.length ? "has-new" : ""}`}
          aria-label={!showSearch && activity.unread.length ? `${activity.unread.length} new messages` : "Latest"}
          title={!showSearch && activity.unread.length ? "New messages" : "Latest"}
          onClick={() => {
            const firstNew = !showSearch ? messages.findIndex((message) => message.id === activity.unread[0]) : -1;
            list.current?.scrollToIndex({ index: firstNew >= 0 ? firstNew : "LAST", align: firstNew >= 0 ? "start" : "end", behavior: "auto" });
            if (activity.atBottom) activity.readLatest();
          }}><ArrowDown size={18} />{!showSearch && activity.unread.length > 0 && <span>{activity.unread.length} new</span>}</button>}
      </section>
      <div className="composer-zone" data-dragging={dragging === "attach" || undefined}
        onDragOver={(e) => {
          if (!Array.from(e.dataTransfer.types).includes("Files")) return;
          e.preventDefault(); e.stopPropagation(); setDragging("attach");
        }}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false); }}
        onDrop={(e) => {
          if (!Array.from(e.dataTransfer.types).includes("Files")) return;
          e.preventDefault(); e.stopPropagation(); setDragging(false);
          void filesFromDrop(e.dataTransfer, 30 - jobs.length).then((files) => addFiles(files)).catch((e) => onError(readableError(e)));
        }}>
        {jobs.length > 0 && <div className="upload-list" aria-label="Uploads">
          {jobs.map((job) => <div key={job.id} className="upload-job">
            <TransferProgress job={job} />
            <div><strong>{job.name}</strong><span>{formatBytes(job.size)} · {job.error ?? ({
              staged: "Attached", queued: "Queued", uploading: `${Math.floor(job.size ? job.uploaded / job.size * 100 : 0)}%`,
              paused: "Paused", failed: "Failed", done: "Ready",
            }[job.state])}</span>
            </div>
            {job.state === "uploading"
              ? <button className="icon-button" aria-label={`Pause ${job.name}`} onClick={() => uploads.pause(job.id)}><Pause size={18} /></button>
              : ["failed", "paused"].includes(job.state)
                ? <button className="icon-button" aria-label={`Resume ${job.name}`} disabled={sessionAccount !== user.id} onClick={() => {
                    if (uploads.hasFile(job.id)) void uploads.resume(job.id).catch((e) => onError(readableError(e)));
                    else { resumeId.current = job.id; resumeInput.current?.click(); }
                  }}><Play size={18} /></button>
                : ["done", "staged"].includes(job.state) ? null : <LoaderCircle size={18} className="spin" />}
            <button className="icon-button" aria-label={`Remove ${job.name}`} onClick={() => void uploads.remove(job.id).catch((e) => onError(readableError(e)))}><X size={18} /></button>
          </div>)}
        </div>}
        <div className="composer">
          <button className="icon-button attach-button" onClick={() => fileInput.current?.click()} disabled={!draftReady || sending} aria-label="Attach files" title="Attach files"><Paperclip size={22} /></button>
          <Editor value={body} onChange={setBody} onSend={() => void send()} onFiles={addFiles} disabled={!draftReady || sending} />
          <button className="send-button" aria-label="Send" title="Send" onClick={() => void send()}
            disabled={!draftReady || sending || (!body.trim() && !jobs.some((job) => !job.sendOnComplete))}>
            {sending ? <LoaderCircle size={22} className="spin" /> : <ArrowUp size={24} />}
          </button>
        </div>
      </div>
      {dragging === "send" && <div className="drop-overlay"><div className="drop-orbit"><UploadCloud size={52} /></div><h2>Drop files</h2></div>}
    </main>
    <input ref={fileInput} type="file" multiple hidden aria-label="Choose files" onChange={(e) => { addFiles(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
    <input ref={resumeInput} type="file" hidden aria-label="Resume file" onChange={(e) => {
      const file = e.target.files?.[0]; if (file) void uploads.resume(resumeId.current, file).catch((err) => onError(readableError(err))); e.target.value = "";
    }} />
    {documentState && <DocumentPanel key={documentState.message?.id ?? "new"} message={documentState.message} engine={engine} onClose={() => setDocumentState(undefined)} onError={onError} />}
    {settings && <SettingsPanel email={user.email ?? ""} onClose={() => setSettings(false)} onReconnect={() => void login(true).catch((e) => onError(readableError(e)))} onArchive={() => void engine.archive()} onLogout={() => void logout()} />}
  </div>;
}

function SettingsPanel({ email, onClose, onReconnect, onArchive, onLogout }: {
  email: string; onClose: () => void; onReconnect: () => void; onArchive: () => void; onLogout: () => void;
}) {
  const panel = useRef<HTMLElement>(null);
  useDialog(panel, onClose);
  return <div className="modal-backdrop"><section ref={panel} className="settings-panel" role="dialog" aria-modal="true" aria-label="Settings">
    <header><h2>Settings</h2><button className="icon-button" aria-label="Close settings" onClick={onClose}><X size={20} /></button></header>
    <dl className="settings-list">
      <div><dt>Account</dt><dd>{email}</dd></div>
      <div><dt>Messages</dt><dd>Supabase</dd></div>
      <div><dt>Files &amp; archives</dt><dd>Google Drive</dd></div>
    </dl>
    <div className="settings-actions">
      <button onClick={onReconnect}>Reconnect Google</button>
      <button onClick={onArchive}>Sync archives</button>
      <button className="danger-text" onClick={onLogout}>Sign out</button>
    </div>
  </section></div>;
}
