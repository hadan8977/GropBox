import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { refreshGoogleToken } from "@/lib/auth-refresh";
import { seal, unseal } from "@/lib/server/crypto";
import { requestClient } from "@/lib/server/supabase";
import { sanitizeSession } from "@/lib/server/oauth";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
const config = { clientId: "test-client", clientSecret: "test-secret" };
describe("Google authorization", () => {
  it("preserves a refresh token when Google doesn't rotate it", async () => {
    const request = vi.fn().mockResolvedValue(Response.json({ access_token: "new-access", expires_in: 3600 }));
    const result = await refreshGoogleToken({ refreshToken: "existing", authError: "ReconnectGoogle" }, config, request);
    expect(result).toMatchObject({ refreshToken: "existing", accessToken: "new-access", authError: undefined });
    expect(result.accessTokenExpires).toBeGreaterThan(Date.now());
  });
  it("separates revoked credentials from transient failures", async () => {
    const revoked = await refreshGoogleToken({ refreshToken: "old" }, config, vi.fn().mockResolvedValue(Response.json({ error: "invalid_grant", secret_detail: "never expose" }, { status: 400 })));
    expect(revoked.authError).toBe("ReconnectGoogle"); expect(JSON.stringify(revoked)).not.toContain("never expose");
    const transient = await refreshGoogleToken({ refreshToken: "old" }, config, vi.fn().mockRejectedValue(new Error("offline")));
    expect(transient.authError).toBe("RefreshTemporarilyUnavailable");
  });
  it("encrypts credentials with account-bound authenticated encryption", () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", "a".repeat(64));
    const encrypted = seal("refresh-secret", "user-one");
    expect(encrypted).not.toContain("refresh-secret"); expect(unseal(encrypted, "user-one")).toBe("refresh-secret");
    expect(() => unseal(encrypted, "user-two")).toThrow();
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", "b".repeat(64)); expect(() => unseal(encrypted, "user-one")).toThrow();
  });
  it("buffers OAuth cookies and strips provider tokens before publishing the real SDK session", async () => {
    for (const [key, value] of Object.entries({ APP_URL: "http://localhost:3000", NEXT_PUBLIC_SUPABASE_URL: "https://test.supabase.co", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "test-publishable", SUPABASE_SECRET_KEY: "test-secret", GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "secret", TOKEN_ENCRYPTION_KEY: "a".repeat(64) })) vi.stubEnv(key, value);
    const user = { id: "d06a2f2d-9e6b-4274-b84f-3a523324aa9e", aud: "authenticated", role: "authenticated", email: "test@example.com", app_metadata: {}, user_metadata: {}, created_at: "2026-09-15T00:00:00Z" };
    const token = `${Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url")}.${Buffer.from(JSON.stringify({ sub: user.id, exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url")}.${Buffer.from("test-signature").toString("base64url")}`;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => String(url).includes("/token") ? Response.json({ access_token: token, refresh_token: "supabase-refresh", expires_in: 3600, token_type: "bearer", user, provider_token: "GOOGLE-ACCESS-SECRET", provider_refresh_token: "GOOGLE-REFRESH-SECRET" }) : Response.json(user)));
    const context = requestClient(new NextRequest("http://localhost:3000/api/auth/callback?code=code"));
    await context.client.auth.signInWithOAuth({ provider: "google", options: { skipBrowserRedirect: true } });
    const { data, error } = await context.client.auth.exchangeCodeForSession("code");
    expect(error).toBeNull(); expect(data.session?.provider_refresh_token).toBe("GOOGLE-REFRESH-SECRET");
    await sanitizeSession(context.client, data.session!);
    const response = context.apply(NextResponse.json({ ok: true }));
    const cookie = response.cookies.get("sb-test-auth-token")?.value;
    expect(cookie).toBeTruthy();
    const decoded = Buffer.from(cookie!.replace(/^base64-/, ""), "base64url").toString("utf8");
    expect(decoded).toContain("supabase-refresh"); expect(decoded).not.toContain("GOOGLE-"); expect(decoded).not.toContain("provider_refresh_token");
  });
});
