import { NextRequest, NextResponse } from "next/server";
import { authenticated, apiError } from "@/lib/server/supabase";
import { googleAccess } from "@/lib/server/google";

export async function POST(request: NextRequest) {
  try {
    const context = await authenticated(request);
    return context.apply(NextResponse.json(await googleAccess(context.user.id, request.nextUrl.searchParams.get("force") === "1")));
  } catch (error) { return apiError(error); }
}
