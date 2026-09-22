import type { Metadata, Viewport } from "next";
import { AppearanceProvider } from "@/components/appearance";
import { appearanceBootstrap } from "@/lib/appearance";
import "./globals.css";

export const metadata: Metadata = { title: "GropBox", description: "Files and messages across your devices.", manifest: "/manifest.webmanifest", icons: { icon: "/gropbox-mark.png", apple: "/gropbox-apple-icon.png" } };
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#f5f5f7", viewportFit: "cover", interactiveWidget: "resizes-content" };
export default function Layout({ children }: { children: React.ReactNode }) {
  return <html lang="en" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{ __html: appearanceBootstrap }} /></head><body><AppearanceProvider>{children}</AppearanceProvider></body></html>;
}
