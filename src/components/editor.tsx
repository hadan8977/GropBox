"use client";
import { useLayoutEffect, useRef } from "react";

export function Editor({ value, onChange, onSend, onFiles, disabled = false }: {
  value: string; onChange: (value: string) => void; onSend: () => void; onFiles: (files: File[]) => void; disabled?: boolean;
}) {
  const input = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const element = input.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 160)}px`;
  }, [value]);
  return <textarea ref={input} className="message-input" aria-label="Message" placeholder="Message"
    rows={1} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}
    onKeyDown={(event) => {
      if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing || event.keyCode === 229) return;
      if (event.ctrlKey || event.metaKey || !window.matchMedia("(pointer: coarse)").matches) {
        event.preventDefault(); onSend();
      }
    }}
    onPaste={(event) => {
      const files = Array.from(event.clipboardData.files);
      if (files.length) { event.preventDefault(); onFiles(files); }
    }} />;
}
