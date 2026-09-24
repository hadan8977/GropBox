import { describe, expect, it } from "vitest";
import { fileExtension, fileKind, imagePreviewMime } from "@/lib/file-types";

describe("attachment types", () => {
  it.each([
    ["scan.PDF", "application/octet-stream", "pdf"],
    ["contract.docx", "", "document"],
    ["budget.XLSX", "application/octet-stream", "spreadsheet"],
    ["export", "text/csv; charset=utf-8", "spreadsheet"],
    ["slides.pptx", "", "presentation"],
    ["backup.tar.gz", "", "archive"],
    ["voice", "audio/aac", "audio"],
    ["clip.mkv", "", "video"],
    ["settings.json", "text/plain", "code"],
    ["notes.md", "text/plain", "text"],
    ["Photo.HEIC", "application/octet-stream", "image"],
    ["photo", "IMAGE/JPEG", "image"],
    ["drawing.svg", "image/svg+xml", "image"],
    ["font.woff2", "", "font"],
    ["installer.dmg", "", "application"],
    ["mislabeled.png", "application/pdf", "pdf"],
    [".env", "", "file"],
    ["unknown.weird", "application/octet-stream", "file"],
    ["unknown", "__proto__", "file"],
    ["unknown", "constructor", "file"],
  ])("classifies %s (%s) as %s", (name, mimeType, kind) => {
    expect(fileKind({ name, mimeType })).toBe(kind);
  });
  it("handles paths, mixed case and absent extensions", () => {
    expect(fileExtension("folder.name\\report.DOCX")).toBe("docx");
    expect(fileExtension("folder.name/README")).toBe("");
    expect(fileExtension(".hidden")).toBe("");
    expect(fileExtension("file.")).toBe("");
  });
  it("only infers raster MIME for originals with missing or generic metadata", () => {
    expect(imagePreviewMime({ name: "photo.JPG", mimeType: "application/octet-stream" })).toBe("image/jpeg");
    expect(imagePreviewMime({ name: "photo.png", mimeType: "text/html" })).toBe("text/html");
    expect(imagePreviewMime({ name: "drawing.svg", mimeType: "" })).toBe("");
    expect(imagePreviewMime({ name: "file.constructor", mimeType: "" })).toBe("");
  });
});
