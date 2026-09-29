'use client';

import { useEffect, useState } from 'react';
import { Icon } from '@/components/Icon';
import { useRunAction } from '@/components/ui/actions';
import { useDialogs } from '@/components/ui/Dialogs';
import { Form } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { date } from '@/lib/format';
import { useApi, useInvalidate } from '@/lib/query';
import { ACCOUNT_PATH, NOTIFY_SETTINGS_PATH, linePath, requestLineCode, saveNotifySettings, unlinkLine } from '../api';
import type { LineCode, LineOrg, LineStatus, NotificationSettings, PageAlerts, QuietHours } from '../types';

/* ตั้งค่าบัญชี → การแจ้งเตือน: which events go to email and to LINE (the bell on the page always shows everything),
   the hours when neither may reach the customer (ช่วงเวลาห้ามรบกวน), the page's own pop-up and sound while it is open,
   and linking the account with each organization's LINE by a 6-digit code sent there in a 1:1 chat
   (GET/POST /api/customer/notification-settings, /api/public/<org>/line). Markup: pages/alerts-customer.css. */

/** Seconds until `until` (0 once passed), ticking every second while there is something to count. */
function useSecondsLeft(until: string | undefined) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!until) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [until]);
  return until ? Math.max(0, Math.round((Date.parse(until) - now) / 1000)) : 0;
}

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

function LineLink({ org }: { org: LineOrg }) {
  const [code, setCode] = useState<(LineCode & { asked_at: number }) | null>(null);
  const [gone, setGone] = useState(false);
  const [busy, setBusy] = useState(false);
  const left = useSecondsLeft(code?.expires_at);
  const run = useRunAction();
  const refresh = useInvalidate();
  const toast = useToast();
  const { confirm } = useDialogs();
  // While a code is shown, ask every 5 seconds whether it arrived (the organization's LINE links the account).
  const status = useApi<LineStatus>(code && left > 0 ? linePath(org.org_slug) : null, { refetchInterval: 5000 });
  const linkedNow = Boolean(code && status.data?.linked);
  // The code stopped working before its time (too many wrong codes reached the organization's LINE, or it came from a
  // LINE that tried too many): an answer fetched after asking no longer lists it. Adjusted while rendering, not in an effect.
  const dead = Boolean(
    code && !linkedNow && status.data && status.dataUpdatedAt > code.asked_at && status.data.code_expires_at !== code.expires_at,
  );
  if (dead) {
    setCode(null);
    setGone(true);
  }

  useEffect(() => {
    if (!linkedNow) return;
    toast(`เชื่อม LINE กับ ${org.org_name} แล้ว`);
    void refresh(NOTIFY_SETTINGS_PATH).then(() => setCode(null));
  }, [linkedNow, org.org_name, refresh, toast]);

  const ask = () =>
    run(async () => {
      setBusy(true);
      try {
        const asked_at = Date.now();
        setCode({ ...(await requestLineCode(org.org_slug)), asked_at });
        setGone(false);
      } finally {
        setBusy(false);
      }
    });

  const copy = () =>
    run(async () => {
      if (!code) return;
      await navigator.clipboard.writeText(code.code);
      toast('คัดลอกรหัสแล้ว');
    });

  const name = org.oa_name || 'LINE Official Account';
  return (
    <li className="line-org" data-org={org.org_slug}>
      <div className="line-org-head">
        <span className="line-org-name">
          <strong>{org.org_name}</strong>
          <span className="muted">{name}</span>
        </span>
        {org.linked ? (
          <span className="badge resolved">
            <Icon name="check" />
            เชื่อมแล้ว
          </span>
        ) : (
          <span className="badge closed">ยังไม่เชื่อม</span>
        )}
      </div>
      {org.linked ? (
        <div className="line-org-body">
          <p className="tiny muted">
            {org.available ? `การแจ้งเตือนที่เลือกไว้ในช่อง LINE จะส่งถึงแชทกับ ${name}` : `${org.org_name} ปิดการส่งข้อความทาง LINE ชั่วคราว`}
            {org.linked_at ? ` · เชื่อมเมื่อ ${date(org.linked_at, true)}` : ''}
          </p>
          <button
            className="btn"
            type="button"
            onClick={() =>
              confirm({
                title: 'ยกเลิกการเชื่อม LINE',
                message: `จะไม่ได้รับการแจ้งเตือนจาก ${org.org_name} ทาง LINE อีก (อีเมลและหน้าเว็บยังแจ้งตามเดิม) เชื่อมใหม่ได้ทุกเมื่อ`,
                confirmLabel: 'ยกเลิกการเชื่อม',
                cancelLabel: 'ไม่ยกเลิก',
                tone: 'danger',
                run: async () => {
                  await unlinkLine(org.org_slug);
                  toast('ยกเลิกการเชื่อม LINE แล้ว');
                  await refresh(NOTIFY_SETTINGS_PATH);
                },
              })
            }
          >
            ยกเลิกการเชื่อม
          </button>
        </div>
      ) : code && left > 0 ? (
        <div className="line-org-body">
          <div className="line-code-box">
            <span className="line-code" aria-label={`รหัส ${code.code.split('').join(' ')}`}>
              {code.code}
            </span>
            <button className="btn" type="button" onClick={copy}>
              คัดลอกรหัส
            </button>
            <span className="line-expiry" aria-live="polite">
              <Icon name="clock" />
              ใช้ได้อีก {clock(left)} นาที
            </span>
          </div>
          <ol className="line-steps">
            <li>เปิดแอป LINE แล้วเพิ่มเพื่อน “{name}” (ค้นหาจากชื่อ หรือจากลิงก์/QR ที่ {org.org_name} ให้ไว้)</li>
            <li>พิมพ์รหัส 6 หลักนี้ส่งในแชทส่วนตัวกับบัญชีนั้น (ส่งในกลุ่มไม่ได้)</li>
            <li>รอสักครู่ หน้านี้จะแสดงว่าเชื่อมแล้ว และ LINE จะส่งข้อความยืนยันให้คุณ</li>
          </ol>
        </div>
      ) : org.available ? (
        <div className="line-org-body">
          {(code || gone) && <p className="tiny muted">{gone ? 'รหัสใช้ไม่ได้แล้ว ขอรหัสใหม่' : 'รหัสเดิมหมดอายุแล้ว ขอรหัสใหม่ได้'}</p>}
          <button className="btn primary" type="button" disabled={busy} onClick={ask}>
            <Icon name="chat" />
            {code || gone ? 'ขอรหัสใหม่' : 'เชื่อม LINE'}
          </button>
        </div>
      ) : (
        <p className="tiny muted">{org.org_name} ปิดการส่งข้อความทาง LINE ชั่วคราว</p>
      )}
    </li>
  );
}

const QUIET: QuietHours = { enabled: false, start: '21:00', end: '08:00' };

/** ช่วงเวลาห้ามรบกวน (backend customers/notify.py): no email or LINE between two times; what falls due meanwhile goes
    out when it ends (a chat reply read on the page by then is not sent at all). Saved with the table above. */
function QuietHoursField({ quiet }: { quiet: QuietHours }) {
  const [on, setOn] = useState(quiet.enabled);
  return (
    <fieldset className="quiet-hours">
      <legend>ช่วงเวลาห้ามรบกวน</legend>
      <label className="check">
        <input type="checkbox" className="switch" name="quiet_on" defaultChecked={quiet.enabled} onChange={(e) => setOn(e.target.checked)} />
        <span>
          ไม่ส่งอีเมลและ LINE ในช่วงเวลานี้
          <span className="tiny muted block">เรื่องที่เกิดระหว่างนั้นจะส่งให้เมื่อพ้นช่วง ถ้าเปิดอ่านบนหน้าเว็บไปก่อนแล้ว จะไม่ส่งซ้ำ</span>
        </span>
      </label>
      <div className="quiet-times" hidden={!on}>
        <label>
          ตั้งแต่
          <input type="time" name="quiet_start" defaultValue={quiet.start} step={60} required={on} />
        </label>
        <label>
          ถึง
          <input type="time" name="quiet_end" defaultValue={quiet.end} step={60} required={on} />
        </label>
        <span className="tiny muted">เวลาประเทศไทย ข้ามเที่ยงคืนได้ เช่น 21:00 ถึง 08:00</span>
      </div>
    </fieldset>
  );
}

const PAGE: PageAlerts = { popup: true, sound: true };

/** While the page is open (features/customer/useReplyPopups): a pop-up at the bottom right when the team answers, and
    a short sound with it. Saved with the table above. */
function PageAlertsField({ page }: { page: PageAlerts }) {
  return (
    <fieldset className="quiet-hours">
      <legend>ขณะเปิดหน้าเว็บนี้อยู่</legend>
      <label className="check">
        <input type="checkbox" className="switch" name="page_popup" defaultChecked={page.popup} />
        <span>
          ป๊อปอัปมุมขวาล่างเมื่อทีมงานตอบ
          <span className="tiny muted block">กดที่ป๊อปอัปเพื่อเปิดแชทนั้น ไม่ขึ้นเมื่อเปิดแชทนั้นอยู่แล้ว</span>
        </span>
      </label>
      <label className="check">
        <input type="checkbox" className="switch" name="page_sound" defaultChecked={page.sound} />
        <span>
          เสียงเตือนสั้น ๆ พร้อมป๊อปอัป
        </span>
      </label>
    </fieldset>
  );
}

export function NotifySettingsCard() {
  const { data } = useApi<NotificationSettings>(NOTIFY_SETTINGS_PATH);
  const refresh = useInvalidate();
  const toast = useToast();
  const emailOk = Boolean(data?.email.ready && data.email.verified);
  const lineOk = Boolean(data?.line.some((l) => l.linked));
  return (
    <section className="card notify-card">
      <div className="card-header">
        <div>
          <h2>การแจ้งเตือน</h2>
          <p>การแจ้งเตือนในหน้าเว็บ (กระดิ่ง) แสดงเสมอ เลือกได้ว่าเรื่องใดจะส่งทางอีเมลหรือ LINE ด้วย</p>
        </div>
      </div>
      {!data ? (
        <div className="card-body">
          <p className="muted">กำลังโหลดการตั้งค่า…</p>
        </div>
      ) : (
        <>
          <Form
            key={JSON.stringify([data.events, data.quiet, data.page])}
            className="card-body"
            data-form="customer-notify"
            onSubmit={async (values, form) => {
              const checked = (name: string) => Boolean((form.elements.namedItem(name) as HTMLInputElement | null)?.checked);
              const events = Object.fromEntries(data.events.map((e) => [e.key, { email: checked(`${e.key}:email`), line: checked(`${e.key}:line`) }]));
              const quiet = { enabled: checked('quiet_on'), start: values.quiet_start || QUIET.start, end: values.quiet_end || QUIET.end };
              if (quiet.enabled && quiet.start === quiet.end) throw new Error('เวลาเริ่มและเวลาสิ้นสุดของช่วงห้ามรบกวนต้องไม่ใช่เวลาเดียวกัน');
              await saveNotifySettings(events, quiet, { popup: checked('page_popup'), sound: checked('page_sound') });
              toast('บันทึกการแจ้งเตือนแล้ว');
              await refresh(NOTIFY_SETTINGS_PATH, ACCOUNT_PATH);
            }}
          >
            <div className="table-scroll">
              <table className="notify-table">
                <thead>
                  <tr>
                    <th scope="col">เรื่องที่แจ้ง</th>
                    <th scope="col" className="notify-check">
                      อีเมล
                    </th>
                    <th scope="col" className="notify-check">
                      LINE
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.events.map((e) => (
                    <tr key={e.key}>
                      <th scope="row">{e.label}</th>
                      <td className="notify-check">
                        <input type="checkbox" className="switch" name={`${e.key}:email`} defaultChecked={e.email} aria-label={`${e.label} ทางอีเมล`} />
                      </td>
                      <td className="notify-check">
                        <input type="checkbox" className="switch" name={`${e.key}:line`} defaultChecked={e.line} aria-label={`${e.label} ทาง LINE`} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!emailOk && (
              <p className="tiny muted">
                {data.email.ready ? 'ต้องยืนยันอีเมลก่อนจึงจะได้รับอีเมลแจ้งเตือน' : 'ระบบยังส่งอีเมลไม่ได้ ตัวเลือกอีเมลจะใช้เมื่อพร้อมส่ง'}
              </p>
            )}
            {!lineOk && <p className="tiny muted">ตัวเลือก LINE ใช้เมื่อเชื่อม LINE ขององค์กรด้านล่างแล้ว</p>}
            <p className="tiny muted">อีเมลและ LINE มีแค่หัวเรื่องและลิงก์ให้เข้ามาดู ไม่มีเนื้อหาข้อความแชท</p>
            <QuietHoursField quiet={data.quiet ?? QUIET} />
            <PageAlertsField page={data.page ?? PAGE} />
            <button className="btn" type="submit">
              <Icon name="check" />
              บันทึกการแจ้งเตือน
            </button>
          </Form>
          <div className="card-body line-links">
            <h3>เชื่อม LINE</h3>
            {data.line.length ? (
              <ul className="line-org-list">
                {data.line.map((org) => (
                  <LineLink key={org.org_slug} org={org} />
                ))}
              </ul>
            ) : (
              <p className="tiny muted">องค์กรที่คุณติดต่อยังไม่ได้เปิดการแจ้งเตือนทาง LINE</p>
            )}
          </div>
        </>
      )}
    </section>
  );
}
