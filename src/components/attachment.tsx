"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Download, FileText, ImageIcon, Share2, LoaderCircle, X } from "lucide-react";
import { type Attachment as FileAttachment, canPreviewImage, formatBytes } from "@/lib/model";
import { boundedBlob, type DriveClient } from "@/lib/drive";
import { readableError } from "@/lib/api";
import { useDialog } from "./use-dialog";

export function Attachment({ file, drive, onError }: { file: FileAttachment; drive: DriveClient; onError: (message: string) => void }) {
  const [preview, setPreview] = useState<string>();
  const [busy, setBusy] = useState<"download" | "share">();
  const [shareFile, setShareFile] = useState<File>();
  const [expanded, setExpanded] = useState(false);
  const action = useRef<AbortController>(null);
  useEffect(() => () => action.current?.abort(), []);
  const shareSupported = typeof navigator !== "undefined" && typeof navigator.share === "function" && file.size <= 20 * 1024 * 1024 && navigator.canShare?.({ files: [new File([], file.name, { type: file.mimeType })] });
  useEffect(() => {
    if (!canPreviewImage(file.mimeType) || file.size > 12 * 1024 * 1024) return;
    const controller = new AbortController(); let objectUrl: string | undefined;
    void drive.download(file.id, controller.signal).then(async (response) => {
      const blob = await boundedBlob(response, 12 * 1024 * 1024, file.mimeType);
      if (!controller.signal.aborted) { objectUrl = URL.createObjectURL(new Blob([blob], { type: file.mimeType })); setPreview(objectUrl); }
    }).catch((error) => { if (!controller.signal.aborted) onError(readableError(error)); });
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [file.id, file.mimeType, file.size, drive, onError]);
  const download = async () => {
    if (busy) return;
    setBusy("download");
    const controller = new AbortController(); action.current = controller;
    try {
      const url = await drive.downloadLink(file.id);
      controller.signal.throwIfAborted();
      // Let Drive's attachment response enter the browser download manager.
      // No file picker, in-memory blob, server proxy, or token in the URL.
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = file.name; anchor.referrerPolicy = "no-referrer";
      document.body.append(anchor); anchor.click(); anchor.remove();
    } catch (error) { if (!(error instanceof Error && error.name === "AbortError")) onError(readableError(error)); }
    finally { setBusy(undefined); }
  };
  const share = async () => {
    if (busy) return;
    setBusy("share");
    const controller = new AbortController(); action.current = controller;
    try {
      const prepared = shareFile ?? new File([await boundedBlob(await drive.download(file.id, controller.signal), 20 * 1024 * 1024, file.mimeType)], file.name, { type: file.mimeType });
      controller.signal.throwIfAborted();
      const files = [prepared];
      if (!navigator.canShare?.({ files })) throw new Error("Sharing unavailable. Download the file instead.");
      // A slow fetch can outlive the gesture. Keep the file for a fresh tap,
      // rather than repeatedly downloading and failing to open the share sheet.
      if (navigator.userActivation && !navigator.userActivation.isActive) { setShareFile(prepared); return; }
      try { await navigator.share({ files }); setShareFile(undefined); }
      catch (error) {
        if (error instanceof Error && error.name === "NotAllowedError" && !shareFile) setShareFile(prepared);
        else if (error instanceof Error && error.name === "NotAllowedError") throw new Error("Sharing blocked. Download the file instead.");
        else throw error;
      }
    } catch (error) {
      setShareFile(undefined);
      if (!(error instanceof Error && error.name === "AbortError")) onError(readableError(error));
    } finally { setBusy(undefined); }
  };
  return <div className="attachment">
    {preview && <button className="image-preview" aria-label={`Preview ${file.name}`} aria-haspopup="dialog" onClick={() => setExpanded(true)}><img src={preview} alt={file.name} /></button>}
    <div className="attachment-details"><span className="file-icon">{canPreviewImage(file.mimeType) ? <ImageIcon size={22} /> : <FileText size={22} />}</span>
      <div className="file-name"><strong title={file.name}>{file.name}</strong><span role={shareFile ? "status" : undefined}>{shareFile ? "Tap Share to continue" : formatBytes(file.size)}</span></div>
      {shareSupported && <button className="icon-button" onClick={() => void share()} disabled={!!busy} aria-label={`Share ${file.name}`} aria-busy={busy === "share"}>{busy === "share" ? <LoaderCircle className="spin" size={17} /> : shareFile ? "Share" : <Share2 size={16} />}</button>}
      <button className="icon-button" onClick={() => void download()} disabled={!!busy} aria-label={`Download ${file.name}`} aria-busy={busy === "download"}>{busy === "download" ? <LoaderCircle className="spin" size={17} /> : <Download size={17} />}</button>
    </div>
    {expanded && preview && <ImagePreview src={preview} name={file.name} onClose={() => setExpanded(false)} />}
  </div>;
}

function ImagePreview({ src, name, onClose }: { src: string; name: string; onClose: () => void }) {
  const panel = useRef<HTMLElement>(null);
  useDialog(panel, onClose);
  return createPortal(<div className="modal-backdrop" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={panel} className="document-panel image-panel" role="dialog" aria-modal="true" aria-label={`Preview ${name}`}>
      <header><h2>{name}</h2><button className="icon-button" onClick={onClose} aria-label="Close preview"><X size={20} /></button></header>
      <div className="image-canvas"><img src={src} alt={name} /></div>
    </section>
  </div>, document.body);
}
