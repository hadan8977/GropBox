"use client";
// Adapted from Beautiful UI's GlideMenu. MIT, Copyright (c) 2026 Shane Levine.
// See skills/beautiful-ui/assets/react/LICENSE.
import { useRef, useState, type ReactNode } from "react";

/** Visual grouping only: children retain their native button/link semantics. */
export function GlideActions({ children, className = "" }: { children: ReactNode; className?: string }) {
  const root = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ top: number; height: number } | null>(null);
  const highlight = (target: EventTarget | null) => {
    const container = root.current;
    const row = target instanceof Element ? target.closest<HTMLElement>("button:not(:disabled), a[href]") : null;
    if (!container || !row || !container.contains(row)) { setBox(null); return; }
    const bounds = container.getBoundingClientRect(), rect = row.getBoundingClientRect();
    setBox({ top: rect.top - bounds.top + container.scrollTop, height: rect.height });
  };
  return <div ref={root} className={`bui-actions ${className}`}
    onPointerOver={event => { if (event.pointerType !== "touch") highlight(event.target); }}
    onPointerLeave={() => highlight(document.activeElement)}
    onFocusCapture={event => highlight(event.target)}
    onBlurCapture={event => highlight(event.relatedTarget)}>
    <span className="bui-action-highlight" aria-hidden="true" style={{ transform: `translateY(${box?.top ?? 0}px)`, height: box?.height ?? 0, opacity: box ? 1 : 0 }} />
    {children}
  </div>;
}
