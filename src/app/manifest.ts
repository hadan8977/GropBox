import type { MetadataRoute } from "next";
export default function manifest(): MetadataRoute.Manifest {
  return { name: "GropBox", short_name: "GropBox", description: "Files and messages across your devices.", lang: "en", start_url: "/", display: "standalone", background_color: "#f5f5f7", theme_color: "#f5f5f7", icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }], share_target: { action: "/", method: "GET", params: { title: "share_title", text: "share_text", url: "share_url" } } };
}
