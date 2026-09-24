import { AppWindow, File, FileArchive, FileCode2, FileMusic, FileSpreadsheet, FileText, FileType2, FileVideo, ImageIcon, Presentation } from "lucide-react";
import { fileExtension, fileKind, type FileKind } from "@/lib/file-types";
import type { Attachment } from "@/lib/model";

const icons = { image: ImageIcon, pdf: FileText, document: FileText, spreadsheet: FileSpreadsheet, presentation: Presentation, archive: FileArchive, audio: FileMusic, video: FileVideo, code: FileCode2, text: FileText, font: FileType2, application: AppWindow, file: File };
const labels: Record<FileKind, string> = { image: "Image", pdf: "PDF", document: "Document", spreadsheet: "Spreadsheet", presentation: "Presentation", archive: "Archive", audio: "Audio", video: "Video", code: "Code", text: "Text", font: "Font", application: "Application", file: "File" };

export function FileTypeIcon({ file, compact = false }: { file: Pick<Attachment, "name" | "mimeType">; compact?: boolean }) {
  const kind = fileKind(file), Icon = icons[kind], extension = fileExtension(file.name);
  if (compact) return <Icon className="transfer-file" aria-hidden="true" />;
  return <span className="file-icon" data-kind={kind} role="img" aria-label={`${labels[kind]} file`}>
    <Icon size={22} aria-hidden="true" />
    {extension && extension.length <= 5 && <span className="file-extension" aria-hidden="true">{extension.toUpperCase()}</span>}
  </span>;
}
