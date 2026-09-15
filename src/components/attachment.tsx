"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Download, FileText, ImageIcon, Share2, LoaderCircle, X } from "lucide-react";
import { type Attachment as FileAttachment, canPreviewImage, formatBytes } from "@/lib/model";
import { boundedBlob, type DriveClient } from "@/lib/drive";
import { readableError } from "@/lib/api";
import { useDialog } from "./use-dialog";

type SaveWindow = Window & { showSaveFilePicker?: (options: { suggestedName: string }) => Promise<{ createWritable: () => Promise<WritableStream> }> };
export function Attachment({ file, drive, onError }: { file: FileAttachment; drive: DriveClient; onError: (message: string) => void }) {
  const [preview, setPreview] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
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
    setBusy(true);
    try {
      const picker = (window as SaveWindow).showSaveFilePicker;
      if (picker) {
        const handle = await picker({ suggestedName: file.name });
        const response = await drive.download(file.id);
        if (!response.body) throw new Error("Couldn't read file.");
        await response.body.pipeTo(await handle.createWritable());
      } else if (file.size > 30 * 1024 * 1024) {
        window.open(`https://drive.google.com/file/d/${encodeURIComponent(file.id)}/view`, "_blank", "noopener,noreferrer");
      } else {
        const response = await drive.download(file.id), url = URL.createObjectURL(await boundedBlob(response, 30 * 1024 * 1024, file.mimeType));
        const anchor = document.createElement("a"); anchor.href = url; anchor.download = file.name; anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      }
    } catch (error) { if (!(error instanceof Error && error.name === "AbortError")) onError(readableError(error)); }
    finally { setBusy(false); }
  };
  const share = async () => {
    setBusy(true);
    try {
      const response = await drive.download(file.id);
      const files = [new File([await boundedBlob(response, 20 * 1024 * 1024, file.mimeType)], file.name, { type: file.mimeType })];
      if (!navigator.canShare?.({ files })) throw new Error("Sharing unavailable. Download the file instead.");
      await navigator.share({ files });
    } catch (error) { if (!(error instanceof Error && error.name === "AbortError")) onError(readableError(error)); }
    finally { setBusy(false); }
  };
  return <div className="attachment">
    {preview && <button className="image-preview" aria-label={`Preview ${file.name}`} aria-haspopup="dialog" onClick={() => setExpanded(true)}><img src={preview} alt={file.name} /></button>}
    <div className="attachment-details"><span className="file-icon">{canPreviewImage(file.mimeType) ? <ImageIcon size={22} /> : <FileText size={22} />}</span>
      <div className="file-name"><strong title={file.name}>{file.name}</strong><span>{formatBytes(file.size)}</span></div>
      {typeof navigator !== "undefined" && !!navigator.share && file.size <= 20 * 1024 * 1024 && <button className="icon-button" onClick={() => void share()} disabled={busy} aria-label={`Share ${file.name}`}><Share2 size={16} /></button>}
      <button className="icon-button" onClick={() => void download()} disabled={busy} aria-label={`Download ${file.name}`}>{busy ? <LoaderCircle className="spin" size={17} /> : <Download size={17} />}</button>
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
