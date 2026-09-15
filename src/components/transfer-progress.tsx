import { Check, FileText } from "lucide-react";
import type { UploadJob } from "@/lib/uploads";

export function TransferProgress({ job }: { job: UploadJob }) {
  const percent = job.state === "done" ? 100 : Math.min(99, Math.floor(job.size ? job.uploaded / job.size * 100 : 0));
  return <span className={`transfer-progress is-${job.state}`} role="progressbar" aria-label={`Upload ${job.name}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
    <svg viewBox="0 0 44 44" aria-hidden="true">
      <circle className="transfer-track" cx="22" cy="22" r="18" />
      <circle className="transfer-arc" cx="22" cy="22" r="18" pathLength="100" strokeDasharray="100" strokeDashoffset={100 - percent} />
    </svg>
    <span className="transfer-symbol" aria-hidden="true"><FileText className="transfer-file" /><Check className="transfer-check" /></span>
  </span>;
}
