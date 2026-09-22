export const APPEARANCE_KEY = "gropbox.appearance";
export const appearances = ["system", "light", "dark"] as const;
export type Appearance = typeof appearances[number];
export function parseAppearance(value: unknown): Appearance {
  return appearances.includes(value as Appearance) ? value as Appearance : "system";
}

// Apply a saved preference before paint without varying the public HTML cache.
export const appearanceBootstrap = `(()=>{let value;try{value=localStorage.getItem(${JSON.stringify(APPEARANCE_KEY)})}catch{console.warn("Appearance storage unavailable.")}document.documentElement.dataset.theme=${JSON.stringify(appearances)}.includes(value)?value:"system"})()`;
