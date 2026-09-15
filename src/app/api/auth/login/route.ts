import { NextRequest, NextResponse } from "next/server";
import { requestClient, apiError, ApiError } from "@/lib/server/supabase";
import { appOrigin } from "@/lib/server/config";

export async function POST(request: NextRequest) {
  try {
    if (request.headers.get("origin") !== appOrigin()) throw new ApiError(403, "Invalid request origin.");
    const context = requestClient(request);
    const reconnect = request.nextUrl.searchParams.get("reconnect") === "1";
    const { data, error } = await context.client.auth.signInWithOAuth({
      provider: "google", options: {
        scopes: "openid email profile https://www.googleapis.com/auth/drive.file",
        redirectTo: `${appOrigin()}/api/auth/callback`, skipBrowserRedirect: true,
        queryParams: { access_type: "offline", ...(reconnect ? { prompt: "consent" } : {}) },
      },
    });
    if (error || !data.url) throw new ApiError(503, "Google sign-in unavailable. Check OAuth setup.");
    return context.apply(NextResponse.json({ url: data.url }));
  } catch (error) { return apiError(error); }
}
