import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { appOrigin, configured, emailAllowed } from "./config";
import { supabaseFetch } from "@/lib/supabase/fetch";

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function adminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: supabaseFetch } });
}

export function requestClient(request: NextRequest) {
  if (!configured()) throw new ApiError(503, "Service setup required.");
  // Buffer ALL cookie writes. OAuth callbacks must strip Google provider tokens before applying them.
  const jar = new Map<string, { name: string; value: string; options?: CookieOptions }>(request.cookies.getAll().map((c) => [c.name, c]));
  const changed = new Set<string>();
  const client = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    global: { fetch: supabaseFetch },
    cookieOptions: { secure: appOrigin().startsWith("https:"), sameSite: "lax", path: "/" },
    cookies: {
      getAll: () => [...jar.values()],
      setAll: (cookies) => { for (const cookie of cookies) { jar.set(cookie.name, cookie); changed.add(cookie.name); } },
    },
  });
  return {
    client,
    apply(response: NextResponse) {
      response.headers.set("Cache-Control", "private, no-store");
      for (const name of changed) { const c = jar.get(name)!; response.cookies.set(c.name, c.value, c.options); }
      return response;
    },
  };
}

export async function authenticated(request: NextRequest, write = true) {
  if (write && request.headers.get("origin") !== appOrigin()) throw new ApiError(403, "Invalid request origin.");
  const context = requestClient(request);
  const { data: { user }, error } = await context.client.auth.getUser();
  if (error || !user) throw new ApiError(401, "Sign in again.");
  if (!emailAllowed(user.email)) throw new ApiError(403, "This account isn't allowed.");
  const { data: account, error: accountError } = await context.client.from("app_accounts").select("user_id,workspace").eq("user_id", user.id).maybeSingle();
  if (accountError) throw new ApiError(503, "Database unavailable. Check project setup.");
  if (!account) throw new ApiError(403, "Account inactive. Reconnect Google.");
  return { ...context, user, account };
}

export function apiError(error: unknown) {
  if (error instanceof ApiError) return NextResponse.json({ error: error.message }, { status: error.status });
  return NextResponse.json({ error: "Service unavailable. Retry or check setup." }, { status: 503 });
}

export async function boundedJson(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, "Empty request.");
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.length;
      if (length > 210_000) { await reader.cancel(); throw new ApiError(413, "Message too large. Send it as a file."); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new ApiError(400, "Invalid JSON."); }
}
