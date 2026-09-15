export class RequestError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export async function api<T>(path: string, body?: unknown, timeout = 30_000): Promise<T> {
  const response = await fetch(path, {
    method: "POST", credentials: "same-origin", cache: "no-store",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}), signal: AbortSignal.timeout(timeout),
  });
  const data = await response.json();
  if (!response.ok) throw new RequestError(typeof data.error === "string" ? data.error : "Request failed. Retry.", response.status);
  return data as T;
}

export function readableError(error: unknown) {
  if (error instanceof RequestError) return error.message;
  if (error instanceof Error && error.name === "AbortError") return "Canceled.";
  if (error instanceof Error && error.name === "TimeoutError") return "Request timed out. Your changes are saved locally.";
  return error instanceof Error ? error.message : "Request failed. Retry.";
}
