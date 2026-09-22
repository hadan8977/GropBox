"use client";
import { createContext, useContext, useEffect, useState } from "react";
import { APPEARANCE_KEY, parseAppearance, type Appearance } from "@/lib/appearance";

const AppearanceContext = createContext<{ preference: Appearance; dark: boolean; change: (value: Appearance) => void } | null>(null);

export function AppearanceProvider({ children }: { children: React.ReactNode }) {
  const [preference, setPreference] = useState<Appearance>("system");
  const [systemDark, setSystemDark] = useState(false);
  const dark = preference === "system" ? systemDark : preference === "dark";
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const syncSystem = () => setSystemDark(media.matches);
    const storage = (event: StorageEvent) => {
      if (event.key !== APPEARANCE_KEY && event.key !== null) return;
      const value = parseAppearance(event.newValue);
      document.documentElement.dataset.theme = value;
      setPreference(value);
    };
    setPreference(parseAppearance(document.documentElement.dataset.theme));
    syncSystem();
    media.addEventListener("change", syncSystem);
    window.addEventListener("storage", storage);
    return () => { media.removeEventListener("change", syncSystem); window.removeEventListener("storage", storage); };
  }, []);
  useEffect(() => {
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#171717" : "#fafaf9");
  }, [dark]);
  const change = (value: Appearance) => {
    document.documentElement.dataset.theme = value;
    setPreference(value);
    try { localStorage.setItem(APPEARANCE_KEY, value); }
    catch { console.warn("Appearance will only be remembered in this tab."); }
  };
  return <AppearanceContext.Provider value={{ preference, dark, change }}>{children}</AppearanceContext.Provider>;
}

export function useAppearance() {
  const value = useContext(AppearanceContext);
  if (!value) throw new Error("AppearanceProvider is missing.");
  return value;
}
