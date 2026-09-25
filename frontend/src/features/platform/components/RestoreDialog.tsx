'use client';

import { useEffect, useState } from 'react';
import { Icon } from '@/components/Icon';
import { useRunAction } from '@/components/ui/actions';
import { date, number } from '@/lib/format';
import { previewRestore, restoreBackup, uploadBackupPiece } from '../api';
import { bytesText } from '../labels';
import type { RestorePreview, RestoreResult } from '../types';

/* กู้คืนผ่านหน้าจอ (backend platform/restore.py), in the console's modal: what the file would replace - organizations
   replaced, added or gone, their cases now and in the file, who can sign in afterwards, whether the credentials come
   back - then the file's name typed out, then the restore. A backup of how things are now is taken first; everyone,
   the admin included, signs in again afterwards. Markup: pages/platform.css (.restore-*). */

const changeWords: Record<RestorePreview['organizations'][number]['change'], string> = {
  replace: 'ถูกแทนที่',
  add: 'เพิ่มกลับมา',
  remove: 'จะหายไป',
};

export function RestoreDialog({ name, onClose }: { name: string; onClose: () => void }) {
  const [preview, setPreview] = useState<RestorePreview | null>(null);
  const [problem, setProblem] = useState('');
  const [typed, setTyped] = useState('');
  const [withoutSecrets, setWithoutSecrets] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<RestoreResult | null>(null);
  const run = useRunAction();

  useEffect(() => {
    let live = true;
    previewRestore(name)
      .then((found) => live && setPreview(found))
      .catch((error: Error) => live && setProblem(error.message || 'อ่านไฟล์สำรองไม่สำเร็จ'));
    return () => {
      live = false;
    };
  }, [name]);

  if (done)
    return (
      <div className="restore-done" role="status">
        <p className="restore-done-title">
          <Icon name="checkCircle" />
          กู้คืนเสร็จแล้ว
        </p>
        <p>
          ทุกคนถูกออกจากระบบ รวมถึงคุณ เข้าสู่ระบบใหม่ด้วยบัญชีที่อยู่ในไฟล์สำรอง
          {done.secrets_skipped && ' · ยังไม่มี Token ของช่องทาง ต้องใส่ LINE อีเมล Facebook คีย์ AI และ SMS ใหม่'}
        </p>
        <p className="tiny muted">
          ข้อมูลก่อนกู้เก็บไว้ที่ <code>{done.safety_backup}</code> ถ้ากู้ผิดไฟล์ กู้คืนจากไฟล์นี้เพื่อกลับไปเหมือนเดิม
        </p>
        <button type="button" className="btn primary" onClick={() => window.location.assign('/login')}>
          ไปหน้าเข้าสู่ระบบ
        </button>
      </div>
    );
  if (problem) return <p className="notice warning">{problem}</p>;
  if (!preview) return <p className="muted">กำลังอ่านไฟล์สำรอง…</p>;

  const t = preview.totals;
  const needsChoice = !preview.secrets.available;
  const ready = typed.trim() === preview.confirm && (!needsChoice || withoutSecrets) && !busy;
  const cases = (value: number | null) => (value == null ? 'ไม่มี' : `${number(value)} เคส`);

  return (
    <div className="restore">
      <p className="restore-file">
        <Icon name="file" />
        <span>
          <strong>{preview.name}</strong>
          สำรองเมื่อ {preview.created_at ? date(preview.created_at, true) : 'ไม่ทราบ'} · {bytesText(preview.size)}
        </span>
      </p>

      <p className="notice danger-notice">
        ข้อมูลทั้งแพลตฟอร์มจะถูกแทนที่ด้วยไฟล์นี้ สิ่งที่เกิดขึ้นหลังเวลาสำรองจะหายไป
      </p>

      <div className="restore-totals">
        <div>
          <strong>{number(t.replace + t.add)}</strong>
          <span>องค์กรหลังกู้</span>
          <small>
            แทนที่ {t.replace} · เพิ่ม {t.add} · หายไป {t.remove}
          </small>
        </div>
        <div>
          <strong>{number(t.cases_backup)}</strong>
          <span>เคสหลังกู้</span>
          <small>ตอนนี้ {number(t.cases_now)} เคส</small>
        </div>
      </div>

      <ul className="restore-orgs">
        {preview.organizations.map((org) => (
          <li key={org.id} className={`is-${org.change}`}>
            <span className="restore-org-name">
              <strong>{org.name}</strong>
              <small>{org.slug}</small>
            </span>
            <span className={`restore-change is-${org.change}`}>{changeWords[org.change]}</span>
            <span className="restore-cases">
              {org.change === 'add' ? cases(org.cases_backup) : `${cases(org.cases_now)} → ${cases(org.cases_backup)}`}
            </span>
          </li>
        ))}
      </ul>

      <ul className="restore-notes">
        <li>ก่อนกู้ ระบบจะสำรองข้อมูลตอนนี้เก็บไว้ให้อัตโนมัติ ถ้ากู้ผิดไฟล์ กู้กลับจากไฟล์นั้นได้</li>
        <li>
          ทุกคนถูกออกจากระบบ รวมถึงคุณ ผู้ดูแลแพลตฟอร์มที่เข้าได้หลังกู้:{' '}
          <strong>{preview.platform_admins.join(', ') || 'ไม่มี'}</strong>
        </li>
        <li>ไฟล์แนบ {number(preview.attachments)} ไฟล์</li>
        {preview.secrets.available ? (
          <li>Token ของช่องทาง (LINE อีเมล Facebook คีย์ AI SMS) กู้คืนได้ เพราะเซิร์ฟเวอร์นี้มีกุญแจ {preview.secrets.key_id}</li>
        ) : (
          <li className="restore-warn">
            เซิร์ฟเวอร์นี้ไม่มีกุญแจ <code>{preview.secrets.key_id}</code> ที่เข้ารหัส Token ในไฟล์นี้ ตั้ง BOOKDOSE_SECRET_KEY เดิมก่อนถ้ายังมีอยู่
            <label className="check">
              <input type="checkbox" checked={withoutSecrets} onChange={(e) => setWithoutSecrets(e.target.checked)} />
              กู้คืนโดยไม่มี Token (ต้องใส่ LINE อีเมล Facebook คีย์ AI และ SMS ใหม่)
            </label>
          </li>
        )}
      </ul>

      <label className="field restore-confirm">
        <span>
          พิมพ์ <code>{preview.confirm}</code> เพื่อยืนยัน
        </span>
        <input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} />
      </label>

      <div className="flex wrap restore-actions">
        <button type="button" className="btn" onClick={onClose} disabled={busy}>
          ยกเลิก
        </button>
        <button
          type="button"
          className="btn danger"
          disabled={!ready}
          onClick={() =>
            void run(async () => {
              setBusy(true);
              try {
                setDone(await restoreBackup({ name: preview.name, confirm: typed.trim(), without_secrets: withoutSecrets }));
              } finally {
                setBusy(false);
              }
            })
          }
        >
          <Icon name="restore" />
          {busy ? 'กำลังสำรองข้อมูลปัจจุบันและกู้คืน…' : 'กู้คืนข้อมูล'}
        </button>
      </div>
    </div>
  );
}

const PIECE = 3 * 1024 * 1024;

function base64Of(bytes: Uint8Array) {
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}

/** Send a backup file from this computer in pieces; resolves with the name the console keeps it under. */
export async function uploadBackupFile(file: File, onProgress: (share: number) => void) {
  let upload: string | null = null;
  let offset = 0;
  do {
    const piece = new Uint8Array(await file.slice(offset, offset + PIECE).arrayBuffer());
    const last = offset + piece.length >= file.size;
    const answer = await uploadBackupPiece({ upload, offset, data: base64Of(piece), last });
    offset += piece.length;
    onProgress(file.size ? offset / file.size : 1);
    if (last) {
      if (!answer.name) throw new Error('ส่งไฟล์ไม่สำเร็จ');
      return answer.name;
    }
    upload = answer.upload ?? null;
  } while (offset < file.size || file.size === 0);
  throw new Error('ส่งไฟล์ไม่สำเร็จ');
}
