import { createBrowserClient } from "@supabase/ssr";
import { supabaseFetch } from "./fetch";

export function browserClient() {
  return createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    global: { fetch: supabaseFetch },
    cookieOptions: { path: "/", sameSite: "lax", secure: typeof window !== "undefined" && window.location.protocol === "https:" },
  });
}
