import { DriveClient, type Workspace } from "@/lib/drive";
import { ROOT_NAME } from "@/lib/model";
import { adminClient, ApiError } from "./supabase";

export async function workspaceFor(userId: string, drive: DriveClient): Promise<Workspace> {
  const admin = adminClient();
  const { data: account, error } = await admin.from("app_accounts").select("workspace").eq("user_id", userId).eq("active", true).single();
  if (error || !account) throw new ApiError(403, "Account unavailable.");
  let workspace: Workspace = account.workspace;
  if (!workspace) {
    const [root, history, documents, assets] = await Promise.all(Array.from({ length: 4 }, () => drive.generateId()));
    const result = await admin.rpc("reserve_workspace", { p_user_id: userId, p_workspace: { root, history, documents, assets } });
    if (result.error || !result.data) throw new ApiError(503, "Couldn't save Drive folder details.");
    workspace = result.data;
  }
  await drive.ensureFolder(workspace.root, ROOT_NAME, "root");
  await Promise.all([
    drive.ensureFolder(workspace.history, "History", "history", workspace.root),
    drive.ensureFolder(workspace.documents, "Notes", "documents", workspace.root),
    drive.ensureFolder(workspace.assets, "Files", "assets", workspace.root),
  ]);
  return workspace;
}

export async function monthFolder(userId: string, workspace: Workspace, drive: DriveClient) {
  const admin = adminClient(); const month = new Date().toISOString().slice(0, 7);
  let result = await admin.from("drive_folders").select("file_id").eq("user_id", userId).eq("month", month).maybeSingle();
  if (result.error) throw new ApiError(503, "Couldn't load monthly folder.");
  if (!result.data) {
    const created = await admin.from("drive_folders").upsert({ user_id: userId, month, file_id: await drive.generateId() }, { onConflict: "user_id,month", ignoreDuplicates: true });
    if (created.error) throw new ApiError(503, "Couldn't save monthly folder.");
    result = await admin.from("drive_folders").select("file_id").eq("user_id", userId).eq("month", month).single();
  }
  if (result.error || !result.data) throw new ApiError(503, "Monthly folder not ready.");
  return drive.ensureFolder(result.data.file_id, month, "month", workspace.assets);
}
