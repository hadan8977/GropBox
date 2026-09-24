import { boundedBlob, MAX_THUMBNAIL_BYTES, type DriveClient } from "./drive";
import { canPreviewImage, type Attachment } from "./model";
import { imagePreviewMime } from "./file-types";

// Scoped to the account's Drive client, never persisted or shared across sign-ins.
const caches = new WeakMap<DriveClient, Map<string, { blob: Blob; expires: number }>>();

export function forgetThumbnail(drive: DriveClient, id: string) { caches.get(drive)?.delete(id); }

export async function attachmentThumbnail(file: Attachment, drive: DriveClient, signal: AbortSignal): Promise<Blob | undefined> {
  let cache = caches.get(drive);
  if (!cache) { cache = new Map(); caches.set(drive, cache); }
  const cached = cache.get(file.id);
  if (cached && cached.expires > Date.now()) return cached.blob;
  cache.delete(file.id);
  const response = await fetch(`/api/drive/thumbnail?fileId=${encodeURIComponent(file.id)}`, { signal, credentials: "same-origin", cache: "no-store" });
  let blob: Blob;
  if (response.status === 204) {
    // Newly uploaded images may not have a Drive thumbnail yet. Only small,
    // browser-readable originals can fill that gap without a large download.
    const mime = imagePreviewMime(file);
    if (!canPreviewImage(mime) || file.size > MAX_THUMBNAIL_BYTES) return undefined;
    blob = await boundedBlob(await drive.download(file.id, signal), MAX_THUMBNAIL_BYTES, mime);
  } else {
    if (!response.ok) throw new Error("Preview unavailable.");
    const mime = response.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase() ?? "";
    if (!canPreviewImage(mime)) { await response.body?.cancel(); throw new Error("Preview unavailable."); }
    blob = await boundedBlob(response, MAX_THUMBNAIL_BYTES, mime);
  }
  signal.throwIfAborted();
  cache.set(file.id, { blob, expires: Date.now() + 5 * 60_000 });
  let bytes = [...cache.values()].reduce((total, entry) => total + entry.blob.size, 0);
  for (const [id, entry] of cache) {
    if (bytes <= 8 * 1024 * 1024) break;
    bytes -= entry.blob.size; cache.delete(id);
  }
  return blob;
}
