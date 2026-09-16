import Dexie, { type EntityTable } from "dexie";
import type { Mutation, Message, RichNode, Attachment } from "./model";

export type AccountHint = { id: string; email?: string };
export const ACCOUNT_HINT_KEY = `gropbox:account:${process.env.NEXT_PUBLIC_SUPABASE_URL}`;

// A display-only pointer to this device's cache, never a session or authorization.
export function loadAccountHint(): AccountHint | null {
  try {
    const value = JSON.parse(localStorage.getItem(ACCOUNT_HINT_KEY) ?? "null");
    return value && /^[a-f0-9-]{36}$/i.test(value.id) && (value.email === undefined || typeof value.email === "string") ? { id: value.id, email: value.email } : null;
  } catch { console.warn("Local account hint unavailable; waiting for sign-in."); return null; }
}
export function saveAccountHint(user: AccountHint | null) {
  try {
    if (user) localStorage.setItem(ACCOUNT_HINT_KEY, JSON.stringify({ id: user.id, email: user.email }));
    else localStorage.removeItem(ACCOUNT_HINT_KEY);
  } catch { console.warn("Local account hint could not be saved."); }
}

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
