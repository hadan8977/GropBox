import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { DriveClient, asAttachment } from "@/lib/drive";
import { APP_ID } from "@/lib/model";
import { googleAccess } from "@/lib/server/google";
import { monthFolder, workspaceFor } from "@/lib/server/workspace";
import { authenticated, adminClient, ApiError, apiError, boundedJson } from "@/lib/server/supabase";

const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("prepare"), uploadId: z.string().uuid(), name: z.string().min(1).max(1024), size: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), mimeType: z.string().min(1).max(200) }),
  z.object({ action: z.literal("complete"), uploadId: z.string().uuid() }),
]);
export const maxDuration = 120;
export async function POST(request: NextRequest) {
  try {
    const context = await authenticated(request);
    const parsed = input.safeParse(await boundedJson(request));
    if (!parsed.success) throw new ApiError(400, "Invalid file details.");
    const data = parsed.data, userId = context.user.id, admin = adminClient();
    let token = await googleAccess(userId);
    const drive = new DriveClient(async (force) => { if (force) token = await googleAccess(userId, true); return token.token; });
    let result = await admin.from("attachments").select("file_id,metadata,ready").eq("user_id", userId).eq("upload_id", data.uploadId).maybeSingle();
    if (result.error) throw new ApiError(503, "Couldn't load upload.");
    if (data.action === "prepare") {
      const workspace = await workspaceFor(userId, drive);
      const folderId = await monthFolder(userId, workspace, drive);
      if (!result.data) {
        const fileId = await drive.generateId();
        const save = await admin.from("attachments").upsert({ user_id: userId, upload_id: data.uploadId, file_id: fileId, metadata: { id: fileId, name: data.name, size: data.size, mimeType: data.mimeType, folderId } }, { onConflict: "user_id,upload_id", ignoreDuplicates: true });
        if (save.error) throw new ApiError(503, "Couldn't create upload.");
        result = await admin.from("attachments").select("file_id,metadata,ready").eq("user_id", userId).eq("upload_id", data.uploadId).single();
      }
      if (!result.data) throw new ApiError(503, "Upload not ready.");
      if (result.data.metadata.name !== data.name || result.data.metadata.size !== data.size || result.data.metadata.mimeType !== data.mimeType) throw new ApiError(409, "File doesn't match the original upload.");
      return context.apply(NextResponse.json({ fileId: result.data.file_id, folderId: result.data.metadata.folderId ?? folderId, attachment: result.data.ready ? result.data.metadata : undefined }));
    }
    if (!result.data) throw new ApiError(404, "Upload not found.");
    if (result.data.ready) return context.apply(NextResponse.json(result.data.metadata));
    const file = await drive.metadata(result.data.file_id);
    const expected = result.data.metadata;
    if (file.trashed || !file.parents?.includes(expected.folderId) || file.appProperties?.app !== APP_ID || file.appProperties?.role !== "attachment") throw new ApiError(400, "Drive file or folder mismatch.");
    const attachment = asAttachment(file);
    if (attachment.size !== expected.size || attachment.name !== expected.name || attachment.mimeType !== expected.mimeType) throw new ApiError(409, "Upload incomplete or file details changed.");
    const saved = await admin.from("attachments").update({ ready: true, metadata: attachment }).eq("user_id", userId).eq("upload_id", data.uploadId);
    if (saved.error) throw new ApiError(503, "File uploaded. Retry to attach.");
    return context.apply(NextResponse.json(attachment));
  } catch (error) { return apiError(error); }
}
