import { NextRequest, NextResponse } from "next/server";
import { adminClient, requestClient } from "@/lib/server/supabase";
import { appOrigin, emailAllowed } from "@/lib/server/config";
import { seal } from "@/lib/server/crypto";
import { sanitizeSession } from "@/lib/server/oauth";

export async function GET(request: NextRequest) {
  const origin = appOrigin();
  let reason = "login";
  try {
    const context = requestClient(request);
    const code = request.nextUrl.searchParams.get("code");
    if (!code) throw new Error("Missing OAuth code");
    const { data, error } = await context.client.auth.exchangeCodeForSession(code);
    if (error || !data.session || !data.user) throw new Error("OAuth exchange failed");
    const { user, session } = data;
    if (!emailAllowed(user.email) || !user.email_confirmed_at || !session.provider_token) { reason = "account"; throw new Error("Account not allowed"); }
    // Bind credentials to the Google identity that actually issued this access token.
    // A Supabase account can have more than one linked identity.
    const identityResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: `Bearer ${session.provider_token}` }, cache: "no-store", signal: AbortSignal.timeout(15_000),
    });
    if (!identityResponse.ok) throw new Error("Google identity validation failed");
    const identity = await identityResponse.json();
    const sub = identity.sub;
    if (typeof sub !== "string" || !identity.email_verified || identity.email?.toLowerCase() !== user.email?.toLowerCase()) { reason = "account"; throw new Error("Google identity mismatch"); }
    const admin = adminClient();
    const { data: prior, error: priorError } = await admin.from("app_accounts").select("google_sub,active").eq("user_id", user.id).maybeSingle();
    if (priorError) { reason = "database"; throw priorError; }
    if (prior && (prior.google_sub !== sub || !prior.active)) { reason = "account"; throw new Error("Identity mismatch"); }
    const { data: credential, error: credentialError } = await admin.from("google_credentials").select("refresh_cipher").eq("user_id", user.id).maybeSingle();
    if (credentialError) { reason = "database"; throw credentialError; }
    if (!session.provider_refresh_token && !credential) { reason = "consent"; throw new Error("Offline access needed"); }
    if (!session.provider_token) { reason = "consent"; throw new Error("Drive access missing"); }
    const access = await fetch("https://www.googleapis.com/drive/v3/about?fields=user(permissionId)", {
      headers: { Authorization: `Bearer ${session.provider_token}` }, cache: "no-store", signal: AbortSignal.timeout(15_000),
    });
    if (!access.ok) { reason = "consent"; throw new Error("Drive permission missing"); }
    if (!prior) {
      const { error: createError } = await admin.from("app_accounts").upsert({ user_id: user.id, google_sub: sub }, { onConflict: "user_id", ignoreDuplicates: true });
      if (createError) throw createError;
    }
    const { error: saveError } = await admin.from("google_credentials").upsert({
      user_id: user.id,
      refresh_cipher: session.provider_refresh_token ? seal(session.provider_refresh_token, user.id) : credential!.refresh_cipher,
      access_cipher: seal(session.provider_token, user.id), expires_at: Date.now() + 50 * 60_000,
    });
    if (saveError) throw saveError;
    await sanitizeSession(context.client, session);
    return context.apply(NextResponse.redirect(`${origin}/`));
  } catch {
    // Do not flush intermediate OAuth cookies: they can contain Google refresh tokens.
    return NextResponse.redirect(`${origin}/?auth_error=${reason}`, { headers: { "Cache-Control": "no-store" } });
  }
}
