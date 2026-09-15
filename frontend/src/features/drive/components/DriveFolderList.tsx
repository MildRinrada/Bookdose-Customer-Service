"use client";

import { Icon } from "@/components/Icon";
import type { DriveFolder } from "../types";

/* The folders beside the files: the drive's own folders first, then the read-only ones made from the project's
   documents, deliveries and (with billing) payment slips. */

export function DriveFolderList({
  folders,
  current,
  onSelect,
}: {
  folders: DriveFolder[];
  current: string | undefined;
  onSelect: (folderId: string) => void;
}) {
  const own = folders.filter((f) => !f.system);
  const item = (f: DriveFolder) => (
    <li key={f.id}>
      <button
        type="button"
        className="drive-folder"
        aria-current={f.id === current ? "true" : undefined}
        onClick={() => onSelect(f.id)}
      >
        <Icon name={f.system ? "lock" : "file"} />
        <span className="grow">{f.name}</span>
        <span className="drive-count">{f.files.length}</span>
      </button>
    </li>
  );
  return (
    <nav className="card drive-folders" aria-label="โฟลเดอร์ในคลังเอกสาร">
      <h3>โฟลเดอร์ของโครงการ</h3>
      {own.length ? (
        <ul>{own.map(item)}</ul>
      ) : (
        <p className="tiny muted drive-folders-hint">
          ยังไม่มีโฟลเดอร์ · อัปโหลดไฟล์แรกได้เลย ระบบจะเก็บไว้ในโฟลเดอร์ “ไฟล์ทั่วไป”
        </p>
      )}
      <h3>จากเอกสารและงวดงาน</h3>
      <ul>{folders.filter((f) => f.system).map(item)}</ul>
    </nav>
  );
}
