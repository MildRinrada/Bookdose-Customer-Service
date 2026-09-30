'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Icon } from '@/components/Icon';
import { useRunAction } from '@/components/ui/actions';
import { useDialogs } from '@/components/ui/Dialogs';
import { FormActions, TextField } from '@/components/ui/fields';
import { Form } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { date, number, relative } from '@/lib/format';
import { useInvalidate } from '@/lib/query';
import {
  backupFileUrl,
  clearAnnouncement,
  HEALTH_PATH,
  markKeySaved,
  PLATFORM_PREFIX,
  retryChannels,
  runBackup,
  saveAnnouncement,
  saveBackupSettings,
  saveOffsite,
  sendOffsiteNow,
  setTenantQuota,
  testOffsite,
} from '../api';
import { bytesText } from '../labels';
import type { Announcement, BackupFile, BackupsView, OffsiteSettings, OffsiteView, OrgChannels, OrgUsage, SecuritySummary, TodoItem } from '../types';
import { RestoreDialog, uploadBackupFile } from './RestoreDialog';

/* The cards of ภาพรวมระบบ that look across the whole platform (backend platform/health.py and backups.py): what needs
   doing, the backups, every organization's channels, how busy each organization is, security at a glance, and the
   announcement to every organization. Markup: pages/platform.css (.todo-*, .health-*). */

const levelLabels: Record<TodoItem['level'], string> = { critical: 'ด่วน', warning: 'ควรทำ', info: 'แนะนำ' };

/* ต้องจัดการ: one list of what is missing or broken, most urgent first, each with the way to fix it. Only the first
   few show until asked, so the numbers below stay in view. */
const TODO_SHOWN = 3;

export function TodoCard({ items }: { items: TodoItem[] }) {
  const toast = useToast();
  const run = useRunAction();
  const refresh = useInvalidate();
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, TODO_SHOWN);
  if (!items.length)
    return (
      <section className="card todo-card todo-clear" id="todo">
        <div className="card-body">
          <Icon name="checkCircle" />
          <span>
            <strong>ไม่มีเรื่องที่ต้องจัดการ</strong>
            <span className="muted"> · ทุกองค์กรมีผู้ดูแล อีเมลของระบบ สำรองข้อมูล และช่องทางทำงานปกติ</span>
          </span>
        </div>
      </section>
    );
  return (
    <section className="card todo-card" id="todo" aria-labelledby="todo-title">
      <div className="card-header">
        <div>
          <h2 id="todo-title">ต้องจัดการ</h2>
          <p>สิ่งที่ยังขาดหรือมีปัญหา เรียงจากเรื่องด่วนที่สุด กดปุ่มในแต่ละรายการเพื่อไปแก้ได้ทันที</p>
        </div>
        <span className="tag-count">{items.length}</span>
      </div>
      <ul className="todo-list">
        {shown.map((item) => (
          <li key={item.key} className={`todo-item level-${item.level}`}>
            <span className="todo-level">{levelLabels[item.level]}</span>
            <span className="grow">
              <strong>{item.title}</strong>
              <span className="muted">{item.detail}</span>
            </span>
            {item.action.do === 'key-saved' ? (
              <button
                type="button"
                className="btn sm"
                onClick={() =>
                  void run(async () => {
                    await markKeySaved();
                    toast('บันทึกแล้ว ระบบจะเตือนอีกครั้งเมื่อกุญแจเปลี่ยน');
                    await refresh(HEALTH_PATH);
                  })
                }
              >
                <Icon name="check" />
                {item.action.label}
              </button>
            ) : (
              <Link className={`btn sm${item.level === 'critical' ? ' primary' : ''}`} href={item.action.href}>
                {item.action.label}
                <Icon name="arrow" />
              </Link>
            )}
          </li>
        ))}
      </ul>
      {items.length > TODO_SHOWN && (
        <div className="todo-more">
          <button type="button" className="btn sm subtle" aria-expanded={all} onClick={() => setAll(!all)}>
            {all ? 'แสดงน้อยลง' : `ดูทั้งหมด ${items.length} รายการ`}
          </button>
        </div>
      )}
    </section>
  );
}

/* Backups: the last one, a button for one now, the daily automatic backup, and the files kept. */
const kindWords: Record<BackupFile['kind'], string> = { auto: 'อัตโนมัติ', manual: 'สั่งเอง', upload: 'อัปโหลด', before: 'ก่อนกู้คืน' };

export function BackupsCard({ view }: { view: BackupsView }) {
  const toast = useToast();
  const run = useRunAction();
  const refresh = useInvalidate();
  const { openModal, closeModal } = useDialogs();
  const [sending, setSending] = useState<number | null>(null);
  const s = view.settings;
  const newest = view.files[0];
  // กู้คืนผ่านหน้าจอ: the file chosen (from the list, or sent from this computer), in the modal.
  const openRestore = (name: string) =>
    openModal('กู้คืนข้อมูลจากไฟล์สำรอง', <RestoreDialog name={name} onClose={() => closeModal()} />, { wide: true });
  return (
    <section className="card" id="backups">
      <div className="card-header">
        <div>
          <h2>สำรองข้อมูล</h2>
          <p>
            สำรองทุกองค์กรในไฟล์เดียว (Token ถูกเข้ารหัส กุญแจไม่อยู่ในไฟล์) · รหัสกุญแจ <code>{view.key_id}</code>
          </p>
        </div>
        <button
          type="button"
          className="btn primary"
          disabled={view.running}
          onClick={() =>
            void run(async () => {
              toast('กำลังสำรองข้อมูล…');
              await runBackup();
              await refresh(HEALTH_PATH, PLATFORM_PREFIX);
              toast('สำรองข้อมูลเรียบร้อยแล้ว');
            })
          }
        >
          <Icon name="restore" />
          {view.running ? 'กำลังสำรอง…' : 'สำรองตอนนี้'}
        </button>
      </div>
      <div className="card-body">
        <p className={view.last && !view.last.ok ? 'notice warning' : 'backup-last'}>
          {view.last
            ? view.last.ok
              ? `สำรองล่าสุด ${relative(view.last.at)} (${date(view.last.at, true)}) · ${bytesText(view.last.size ?? 0)} · ${view.last.kind === 'auto' ? 'อัตโนมัติ' : 'สั่งจากคอนโซล'}`
              : `สำรองครั้งล่าสุดไม่สำเร็จเมื่อ ${date(view.last.at, true)} (${view.last.error}) ตรวจพื้นที่ดิสก์และสิทธิ์เขียนโฟลเดอร์`
            : newest
              ? `ไฟล์ล่าสุด ${date(newest.created_at, true)}`
              : 'ยังไม่เคยสำรองข้อมูลจากคอนโซล'}
        </p>
        <Form
          key={JSON.stringify(s)}
          className="backup-settings"
          data-form="backup-settings"
          onSubmit={async (values) => {
            await saveBackupSettings({ enabled: values.enabled === 'on', hour: Number(values.hour), keep: Number(values.keep) });
            await refresh(HEALTH_PATH);
            toast('บันทึกการสำรองอัตโนมัติแล้ว');
          }}
        >
          <label className="check">
            <input type="checkbox" className="switch" name="enabled" defaultChecked={s.enabled} />
            สำรองอัตโนมัติทุกวัน
          </label>
          <label className="field">
            <span>เวลา (ไทย)</span>
            <select name="hour" defaultValue={s.hour}>
              {Array.from({ length: 24 }, (_, hour) => (
                <option key={hour} value={hour}>
                  {String(hour).padStart(2, '0')}:00
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>เก็บไฟล์อัตโนมัติล่าสุด</span>
            <select name="keep" defaultValue={s.keep}>
              {[3, 7, 14, 30, 60, 90].map((keep) => (
                <option key={keep} value={keep}>
                  {keep} ชุด
                </option>
              ))}
            </select>
          </label>
          <button className="btn" type="submit">
            <Icon name="check" />
            บันทึก
          </button>
        </Form>
        <p className="tiny muted">
          เก็บที่ <code>{view.folder}</code>
          {view.from_environment ? ' (BOOKDOSE_BACKUP_DIR)' : ' · เปลี่ยนได้ด้วย BOOKDOSE_BACKUP_DIR'}
          {view.same_disk && !view.offsite.settings.kind && ' · อยู่บนดิสก์เดียวกับข้อมูล ถ้าดิสก์เสียจะเสียทั้งคู่'}
          {' '}ไฟล์ที่สั่งเองไม่ถูกลบอัตโนมัติ
        </p>
        <OffsiteBlock view={view.offsite} hasFiles={view.files.length > 0} />
        <div className="restore-upload">
          <input
            id="restore-upload"
            className="sr-only"
            type="file"
            accept=".zip,application/zip"
            disabled={sending !== null}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (!file) return;
              void run(async () => {
                setSending(0);
                try {
                  const name = await uploadBackupFile(file, setSending);
                  await refresh(HEALTH_PATH, PLATFORM_PREFIX);
                  openRestore(name);
                } finally {
                  setSending(null);
                }
              });
            }}
          />
          <label htmlFor="restore-upload" className={`btn${sending !== null ? ' disabled' : ''}`}>
            <Icon name="download" />
            {sending !== null ? `กำลังส่งไฟล์ ${Math.round(sending * 100)}%` : 'กู้คืนจากไฟล์ในเครื่อง'}
          </label>
          <span className="tiny muted">หรือกด กู้คืน ที่ไฟล์ในรายการ · ระบบบอกก่อนว่าจะแทนที่อะไรบ้าง ยังไม่มีอะไรเปลี่ยนจนกว่าจะยืนยัน</span>
        </div>
        {view.files.length > 0 && (
          <div className="table-scroll">
            <table className="backup-files">
              <thead>
                <tr>
                  <th>ไฟล์</th>
                  <th>ขนาด</th>
                  <th>
                    <span className="sr-only">ดาวน์โหลดหรือกู้คืน</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {view.files.slice(0, 10).map((f) => (
                  <tr key={f.name}>
                    <td>
                      <strong>{date(f.created_at, true)}</strong>
                      <span className="muted"> · {kindWords[f.kind] ?? f.kind}</span>
                    </td>
                    <td>{bytesText(f.size)}</td>
                    <td className="backup-actions">
                      <a className="btn sm" href={backupFileUrl(f.name)} download={f.name}>
                        <Icon name="file" />
                        ดาวน์โหลด
                      </a>
                      <button type="button" className="btn sm" disabled={view.running} onClick={() => openRestore(f.name)}>
                        <Icon name="restore" />
                        กู้คืน
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

/* ส่งไฟล์สำรองออกนอกเครื่อง (backend platform/offsite.py): where every backup is copied as soon as it is made, how the
   last copy went, a test and "send the newest now". Markup: pages/platform.css (offsite-*). */
function OffsiteBlock({ view, hasFiles }: { view: OffsiteView; hasFiles: boolean }) {
  const toast = useToast();
  const run = useRunAction();
  const refresh = useInvalidate();
  const { openModal } = useDialogs();
  const s = view.settings;
  const where = s.kind === 'folder' ? `โฟลเดอร์ ${s.folder}` : s.kind === 's3' ? `${s.bucket}/${s.prefix} ที่ ${s.endpoint}` : '';
  const open = () => openModal('ส่งไฟล์สำรองออกนอกเครื่อง', <OffsiteForm view={view} />);
  return (
    <div className="offsite">
      <div className="offsite-head">
        <div>
          <strong>สำเนานอกเครื่อง</strong>
          <p className="tiny muted">
            {s.kind ? `ทุกครั้งที่สำรอง ระบบส่งสำเนาไปที่ ${where} เอง` : 'ยังไม่ได้ตั้ง · ถ้าเครื่องหรือดิสก์เสีย ไฟล์สำรองจะหายไปพร้อมกัน'}
          </p>
        </div>
        <button type="button" className="btn sm" onClick={open}>
          <Icon name="settings" />
          {s.kind ? 'แก้ปลายทาง' : 'ตั้งปลายทาง'}
        </button>
      </div>
      {s.kind && (
        <>
          {view.last ? (
            <p className={view.last.ok ? 'offsite-ok' : 'notice warning'}>
              {view.last.ok
                ? `ส่งสำเนาล่าสุด ${relative(view.last.at)} · ${view.last.name}`
                : `ส่งสำเนาไม่สำเร็จเมื่อ ${date(view.last.at, true)} (${view.last.error}) กดทดสอบเพื่อตรวจปลายทาง`}
            </p>
          ) : (
            <p className="tiny muted">ยังไม่ได้ส่งไฟล์ไปปลายทางนี้</p>
          )}
          {view.same_disk && <p className="tiny muted">โฟลเดอร์นี้อยู่ดิสก์เดียวกับข้อมูล ถ้าดิสก์เสียจะเสียทั้งคู่ ควรใช้ดิสก์อื่นหรือไดรฟ์บนเครือข่าย</p>}
          <div className="flex">
            <button
              type="button"
              className="btn sm"
              onClick={() =>
                void run(async () => {
                  await testOffsite();
                  toast('ส่งไฟล์ทดสอบไปปลายทางได้');
                })
              }
            >
              <Icon name="check" />
              ทดสอบ
            </button>
            {hasFiles ? (
              <button
                type="button"
                className="btn sm"
                disabled={view.sending}
                onClick={() =>
                  void run(async () => {
                    const answer = await sendOffsiteNow();
                    toast(`กำลังส่ง ${answer.name} · ผลขึ้นที่นี่เมื่อเสร็จ`);
                    await refresh(HEALTH_PATH);
                  })
                }
              >
                <Icon name="send" />
                {view.sending ? 'กำลังส่ง…' : 'ส่งไฟล์ล่าสุดตอนนี้'}
              </button>
            ) : (
              <span className="tiny muted">ยังไม่มีไฟล์ให้ส่ง กดสำรองตอนนี้ก่อน</span>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function OffsiteForm({ view }: { view: OffsiteView }) {
  const toast = useToast();
  const refresh = useInvalidate();
  const { closeModal } = useDialogs();
  const [kind, setKind] = useState<OffsiteSettings['kind']>(view.settings.kind);
  const s = view.settings;
  return (
    <Form
      data-form="offsite"
      onSubmit={async (values) => {
        await saveOffsite({
          kind,
          folder: values.folder ?? '',
          endpoint: values.endpoint ?? '',
          region: values.region ?? '',
          bucket: values.bucket ?? '',
          prefix: values.prefix ?? '',
          access_key: values.access_key ?? '',
          secret_key: values.secret_key ?? '',
        });
        closeModal();
        toast(kind ? 'บันทึกปลายทางแล้ว · กดทดสอบเพื่อตรวจว่าส่งได้' : 'ปิดการส่งไฟล์ออกนอกเครื่องแล้ว');
        await refresh(HEALTH_PATH);
      }}
    >
      <div className="field">
        <label htmlFor="offsite-kind">ปลายทาง</label>
        <select id="offsite-kind" value={kind} onChange={(e) => setKind(e.target.value as OffsiteSettings['kind'])}>
          <option value="">ไม่ส่ง</option>
          <option value="folder">โฟลเดอร์บนดิสก์อื่นหรือไดรฟ์บนเครือข่าย</option>
          <option value="s3">พื้นที่เก็บไฟล์แบบ S3 (Amazon S3, Cloudflare R2, Backblaze B2, Wasabi)</option>
        </select>
      </div>
      {kind === 'folder' && (
        <>
          <p className="notice">ใช้ดิสก์อีกลูก ไดรฟ์ที่แชร์บนเครือข่าย หรือไดรฟ์คลาวด์ที่เชื่อมไว้กับเครื่องเซิร์ฟเวอร์ โฟลเดอร์ต้องมีอยู่แล้วและระบบเขียนได้</p>
          <TextField label="ตำแหน่งโฟลเดอร์บนเซิร์ฟเวอร์ (แบบเต็ม)" name="folder" defaultValue={s.folder} max={500} />
        </>
      )}
      {kind === 's3' && (
        <>
          <p className="notice">สร้าง Bucket และกุญแจที่เขียนและลบไฟล์ใน Bucket นั้นได้เท่านั้น ไฟล์ที่ส่งไปมี Token ที่เข้ารหัสแล้ว แต่ไม่มีกุญแจเปิด</p>
          <TextField label="Endpoint (ขึ้นต้นด้วย https://)" name="endpoint" defaultValue={s.endpoint} max={300} />
          <div className="form-grid">
            <TextField label="Bucket" name="bucket" defaultValue={s.bucket} max={63} />
            <TextField label="Region (R2 ใช้ auto)" name="region" defaultValue={s.region || 'auto'} max={40} required={false} />
            <TextField label="โฟลเดอร์ใน Bucket" name="prefix" defaultValue={s.prefix} max={100} required={false} />
            <TextField label="Access key" name="access_key" defaultValue={s.access_key} max={200} />
          </div>
          <TextField
            label={view.secret_saved ? 'Secret key (เว้นว่างเพื่อใช้ค่าที่บันทึกไว้)' : 'Secret key'}
            name="secret_key"
            type="password"
            max={200}
            required={!view.secret_saved}
            minLength={1}
            autoComplete="new-password"
          />
        </>
      )}
      <FormActions label="บันทึก" onCancel={() => closeModal()} />
    </Form>
  );
}

const statusWords: Record<OrgChannels['status'], string> = { ok: 'ปกติ', warning: 'ต้องดู', error: 'มีปัญหา' };

/* Channels of every organization: what is failing and why, and sending the failed replies of one organization again. */
export function ChannelsCard({ orgs }: { orgs: OrgChannels[] }) {
  const { confirm } = useDialogs();
  const toast = useToast();
  const refresh = useInvalidate();
  const failing = orgs.filter((o) => o.status !== 'ok').length;
  return (
    <section className="card" id="channels">
      <div className="card-header">
        <div>
          <h2>สถานะช่องทางของทุกองค์กร</h2>
          <p>{orgs.length ? `LINE อีเมล และ Facebook ที่เปิดใช้ ${orgs.length} องค์กร · มีปัญหา ${failing} องค์กร` : 'ยังไม่มีองค์กรใดเปิดใช้ LINE อีเมล หรือ Facebook'}</p>
        </div>
        <Icon name="inbox" />
      </div>
      {orgs.length > 0 && (
        <div className="table-scroll">
          <table className="health-table">
            <thead>
              <tr>
                <th>องค์กร</th>
                <th>ช่องทาง</th>
                <th>
                  <span className="sr-only">ส่งซ้ำ</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {orgs.map((org) => {
                const failed = org.channels.reduce((total, c) => total + c.failed, 0);
                return (
                  <tr key={org.id} className={`health-${org.status}`}>
                    <td>
                      <strong>{org.name}</strong>
                      <span className={`health-pill health-${org.status}`}>{statusWords[org.status]}</span>
                    </td>
                    <td>
                      <ul className="health-channels">
                        {org.channels.map((c) => (
                          <li key={c.kind} className={`health-${c.status}`}>
                            <strong>{c.name}</strong>
                            <span className="muted">
                              {!c.enabled ? 'ปิดอยู่' : c.error || (c.status === 'ok' ? 'ทำงานปกติ' : '')}
                              {c.failed ? ` · ส่งไม่สำเร็จ ${number(c.failed)}` : ''}
                              {c.unknown ? ` · ไม่แน่ใจผล ${number(c.unknown)}` : ''}
                              {c.waiting ? ` · รอส่ง ${number(c.waiting)}${c.stuck ? ` (ค้างตั้งแต่ ${relative(c.oldest_waiting!)})` : ''}` : ''}
                              {c.last_failure ? ` · สาเหตุล่าสุด: ${c.last_failure}` : ''}
                              {c.last_received ? ` · รับล่าสุด ${relative(c.last_received)}` : ''}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </td>
                    <td>
                      {failed > 0 && (
                        <button
                          type="button"
                          className="btn sm"
                          onClick={() =>
                            confirm({
                              title: `ส่งข้อความของ ${org.name} ซ้ำ`,
                              message: `ส่งข้อความที่ส่งไม่สำเร็จ ${failed} รายการอีกครั้งในนามผู้เขียนเดิม ข้อความที่ไม่แน่ใจผลจะไม่ถูกส่งซ้ำ เพื่อไม่ให้ลูกค้าได้รับซ้ำ`,
                              confirmLabel: 'ส่งซ้ำ',
                              run: async () => {
                                const result = await retryChannels(org.id);
                                toast(
                                  `ส่งซ้ำ ${result.retried} รายการ${result.skipped ? ` · ส่งซ้ำไม่ได้ ${result.skipped} (${result.reasons.join(', ')})` : ''}`,
                                  result.skipped > 0 && !result.retried,
                                );
                                await refresh(HEALTH_PATH, PLATFORM_PREFIX);
                              },
                            })
                          }
                        >
                          <Icon name="restore" />
                          ส่งซ้ำ
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/* How busy each organization is, and how much of the shared disk it takes.

   The disk is one disk: an organization filling it stops every organization from writing, and the platform-wide
   "less than 10% left" warning comes far too late to do anything about it. Each organization therefore has a
   ceiling of its own, changed right here - an organization that asks for more room gets it the moment the number
   is saved, and only its uploads were ever refused meanwhile. */
export function UsageCard({ orgs }: { orgs: OrgUsage[] }) {
  // No activity for a week reads as quiet (the moment the card was opened is close enough).
  const [weekAgo] = useState(() => new Date(Date.now() - 7 * 864e5).toISOString());
  const noCeiling = orgs.filter((o) => !o.quota_mb && o.status === 'active').length;
  return (
    <section className="card" id="usage">
      <div className="card-header">
        <div>
          <h2>การใช้งานของแต่ละองค์กร</h2>
          <p>เรียงจากองค์กรที่มีข้อความมากที่สุดใน 7 วัน · กดที่พื้นที่เพื่อตั้งหรือเพิ่มโควตาให้องค์กรนั้น</p>
        </div>
        <Icon name="chart" />
      </div>
      {noCeiling > 0 && (
        <div className="card-body">
          <p className="notice warning">
            ยังไม่ได้กำหนดโควตา {noCeiling} องค์กร · องค์กรที่ไม่มีโควตาใช้ดิสก์ได้ไม่จำกัด และทำให้ทุกองค์กรเขียนข้อมูลไม่ได้เมื่อดิสก์เต็ม
          </p>
        </div>
      )}
      <div className="table-scroll">
        <table className="health-table usage-table">
          <thead>
            <tr>
              <th>องค์กร</th>
              <th>เคสที่เปิดอยู่</th>
              <th>ข้อความ 7 วัน</th>
              <th>พื้นที่ที่ใช้ / โควตา</th>
              <th>สมาชิก</th>
              <th>ใช้งานล่าสุด</th>
            </tr>
          </thead>
          <tbody>
            {orgs.map((o) => (
              <tr key={o.id} className={o.status === 'active' ? '' : 'org-suspended'}>
                <td>
                  <strong>{o.name}</strong>
                  {o.status !== 'active' && <span className="muted"> · ระงับ</span>}
                </td>
                <td>{number(o.open_cases)}</td>
                <td>{number(o.messages_7d)}</td>
                <td>
                  <QuotaCell org={o} />
                </td>
                <td>{number(o.members)}</td>
                <td className={o.last_active && o.last_active > weekAgo ? '' : 'usage-quiet'}>
                  {o.last_active ? relative(o.last_active) : 'ยังไม่มีการใช้งาน'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* What one organization takes, against what it is allowed, as a button: the number and the way to change it are the
   same thing, so nobody has to go looking for where quotas are set. */
function QuotaCell({ org }: { org: OrgUsage }) {
  const { openModal } = useDialogs();
  const percent = Math.round(org.share * 100);
  const tone = !org.quota_mb ? 'none' : org.share >= 1 ? 'full' : org.share >= 0.8 ? 'tight' : 'fine';
  return (
    <button
      type="button"
      className={`quota-cell ${tone}`}
      title={`ไฟล์แนบ ${bytesText(org.storage_bytes)} · ฐานข้อมูล ${bytesText(org.database_bytes)} · กดเพื่อตั้งโควตา`}
      onClick={() => openModal(`โควตาพื้นที่ของ ${org.name}`, <QuotaForm org={org} />)}
    >
      <span className="quota-figures">
        {bytesText(org.used_bytes)}
        <span className="muted"> / {org.quota_mb ? `${org.quota_mb >= 1024 ? `${(org.quota_mb / 1024).toFixed(0)} GB` : `${org.quota_mb} MB`}` : 'ไม่จำกัด'}</span>
      </span>
      {/* The width is set through the CSSOM by the class alone would not do; a fixed set of steps keeps the policy
          happy (no inline style attribute) and is precise enough to read at a glance. */}
      <span className={`quota-bar step-${Math.min(10, Math.max(0, Math.round(org.share * 10)))}`} aria-hidden="true" />
      <span className="tiny muted">{org.quota_mb ? `${percent}%` : 'ยังไม่ได้กำหนด'}</span>
    </button>
  );
}

const QUOTA_STEPS = [512, 1024, 2048, 5120, 10240, 20480];

export function QuotaForm({ org }: { org: OrgUsage }) {
  const { closeModal } = useDialogs();
  const toast = useToast();
  const refresh = useInvalidate();
  return (
    <Form
      data-form="tenant-quota"
      onSubmit={async (values) => {
        const quota = Number(values.quota_mb ?? 0);
        await setTenantQuota(org.id, quota);
        closeModal();
        toast(quota ? `ตั้งโควตาของ ${org.name} เป็น ${quota} MB แล้ว` : `เอาโควตาของ ${org.name} ออกแล้ว`);
        await refresh(PLATFORM_PREFIX);
      }}
    >
      <p className="notice">
        ตอนนี้ใช้ไป <strong>{bytesText(org.used_bytes)}</strong> (ไฟล์แนบ {bytesText(org.storage_bytes)} · ฐานข้อมูล {bytesText(org.database_bytes)}) ·
        เมื่อเต็ม องค์กรนี้จะอัปโหลดไฟล์ใหม่ไม่ได้ แต่ยังตอบลูกค้าและอ่านของเดิมได้ตามปกติ
      </p>
      <div className="field">
        <label htmlFor="quota-mb">โควตา (MB)</label>
        <input id="quota-mb" name="quota_mb" type="number" min={0} max={1048576} step={256} defaultValue={org.quota_mb} required />
        <span className="tiny muted">ต่ำสุด 100 MB สูงสุด 1 TB · ใส่ 0 เพื่อไม่จำกัด (ไม่แนะนำ เพราะดิสก์เป็นก้อนเดียวกับทุกองค์กร)</span>
      </div>
      <div className="quota-presets">
        {QUOTA_STEPS.map((mb) => (
          <button
            key={mb}
            type="button"
            className="btn sm"
            onClick={(event) => {
              const input = event.currentTarget.form?.elements.namedItem('quota_mb') as HTMLInputElement | null;
              if (input) input.value = String(mb);
            }}
          >
            {mb >= 1024 ? `${mb / 1024} GB` : `${mb} MB`}
          </button>
        ))}
      </div>
      <div className="form-actions">
        <button type="button" className="btn" onClick={() => closeModal()}>
          ยกเลิก
        </button>
        <button type="submit" className="btn primary">
          <Icon name="check" />
          บันทึกโควตา
        </button>
      </div>
    </Form>
  );
}

/* Security at a glance, linking to the security console. */
export function SecurityCard({ summary }: { summary: SecuritySummary }) {
  const tiles: [string, number, boolean][] = [
    ['เข้าสู่ระบบไม่สำเร็จ 24 ชม.', summary.failed_sign_ins, summary.failed_sign_ins > 20],
    ['บัญชีที่ถูกล็อกอยู่', summary.locked_accounts, summary.locked_accounts > 0],
    ['IP ที่ถูกบล็อก', summary.blocked_ips, false],
    ['กับดักถูกแตะ 24 ชม.', summary.trap_hits, summary.trap_hits > 0],
    ['การแจ้งเตือนรอตรวจ', summary.open_alerts, summary.open_alerts > 0],
  ];
  return (
    <section className="card" id="security-summary">
      <div className="card-header">
        <div>
          <h2>ความปลอดภัยโดยสรุป</h2>
          <p>ตัวเลขจากบันทึกความปลอดภัยของทั้งแพลตฟอร์ม</p>
        </div>
        <Link className="btn sm" href="/platform/security">
          ดูทั้งหมด
          <Icon name="arrow" />
        </Link>
      </div>
      <div className="card-body">
        <dl className="security-tiles">
          {tiles.map(([label, value, alert]) => (
            <div key={label} className={alert ? 'alert' : ''}>
              <dt>{label}</dt>
              <dd>{number(value)}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

/** A local date-time field value ("2026-09-20T22:00") as ISO, or '' when empty. */
const toIso = (value: string | undefined) => (value ? new Date(value).toISOString() : '');
/** ISO as the value of a local date-time field. */
const toLocal = (iso: string | undefined) => {
  if (!iso) return '';
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

/* One message to every organization: shown at the top of every staff screen (and customers', when chosen) until it
   ends. */
export function AnnouncementCard({ current }: { current: Announcement | null }) {
  const toast = useToast();
  const run = useRunAction();
  const refresh = useInvalidate();
  const ended = Boolean(current?.ends_at && current.ends_at < new Date().toISOString());
  return (
    <section className="card" id="announcement">
      <div className="card-header">
        <div>
          <h2>ประกาศถึงทุกองค์กร</h2>
          <p>เช่น แจ้งปิดปรับปรุงระบบล่วงหน้า แสดงเป็นแถบด้านบนของทุกหน้าจนถึงเวลาสิ้นสุด</p>
        </div>
        {current && !ended && <span className={`health-pill health-${current.level === 'warning' ? 'warning' : 'ok'}`}>กำลังแสดง</span>}
      </div>
      <Form
        key={JSON.stringify(current)}
        className="card-body announcement-form"
        data-form="announcement"
        onSubmit={async (values) => {
          await saveAnnouncement({
            text: values.text ?? '',
            level: values.level === 'warning' ? 'warning' : 'info',
            audience: values.audience === 'all' ? 'all' : 'staff',
            starts_at: toIso(values.starts_at),
            ends_at: toIso(values.ends_at),
          });
          await refresh(HEALTH_PATH, '/api/bootstrap');
          toast('ประกาศแล้ว ทุกองค์กรจะเห็นในการเปิดหน้าครั้งถัดไป');
        }}
      >
        <label className="field">
          <span>ข้อความ (ไม่เกิน 300 ตัวอักษร)</span>
          <textarea name="text" rows={2} maxLength={300} required defaultValue={current?.text} placeholder="เช่น ปิดปรับปรุงระบบวันเสาร์ที่ 20 ก.ย. 22:00-23:00 น." />
        </label>
        <div className="announcement-options">
          <label className="field">
            <span>ระดับ</span>
            <select name="level" defaultValue={current?.level ?? 'info'}>
              <option value="info">แจ้งให้ทราบ</option>
              <option value="warning">สำคัญ (สีส้ม)</option>
            </select>
          </label>
          <label className="field">
            <span>ผู้เห็น</span>
            <select name="audience" defaultValue={current?.audience ?? 'staff'}>
              <option value="staff">ทีมงานทุกองค์กร</option>
              <option value="all">ทีมงานและลูกค้าที่เข้าสู่ระบบ</option>
            </select>
          </label>
          <label className="field">
            <span>เริ่มแสดง (ไม่บังคับ)</span>
            <input type="datetime-local" name="starts_at" defaultValue={toLocal(current?.starts_at)} />
          </label>
          <label className="field">
            <span>สิ้นสุด (ไม่บังคับ)</span>
            <input type="datetime-local" name="ends_at" defaultValue={toLocal(current?.ends_at)} />
          </label>
        </div>
        {ended && <p className="tiny muted">ประกาศนี้สิ้นสุดแล้ว ไม่มีใครเห็นอีก</p>}
        <div className="security-actions">
          <button className="btn primary" type="submit">
            <Icon name="send" />
            {current ? 'บันทึกประกาศ' : 'ประกาศ'}
          </button>
          {current && (
            <button
              type="button"
              className="btn danger"
              onClick={() =>
                void run(async () => {
                  await clearAnnouncement();
                  await refresh(HEALTH_PATH, '/api/bootstrap');
                  toast('ลบประกาศแล้ว');
                })
              }
            >
              <Icon name="trash" />
              ลบประกาศ
            </button>
          )}
        </div>
      </Form>
    </section>
  );
}
