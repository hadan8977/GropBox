"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { SyncEngine } from "@/lib/sync";
import { trackIncoming, type IncomingState } from "@/lib/timeline";

export function useMessageActivity(engine: SyncEngine, readingView: boolean) {
  const view = useRef(readingView), bottom = useRef(true);
  const tracker = useRef<IncomingState | undefined>(undefined);
  const [activity, setActivity] = useState<IncomingState>();
  const [atBottom, setAtBottom] = useState(true);
  useLayoutEffect(() => { view.current = readingView; }, [readingView]);

  const readLatest = useCallback(() => {
    if (!view.current || document.hidden || document.querySelector('[aria-modal="true"]') || !tracker.current?.unread.length) return;
    tracker.current = { ...tracker.current, unread: [] };
    setActivity(tracker.current);
  }, []);
  const bottomChanged = useCallback((value: boolean) => {
    bottom.current = value; setAtBottom(value);
    if (value) readLatest();
  }, [readLatest]);

  useEffect(() => {
    let previousMessages = engine.getSnapshot().messages;
    const update = () => {
      const snapshot = engine.getSnapshot();
      // Do not label the initial history response as new arrivals.
      if (!snapshot.syncedAt || (tracker.current && snapshot.messages === previousMessages)) return;
      previousMessages = snapshot.messages;
      tracker.current = trackIncoming(tracker.current, snapshot.messages, view.current && bottom.current && !document.hidden && !document.querySelector('[aria-modal="true"]'));
      setActivity(tracker.current);
    };
    update();
    const unsubscribe = engine.subscribe(update);
    const visibility = () => { if (!document.hidden && bottom.current) readLatest(); };
    document.addEventListener("visibilitychange", visibility);
    return () => { unsubscribe(); document.removeEventListener("visibilitychange", visibility); };
  }, [engine, readLatest]);

  return { atBottom, bottomChanged, readLatest, unread: activity?.unread ?? [], divider: activity?.divider };
}
