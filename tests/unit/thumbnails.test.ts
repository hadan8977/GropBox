import { afterEach, describe, expect, it, vi } from "vitest";
import { attachmentThumbnail, forgetThumbnail } from "@/lib/thumbnails";
import { DriveClient, MAX_THUMBNAIL_BYTES } from "@/lib/drive";

const file = { id: "photo-id", name: "photo.png", size: 20 * 1024 * 1024, mimeType: "image/png" };
const signal = () => new AbortController().signal;
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("thumbnail loading", () => {
  it("reuses successful previews only within the same Drive client and expires them", async () => {
    const request = vi.fn(async () => new Response("thumb", { headers: { "Content-Type": "image/png" } }));
    vi.stubGlobal("fetch", request);
    const drive = new DriveClient(async () => "unused");
    const first = await attachmentThumbnail(file, drive, signal());
    expect(await attachmentThumbnail(file, drive, signal())).toBe(first); expect(request).toHaveBeenCalledTimes(1);
    await attachmentThumbnail(file, new DriveClient(async () => "other-account"), signal());
    expect(request).toHaveBeenCalledTimes(2);
    const now = Date.now(); vi.spyOn(Date, "now").mockReturnValue(now + 6 * 60_000);
    await attachmentThumbnail(file, drive, signal()); expect(request).toHaveBeenCalledTimes(3);
    forgetThumbnail(drive, file.id);
    await attachmentThumbnail(file, drive, signal()); expect(request).toHaveBeenCalledTimes(4);
  });
  it("falls back only for small browser-readable originals while a thumbnail is pending", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));
    const request = vi.fn(async () => new Response("png"));
    const drive = new DriveClient(async () => "test-access", request);
    expect(await attachmentThumbnail(file, drive, signal())).toBeUndefined();
    expect(await attachmentThumbnail({ ...file, size: 3, mimeType: "image/heic" }, drive, signal())).toBeUndefined();
    expect(request).not.toHaveBeenCalled();
    expect((await attachmentThumbnail({ ...file, size: 3, mimeType: "application/octet-stream" }, drive, signal()))?.type).toBe("image/png");
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("does not cache failures or use an original to bypass a permission failure", async () => {
    const request = vi.fn().mockResolvedValueOnce(new Response(null, { status: 403 }))
      .mockResolvedValueOnce(new Response("thumb", { headers: { "Content-Type": "image/png" } }));
    vi.stubGlobal("fetch", request);
    const original = vi.fn(), drive = new DriveClient(async () => "unused", original);
    await expect(attachmentThumbnail({ ...file, size: 5 }, drive, signal())).rejects.toThrow("Preview unavailable");
    expect(original).not.toHaveBeenCalled();
    expect((await attachmentThumbnail(file, drive, signal()))?.type).toBe("image/png"); expect(request).toHaveBeenCalledTimes(2);
  });
  it("evicts the oldest thumbnails at the 8 MiB budget", async () => {
    const request = vi.fn(async () => new Response(new Uint8Array(MAX_THUMBNAIL_BYTES), { headers: { "Content-Type": "image/png" } }));
    vi.stubGlobal("fetch", request);
    const drive = new DriveClient(async () => "unused");
    for (let i = 0; i < 5; i++) await attachmentThumbnail({ ...file, id: `photo-${i}` }, drive, signal());
    await attachmentThumbnail({ ...file, id: "photo-4" }, drive, signal()); expect(request).toHaveBeenCalledTimes(5);
    await attachmentThumbnail({ ...file, id: "photo-0" }, drive, signal()); expect(request).toHaveBeenCalledTimes(6);
  });
});
