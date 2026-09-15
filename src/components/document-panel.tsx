"use client";
import { useEffect, useRef, useState } from "react";
import { X, Download } from "lucide-react";
import { useDialog } from "./use-dialog";
import { editMutation, plainText, type Message, type Mutation } from "@/lib/model";
import type { SyncEngine } from "@/lib/sync";
import { readableError } from "@/lib/api";

export function DocumentPanel({ message, engine, onClose, onError }: { message?: Message; engine: SyncEngine; onClose: () => void; onError: (message: string) => void }) {
  const panel = useRef<HTMLElement>(null);
  useDialog(panel, onClose);
  const draftId = `document:${message?.id ?? "new"}`;
  const [body, setBody] = useState(plainText(message?.body ?? ""));
  const [title, setTitle] = useState(message?.title ?? "");
  const [format, setFormat] = useState<"text" | "markdown">(message?.format === "markdown" ? "markdown" : "text");
  const [ready, setReady] = useState(false), [saving, setSaving] = useState(false);
  const isNote = !message || message.kind === "document";
  useEffect(() => {
    let disposed = false;
    void engine.db.drafts.get(draftId).then((draft) => {
      if (disposed) return;
      if (draft) {
        setBody(plainText(draft.body)); setTitle(draft.title ?? "");
        setFormat(draft.format === "markdown" ? "markdown" : "text");
      }
      setReady(true);
    }).catch((error) => onError(readableError(error)));
    return () => { disposed = true; };
  }, [draftId, engine, onError]);
  useEffect(() => {
    if (!ready || saving) return;
    void engine.db.drafts.put({ id: draftId, body, title, format, attachments: message?.attachments ?? [] }).catch((error) => onError(readableError(error)));
  }, [body, title, format, draftId, ready, saving, engine, message, onError]);
  const save = async () => {
    if (!ready || saving) return;
    setSaving(true);
    try {
      const mutation: Mutation = message ? editMutation(message) : {
        operationId: crypto.randomUUID(), id: crypto.randomUUID(), expectedVersion: 0, kind: "document",
        title: "", format, body, pinned: false, deleted: false, attachments: [],
      };
      await engine.enqueue({ ...mutation, body, title: isNote ? title.trim() || "Untitled" : title, format }, { draftId });
      onClose();
    } catch (error) { onError(readableError(error)); setSaving(false); }
  };
  const exportText = () => {
    const url = URL.createObjectURL(new Blob([body], { type: "text/plain;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(title || "Untitled").replace(/[<>:"/\\|?*]/g, "_")}.${format === "markdown" ? "md" : "txt"}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  };
  return <div className="modal-backdrop"><section ref={panel} className="document-panel" role="dialog" aria-modal="true" aria-label="Note"
    onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === "s") { event.preventDefault(); void save(); } }}>
    <header><h2>{message ? "Edit" : "New note"}</h2><button className="icon-button" onClick={onClose} aria-label="Close note"><X size={20} /></button></header>
    {isNote && <input className="document-title" aria-label="Title" placeholder="Untitled" maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} disabled={!ready} />}
    <textarea className="plain-editor" aria-label="Note text" placeholder="Text" value={body} onChange={(e) => setBody(e.target.value)} disabled={!ready} />
    <footer><button className="icon-button" title="Download" aria-label="Download note" onClick={() => { try { exportText(); } catch (e) { onError(readableError(e)); } }}><Download size={20} /></button>
      <button className="primary" onClick={() => void save()} disabled={!ready || saving}>{saving ? "Saving…" : "Save"}</button></footer>
  </section></div>;
}
