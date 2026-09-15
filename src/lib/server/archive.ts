import { DriveClient } from "@/lib/drive";
import { adminClient } from "./supabase";
import { googleAccess } from "./google";
import { workspaceFor } from "./workspace";

export async function archiveBatch(userId: string | null) {
  const admin = adminClient(), lease = crypto.randomUUID();
  const claimed = await admin.rpc("claim_archives", { p_user_id: userId, p_lease: lease });
  if (claimed.error) throw new Error("Couldn't start archive sync.");
  let completed = 0, failed = 0;
  const started = Date.now();
  for (const job of claimed.data ?? []) {
    if (Date.now() - started > 100_000) break; // Unprocessed leases become available again after expiry.
    try {
      let access = await googleAccess(job.user_id);
      const drive = new DriveClient(async (force) => { if (force) access = await googleAccess(job.user_id, true); return access.token; });
      const workspace = await workspaceFor(job.user_id, drive);
      let fileId = job.drive_file_id;
      if (!fileId) {
        fileId = await drive.generateId();
        const reserved = await admin.from("archive_jobs").update({ drive_file_id: fileId }).eq("user_id", job.user_id).eq("operation_id", job.operation_id).eq("lease_id", lease).select("drive_file_id").single();
        if (reserved.error) throw reserved.error;
      }
      await drive.writeArchive(fileId, job.snapshot.kind === "document" ? workspace.documents : workspace.history, job.operation_id, job.snapshot);
      const saved = await admin.rpc("finish_archive", { p_user_id: job.user_id, p_operation_id: job.operation_id, p_lease: lease });
      if (saved.error) throw saved.error;
      completed++;
    } catch {
      failed++;
      const saved = await admin.from("archive_jobs").update({ lease_id: null, lease_until: null,
        next_attempt_at: new Date(Date.now() + Math.min(3600_000, 30_000 * 2 ** Math.min(job.attempts, 7))).toISOString(),
      }).eq("user_id", job.user_id).eq("operation_id", job.operation_id).eq("lease_id", lease);
      if (saved.error) throw new Error("Couldn't save archive retry state.");
    }
  }
  return { completed, failed };
}
