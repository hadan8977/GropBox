"use client";
import { useEffect, useRef } from "react";
import type { ShaderMount } from "@paper-design/shaders";
import { useAppearance } from "./appearance";

/** A decorative enhancement; the composer never waits for this renderer. */
export function LiquidMaterial() {
  const host = useRef<HTMLDivElement>(null);
  const { dark } = useAppearance();
  useEffect(() => {
    const element = host.current!, composer = element.parentElement!;
    const reductions = ["(prefers-reduced-motion: reduce)", "(prefers-reduced-transparency: reduce)", "(prefers-contrast: more)"].map(query => matchMedia(query));
    let mount: ShaderMount | undefined, generation = 0, failed = false;
    let loadTimer: number | undefined, settleTimer: number | undefined;

    const settle = () => { window.clearTimeout(settleTimer); mount?.setSpeed(0); };
    const release = () => {
      settle();
      mount?.canvasElement.removeEventListener("webglcontextlost", unavailable);
      const context = mount?.canvasElement.getContext("webgl2");
      mount?.dispose();
      if (context && !context.isContextLost()) context.getExtension("WEBGL_lose_context")?.loseContext();
      mount = undefined;
      element.replaceChildren();
      element.dataset.material = "static";
    };
    const unavailable = () => {
      failed = true;
      release();
      console.warn("Liquid material unavailable; using the static surface.");
    };
    const flow = () => {
      if (!mount || document.hidden || settleTimer !== undefined) return;
      mount.setSpeed(.12);
      settleTimer = window.setTimeout(() => { settle(); settleTimer = undefined; }, 1400);
    };
    const focus = (event: FocusEvent) => {
      if (!(event.relatedTarget instanceof Node) || !composer.contains(event.relatedTarget)) flow();
    };
    const drag = (event: DragEvent) => {
      if (event.dataTransfer?.types.includes("Files") && (!(event.relatedTarget instanceof Node) || !composer.contains(event.relatedTarget))) flow();
    };
    const refresh = () => {
      const current = ++generation;
      window.clearTimeout(loadTimer);
      release();
      settleTimer = undefined;
      if (failed || document.hidden || reductions.some(query => query.matches)) return;
      loadTimer = window.setTimeout(() => {
        void (async () => {
          const createRenderer = await (await import("@/lib/liquid-renderer")).loadLiquidRenderer();
          if (generation !== current) return;
          mount = createRenderer(element, dark);
          mount.canvasElement.addEventListener("webglcontextlost", unavailable);
          element.dataset.material = "ready";
        })().catch(() => {
          if (generation !== current) return;
          // The constructor can fail after inserting a canvas but before returning a mount.
          try { element.querySelector("canvas")?.getContext("webgl2")?.getExtension("WEBGL_lose_context")?.loseContext(); }
          catch { console.warn("Could not release the unavailable graphics context."); }
          unavailable();
        });
      }, 180);
    };
    const visibility = () => {
      if (document.hidden) { ++generation; window.clearTimeout(loadTimer); settle(); settleTimer = undefined; }
      else if (!mount) refresh();
    };
    refresh();
    reductions.forEach(query => query.addEventListener("change", refresh));
    composer.addEventListener("focusin", focus);
    composer.addEventListener("dragenter", drag);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      ++generation;
      window.clearTimeout(loadTimer);
      release();
      reductions.forEach(query => query.removeEventListener("change", refresh));
      composer.removeEventListener("focusin", focus);
      composer.removeEventListener("dragenter", drag);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [dark]);
  return <div ref={host} className="liquid-material" aria-hidden="true" data-material="static" />;
}
