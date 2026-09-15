import { z } from "zod";

// Stable storage identity; independent of the display name.
export const APP_ID = "paseo-v1";
export const ROOT_NAME = "GropBox";
export const PAGE_SIZE = 30;
export const MAX_CONTENT_LENGTH = 150_000;
export const FILE_ID = /^[a-zA-Z0-9_-]{1,200}$/;

export type RichNode = {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  content?: RichNode[];
};

const allowedNodes = new Set(["doc", "paragraph", "text", "heading", "bulletList", "orderedList", "listItem", "blockquote", "codeBlock", "hardBreak", "horizontalRule", "table", "tableRow", "tableCell", "tableHeader"]);
const allowedMarks = new Set(["bold", "italic", "strike", "underline", "code", "link"]);

export function safeHref(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    if (["https:", "http:", "mailto:"].includes(url.protocol)) return url.href;
  } catch { return undefined; }
  return undefined;
}

export function isRichDocument(value: unknown): value is RichNode {
  let count = 0;
  function check(node: unknown, depth: number): boolean {
    if (++count > 10_000 || depth > 20 || !node || typeof node !== "object") return false;
    const n = node as RichNode;
    if (!allowedNodes.has(n.type)) return false;
    if (n.text !== undefined && typeof n.text !== "string") return false;
    if (n.attrs !== undefined && (!n.attrs || typeof n.attrs !== "object" || Array.isArray(n.attrs))) return false;
    if (n.marks !== undefined && (!Array.isArray(n.marks) || !n.marks.every((m) => m && allowedMarks.has(m.type) && (m.type !== "link" || Boolean(safeHref(m.attrs?.href)))))) return false;
    return n.content === undefined || (Array.isArray(n.content) && n.content.every((c) => check(c, depth + 1)));
  }
  return check(value, 0) && (value as RichNode).type === "doc";
}

export const richSchema = z.custom<RichNode>((value) => isRichDocument(value) && JSON.stringify(value).length <= MAX_CONTENT_LENGTH, "Invalid or oversized content.");
export const attachmentSchema = z.object({
  id: z.string().regex(FILE_ID),
  name: z.string().min(1).max(1024),
  size: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  mimeType: z.string().max(200),
});
export type Attachment = z.infer<typeof attachmentSchema>;

export const mutationSchema = z.object({
  operationId: z.string().uuid(),
  id: z.string().uuid(),
  expectedVersion: z.number().int().min(0),
  kind: z.enum(["message", "document"]),
  format: z.enum(["rich", "text", "markdown"]),
  title: z.string().max(200),
  body: z.union([z.string().max(MAX_CONTENT_LENGTH), richSchema]),
  attachments: z.array(attachmentSchema).max(30),
  pinned: z.boolean(),
  deleted: z.boolean(),
}).refine((m) => m.format === "rich" ? typeof m.body === "object" : typeof m.body === "string", "Content format mismatch.")
  .refine((m) => new TextEncoder().encode(JSON.stringify(m)).length <= 200_000, "Message too large. Send it as a file.");
export type Mutation = z.infer<typeof mutationSchema>;
export type Message = {
  id: string; user_id: string; kind: Mutation["kind"]; format: Mutation["format"];
  title: string; body: RichNode | string; attachments: Attachment[];
  pinned: boolean; deleted: boolean; version: number; archive_version: number;
  created_at: string; updated_at: string;
};
export type VisibleMessage = Message & { pending?: boolean; error?: string };

export function plainText(body: RichNode | string): string {
  if (typeof body === "string") return body;
  if (body.type === "text") return body.text ?? "";
  if (body.type === "hardBreak") return "\n";
  const separator = ["doc", "bulletList", "orderedList", "table", "tableRow", "blockquote", "listItem"].includes(body.type) ? "\n" : "";
  return body.content?.map(plainText).join(separator) ?? "";
}

export function editMutation(message: Message): Mutation {
  return {
    operationId: crypto.randomUUID(), id: message.id, expectedVersion: message.version,
    kind: message.kind, format: message.format, title: message.title, body: message.body,
    attachments: message.attachments, pinned: message.pinned, deleted: message.deleted,
  };
}

export function mergeMessages(remote: Message[], pending: { mutation: Mutation; createdAt: string; error?: string }[], userId: string): VisibleMessage[] {
  const map = new Map<string, VisibleMessage>(remote.map((m) => [m.id, m]));
  for (const { mutation: m, createdAt, error } of pending) {
    const prior = map.get(m.id);
    map.set(m.id, {
      id: m.id, user_id: userId, kind: m.kind, format: m.format, title: m.title, body: m.body,
      attachments: m.attachments, pinned: m.pinned, deleted: m.deleted,
      version: prior?.version ?? 0, archive_version: prior?.archive_version ?? 0,
      created_at: prior?.created_at ?? createdAt, updated_at: createdAt, pending: true, error,
    });
  }
  return [...map.values()].filter((m) => !m.deleted || m.pending).sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

export function canPreviewImage(mime: string) {
  return ["image/jpeg", "image/png", "image/gif", "image/webp", "image/avif"].includes(mime);
}

export function emptyDocument(): RichNode {
  return { type: "doc", content: [{ type: "paragraph" }] };
}
