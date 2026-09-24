import { Check, CircleAlert, Pause } from "lucide-react";
import type { UploadJob } from "@/lib/uploads";
import { FileTypeIcon } from "./file-type-icon";

export function TransferProgress({ job, percent }: { job: UploadJob; percent: number }) {
  const staged = job.state === "staged";
  return <span className={`transfer-progress is-${job.state}`} role={staged ? "img" : "progressbar"} aria-label={`${staged ? "Attached" : "Upload"} ${job.name}`} aria-valuemin={staged ? undefined : 0} aria-valuemax={staged ? undefined : 100} aria-valuenow={staged ? undefined : percent} aria-valuetext={staged ? undefined : job.state === "failed" ? "Failed" : job.state === "paused" ? `Paused at ${percent}%` : job.state === "done" ? "Ready" : `${percent}%`}>
    <svg viewBox="0 0 44 44" aria-hidden="true">
      <circle className="transfer-track" cx="22" cy="22" r="18" />
      <circle className="transfer-arc" cx="22" cy="22" r="18" pathLength="100" strokeDasharray="100" strokeDashoffset={100 - percent} />
    </svg>
    <span className="transfer-symbol" aria-hidden="true">{job.state === "failed" ? <CircleAlert /> : job.state === "paused" ? <Pause /> : <FileTypeIcon file={job} compact />}<Check className="transfer-check" /></span>
  </span>;
}
