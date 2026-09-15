import type { VisibleMessage } from "./model";

type Position = Pick<VisibleMessage, "id" | "created_at">;
const GROUP_INTERVAL = 5 * 60_000;

export function startsTimeGroup(message: Position, previous?: Position): boolean {
  if (!previous) return true;
  const time = new Date(message.created_at), before = new Date(previous.created_at);
  return time.toDateString() !== before.toDateString() || time.getTime() - before.getTime() >= GROUP_INTERVAL;
}

function comparePosition(a: Position, b: Position) {
  return Date.parse(a.created_at) - Date.parse(b.created_at) || a.id.localeCompare(b.id);
}

export type IncomingState = {
  known: Set<string>;
  latest?: Position;
  unread: string[];
  divider?: string;
};

// A session-local arrival boundary, not a server-side read receipt.
export function trackIncoming(previous: IncomingState | undefined, messages: VisibleMessage[], readingLatest: boolean): IncomingState {
  const existing = new Set(messages.filter((message) => !message.deleted).map((message) => message.id));
  const confirmed = messages.filter((message) => !message.pending && !message.deleted);
  const incoming = previous ? confirmed.filter((message) =>
    !previous.known.has(message.id) && (!previous.latest || comparePosition(message, previous.latest) > 0)
  ).map((message) => message.id) : [];
  const remaining = previous?.unread.filter((id) => existing.has(id)) ?? [];
  const unread = readingLatest ? [] : [...remaining, ...incoming];
  let latest = previous?.latest;
  for (const message of confirmed) if (!latest || comparePosition(message, latest) > 0) latest = { id: message.id, created_at: message.created_at };
  const oldDivider = previous?.divider && existing.has(previous.divider) ? previous.divider : remaining[0];
  return {
    known: new Set(messages.map((message) => message.id)), latest, unread,
    divider: !readingLatest && remaining.length === 0 && incoming.length ? incoming[0] : oldDivider,
  };
}
