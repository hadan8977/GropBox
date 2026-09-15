import { describe, expect, it } from "vitest";
import { emptyDocument, isRichDocument, mutationSchema, safeHref, mergeMessages, type Mutation, type Message } from "@/lib/model";
import { rangeOffset, validateUploadUrl } from "@/lib/drive";
import { escapeLike } from "@/lib/sync";

const input = (): Mutation => ({ id: crypto.randomUUID(), operationId: crypto.randomUUID(), expectedVersion: 0, kind: "message", format: "rich", body: emptyDocument(), title: "", attachments: [], pinned: false, deleted: false });
describe("content and transfer boundaries", () => {
  it("rejects executable links, unknown nodes and excessive nesting", () => {
    expect(safeHref("javascript:alert(1)")).toBeUndefined();
    expect(safeHref("https://example.com/path")).toBe("https://example.com/path");
    expect(isRichDocument({ type: "doc", content: [{ type: "script", text: "bad" }] })).toBe(false);
    expect(isRichDocument({ type: "doc", content: [{ type: "text", text: "click", marks: [{ type: "link", attrs: { href: "data:text/html,<script>" } }] }] })).toBe(false);
    let doc = emptyDocument(); for (let i = 0; i < 30; i++) doc = { type: "doc", content: [doc] };
    expect(isRichDocument(doc)).toBe(false);
  });
  it("checks format and UTF-8 payload size, not just character count", () => {
    expect(mutationSchema.safeParse({ ...input(), body: "text" }).success).toBe(false);
    expect(mutationSchema.safeParse({ ...input(), format: "text", body: "中".repeat(70_000) }).success).toBe(false);
    expect(mutationSchema.safeParse(input()).success).toBe(true);
    for (const body of [undefined, null, 42, { type: "doc", content: "invalid" }]) expect(mutationSchema.safeParse({ ...input(), body }).success).toBe(false);
  });
  it("only sends bearer credentials to a Google upload endpoint", () => {
    expect(validateUploadUrl("https://www.googleapis.com/upload/drive/v3/files?upload_id=123")).toContain("upload_id=123");
    for (const url of ["https://www.googleapis.com.evil.test/upload/drive/v3/files", "https://evil.test/upload/drive/v3/files", "http://www.googleapis.com/upload/drive/v3/files", "https://user:pass@www.googleapis.com/upload/drive/v3/files", "https://www.googleapis.com/upload/drive/v3/filesEVIL", "https://www.googleapis.com:444/upload/drive/v3/files"]) expect(() => validateUploadUrl(url)).toThrow();
  });
  it("honors acknowledged resumable ranges", () => {
    expect(rangeOffset(null)).toBe(0); expect(rangeOffset("bytes=0-8388607")).toBe(8388608);
    expect(() => rangeOffset("bytes=1-20")).toThrow(); expect(() => rangeOffset("bytes=0-99999999999999999")).toThrow();
  });
  it("keeps conflict drafts visible rather than replacing them with remote state", () => {
    const m = input(), time = "2026-09-15T12:00:00.000Z";
    const remote: Message = { ...m, user_id: "user", created_at: time, updated_at: time, version: 2, archive_version: 1 };
    const pending = { mutation: { ...m, format: "text" as const, body: "本机修改" }, createdAt: time, error: "conflict" };
    const result = mergeMessages([remote], [pending], "user");
    expect(result).toHaveLength(1); expect(result[0]).toMatchObject({ body: "本机修改", version: 2, pending: true, error: "conflict" });
    expect(mergeMessages([{ ...remote, deleted: true }], [], "user")).toEqual([]);
  });
  it("escapes wildcard characters in literal search", () => { expect(escapeLike("100%_a\\b")).toBe("100\\%\\_a\\\\b"); });
});
