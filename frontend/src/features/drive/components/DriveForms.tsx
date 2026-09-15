"use client";

import { useState } from "react";
import { filesOf } from "@/components/ui/FileInput";
import { Form } from "@/components/ui/Form";
import { FormActions, RequiredStar, SelectField, TextArea, TextField } from "@/components/ui/fields";
import { DRIVE_ACCEPT, DRIVE_FILE_TEXT, GENERAL_FOLDER, driveFileProblem, fileSize } from "../files";
import type { DriveFolder } from "../types";

/* The drive's two dialogs: อัปโหลดไฟล์ (into a folder, with a note for this version) and สร้างโฟลเดอร์. */

/** Choose a folder and files; the chosen files are listed with their size, what is wrong with one, or that it will be
    the next version of a file already in that folder. The files are sent by the caller after the dialog closes. */
export function DriveUploadForm({
  folders,
  folderId,
  onUpload,
  onCancel,
}: {
  folders: DriveFolder[];
  /** The folder open on the page ('' or a read-only one: the general folder). */
  folderId: string;
  onUpload: (files: File[], folderId: string, note: string) => void;
  onCancel: () => void;
}) {
  const own = folders.filter((f) => !f.system);
  const general = own.find((f) => f.name === GENERAL_FOLDER);
  const [target, setTarget] = useState(
    own.find((f) => f.id === folderId)?.id ?? general?.id ?? own[0]?.id ?? "",
  );
  const [chosen, setChosen] = useState<File[]>([]);
  const names = new Set((own.find((f) => f.id === target)?.files ?? []).map((f) => f.name.toLowerCase()));
  return (
    <Form
      onChange={(e) => {
        // Changes bubble up from the folder select and the file input.
        const input: EventTarget = e.target;
        if (input instanceof HTMLSelectElement && input.name === "folder_id") setTarget(input.value);
        if (input instanceof HTMLInputElement && input.type === "file") setChosen([...(input.files ?? [])]);
      }}
      onSubmit={async (values, form) => {
        const files = filesOf(form, "files");
        if (!files.length) throw new Error("กรุณาเลือกไฟล์อย่างน้อย 1 ไฟล์");
        const problem = files.map(driveFileProblem).find(Boolean);
        if (problem) throw new Error(`${problem} · ${DRIVE_FILE_TEXT}`);
        onUpload(files, values.folder_id ?? "", (values.note ?? "").trim());
      }}
    >
      <SelectField label="โฟลเดอร์" name="folder_id" defaultValue={target}>
        {!general && <option value="">{GENERAL_FOLDER} (สร้างให้เมื่ออัปโหลด)</option>}
        {own.map((f) => (
          <option key={f.id} value={f.id}>
            {f.name}
          </option>
        ))}
      </SelectField>
      <div className="field">
        <label htmlFor="drive-files">
          ไฟล์
          <RequiredStar />
        </label>
        <input id="drive-files" type="file" name="files" multiple accept={DRIVE_ACCEPT} />
        <p className="tiny muted">
          {DRIVE_FILE_TEXT} · เลือกได้หลายไฟล์ ระบบส่งทีละไฟล์ให้เอง · ชื่อซ้ำกับไฟล์ในโฟลเดอร์จะเป็นเวอร์ชันใหม่
        </p>
        {chosen.length > 0 && (
          <ul className="drive-chosen">
            {chosen.map((file, i) => {
              const problem = driveFileProblem(file);
              return (
                <li key={`${file.name}-${i}`}>
                  <span className="grow">{file.name}</span>
                  <span className="muted">{fileSize(file.size)}</span>
                  {problem ? (
                    <span className="drive-tag danger">{problem}</span>
                  ) : names.has(file.name.toLowerCase()) ? (
                    <span className="drive-tag">เวอร์ชันใหม่ของไฟล์เดิม</span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <TextArea
        label="หมายเหตุของเวอร์ชันนี้"
        name="note"
        required={false}
        max={500}
        rows={2}
        hint="เช่น แก้ตามคอมเมนต์รอบที่ 2 (ใช้กับทุกไฟล์ที่เลือก)"
      />
      <FormActions label="อัปโหลด" onCancel={onCancel} />
    </Form>
  );
}

/** สร้างโฟลเดอร์: throw to show the server's reason (a name taken, a system folder's name) on the form. */
export function DriveFolderForm({
  onCreate,
  onCancel,
}: {
  onCreate: (name: string) => Promise<unknown>;
  onCancel: () => void;
}) {
  return (
    <Form onSubmit={async (values) => onCreate((values.name ?? "").trim())}>
      <TextField
        label="ชื่อโฟลเดอร์"
        name="name"
        max={100}
        autoFocus
        hint="เช่น แบบร่างหน้าจอ, รายงานการประชุม, คู่มือการใช้งาน · ใช้ / หรือ \ ไม่ได้"
      />
      <FormActions label="สร้างโฟลเดอร์" onCancel={onCancel} />
    </Form>
  );
}
