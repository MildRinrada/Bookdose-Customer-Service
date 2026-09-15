/* What may be attached, in one place. The server checks the same list plus each file's real first bytes, so a
   renamed program cannot get through; this side says no immediately, by name, instead of after sending. */

export const ALLOWED_FILE_TYPES = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'mp4', 'webm', 'pdf', 'txt']);
export const FILE_LIMITS = { count: 3, bytes: 5 * 1024 * 1024 };
export const ALLOWED_FILE_TEXT = 'แนบได้สูงสุด 3 ไฟล์ รวมไม่เกิน 5 MB · PNG, JPG, GIF, WebP, MP4, WebM, PDF และ TXT';

export type Upload = { name: string; data: string };

/** Why these files cannot be sent, or '' when they can. */
export function fileProblem(files: File[]): string {
  if (files.length > FILE_LIMITS.count) return `แนบได้สูงสุด ${FILE_LIMITS.count} ไฟล์ · ${ALLOWED_FILE_TEXT}`;
  for (const file of files) {
    const parts = file.name.split('.');
    if (parts.length < 2 || !ALLOWED_FILE_TYPES.has(parts.pop()!.toLowerCase()))
      return `“${file.name}” เป็นชนิดไฟล์ที่ระบบไม่รองรับ · ${ALLOWED_FILE_TEXT}`;
    if (!file.size) return `“${file.name}” เป็นไฟล์ว่าง กรุณาเลือกไฟล์อื่น`;
  }
  if (files.reduce((total, file) => total + file.size, 0) > FILE_LIMITS.bytes)
    return 'ขนาดไฟล์รวมต้องไม่เกิน 5 MB กรุณาเอาบางไฟล์ออก';
  return '';
}

export function readFile(file: File): Promise<Upload> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ name: file.name, data: String(reader.result).split(',')[1] ?? '' });
    reader.onerror = () => reject(new Error('อ่านไฟล์ไม่สำเร็จ'));
    reader.readAsDataURL(file);
  });
}

/** The files as the API takes them ({name, data: base64}); throws the reason when they cannot be sent. */
export async function readFiles(files: File[]): Promise<Upload[]> {
  const problem = fileProblem(files);
  if (problem) throw new Error(problem);
  return Promise.all(files.map(readFile));
}
