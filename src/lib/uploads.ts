import { api, readableError } from "./api";
import { DriveClient, DriveError, delay } from "./drive";
import { DriveCache, type UploadRecord } from "./cache";
import type { Attachment } from "./model";

export type UploadJob = UploadRecord & { state: "queued" | "uploading" | "paused" | "failed" | "done"; error?: string };

export async function filesFromDrop(data: DataTransfer, limit = 30): Promise<File[]> {
  // Capture entries synchronously: the drag data store is protected after the event.
  const items = Array.from(data.items ?? []).filter(item => item.kind === "file").map(item => ({ entry: item.webkitGetAsEntry?.(), file: item.getAsFile() }));
  const fallback = Array.from(data.files);
  const files: File[] = [];
  const add = (file: File) => {
    if (files.length >= limit) throw new Error(`Up to ${limit} more files. Send the current attachments first.`);
    files.push(file);
  };
  async function visit(entry: FileSystemEntry) {
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, () => reject(new Error(`Couldn't read ${entry.name}.`))));
      add(file);
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      // Browsers return directory contents in batches, not necessarily one call.
      while (true) {
        const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, () => reject(new Error(`Couldn't read folder ${entry.name}.`))));
        if (!batch.length) break;
        for (const child of batch) await visit(child);
      }
    }
  }
  if (items.length) {
    for (const item of items) {
      if (item.entry) await visit(item.entry);
      else if (item.file) add(item.file);
      else throw new Error("Can't read this drop. Choose the files inside the folder.");
    }
  } else fallback.forEach(add);
  if (!files.length) throw new Error("No files found. Empty folders aren't uploaded.");
  return files;
}

export class UploadManager {
  private jobs: UploadJob[] = [];
  private files = new Map<string, File>();
  private controllers = new Map<string, AbortController>();
  private listeners = new Set<() => void>();
  private access?: { token: string; expiresAt: number };
  private tokenRequest?: Promise<string>;
  private disposed = false;
  readonly drive: DriveClient;
  constructor(private db: DriveCache) { this.drive = new DriveClient((force) => this.token(force)); }
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  getSnapshot = () => this.jobs;
  private notify() { this.listeners.forEach((fn) => fn()); }
  private patch(id: string, update: Partial<UploadJob>) { this.jobs = this.jobs.map((j) => j.id === id ? { ...j, ...update } : j); this.notify(); }
  private async token(force = false): Promise<string> {
    if (force) this.access = undefined;
    if (this.access && this.access.expiresAt > Date.now() + 60_000) return this.access.token;
    if (!this.tokenRequest) this.tokenRequest = api<{ token: string; expiresAt: number }>(`/api/drive/token${force ? "?force=1" : ""}`).then((data) => { this.access = data; return data.token; }).finally(() => { this.tokenRequest = undefined; });
    return this.tokenRequest;
  }
  async restore() { this.disposed = false; this.jobs = (await this.db.uploads.toArray()).map((j) => ({ ...j, state: j.attachment ? "done" : "paused" })); this.notify(); }
  async add(files: File[]) {
    if (this.jobs.length + files.length > 30) throw new Error("Up to 30 files. Send the current attachments first.");
    for (const file of files) {
      if (this.disposed) return;
      const record: UploadRecord = { id: crypto.randomUUID(), name: file.name, size: file.size, mimeType: file.type || "application/octet-stream", lastModified: file.lastModified, uploaded: 0 };
      await this.db.uploads.put(record); this.files.set(record.id, file); this.jobs = [...this.jobs, { ...record, state: "queued" }];
    }
    this.notify(); this.pump();
  }
  async resume(id: string, file?: File) {
    const job = this.jobs.find((j) => j.id === id); if (!job) return;
    if (file) {
      if (file.name !== job.name || file.size !== job.size || file.lastModified !== job.lastModified) throw new Error("Choose the original file to resume.");
      this.files.set(id, file);
    }
    if (!this.files.has(id)) throw new Error("Choose the original file to resume.");
    this.patch(id, { state: "queued", error: undefined }); this.pump();
  }
  hasFile(id: string) { return this.files.has(id); }
  pause(id: string) { this.controllers.get(id)?.abort(); this.patch(id, { state: "paused" }); }
  async remove(id: string) {
    this.controllers.get(id)?.abort(); this.files.delete(id); await this.db.uploads.delete(id);
    this.jobs = this.jobs.filter((j) => j.id !== id); this.notify();
  }
  consumeDone() { this.jobs = this.jobs.filter((job) => job.state !== "done"); this.notify(); }
  stop() { this.disposed = true; this.access = undefined; this.controllers.forEach((controller) => controller.abort()); }
  private pump() {
    if (this.disposed) return;
    for (const job of this.jobs) {
      if (this.controllers.size >= 2) break;
      if (job.state !== "queued" || this.controllers.has(job.id)) continue;
      const controller = new AbortController(); this.controllers.set(job.id, controller);
      void this.run(job, controller.signal).finally(() => { this.controllers.delete(job.id); this.pump(); });
    }
  }
  private async persist(id: string, change: Partial<UploadRecord>) {
    if (this.disposed) throw new DOMException("Stopped", "AbortError");
    if (!(await this.db.uploads.get(id))) throw new DOMException("Removed", "AbortError");
    await this.db.uploads.update(id, change); this.patch(id, change);
  }
  private async run(job: UploadJob, signal: AbortSignal) {
    this.patch(job.id, { state: "uploading", error: undefined });
    try {
      const file = this.files.get(job.id); if (!file) throw new Error("Choose the original file.");
      const prepared = await api<{ fileId: string; folderId: string; attachment?: Attachment }>("/api/drive/uploads", {
        action: "prepare", uploadId: job.id, name: job.name, size: job.size, mimeType: job.mimeType,
      }, 125_000);
      signal.throwIfAborted();
      await this.persist(job.id, { fileId: prepared.fileId, folderId: prepared.folderId });
      if (!prepared.attachment) {
        let session = job.sessionUrl, offset = 0, complete = false;
        if (session) {
          try { const status = await this.drive.uploadStatus(session, file.size, signal); offset = status.offset; complete = Boolean(status.attachment); }
          catch (error) { if (error instanceof DriveError && [404, 410].includes(error.status)) session = undefined; else throw error; }
        }
        if (!session) {
          try { session = await this.drive.createUpload(file, prepared.folderId, prepared.fileId); }
          catch (error) {
            if (!(error instanceof DriveError) || error.status !== 409) throw error;
            complete = true; // A lost final response is verified by the completion endpoint below.
          }
          if (session) await this.persist(job.id, { sessionUrl: session });
        }
        let attempts = 0;
        while (!complete && session) {
          signal.throwIfAborted();
          if (!Number.isSafeInteger(offset) || offset < 0 || offset > file.size) throw new Error("Invalid upload progress.");
          try {
            const result = await this.drive.uploadChunk(session, file, offset, signal, (uploaded) => this.patch(job.id, { uploaded }));
            if (!result.attachment && result.offset <= offset) throw new Error("Upload stalled. Retry.");
            offset = result.offset; complete = Boolean(result.attachment); attempts = 0;
            await this.persist(job.id, { uploaded: offset });
          } catch (error) {
            if (signal.aborted || ++attempts > 3) throw error;
            if (error instanceof DriveError && error.status === 401) await this.token(true);
            await delay(1000 * 2 ** (attempts - 1), signal);
            const status = await this.drive.uploadStatus(session, file.size, signal);
            offset = status.offset; complete = Boolean(status.attachment);
          }
        }
      }
      signal.throwIfAborted();
      const attachment = prepared.attachment ?? await api<Attachment>("/api/drive/uploads", { action: "complete", uploadId: job.id });
      await this.persist(job.id, { attachment, uploaded: job.size });
      this.patch(job.id, { state: "done" }); this.files.delete(job.id);
    } catch (error) { this.patch(job.id, { state: signal.aborted ? "paused" : "failed", error: signal.aborted ? undefined : readableError(error) }); }
  }
}
