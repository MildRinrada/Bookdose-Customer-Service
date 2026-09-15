"use client";

import { useCallback, useRef, useState } from "react";
import { useToast } from "@/components/ui/Toast";
import { readFile } from "@/lib/files";
import { driveApi } from "../api";

/* Several files go to the drive one request each (the server takes one file of at most 5 MB per request), one after
   another. While they go, `progress` says which one; a file the server refuses does not stop the others, and the
   toast sums up what went and why the first failure failed. */

export type UploadProgress = { total: number; done: number; current: string };

export function useDriveUpload(base: string, onChanged: () => Promise<unknown>) {
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const running = useRef(false);
  const toast = useToast();
  /** Returns the folder the files went to (the general folder is made on the first upload without one), or null. */
  const upload = useCallback(
    async (files: File[], folderId: string, note: string): Promise<string | null> => {
      if (running.current) {
        toast("กำลังอัปโหลดไฟล์ชุดก่อนอยู่ กรุณารอให้เสร็จก่อน", true);
        return null;
      }
      running.current = true;
      const drive = driveApi(base);
      const failed: string[] = [];
      let folder = folderId;
      let landed: string | null = null;
      let sent = 0;
      try {
        for (const [i, file] of files.entries()) {
          setProgress({ total: files.length, done: i, current: file.name });
          try {
            const result = await drive.upload(folder, await readFile(file), note);
            folder = landed = result.folder_id;
            sent += 1;
          } catch (error) {
            failed.push(`“${file.name}”: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      } finally {
        running.current = false;
        setProgress(null);
      }
      await onChanged();
      if (failed.length)
        toast(
          sent
            ? `อัปโหลดแล้ว ${sent} ไฟล์ ไม่สำเร็จ ${failed.length} ไฟล์ · ${failed[0]}`
            : `อัปโหลดไม่สำเร็จ · ${failed[0]}`,
          true,
        );
      else toast(sent === 1 ? `อัปโหลด “${files[0].name}” แล้ว` : `อัปโหลดแล้ว ${sent} ไฟล์`);
      return landed;
    },
    [base, onChanged, toast],
  );
  return { progress, upload };
}
