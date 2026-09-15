import { readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { parseEnv } from "node:util";

// Run from the repository root. No network calls or secret values in output.
async function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--check") || args.length > 1) throw new Error("USAGE");
  const template = await readFile(".env.example", "utf8");
  if (!args.length) {
    const content = template.replace(/^TOKEN_ENCRYPTION_KEY=$/m, `TOKEN_ENCRYPTION_KEY=${randomBytes(32).toString("hex")}`)
      .replace(/^CRON_SECRET=$/m, `CRON_SECRET=${randomBytes(32).toString("hex")}`);
    try {
      await writeFile(".env.local", content, { flag: "wx", mode: 0o600 });
      console.log("Created .env.local with two independent random secrets. Fill the remaining fields in your editor.");
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      console.log("Kept existing .env.local unchanged. No secrets were rotated.");
    }
    console.log("Next: npm run setup:check");
    return;
  }

  const values = parseEnv(await readFile(".env.local", "utf8"));
  const errors = [];
  for (const key of Object.keys(parseEnv(template))) {
    if (key !== "ALLOWED_GOOGLE_EMAILS" && !values[key]?.trim()) errors.push(`Missing ${key}.`);
  }
  const origin = (key) => {
    try {
      const url = new URL(values[key]);
      const local = ["localhost", "127.0.0.1"].includes(url.hostname);
      if (url.username || url.password || url.search || url.hash || url.pathname !== "/" || (url.protocol !== "https:" && !(url.protocol === "http:" && local))) throw new Error();
      return url.origin;
    } catch { errors.push(`${key} must be an HTTPS origin (HTTP is allowed for localhost only).`); }
  };
  const app = origin("APP_URL"), supabase = origin("NEXT_PUBLIC_SUPABASE_URL");
  if (!/^[0-9a-f]{64}$/i.test(values.TOKEN_ENCRYPTION_KEY ?? "")) errors.push("TOKEN_ENCRYPTION_KEY must be 64 hexadecimal characters.");
  if ((values.CRON_SECRET?.length ?? 0) < 32) errors.push("CRON_SECRET must contain at least 32 characters.");
  if (values.CRON_SECRET === values.TOKEN_ENCRYPTION_KEY) errors.push("Use different secrets for encryption and cron.");
  const publicKey = values.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
  let anon = false;
  try { anon = JSON.parse(Buffer.from(publicKey.split(".")[1] ?? "", "base64url").toString()).role === "anon"; } catch { /* Modern publishable keys are not JWTs. */ }
  if (!publicKey.startsWith("sb_publishable_") && !anon) errors.push("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY must be a publishable or anon key, never a server secret.");
  if (!values.GOOGLE_CLIENT_ID?.endsWith(".apps.googleusercontent.com")) errors.push("Use a Google Web application client ID.");
  if (values.ALLOWED_GOOGLE_EMAILS && values.ALLOWED_GOOGLE_EMAILS.split(",").some((email) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))) errors.push("ALLOWED_GOOGLE_EMAILS must contain comma-separated email addresses.");
  if (errors.length) {
    console.error(errors.join("\n"));
    process.exitCode = 1;
    return;
  }
  console.log("Local configuration format is valid. Cloud credentials and services have NOT been verified.");
  console.log(`Google authorized redirect URI: ${supabase}/auth/v1/callback`);
  console.log(`Supabase Site URL: ${app}`);
  console.log(`Supabase Redirect URL: ${app}/api/auth/callback`);
  if (app.startsWith("http:")) console.log("For production, replace APP_URL with your final HTTPS domain before deploying.");
  if (!values.ALLOWED_GOOGLE_EMAILS?.trim()) console.log("No email allowlist: any Google account may join. Set your email for a personal deployment.");
}

main().catch((error) => {
  console.error(error.message === "USAGE" ? "Usage: npm run setup or npm run setup:check" : error.code === "ENOENT" ? "Missing .env.example or .env.local. Run npm run setup from the repository root first." : "Setup failed. Check local file permissions and environment-file formatting.");
  process.exitCode = 1;
});
