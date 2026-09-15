import { describe, expect, it } from "vitest";
import { startsTimeGroup, trackIncoming } from "@/lib/timeline";
import type { VisibleMessage } from "@/lib/model";

function message(id: string, time: string, extra: Partial<VisibleMessage> = {}): VisibleMessage {
  return { id, created_at: time, updated_at: time, user_id: "user", kind: "message", format: "text", title: "", body: id, attachments: [], version: 1, archive_version: 0, pinned: false, deleted: false, ...extra };
}
const a = message("a", "2026-09-15T08:00:00Z");
const b = message("b", "2026-09-15T08:01:00Z");
const c = message("c", "2026-09-15T08:02:00Z");

describe("message time groups", () => {
  it("groups consecutive messages until a five-minute gap", () => {
    expect(startsTimeGroup(a)).toBe(true);
    expect(startsTimeGroup(b, a)).toBe(false);
    expect(startsTimeGroup(message("x", "2026-09-15T08:04:59.999Z"), a)).toBe(false);
    expect(startsTimeGroup(message("x", "2026-09-15T08:05:00Z"), a)).toBe(true);
    expect(startsTimeGroup(c, b)).toBe(false);
  });
  it("starts a new group at local midnight even within five minutes", () => {
    const before = message("before", new Date(2026, 8, 15, 23, 59).toISOString());
    const after = message("after", new Date(2026, 8, 16, 0, 0).toISOString());
    expect(startsTimeGroup(after, before)).toBe(true);
  });
});

describe("session arrivals", () => {
  it("does not call initial history new", () => {
    const state = trackIncoming(undefined, [a, b], false);
    expect(state.unread).toEqual([]);
    expect(state.divider).toBeUndefined();
  });
  it("counts arrivals once while reading history, ignoring edits and archive acknowledgements", () => {
    const initial = trackIncoming(undefined, [a], true);
    const arrived = trackIncoming(initial, [a, b, c], false);
    expect(arrived.unread).toEqual(["b", "c"]);
    expect(arrived.divider).toBe("b");
    const refreshed = trackIncoming(arrived, [a, { ...b, body: "edited", version: 2 }, { ...c, archive_version: 1 }], false);
    expect(refreshed.unread).toEqual(["b", "c"]);
    expect(refreshed.divider).toBe("b");
  });
  it("clears counts at the bottom, retaining the boundary until the next unread burst", () => {
    const arrived = trackIncoming(trackIncoming(undefined, [a], true), [a, b], false);
    const read = trackIncoming(arrived, [a, b], true);
    expect(read.unread).toEqual([]);
    expect(read.divider).toBe("b");
    const next = trackIncoming(read, [a, b, c], false);
    expect(next.unread).toEqual(["c"]);
    expect(next.divider).toBe("c");
  });
  it("does not mark older pages or local pending acknowledgements as new", () => {
    let state = trackIncoming(undefined, [b], false);
    state = trackIncoming(state, [a, b, { ...c, pending: true }], false);
    state = trackIncoming(state, [a, b, c], false);
    expect(state.unread).toEqual([]);
    expect(state.divider).toBeUndefined();
  });
  it("moves the divider when the first unread message is deleted", () => {
    const arrived = trackIncoming(trackIncoming(undefined, [a], true), [a, b, c], false);
    const removed = trackIncoming(arrived, [a, { ...b, deleted: true }, c], false);
    expect(removed.unread).toEqual(["c"]);
    expect(removed.divider).toBe("c");
  });
  it("uses IDs to order simultaneous arrivals and handles an initially empty inbox", () => {
    const simultaneous = { ...b, created_at: a.created_at };
    expect(trackIncoming(trackIncoming(undefined, [a], true), [a, simultaneous], false).unread).toEqual(["b"]);
    expect(trackIncoming(trackIncoming(undefined, [], true), [a], false).unread).toEqual(["a"]);
    expect(trackIncoming(trackIncoming(undefined, [a], true), [a, b], true).unread).toEqual([]);
  });
});
