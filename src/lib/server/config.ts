export function configured() {
  const present = ["APP_URL", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SECRET_KEY", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "TOKEN_ENCRYPTION_KEY"].every((key) => Boolean(process.env[key]));
  if (!present || !/^[0-9a-f]{64}$/i.test(process.env.TOKEN_ENCRYPTION_KEY ?? "")) return false;
  try {
    appOrigin();
    const url = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
    return !url.username && !url.password && (url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)));
  } catch { return false; } // Invalid configuration is displayed as the setup screen.
}

export function appOrigin() {
  const url = new URL(process.env.APP_URL!);
  if (url.username || url.password || (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)))) throw new Error("APP_URL requires HTTPS.");
  return url.origin;
}

export function emailAllowed(email: string | undefined) {
  const allowed = (process.env.ALLOWED_GOOGLE_EMAILS ?? "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
  return Boolean(email) && (!allowed.length || allowed.includes(email!.toLowerCase()));
}
