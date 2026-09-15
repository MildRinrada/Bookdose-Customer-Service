"use client";

import { useCallback, useState, type DragEvent } from "react";
import { Icon } from "@/components/Icon";
import { useDialogs } from "@/components/ui/Dialogs";
import { ErrorState, PageLoading } from "@/components/ui/display";
import { useToast } from "@/components/ui/Toast";
import { driveApi } from "@/features/drive/api";
import { DriveFileTable } from "@/features/drive/components/DriveFileTable";
import { DriveFolderList } from "@/features/drive/components/DriveFolderList";
import { DriveFolderForm, DriveUploadForm } from "@/features/drive/components/DriveForms";
import { useDriveUpload } from "@/features/drive/components/useDriveUpload";
import { DRIVE_FILE_TEXT, driveFileProblem } from "@/features/drive/files";
import { partyLabel } from "@/features/drive/labels";
import type { DriveFile, DriveView } from "@/features/drive/types";
import { useApi, useInvalidate } from "@/lib/query";
import { useProject } from "./ProjectContext";

/* คลังเอกสาร: the project's central files in folders with versions, uploaded by both sides, next to the read-only
   folders made from the signed documents, the delivered work and (with billing) the payment slips. The same markup
   for the team and the customer: its API is links.drive, and what the viewer may do comes from the server
   (can_upload, can_delete). Files are sent one per request (features/drive/files.ts), from the upload dialog or
   dropped on the open folder. Markup: pages/drive.css. */

export function ProjectDrive() {
  const { links, side } = useProject();
  const { data, error, refetch } = useApi<DriveView>(links.drive);
  const invalidate = useInvalidate();
  const { openModal, closeModal, confirm, confirmDelete } = useDialogs();
  const toast = useToast();
  const [selected, setSelected] = useState("");
  const [dragging, setDragging] = useState(false);
  // The contract's path is a prefix of the drive's: its events (drive_uploaded, drive_deleted) refresh too.
  const reload = useCallback(() => invalidate(links.base), [invalidate, links.base]);
  const { progress, upload } = useDriveUpload(links.drive, reload);

  if (error)
    return (
      <section className="card">
        <ErrorState title="เปิดคลังเอกสารไม่สำเร็จ" error={error} onRetry={() => void refetch()} />
      </section>
    );
  if (!data)
    return (
      <section className="card">
        <PageLoading />
      </section>
    );

  const drive = driveApi(links.drive);
  const folder =
    data.folders.find((f) => f.id === selected) ?? data.folders.find((f) => !f.system) ?? data.folders[0];
  const canDrop = data.can_upload && !folder.system && !progress;

  const send = async (files: File[], folderId: string, note: string) => {
    const landed = await upload(files, folderId, note);
    if (landed) setSelected(landed);
  };

  const openUpload = (folderId: string) =>
    openModal(
      "อัปโหลดไฟล์",
      <DriveUploadForm
        folders={data.folders}
        folderId={folderId}
        onCancel={() => closeModal()}
        onUpload={(files, target, note) => {
          closeModal(true);
          void send(files, target, note);
        }}
      />,
    );

  const openNewFolder = () =>
    openModal(
      "สร้างโฟลเดอร์",
      <DriveFolderForm
        onCancel={() => closeModal()}
        onCreate={async (name) => {
          const { id } = await drive.createFolder(name);
          await reload();
          setSelected(id);
          closeModal(true);
          toast(`สร้างโฟลเดอร์ “${name}” แล้ว`);
        }}
      />,
    );

  const removeFile = (file: DriveFile) =>
    confirmDelete({
      title: "ลบไฟล์",
      warning: `ลบ “${file.name}” ออกจากคลังเอกสาร`,
      effects: [
        `ทุกเวอร์ชันของไฟล์นี้ (${file.versions.length} เวอร์ชัน) จะไม่แสดงในคลังเอกสารอีก`,
        "การลบถูกบันทึกในความเคลื่อนไหวของโครงการที่ทั้งสองฝ่ายเห็น",
      ],
      confirmLabel: "ลบไฟล์",
      run: async () => {
        await drive.removeFile(file.id);
        await reload();
        toast(`ลบ “${file.name}” แล้ว`);
      },
    });

  const removeFolder = () =>
    confirm({
      title: "ลบโฟลเดอร์",
      message: `ลบโฟลเดอร์ “${folder.name}” ที่ว่างอยู่ออกจากคลังเอกสาร?`,
      confirmLabel: "ลบโฟลเดอร์",
      tone: "danger",
      run: async () => {
        await drive.removeFolder(folder.id);
        setSelected("");
        await reload();
        toast(`ลบโฟลเดอร์ “${folder.name}” แล้ว`);
      },
    });

  const drag = (e: DragEvent<HTMLElement>) => {
    if (!canDrop || !e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    setDragging(true);
  };
  const drop = (e: DragEvent<HTMLElement>) => {
    if (!canDrop) return;
    e.preventDefault();
    setDragging(false);
    const files = [...e.dataTransfer.files];
    const problem = files.map(driveFileProblem).find(Boolean);
    if (problem) toast(`${problem} · ${DRIVE_FILE_TEXT}`, true);
    const good = files.filter((file) => !driveFileProblem(file));
    if (good.length) void send(good, folder.id, "");
  };

  return (
    <div className="drive">
      <section className="card">
        <div className="card-header">
          <div>
            <h2>คลังเอกสารโครงการ</h2>
            <p>
              {side === "org"
                ? "ไฟล์กลางที่ทีมงานและลูกค้าใช้ร่วมกัน อัปโหลดชื่อเดิมในโฟลเดอร์เดิมจะเก็บเป็นเวอร์ชันใหม่ ลูกค้าได้รับแจ้งเมื่อทีมงานเพิ่มไฟล์"
                : "ไฟล์กลางที่คุณและทีมงานผู้รับจ้างใช้ร่วมกัน อัปโหลดชื่อเดิมในโฟลเดอร์เดิมจะเก็บเป็นเวอร์ชันใหม่ ประวัติทุกเวอร์ชันยังดาวน์โหลดได้"}
            </p>
          </div>
          {data.can_upload && (
            <div className="drive-toolbar">
              <button type="button" className="btn sm" onClick={openNewFolder}>
                <Icon name="plus" />
                สร้างโฟลเดอร์
              </button>
              <button
                type="button"
                className="btn sm primary"
                disabled={Boolean(progress)}
                onClick={() => openUpload(folder.system ? "" : folder.id)}
              >
                <Icon name="paperclip" />
                อัปโหลดไฟล์
              </button>
            </div>
          )}
        </div>
        {progress && (
          <div className="drive-progress" role="status" aria-live="polite">
            <span>
              กำลังอัปโหลด {progress.done + 1}/{progress.total} · {progress.current}
            </span>
            <progress className="project-meter" max={progress.total} value={progress.done}>
              {progress.done}/{progress.total}
            </progress>
          </div>
        )}
      </section>
      <div className="drive-layout">
        <DriveFolderList folders={data.folders} current={folder.id} onSelect={setSelected} />
        <section
          className="card drive-main"
          data-dragging={dragging ? "true" : undefined}
          onDragOver={drag}
          onDragEnter={drag}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
          }}
          onDrop={drop}
        >
          <div className="card-header">
            <div>
              <h2>{folder.name}</h2>
              <p>
                {folder.system
                  ? "สร้างจากไฟล์ของโครงการ · ดาวน์โหลดได้อย่างเดียว"
                  : `สร้างโดย ${folder.created_by} (${partyLabel(side, folder.party)}) · ${folder.files.length} ไฟล์`}
              </p>
            </div>
            <div className="drive-toolbar">
              {!folder.system && data.can_upload && (
                <button
                  type="button"
                  className="btn sm subtle"
                  disabled={Boolean(progress)}
                  onClick={() => openUpload(folder.id)}
                >
                  <Icon name="paperclip" />
                  อัปโหลดในโฟลเดอร์นี้
                </button>
              )}
              {folder.can_delete && (
                <button type="button" className="btn sm subtle" onClick={removeFolder}>
                  <Icon name="trash" />
                  ลบโฟลเดอร์
                </button>
              )}
            </div>
          </div>
          <DriveFileTable folder={folder} base={links.drive} onRemove={removeFile} />
          {canDrop && <p className="drive-drop-hint tiny muted">ลากไฟล์มาวางในกรอบนี้เพื่ออัปโหลดเข้าโฟลเดอร์ “{folder.name}”</p>}
        </section>
      </div>
    </div>
  );
}
