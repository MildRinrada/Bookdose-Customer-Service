/* What may be put in the project drive, as backend/modules/drive/schema.py checks it (plus each file's real content
   there). The request body is at most 8 MB and files travel as base64, so the drive takes one file per request of at
   most 5 MB and the screen sends several one after another. */

export const DRIVE_FILE_TYPES = new Set([
  "pdf",
  "png",
  "jpg",
  "jpeg",
  "webp",
  "docx",
  "xlsx",
  "pptx",
  "zip",
  "txt",
  "csv",
  "md",
]);
export const DRIVE_MAX_BYTES = 5 * 1024 * 1024;
export const DRIVE_ACCEPT = [...DRIVE_FILE_TYPES].map((t) => `.${t}`).join(",");
export const DRIVE_FILE_TEXT =
  "ไฟล์ละไม่เกิน 5 MB · PDF, PNG, JPG, WebP, Word, Excel, PowerPoint, ZIP, TXT, CSV และ Markdown";
/** The folder the server puts a file in when none is chosen (made on first use). */
export const GENERAL_FOLDER = "ไฟล์ทั่วไป";

/** Why this file cannot go in the drive, or '' when it can. */
export function driveFileProblem(file: File): string {
  const parts = file.name.split(".");
  if (parts.length < 2 || !DRIVE_FILE_TYPES.has(parts.pop()!.toLowerCase()))
    return `“${file.name}” เป็นชนิดไฟล์ที่คลังเอกสารไม่รองรับ`;
  if (!file.size) return `“${file.name}” เป็นไฟล์ว่าง`;
  if (file.size > DRIVE_MAX_BYTES) return `“${file.name}” ใหญ่เกิน 5 MB`;
  return "";
}

/** 820 B, 12 KB, 1.4 MB */
export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
