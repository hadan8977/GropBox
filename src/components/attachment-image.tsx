"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ImageOff, LoaderCircle, RotateCcw, X } from "lucide-react";
import { boundedBlob, type DriveClient } from "@/lib/drive";
import { canPreviewImage, type Attachment } from "@/lib/model";
import { imagePreviewMime } from "@/lib/file-types";
import { attachmentThumbnail, forgetThumbnail } from "@/lib/thumbnails";
import { useDialog } from "./use-dialog";

export function AttachmentImage({ file, drive }: { file: Attachment; drive: DriveClient }) {
  const container = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(false);
  const [preview, setPreview] = useState<string>();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const { id, name, mimeType, size } = file;
  useEffect(() => {
    if (!container.current || active) return;
    if (typeof IntersectionObserver === "undefined") { setActive(true); return; }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setActive(true); observer.disconnect(); }
    }, { rootMargin: "160px" });
    observer.observe(container.current);
    return () => observer.disconnect();
  }, [active]);
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]);
    let objectUrl: string | undefined;
    setPreview(undefined); setFailed(false);
    void attachmentThumbnail({ id, name, mimeType, size }, drive, signal).then(blob => {
      if (controller.signal.aborted) return;
      if (!blob) { setFailed(true); return; }
      objectUrl = URL.createObjectURL(blob); setPreview(objectUrl);
    }).catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [active, attempt, id, name, mimeType, size, drive]);
  return <div ref={container} className="attachment-image">
    <button className="image-preview" aria-label={`${failed ? "Retry preview" : "Preview"} ${name}`}
      aria-haspopup={preview ? "dialog" : undefined} aria-busy={!preview && !failed} disabled={!preview && !failed}
      onClick={() => preview ? setExpanded(true) : setAttempt(value => value + 1)}>
      {preview ? <img src={preview} alt={name} decoding="async" onError={() => { forgetThumbnail(drive, id); setPreview(undefined); setFailed(true); }} />
        : failed ? <span className="preview-placeholder"><ImageOff size={24} aria-hidden="true" /><span>Preview unavailable</span><span><RotateCcw size={13} aria-hidden="true" />Retry</span></span>
        : <span className="preview-placeholder" role="status" aria-label="Loading preview"><LoaderCircle className="spin" size={20} aria-hidden="true" /></span>}
    </button>
    {expanded && preview && <ImagePreview file={file} drive={drive} thumbnail={preview} onClose={() => setExpanded(false)} />}
  </div>;
}

function ImagePreview({ file, drive, thumbnail, onClose }: { file: Attachment; drive: DriveClient; thumbnail: string; onClose: () => void }) {
  const panel = useRef<HTMLElement>(null);
  const [original, setOriginal] = useState<string>();
  const [loading, setLoading] = useState(false);
  const mime = imagePreviewMime(file);
  useDialog(panel, onClose);
  useEffect(() => {
    if (!canPreviewImage(mime) || file.size > 12 * 1024 * 1024) return;
    const controller = new AbortController(); let objectUrl: string | undefined;
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]);
    setLoading(true);
    void drive.download(file.id, signal).then(response => boundedBlob(response, 12 * 1024 * 1024, mime)).then(blob => {
      if (!controller.signal.aborted) { objectUrl = URL.createObjectURL(blob); setOriginal(objectUrl); }
    }).catch(() => { if (!controller.signal.aborted) setOriginal(undefined); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [file.id, file.size, mime, drive]);
  return createPortal(<div className="modal-backdrop" onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={panel} className="document-panel image-panel" role="dialog" aria-modal="true" aria-label={`Preview ${file.name}`}>
      <header><h2>{file.name}</h2><span className="image-quality" role="status">{!original && (loading ? "Loading original…" : "Thumbnail")}</span><button className="icon-button" onClick={onClose} aria-label="Close preview"><X size={20} /></button></header>
      <div className="image-canvas"><img src={original ?? thumbnail} alt={file.name} onError={() => setOriginal(undefined)} /></div>
    </section>
  </div>, document.body);
}
