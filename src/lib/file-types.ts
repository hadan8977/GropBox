import type { Attachment } from "./model";

type FileDetails = Pick<Attachment, "name" | "mimeType">;
export type FileKind = "image" | "pdf" | "document" | "spreadsheet" | "presentation" | "archive" | "audio" | "video" | "code" | "text" | "font" | "application" | "file";

const extensions: Record<FileKind, readonly string[]> = {
  image: ["jpg", "jpeg", "png", "gif", "webp", "avif", "heic", "heif", "tif", "tiff", "bmp", "svg", "ico", "dng", "raw", "psd"],
  pdf: ["pdf"],
  document: ["doc", "docx", "odt", "rtf", "pages"],
  spreadsheet: ["xls", "xlsx", "xlsm", "ods", "csv", "tsv", "numbers"],
  presentation: ["ppt", "pptx", "odp", "key"],
  archive: ["zip", "7z", "rar", "tar", "gz", "tgz", "bz2", "xz", "zst"],
  audio: ["mp3", "m4a", "aac", "wav", "flac", "ogg", "opus", "aiff"],
  video: ["mp4", "mov", "m4v", "webm", "mkv", "avi", "wmv", "mpeg"],
  code: ["js", "jsx", "ts", "tsx", "json", "html", "htm", "css", "scss", "py", "rs", "go", "java", "c", "h", "cpp", "cs", "swift", "kt", "sh", "ps1", "sql", "xml", "yaml", "yml", "toml"],
  text: ["txt", "md", "markdown", "log", "ini", "conf"],
  font: ["ttf", "otf", "woff", "woff2"],
  application: ["exe", "msi", "dmg", "pkg", "apk", "deb", "rpm", "appimage"],
  file: [],
};
const mimeKinds: Record<string, FileKind> = {
  "application/pdf": "pdf",
  "application/msword": "document", "application/rtf": "document", "text/rtf": "document",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "document",
  "application/vnd.oasis.opendocument.text": "document", "application/vnd.google-apps.document": "document",
  "application/vnd.ms-excel": "spreadsheet", "text/csv": "spreadsheet", "text/tab-separated-values": "spreadsheet",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "spreadsheet",
  "application/vnd.oasis.opendocument.spreadsheet": "spreadsheet", "application/vnd.google-apps.spreadsheet": "spreadsheet",
  "application/vnd.ms-powerpoint": "presentation",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "presentation",
  "application/vnd.oasis.opendocument.presentation": "presentation", "application/vnd.google-apps.presentation": "presentation",
  "application/zip": "archive", "application/x-zip-compressed": "archive", "application/x-7z-compressed": "archive",
  "application/vnd.rar": "archive", "application/x-rar-compressed": "archive", "application/gzip": "archive", "application/x-tar": "archive",
  "application/json": "code", "application/ld+json": "code", "application/javascript": "code",
  "application/xml": "code", "text/xml": "code", "text/javascript": "code", "text/html": "code", "text/css": "code",
};

export function fileExtension(name: string) {
  const leaf = name.split(/[\\/]/).pop() ?? "";
  const dot = leaf.lastIndexOf(".");
  return dot > 0 ? leaf.slice(dot + 1).toLowerCase() : "";
}

export function fileKind(file: FileDetails): FileKind {
  const mime = file.mimeType.split(";")[0].trim().toLowerCase();
  for (const kind of ["image", "audio", "video", "font"] as const) if (mime.startsWith(`${kind}/`)) return kind;
  if (Object.hasOwn(mimeKinds, mime)) return mimeKinds[mime];
  const extension = fileExtension(file.name);
  const kind = (Object.keys(extensions) as FileKind[]).find(key => extensions[key].includes(extension));
  return kind ?? (mime.startsWith("text/") ? "text" : "file");
}

// Inferred raster types are only used in <img> blobs, never to serve inline documents.
export function imagePreviewMime(file: FileDetails) {
  const mime = file.mimeType.split(";")[0].trim().toLowerCase();
  if (mime && mime !== "application/octet-stream") return mime;
  const images: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp", avif: "image/avif" };
  const extension = fileExtension(file.name);
  return Object.hasOwn(images, extension) ? images[extension] : mime;
}
