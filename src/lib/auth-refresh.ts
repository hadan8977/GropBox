export type AuthError = "ReconnectGoogle" | "RefreshTemporarilyUnavailable";
export type GoogleToken = { refreshToken?: string; accessToken?: string; accessTokenExpires?: number; authError?: AuthError };

export async function refreshGoogleToken(
  token: GoogleToken,
  credentials: { clientId: string; clientSecret: string },
  request: typeof fetch = fetch,
): Promise<GoogleToken> {
  if (!token.refreshToken) return { ...token, authError: "ReconnectGoogle" };
  try {
    const response = await request("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
        grant_type: "refresh_token",
        refresh_token: token.refreshToken,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    const data = await response.json();
    if (!response.ok) {
      return { ...token, authError: data.error === "invalid_grant" ? "ReconnectGoogle" : "RefreshTemporarilyUnavailable" };
    }
    if (typeof data.access_token !== "string" || !Number.isFinite(data.expires_in) || data.expires_in <= 0) {
      return { ...token, authError: "RefreshTemporarilyUnavailable" };
    }
    return {
      ...token,
      accessToken: data.access_token,
      accessTokenExpires: Date.now() + data.expires_in * 1000,
      refreshToken: typeof data.refresh_token === "string" ? data.refresh_token : token.refreshToken,
      authError: undefined,
    };
  } catch {
    // Provider payloads and credentials must never be written to logs or session errors.
    return { ...token, authError: "RefreshTemporarilyUnavailable" };
  }
}
