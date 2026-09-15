import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { authenticated, apiError, ApiError } from "@/lib/server/supabase";
import { archiveBatch } from "@/lib/server/archive";

export const maxDuration = 300;
export async function POST(request: NextRequest) {
  try {
    const context = await authenticated(request);
    return context.apply(NextResponse.json(await archiveBatch(context.user.id)));
  } catch (error) { return apiError(error); }
}
export async function GET(request: NextRequest) {
  try {
    const secret = process.env.CRON_SECRET;
    const provided = Buffer.from(request.headers.get("authorization") ?? "");
    const expected = Buffer.from(`Bearer ${secret}`);
    if (!secret || expected.length !== provided.length || !timingSafeEqual(expected, provided)) throw new ApiError(401, "Unauthorized.");
    return NextResponse.json(await archiveBatch(null));
  } catch (error) { return apiError(error); }
}
