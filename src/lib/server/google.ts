import { refreshGoogleToken } from "@/lib/auth-refresh";
import { adminClient, ApiError } from "./supabase";
import { seal, unseal } from "./crypto";

export async function googleAccess(userId: string, force = false) {
  const admin = adminClient();
  const { data, error } = await admin.from("google_credentials").select("refresh_cipher,access_cipher,expires_at").eq("user_id", userId).single();
  if (error || !data) throw new ApiError(401, "Reconnect Google.");
  if (!force && data.access_cipher && data.expires_at > Date.now() + 60_000) return { token: unseal(data.access_cipher, userId), expiresAt: data.expires_at as number };
  const refreshed = await refreshGoogleToken({ refreshToken: unseal(data.refresh_cipher, userId) }, {
    clientId: process.env.GOOGLE_CLIENT_ID!, clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
  });
  if (refreshed.authError || !refreshed.accessToken) throw new ApiError(refreshed.authError === "ReconnectGoogle" ? 401 : 503,
    refreshed.authError === "ReconnectGoogle" ? "Reconnect Google." : "Google unavailable. Retry shortly.");
  const { error: saveError } = await admin.from("google_credentials").update({
    refresh_cipher: seal(refreshed.refreshToken!, userId), access_cipher: seal(refreshed.accessToken, userId), expires_at: refreshed.accessTokenExpires,
  }).eq("user_id", userId).eq("refresh_cipher", data.refresh_cipher);
  if (saveError) throw new ApiError(503, "Couldn't save Google credentials. Retry.");
  return { token: refreshed.accessToken, expiresAt: refreshed.accessTokenExpires! };
}
