import { APP_ID, FILE_ID, attachmentSchema, canPreviewImage, type Attachment } from "./model";

const API = "https://www.googleapis.com/drive/v3";
const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
export const MAX_THUMBNAIL_BYTES = 2 * 1024 * 1024;
const META_FIELDS = "id,name,mimeType,parents,appProperties,size,trashed,webContentLink";
export type DriveFile = { id: string; name: string; mimeType: string; parents?: string[]; appProperties?: Record<string,string>; size?: string; trashed?: boolean; webContentLink?: string };
export type Workspace = { root: string; history: string; documents: string; assets: string };
export class DriveError extends Error {
  constructor(message: string, public status: number) { super(message); this.name = "DriveError"; }
}
function validId(id: string) { if (!FILE_ID.test(id)) throw new Error("Invalid file ID."); return id; }
export function validateUploadUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" || !["www.googleapis.com","content.googleapis.com"].includes(url.hostname) || url.port || url.username || url.password || !/^\/upload\/drive\/v3\/files(?:\/[\w-]+)?$/.test(url.pathname)) throw new Error("Invalid upload URL. Transfer stopped.");
  return url.href;
}
export async function delay(ms: number, signal?: AbortSignal) {
  await new Promise<void>((resolve,reject) => {
    if (signal?.aborted) { reject(new DOMException("Aborted","AbortError")); return; }
    const abort = () => { clearTimeout(timer); reject(new DOMException("Aborted","AbortError")); };
    const timer = setTimeout(() => { signal?.removeEventListener("abort",abort); resolve(); },ms);
    signal?.addEventListener("abort",abort,{once:true});
  });
}
function failure(status: number) {
  if (status === 401) return "Reconnect Google.";
  if (status === 403) return "Drive denied access. Check permissions and storage.";
  if (status === 404) return "File or upload session not found. Retry.";
  return `Drive unavailable (${status}). Retry.`;
}
export class DriveClient {
  constructor(private token: (force?: boolean) => Promise<string>, private requestFetch: typeof fetch = (...args) => fetch(...args)) {}
  private async request(url: string, init: RequestInit = {}, allowConflict = false): Promise<Response> {
    if (!url.startsWith(`${API}/`) && !url.startsWith(`${UPLOAD_API}/`)) throw new Error("Invalid Drive API URL.");
    for (let attempt = 0; attempt < 4; attempt++) {
      const response = await this.requestFetch(url, {
        ...init, signal: init.signal ?? AbortSignal.timeout(30_000),
        headers: { ...Object.fromEntries(new Headers(init.headers)), Authorization: `Bearer ${await this.token()}` },
        cache: "no-store", credentials: "omit",
      });
      if (response.ok || (allowConflict && response.status === 409)) return response;
      if (response.status === 401 && attempt === 0) { await this.token(true); continue; }
      if ((response.status === 429 || response.status >= 500) && attempt < 3) { await delay(500 * 2 ** attempt, init.signal ?? undefined); continue; }
      throw new DriveError(failure(response.status),response.status);
    }
    throw new Error("Drive request failed.");
  }
  async generateId() {
    const data = await (await this.request(`${API}/files/generateIds?count=1&space=drive&type=files`)).json();
    return validId(data.ids?.[0] ?? "");
  }
  async metadata(id: string): Promise<DriveFile> {
    return (await this.request(`${API}/files/${validId(id)}?fields=${encodeURIComponent(META_FIELDS)}`)).json();
  }
  async ensureFolder(id: string, name: string, role: string, parent?: string) {
    let file: DriveFile;
    try { file = await this.metadata(id); }
    catch (error) {
      if (!(error instanceof DriveError) || error.status !== 404) throw error;
      await this.request(`${API}/files?fields=id`, { method:"POST", headers:{"Content-Type":"application/json"},
        body:JSON.stringify({id:validId(id),name,mimeType:"application/vnd.google-apps.folder",...(parent ? {parents:[validId(parent)]} : {}),
          appProperties:{app:APP_ID,role}})},true);
      file = await this.metadata(id);
    }
    if (file.trashed || file.mimeType !== "application/vnd.google-apps.folder" || file.appProperties?.app !== APP_ID || file.appProperties?.role !== role || (parent && !file.parents?.includes(parent))) throw new Error("Restore the app folder in Drive, then retry.");
    return id;
  }
  async writeArchive(id: string, folder: string, operation: string, snapshot: unknown) {
    const boundary = `paseo_${crypto.randomUUID().replaceAll("-","")}`;
    const metadata = {id:validId(id),name:`${operation}.json`,mimeType:"application/json",parents:[validId(folder)],appProperties:{app:APP_ID,role:"archive",operation}};
    const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({schema:1,message:snapshot})}\r\n--${boundary}--`;
    const response = await this.request(`${UPLOAD_API}/files?uploadType=multipart&fields=${encodeURIComponent(META_FIELDS)}`, {
      method:"POST",headers:{"Content-Type":`multipart/related; boundary=${boundary}`},body,
    },true);
    const file: DriveFile = response.status === 409 ? await this.metadata(id) : await response.json();
    if (file.appProperties?.operation !== operation || !file.parents?.includes(folder)) throw new Error("Archive conflict. Existing data unchanged.");
  }
  async createUpload(file: File, folderId: string, fileId: string): Promise<string> {
    const response = await this.request(`${UPLOAD_API}/files?uploadType=resumable&fields=id,name,mimeType,size`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Upload-Content-Type": file.type || "application/octet-stream", "X-Upload-Content-Length": String(file.size) },
      body: JSON.stringify({ id: validId(fileId), name: file.name, mimeType: file.type || "application/octet-stream", parents: [validId(folderId)], appProperties: { app: APP_ID, role: "attachment" } }),
    });
    return validateUploadUrl(response.headers.get("Location") ?? "");
  }

  async uploadStatus(sessionUrl: string, size: number, signal?: AbortSignal): Promise<{ offset: number; attachment?: Attachment }> {
    const response = await this.requestFetch(validateUploadUrl(sessionUrl), {
      method: "PUT", headers: { "Content-Range": `bytes */${size}`, Authorization: `Bearer ${await this.token()}` },
      body: new Blob(), signal: signal ?? AbortSignal.timeout(30_000), cache: "no-store", credentials: "omit",
    });
    if (response.status === 308) return { offset: rangeOffset(response.headers.get("Range")) };
    if (response.ok) return { offset: size, attachment: asAttachment(await response.json()) };
    throw new DriveError(failure(response.status), response.status);
  }

  async uploadChunk(sessionUrl: string, file: File, offset: number, signal: AbortSignal, progress: (bytes: number) => void) {
    const chunk = file.slice(offset, Math.min(offset + 8 * 1024 * 1024, file.size));
    const token = await this.token();
    return new Promise<{ offset: number; attachment?: Attachment }>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const abort = () => xhr.abort();
      if (signal.aborted) { reject(new DOMException("Aborted", "AbortError")); return; }
      xhr.open("PUT", validateUploadUrl(sessionUrl));
      xhr.timeout = 120_000;
      xhr.setRequestHeader("Authorization", `Bearer ${token}`);
      xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
      xhr.setRequestHeader("Content-Range", file.size === 0 ? "bytes */0" : `bytes ${offset}-${offset + chunk.size - 1}/${file.size}`);
      xhr.upload.onprogress = (event) => progress(offset + event.loaded);
      xhr.onloadend = () => signal.removeEventListener("abort", abort);
      xhr.onload = () => {
        try {
          if (xhr.status === 308) resolve({ offset: rangeOffset(xhr.getResponseHeader("Range")) });
          else if (xhr.status >= 200 && xhr.status < 300) resolve({ offset: file.size, attachment: asAttachment(JSON.parse(xhr.responseText)) });
          else reject(new DriveError(failure(xhr.status), xhr.status));
        } catch { reject(new Error("Couldn't confirm upload. Retry.")); }
      };
      xhr.onerror = () => reject(new Error("Connection lost. Reconnect to resume."));
      xhr.ontimeout = () => reject(new Error("Upload timed out. Retry to resume."));
      xhr.onabort = () => reject(new DOMException("Aborted", "AbortError"));
      signal.addEventListener("abort", abort, { once: true });
      xhr.send(chunk);
    });
  }

  async download(id: string, signal?: AbortSignal) {
    // A large streamed download must not inherit the 30-second metadata deadline.
    return this.request(`${API}/files/${validId(id)}?alt=media`, { signal: signal ?? new AbortController().signal });
  }
  // Drive thumbnail URLs require credentials and are not browser-CORS endpoints.
  // Only call this from the authenticated thumbnail route, never expose the URL.
  async thumbnail(id: string, signal: AbortSignal): Promise<Blob | undefined> {
    const file = await (await this.request(`${API}/files/${validId(id)}?fields=thumbnailLink,trashed`, { signal })).json();
    if (file.trashed) throw new DriveError("File not found.", 404);
    if (!file.thumbnailLink) return undefined;
    const url = new URL(file.thumbnailLink);
    if (url.protocol !== "https:" || !url.hostname.endsWith(".googleusercontent.com") || url.username || url.password || url.port) throw new Error("Invalid thumbnail URL.");
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await this.requestFetch(url.href, {
        signal, headers: { Authorization: `Bearer ${await this.token(attempt === 1)}` },
        cache: "no-store", credentials: "omit", redirect: "error",
      });
      if (response.status === 401 && attempt === 0) { await response.body?.cancel(); continue; }
      const mime = response.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase() ?? "";
      if (!response.ok || !canPreviewImage(mime)) {
        await response.body?.cancel();
        throw new DriveError("Preview unavailable.", response.ok ? 502 : response.status);
      }
      return boundedBlob(response, MAX_THUMBNAIL_BYTES, mime);
    }
    throw new Error("Preview unavailable.");
  }
  async downloadLink(id: string) {
    const file = await this.metadata(id);
    if (!file.webContentLink || file.trashed) throw new Error("Download unavailable. Check the file in Drive.");
    const url = new URL(file.webContentLink);
    if (url.protocol !== "https:" || !["drive.google.com", "drive.usercontent.google.com"].includes(url.hostname) || url.port || url.username || url.password) throw new Error("Invalid Drive download link.");
    return url.href;
  }
}

export function rangeOffset(range: string | null) {
  if (!range) return 0;
  const match = /^bytes=0-(\d+)$/.exec(range);
  if (!match) throw new Error("Couldn't read upload progress. Retry.");
  const offset = Number(match[1]) + 1;
  if (!Number.isSafeInteger(offset)) throw new Error("Invalid upload progress.");
  return offset;
}

export function asAttachment(file: DriveFile): Attachment {
  const size = Number(file.size ?? 0);
  if (!FILE_ID.test(file.id) || !Number.isSafeInteger(size) || size < 0) throw new Error("Invalid file details.");
  return attachmentSchema.parse({ id: file.id, name: file.name, mimeType: file.mimeType, size });
}

export async function boundedBlob(response: Response, limit: number, mimeType: string) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Couldn't read file.");
  const chunks: ArrayBuffer[] = []; let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) { await reader.cancel(); throw new Error("File exceeds preview limit. Download from Drive."); }
      chunks.push(value.slice().buffer);
    }
  } finally { reader.releaseLock(); }
  return new Blob(chunks, { type: mimeType });
}
