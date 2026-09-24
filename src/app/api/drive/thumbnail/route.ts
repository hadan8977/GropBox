import { NextRequest, NextResponse } from "next/server";
import { DriveClient, DriveError } from "@/lib/drive";
import { FILE_ID } from "@/lib/model";
import { fileKind } from "@/lib/file-types";
import { googleAccess } from "@/lib/server/google";
import { authenticated, ApiError, apiError } from "@/lib/server/supabase";

export async function GET(request: NextRequest) {
  try {
    const context = await authenticated(request, false);
    const id = request.nextUrl.searchParams.get("fileId") ?? "";
    if (!FILE_ID.test(id)) throw new ApiError(400, "Invalid file ID.");
    const { data, error } = await context.client.from("attachments").select("metadata")
      .eq("user_id", context.user.id).eq("file_id", id).eq("ready", true).maybeSingle();
    if (error) throw new ApiError(503, "Couldn't load attachment.");
    if (!data || fileKind(data.metadata) !== "image") throw new ApiError(404, "Image not found.");
    let token = await googleAccess(context.user.id);
    const drive = new DriveClient(async force => { if (force) token = await googleAccess(context.user.id, true); return token.token; });
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(15_000)]);
    const image = await drive.thumbnail(id, signal);
    if (!image) return context.apply(new NextResponse(null, { status: 204 }));
    return context.apply(new NextResponse(image, { headers: {
      "Content-Type": image.type, "X-Content-Type-Options": "nosniff", "Cross-Origin-Resource-Policy": "same-origin",
    } }));
  } catch (error) {
    const response = apiError(error instanceof DriveError ? new ApiError(error.status === 404 ? 404 : 503, "Preview unavailable.") : error);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
}
