import Dexie, { type EntityTable } from "dexie";
import type { Mutation, Message, RichNode, Attachment } from "./model";

export type PendingRecord = { id: string; mutation: Mutation; createdAt: string; error?: string; blocked?: boolean };
export type UploadRecord = {
  id: string; name: string; size: number; mimeType: string; lastModified: number;
  sessionUrl?: string; fileId?: string; folderId?: string; uploaded: number; attachment?: Attachment;
};
export type Draft = { id: string; body: RichNode | string; attachments: Attachment[]; title?: string; format?: "rich" | "text" | "markdown" };

export class DriveCache extends Dexie {
  messages!: EntityTable<Message, "id">;
  pending!: EntityTable<PendingRecord, "id">;
  settings!: EntityTable<{ key: string; value: string }, "key">;
  uploads!: EntityTable<UploadRecord, "id">;
  drafts!: EntityTable<Draft, "id">;

  constructor(accountId: string) {
    super(`paseo-v2:${encodeURIComponent(accountId)}`);
    this.version(1).stores({
      messages: "id, created_at",
      pending: "id",
      settings: "key",
      uploads: "id",
      drafts: "id",
    });
  }

  async setting(key: string): Promise<string | undefined> { return (await this.settings.get(key))?.value; }
  async setSetting(key: string, value: string) { await this.settings.put({ key, value }); }
}
