import type { MetadataRoute } from "next";
export default function manifest(): MetadataRoute.Manifest {
  return { name: "GropBox", short_name: "GropBox", description: "Files and messages across your devices.", lang: "en", start_url: "/", display: "standalone", background_color: "#fafaf9", theme_color: "#fafaf9", icons: [{ src: "/gropbox-icon.png", sizes: "512x512", type: "image/png", purpose: "any" }], share_target: { action: "/", method: "GET", params: { title: "share_title", text: "share_text", url: "share_url" } } };
}
