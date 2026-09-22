"use client";
import { useId, useState } from "react";
import { ChevronDown, Files, Pause, Play, RotateCcw, X } from "lucide-react";
import { formatBytes } from "@/lib/model";
import type { UploadJob } from "@/lib/uploads";
import { TransferProgress } from "./transfer-progress";

export function TransferQueue({ jobs, attached = false, canResume, onPause, onResume, onRemove }: {
  jobs: UploadJob[]; attached?: boolean; canResume: boolean;
  onPause: (id: string) => void; onResume: (id: string) => void; onRemove: (id: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const detailsId = useId();
  if (!jobs.length) return null;
  const expanded = jobs.length === 1 || !collapsed;
  const failed = jobs.filter(job => job.state === "failed").length;
  const paused = jobs.filter(job => job.state === "paused").length;
  const active = jobs.some(job => job.state === "uploading" || job.state === "queued");
  const size = jobs.reduce((total, job) => total + job.size, 0);
  const uploaded = jobs.reduce((total, job) => total + Math.min(job.uploaded, job.size), 0);
  const summary = failed ? `${failed} failed` : paused ? `${paused} paused`
    : active ? `${Math.min(99, Math.floor(size ? uploaded / size * 100 : 0))}%`
    : jobs.every(job => job.state === "done") ? "Ready" : formatBytes(size);
  return <section className={`upload-list ${attached ? "composer-attachments" : "transfer-queue"}`} aria-label={attached ? "Attachments" : "Transfers"} data-expanded={expanded}>
    {jobs.length > 1 && <button className="transfer-summary" aria-label={`${expanded ? "Collapse" : "Expand"} ${attached ? "attachments" : "transfers"}`} aria-expanded={expanded} aria-controls={detailsId} onClick={() => setCollapsed(expanded)}>
      <Files size={18} aria-hidden="true" />
      <strong>{jobs.length} {attached ? "files" : "transfers"}</strong>
      <span className={failed ? "danger-text" : ""}>{summary}</span>
      <ChevronDown className="queue-chevron" size={16} aria-hidden="true" />
    </button>}
    <div className="transfer-details" id={detailsId} aria-hidden={!expanded} inert={!expanded}>
      <div className="transfer-scroll">
        {jobs.map(job => {
          const percent = job.state === "done" ? 100 : Math.min(99, Math.floor(job.size ? job.uploaded / job.size * 100 : 0));
          const status = { staged: "", queued: "Queued", uploading: job.attachment ? "Sending…" : `${percent}%`, paused: "Paused", failed: "Failed", done: "Ready" }[job.state];
          return <div key={job.id} className="upload-job" data-state={job.state}>
            <TransferProgress job={job} percent={percent} />
            <div className="upload-description">
              <strong title={job.name}>{job.name}</strong>
              <span>{formatBytes(job.size)}{status && <> · <span className={job.state === "failed" ? "danger-text" : ""}>{status}</span></>}</span>
              {job.error && <p className="upload-error">{job.error}</p>}
            </div>
            <div className="upload-actions">
              {job.state === "uploading" ? <button className="icon-button" aria-label={`Pause ${job.name}`} title="Pause" onClick={() => onPause(job.id)}><Pause size={17} /></button>
                : (job.state === "failed" || job.state === "paused") && <button className="icon-button" aria-label={`${job.state === "failed" ? "Retry" : "Resume"} ${job.name}`} title={job.state === "failed" ? "Retry" : "Resume"} disabled={!canResume} onClick={() => onResume(job.id)}>
                  {job.state === "failed" ? <RotateCcw size={17} /> : <Play size={17} />}
                </button>}
              <button className="icon-button" aria-label={`Remove ${job.name}`} title="Remove" onClick={() => onRemove(job.id)}><X size={17} /></button>
            </div>
          </div>;
        })}
      </div>
    </div>
  </section>;
}
