import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { GET } from "@/app/api/drive/thumbnail/route";
import { ApiError } from "@/lib/server/supabase";

const mocks = vi.hoisted(() => ({ authenticated: vi.fn(), googleAccess: vi.fn() }));
vi.mock("@/lib/server/supabase", async importOriginal => ({ ...await importOriginal<object>(), authenticated: mocks.authenticated }));
vi.mock("@/lib/server/google", () => ({ googleAccess: mocks.googleAccess }));

const query = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn() };
const request = () => new NextRequest("https://app.test/api/drive/thumbnail?fileId=owned-file");
const context = { user: { id: "current-user" }, client: { from: vi.fn(() => query) }, apply: (response: NextResponse) => { response.headers.set("Cache-Control", "private, no-store"); return response; } };
beforeEach(() => {
  vi.clearAllMocks();
  query.select.mockReturnValue(query); query.eq.mockReturnValue(query);
  query.maybeSingle.mockResolvedValue({ data: { metadata: { name: "photo.heic", mimeType: "image/heic" } }, error: null });
  mocks.authenticated.mockResolvedValue(context);
  mocks.googleAccess.mockResolvedValue({ token: "test-private-token" });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json({ thumbnailLink: "https://lh3.googleusercontent.com/private" }))
    .mockResolvedValueOnce(new Response("thumbnail", { headers: { "Content-Type": "image/jpeg" } })));
});
afterEach(() => vi.unstubAllGlobals());

describe("private thumbnail endpoint", () => {
  it("checks the current owner and completed upload before serving a bounded raster, never a link or token", async () => {
    const req = request(), response = await GET(req);
    expect(mocks.authenticated).toHaveBeenCalledWith(req, false);
    expect(context.client.from).toHaveBeenCalledWith("attachments");
    expect(query.eq.mock.calls).toEqual([["user_id", "current-user"], ["file_id", "owned-file"], ["ready", true]]);
    expect(mocks.googleAccess).toHaveBeenCalledWith("current-user");
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Content-Type")).toBe("image/jpeg");
    expect(response.headers.get("Cross-Origin-Resource-Policy")).toBe("same-origin");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(await response.text()).toBe("thumbnail");
  });
  it("rejects unauthenticated requests before touching attachments or Drive", async () => {
    mocks.authenticated.mockRejectedValueOnce(new ApiError(401, "Sign in again."));
    const response = await GET(request());
    expect(response.status).toBe(401); expect(context.client.from).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
  it("rejects attachments outside the current account before obtaining credentials", async () => {
    query.maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    const response = await GET(request());
    expect(response.status).toBe(404); expect(mocks.googleAccess).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
  it("rejects malformed IDs, non-images, and database failures", async () => {
    expect((await GET(new NextRequest("https://app.test/api/drive/thumbnail?fileId=../secret"))).status).toBe(400);
    query.maybeSingle.mockResolvedValueOnce({ data: { metadata: { name: "report.pdf", mimeType: "application/pdf" } }, error: null });
    expect((await GET(request())).status).toBe(404);
    query.maybeSingle.mockResolvedValueOnce({ data: null, error: { message: "private database details" } });
    const response = await GET(request());
    expect(response.status).toBe(503); expect(await response.text()).not.toContain("private database details");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("returns uncached no-content while Drive is generating the thumbnail", async () => {
    vi.mocked(fetch).mockReset().mockResolvedValueOnce(Response.json({}));
    const response = await GET(request());
    expect(response.status).toBe(204); expect(await response.text()).toBe("");
    expect(response.headers.get("Cache-Control")).toContain("no-store");
  });
});
