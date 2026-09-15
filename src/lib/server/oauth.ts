import type { SupabaseClient, Session } from "@supabase/supabase-js";

export async function sanitizeSession(client: SupabaseClient, session: Session) {
  // setSession constructs a NEW session from the two Supabase tokens, omitting provider credentials.
  // Never apply the cookie buffer until this has succeeded (including failure responses).
  const { data, error } = await client.auth.setSession({ access_token: session.access_token, refresh_token: session.refresh_token });
  if (error || !data.session || data.session.provider_token || data.session.provider_refresh_token) throw new Error("Couldn't save sign-in session.");
}
