'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Icon } from '@/components/Icon';
import { useDialogs } from '@/components/ui/Dialogs';
import { FormActions } from '@/components/ui/fields';
import { Form } from '@/components/ui/Form';
import { useApi } from '@/lib/query';
import { IMPORT_ACCEPT, IMPORT_MAX_BYTES, IMPORTS_PATH, startImport } from '../api';
import type { OpenImport } from '../types';

/* นำเข้าบทความ, from the knowledge page: choose a file, and the review page (features/knowledge/ImportScreen) shows
   the drafts it made. Nothing is an article until the หัวหน้าทีม saves it there. */

export function ImportArticlesButton() {
  const { openModal } = useDialogs();
  return (
    <button type="button" className="btn kb-new" onClick={() => openModal('นำเข้าบทความจากไฟล์', <ImportForm />)}>
      <Icon name="file" />
      นำเข้าจากไฟล์
    </button>
  );
}

function ImportForm() {
  const router = useRouter();
  const { closeModal } = useDialogs();
  const [file, setFile] = useState<File | null>(null);
  const [problem, setProblem] = useState('');
  return (
    <Form
      className="stack"
      onSubmit={async () => {
        if (!file) throw new Error('เลือกไฟล์ก่อน');
        const found = await startImport(file);
        closeModal(true);
        router.push(`/knowledge/import/${found.id}`);
      }}
    >
      <div className="field">
        <label htmlFor="import-file">ไฟล์</label>
        <input
          id="import-file"
          type="file"
          accept={IMPORT_ACCEPT}
          aria-invalid={problem ? true : undefined}
          aria-describedby="import-file-hint"
          onChange={(e) => {
            const chosen = e.currentTarget.files?.[0] ?? null;
            const tooBig = Boolean(chosen && chosen.size > IMPORT_MAX_BYTES);
            setProblem(tooBig ? `ไฟล์ใหญ่เกิน ${IMPORT_MAX_BYTES / 1024 / 1024} MB` : '');
            setFile(tooBig ? null : chosen);
          }}
        />
        <small id="import-file-hint" className="muted">
          PDF ที่มีตัวอักษรในไฟล์, Word (.docx), .txt หรือ .md ไม่เกิน {IMPORT_MAX_BYTES / 1024 / 1024} MB
        </small>
        {problem && (
          <p className="file-error" role="alert">
            {problem}
          </p>
        )}
      </div>
      <ul className="import-about">
        <li>ระบบแบ่งไฟล์เป็นร่างบทความตามหัวข้อในไฟล์ ถ้าองค์กรเปิด AI ช่วยเจ้าหน้าที่ไว้ AI จะรวมหัวข้อที่เป็นเรื่องเดียวกัน ตั้งชื่อ และเลือกหมวดให้ เนื้อหายังเป็นคำในไฟล์ทุกคำ</li>
        <li>ยังไม่มีบทความไหนถูกบันทึก จนกว่าคุณจะตรวจร่างและกดบันทึก ร่างเริ่มต้นเป็นภายในองค์กร ลูกค้าและ Chatbot ยังไม่เห็น</li>
        <li>ระบบไม่เก็บไฟล์ เก็บเฉพาะร่าง 7 วัน</li>
      </ul>
      <FormActions label="อ่านไฟล์" onCancel={() => closeModal()} />
    </Form>
  );
}

/** The imports still waiting to be checked, under the knowledge page's heading, so a draft left halfway is found again. */
export function OpenImports() {
  const page = useApi<{ imports: OpenImport[] }>(IMPORTS_PATH);
  const waiting = (page.data?.imports ?? []).filter((i) => i.open);
  if (!waiting.length) return null;
  return (
    <div className="notice import-waiting" role="status">
      <Icon name="file" />
      <span>
        ร่างจากไฟล์ที่ยังตรวจไม่เสร็จ:{' '}
        {waiting.map((item, index) => (
          <span key={item.id}>
            {index ? ', ' : ''}
            <Link href={`/knowledge/import/${item.id}`}>{item.file_name}</Link> (เหลือ {item.open} ร่าง)
          </span>
        ))}
      </span>
    </div>
  );
}
