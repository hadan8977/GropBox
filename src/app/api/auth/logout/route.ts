import { NextRequest, NextResponse } from "next/server";
import { requestClient, apiError, ApiError } from "@/lib/server/supabase";
import { appOrigin } from "@/lib/server/config";

export async function POST(request: NextRequest) {
  try {
    if (request.headers.get("origin") !== appOrigin()) throw new ApiError(403, "Invalid request origin.");
    const context = requestClient(request);
    const { error } = await context.client.auth.signOut({ scope: "local" });
    if (error) throw new ApiError(503, "Sign-out failed. Retry.");
    return context.apply(NextResponse.json({ ok: true }));
  } catch (error) { return apiError(error); }
}
