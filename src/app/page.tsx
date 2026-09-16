import { App } from "@/components/app";
import { configured } from "@/lib/server/config";

// Only a public shell is rendered here. Account data is loaded in the browser.
// Fail the build if a future change accidentally adds request-specific data.
export const dynamic = "error";
export default function Page() { return <App configured={configured()} />; }
