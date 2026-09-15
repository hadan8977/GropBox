import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "GropBox", description: "Files and messages across your devices.", manifest: "/manifest.webmanifest", icons: { icon: "/icon.svg", apple: "/icon.svg" } };
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#f5f5f7", viewportFit: "cover", interactiveWidget: "resizes-content" };
export default function Layout({ children }: { children: React.ReactNode }) { return <html lang="en"><body>{children}</body></html>; }
