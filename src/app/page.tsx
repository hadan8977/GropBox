import { App } from "@/components/app";
import { configured } from "@/lib/server/config";

export const dynamic = "force-dynamic";
export default function Page() { return <App configured={configured()} />; }
