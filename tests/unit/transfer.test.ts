import { afterEach, describe, expect, it, vi } from "vitest";
import { boundedBlob, DriveClient } from "@/lib/drive";
import { filesFromDrop } from "@/lib/uploads";

describe("folder drops", () => {
  const file = (name: string, contents = "contents") => ({ name, isFile: true, isDirectory: false, file: (accept: (file: File) => void) => accept(new File([contents], name)) }) as FileSystemFileEntry;
  const folder = (name: string, batches: FileSystemEntry[][]) => ({ name, isDirectory: true, isFile: false, createReader: () => {
    let index = 0;
    return { readEntries: (accept: (entries: FileSystemEntry[]) => void) => accept(batches[index++] ?? []) };
  } }) as FileSystemDirectoryEntry;
  const drop = (entry: FileSystemEntry) => ({ items: [{ kind: "file", webkitGetAsEntry: () => entry, getAsFile: () => new File([], entry.name) }], files: [] }) as unknown as DataTransfer;

  it("reads nested directories and every batch, never the folder placeholder", async () => {
    const files = await filesFromDrop(drop(folder("Trip", [[file("one.txt")], [folder("Nested", [[file("empty.txt", ""), file("two.txt")]])]])));
    expect(files.map(f => [f.name, f.size])).toEqual([["one.txt", 8], ["empty.txt", 0], ["two.txt", 8]]);
    expect(await files[2].text()).toBe("contents");
  });
  it("rejects empty, unreadable, or over-limit folders without returning partial files", async () => {
    await expect(filesFromDrop(drop(folder("Empty", [])))).rejects.toThrow("Empty folders");
    await expect(filesFromDrop(drop(folder("Large", [[file("one"), file("two")]])), 1)).rejects.toThrow("Up to 1 more files");
    const unreadable = { name: "Denied", isFile: false, isDirectory: true, createReader: () => ({ readEntries: (_ok: unknown, fail: () => void) => fail() }) } as unknown as FileSystemDirectoryEntry;
    await expect(filesFromDrop(drop(unreadable))).rejects.toThrow("Couldn't read folder Denied");
  });
  it("supports ordinary files when directory entries are unavailable", async () => {
    const original = new File([], "empty.txt");
    const data = { items: [{ kind: "file", getAsFile: () => original }], files: [original] } as unknown as DataTransfer;
    expect(await filesFromDrop(data)).toEqual([original]);
  });
});

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
