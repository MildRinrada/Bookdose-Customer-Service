"use client";

import { useState, type ReactNode } from "react";
import { Icon } from "@/components/Icon";
import { EmptyState } from "@/components/ui/display";
import { useToast } from "@/components/ui/Toast";
import { useProject } from "@/features/contracts/components/ProjectContext";
import { download } from "@/lib/api/client";
import { date } from "@/lib/format";
import { driveApi } from "../api";
import { fileSize } from "../files";
import { partyLabel } from "../labels";
import type { DriveFile, DriveFolder } from "../types";

/* The files of one folder. A drive file downloads its latest version, and its version tag opens the history (every
   version with who, when and the note, each downloadable). A read-only folder's files are grouped (by version,
   milestone round or invoice) and download through the contract's own file route. */

const emptyText: Record<string, string> = {
  contract: "ไฟล์แนบของสัญญา/TOR ทุกเวอร์ชันที่ส่งแล้วจะแสดงที่นี่",
  delivery: "ไฟล์ที่ทีมงานแนบมากับการส่งมอบแต่ละรอบจะแสดงที่นี่",
  payment: "สลิปที่แนบกับใบแจ้งหนี้จะแสดงที่นี่",
};

/** report.pdf, version 2 of 3 → report (v2).pdf */
function versionName(name: string, version: number, latest: number): string {
  if (version === latest) return name;
  const dot = name.lastIndexOf(".");
  return dot > 0 ? `${name.slice(0, dot)} (v${version})${name.slice(dot)}` : `${name} (v${version})`;
}

export function DriveFileTable({
  folder,
  base,
  onRemove,
}: {
  folder: DriveFolder;
  /** The drive's API address (ProjectLinks.drive). */
  base: string;
  onRemove: (file: DriveFile) => void;
}) {
  const { side } = useProject();
  const toast = useToast();
  const [open, setOpen] = useState<string | null>(null);
  const drive = driveApi(base);
  const save = (path: string, name: string) =>
    download(path, name).catch((error: Error) => toast(error.message, true));
  if (!folder.files.length)
    return (
      <EmptyState
        title="ยังไม่มีไฟล์ในโฟลเดอร์นี้"
        description={
          folder.system ? emptyText[folder.id] : "กด “อัปโหลดไฟล์” หรือลากไฟล์มาวางที่นี่"
        }
        icon="file"
      />
    );
  const rows: ReactNode[] = [];
  let group: string | undefined;
  for (const f of folder.files) {
    if (folder.system && f.group !== group) {
      group = f.group;
      rows.push(
        <tr key={`group-${group}`} className="drive-group">
          <th colSpan={6} scope="colgroup">
            {group}
          </th>
        </tr>,
      );
    }
    const latest = f.versions[0];
    const opened = open === f.id;
    rows.push(
      <tr key={f.id}>
        <td>
          <button
            type="button"
            className="link-button drive-name"
            onClick={() => save(f.download ?? drive.versionPath(latest.id), f.name)}
          >
            <Icon name="paperclip" />
            {f.name}
          </button>
        </td>
        <td>
          {latest ? (
            <button
              type="button"
              className="drive-version"
              aria-expanded={opened}
              title="ดูทุกเวอร์ชัน"
              onClick={() => setOpen(opened ? null : f.id)}
            >
              v{f.version}
              <Icon name="down" />
            </button>
          ) : (
            <span className="muted">–</span>
          )}
        </td>
        <td className="drive-size">{fileSize(f.size)}</td>
        <td>
          {f.uploaded_by}
          <span className="tiny muted drive-party">{partyLabel(side, f.party)}</span>
        </td>
        <td className="drive-date">{date(f.updated_at, true)}</td>
        <td className="drive-actions">
          {f.can_delete && (
            <button
              type="button"
              className="icon-btn sm"
              aria-label={`ลบไฟล์ ${f.name}`}
              title="ลบไฟล์"
              onClick={() => onRemove(f)}
            >
              <Icon name="trash" />
            </button>
          )}
        </td>
      </tr>,
    );
    if (opened)
      rows.push(
        <tr key={`history-${f.id}`} className="drive-history">
          <td colSpan={6}>
            <ol aria-label={`เวอร์ชันของ ${f.name}`}>
              {f.versions.map((v) => (
                <li key={v.id}>
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => save(drive.versionPath(v.id), versionName(f.name, v.version, f.versions[0].version))}
                  >
                    <Icon name="download" />v{v.version}
                  </button>
                  <span className="muted">
                    {fileSize(v.size)} · {v.uploaded_by} ({partyLabel(side, v.party)}) · {date(v.created_at, true)}
                  </span>
                  {v.note && <span className="drive-note">{v.note}</span>}
                </li>
              ))}
            </ol>
          </td>
        </tr>,
      );
  }
  return (
    <div className="table-scroll">
      <table className="drive-table">
        <thead>
          <tr>
            <th>ชื่อไฟล์</th>
            <th>เวอร์ชัน</th>
            <th>ขนาด</th>
            <th>โดย</th>
            <th>อัปเดต</th>
            <th aria-label="จัดการ" />
          </tr>
        </thead>
        <tbody>{rows}</tbody>
      </table>
    </div>
  );
}
