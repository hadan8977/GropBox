"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Copy, Pin, Pencil, Trash2, Check, Cloud, AlertCircle, RotateCcw, FilePlus2, MoreHorizontal, X } from "lucide-react";
import { RichText } from "./rich-text";
import { Attachment } from "./attachment";
import { editMutation, plainText, type VisibleMessage, type Message } from "@/lib/model";
import type { SyncEngine } from "@/lib/sync";
import type { UploadManager } from "@/lib/uploads";
import { readableError } from "@/lib/api";
import { useDialog } from "./use-dialog";
import { GlideActions } from "./ui/glide-actions";
import { FeedbackButton } from "./ui/feedback-button";

export function MessageCard({ message: m, grouped, engine, uploads, onEdit, onError }: { message: VisibleMessage; grouped: boolean; engine: SyncEngine; uploads: UploadManager; onEdit: (message: Message) => void; onError: (message: string) => void }) {
  const [actionsOpen, setActionsOpen] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copying" | "copied">("idle");
  const text = plainText(m.body), canCopy = !m.deleted && text.trim().length > 0;
  useEffect(() => {
    if (copyState !== "copied") return;
    const timer = window.setTimeout(() => setCopyState("idle"), 1600);
    return () => window.clearTimeout(timer);
  }, [copyState]);
  const action = async (kind: "pin" | "delete" | "copy" | "retry" | "discard" | "saveAs") => {
    try {
      if (kind === "copy") {
        if (!canCopy || copyState === "copying") return;
        setCopyState("copying");
        await navigator.clipboard.writeText(text);
        setCopyState("copied");
        return;
      }
      if (kind === "delete" && !window.confirm("Delete this item? Drive files and archives stay.")) return;
      if (kind === "pin" || kind === "delete") { await engine.enqueue({ ...editMutation(m), pinned: kind === "pin" ? !m.pinned : m.pinned, deleted: kind === "delete" }); return; }
      const pending = await engine.pendingFor(m.id); if (!pending) return;
      if (kind === "retry") await engine.retry(pending.id);
      if (kind === "discard" && window.confirm("Discard local changes? The saved version stays.")) await engine.discard(pending.id);
      if (kind === "saveAs") { await engine.enqueue({ ...pending.mutation, operationId: crypto.randomUUID(), id: crypto.randomUUID(), expectedVersion: 0, deleted: false }); await engine.discard(pending.id); }
    } catch (error) {
      if (kind === "copy") { setCopyState("idle"); onError("Could not copy. Select the text to copy manually."); }
      else onError(readableError(error));
    }
  };
  return <article className={`message-row ${m.error ? "message-failed" : ""}`} aria-label={m.kind === "document" ? `Note ${m.title}` : "Message"}>
    <div className="message-line">
    <button className="message-more icon-button" aria-label="Message actions" title="Message actions" aria-haspopup="dialog" aria-expanded={actionsOpen} onClick={() => setActionsOpen(true)}><MoreHorizontal size={18} /></button>
    {canCopy && <FeedbackButton className="message-copy icon-button" label="Copy text" successLabel="Copied"
      state={copyState === "copying" ? "pending" : copyState === "copied" ? "success" : "idle"}
      icon={<Copy size={18} />} successIcon={<Check size={18} />} onClick={() => void action("copy")} />}
    <div className={`message-bubble ${grouped ? "message-continuation" : ""}`}>
      {m.title && <button className="message-title" onClick={() => onEdit(m)} disabled={m.pending}>{m.kind === "document" && <FilePlus2 size={17} />}{m.title}</button>}
      {m.deleted ? <p>Deleting…</p> : <RichText body={m.body} />}
      {m.attachments.map((file) => <Attachment key={file.id} file={file} drive={uploads.drive} onError={onError} />)}
    <span className="message-indicators">{m.pinned && <Pin size={12} aria-label="Pinned" />}<span className={`delivery ${m.error ? "danger-text" : ""}`}
      role="status" aria-label={m.error ? "Not sent" : m.pending ? "Pending" : "Sent"}
      title={m.error ? "Not sent" : m.pending ? "Pending" : m.archive_version >= m.version ? "Archived" : "Sent · Archive pending"}>
      {m.error ? <AlertCircle size={12} /> : m.pending ? <RotateCcw size={12} className="spin" /> : m.archive_version >= m.version ? <Cloud size={12} /> : <Check size={12} />}
    </span></span>
    </div></div>
    <span className="sr-only" role="status">{copyState === "copied" ? "Copied" : ""}</span>
    {m.error && <div className="pending-error"><p>{m.error}</p><button onClick={() => void action("retry")}>Retry</button><button onClick={() => void action("saveAs")}>Save as new</button><button onClick={() => void action("discard")}>Discard</button></div>}
    {actionsOpen && <MessageActions message={m} canCopy={canCopy} onClose={() => setActionsOpen(false)} onAction={(kind) => { setActionsOpen(false); if (kind === "edit") onEdit(m); else void action(kind); }} />}
  </article>;
}

function MessageActions({ message, canCopy, onClose, onAction }: { message: VisibleMessage; canCopy: boolean; onClose: () => void; onAction: (kind: "copy" | "pin" | "edit" | "delete") => void }) {
  const panel = useRef<HTMLElement>(null);
  useDialog(panel, onClose);
  return createPortal(<div className="modal-backdrop" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={panel} className="settings-panel message-menu" role="dialog" aria-modal="true" aria-label="Message actions">
      <header><time dateTime={message.created_at}>{new Date(message.created_at).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" })}</time><button className="icon-button" aria-label="Close actions" onClick={onClose}><X size={20} /></button></header>
      <GlideActions className="settings-actions">
        {canCopy && <button onClick={() => onAction("copy")}><Copy size={18} />Copy</button>}
        {!message.pending && <>
          <button onClick={() => onAction("pin")}><Pin size={18} />{message.pinned ? "Unpin" : "Pin"}</button>
          <button onClick={() => onAction("edit")}><Pencil size={18} />Edit</button>
          <button className="danger-text" onClick={() => onAction("delete")}><Trash2 size={18} />Delete</button>
        </>}
      </GlideActions>
    </section>
  </div>, document.body);
}
