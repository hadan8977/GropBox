import { afterEach, describe, expect, it, vi } from "vitest";
import { boundedBlob, DriveClient } from "@/lib/drive";

afterEach(() => vi.unstubAllGlobals());
describe("bounded-memory transfers", () => {
  it("uploads a file larger than 5 GiB in 8 MiB chunks, with exact final ranges", async () => {
    const total = 5 * 1024 ** 3 + 17, offset = 5 * 1024 ** 3;
    const calls: { headers: Record<string,string>; bytes: number }[] = [];
    class Xhr {
      headers: Record<string,string> = {}; upload = { onprogress: undefined }; timeout = 0;
      status = 200; responseText = JSON.stringify({ id: "large-file", name: "large.bin", mimeType: "application/octet-stream", size: String(total) });
      onload?: () => void; onloadend?: () => void;
      open() {} setRequestHeader(name: string, value: string) { this.headers[name] = value; }
      getResponseHeader() { return "bytes=0-8388607"; }
      send(blob: Blob) { calls.push({ headers: this.headers, bytes: blob.size }); this.status = blob.size === 17 ? 200 : 308; queueMicrotask(() => { this.onload?.(); this.onloadend?.(); }); }
    }
    vi.stubGlobal("XMLHttpRequest", Xhr);
    const file = { name: "large.bin", size: total, type: "application/octet-stream", slice: (start: number, end: number) => new Blob([new Uint8Array(end - start)]) } as File;
    const drive = new DriveClient(async () => "test-access");
    expect(await drive.uploadChunk("https://www.googleapis.com/upload/drive/v3/files?upload_id=test", file, 0, new AbortController().signal, () => {})).toEqual({ offset: 8 * 1024 ** 2 });
    const final = await drive.uploadChunk("https://www.googleapis.com/upload/drive/v3/files?upload_id=test", file, offset, new AbortController().signal, () => {});
    expect(calls.map((c) => c.bytes)).toEqual([8 * 1024 ** 2, 17]);
    expect(calls[1].headers["Content-Range"]).toBe(`bytes ${offset}-${total - 1}/${total}`);
    expect(final.attachment?.size).toBe(total);
  });
  it("stops a preview when actual bytes exceed the metadata-based budget", async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({ pull(controller) { controller.enqueue(new Uint8Array(5)); }, cancel() { cancelled = true; } });
    await expect(boundedBlob(new Response(stream), 8, "image/png")).rejects.toThrow("File exceeds preview limit."); expect(cancelled).toBe(true);
    expect((await boundedBlob(new Response("hello"), 5, "text/plain")).size).toBe(5);
  });
});
