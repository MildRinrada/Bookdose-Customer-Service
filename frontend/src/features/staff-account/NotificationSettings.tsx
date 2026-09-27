'use client';

import { useState, useSyncExternalStore } from 'react';
import { Icon } from '@/components/Icon';
import { useRunAction } from '@/components/ui/actions';
import { PageLoading } from '@/components/ui/display';
import { Form } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { useInvalidate } from '@/lib/query';
import { allowDesktop, desktopPermission, playAlertSound, playSound, showDesktop } from './alerts';
import { showCelebration } from './celebrate';
import { PREFS_PATH, savePreferences, sendTestEmail, usePreferences, type NotifyEvent, type PreferencesView } from './prefs';

/* ตั้งค่าบัญชี → การแจ้งเตือน: how the member hears about their own work - a desktop notification and a sound from
   the open page (useWorkAlerts in the staff frame), and email sent by the server - and which events count: a case
   assigned to them, a customer answering on their case, their case close to or past its SLA. The bell in the top
   bar always lists everything. */

const neverChanges = () => () => {};

export function NotificationSettings() {
  const view = usePreferences();
  if (!view.data) return <PageLoading />;
  return (
    <div className="account-section">
      <NotifyCard key={JSON.stringify(view.data.preferences.notify)} view={view.data} />
    </div>
  );
}

function NotifyCard({ view }: { view: PreferencesView }) {
  const toast = useToast();
  const run = useRunAction();
  const refresh = useInvalidate();
  const notify = view.preferences.notify;
  // Only the browser knows whether it may show notifications; the server renders the page without that line.
  const initial = useSyncExternalStore(neverChanges, desktopPermission, () => 'default' as const);
  const [permission, setPermission] = useState<string | null>(null);
  const allowed = permission ?? initial;

  return (
    <section className="card">
      <div className="card-header">
        <div>
          <h2>การแจ้งเตือนงานของฉัน</h2>
          <p>เลือกช่องทางและเหตุการณ์ที่ต้องการรู้ทันที กระดิ่งด้านบนยังแสดงทุกเรื่องเสมอ</p>
        </div>
      </div>
      <Form
        className="card-body notify-prefs"
        data-form="staff-notify"
        onSubmit={async (values) => {
          if (values.desktop === 'on' && !(await allowDesktop())) {
            setPermission(desktopPermission());
            throw new Error('เบราว์เซอร์ยังไม่อนุญาตให้แจ้งเตือนบนหน้าจอ กดอนุญาตที่ไอคอนแม่กุญแจข้างที่อยู่เว็บ แล้วบันทึกอีกครั้ง');
          }
          setPermission(desktopPermission());
          const events = Object.fromEntries(Object.keys(view.events).map((key) => [key, values[`event:${key}`] === 'on'])) as Record<NotifyEvent, boolean>;
          await savePreferences({
            notify: {
              desktop: values.desktop === 'on',
              sound: values.sound === 'on',
              email: values.email === 'on',
              celebrate: values.celebrate === 'on',
              recap: values.recap === 'on',
              events,
            },
          });
          await refresh(PREFS_PATH);
          toast('บันทึกการแจ้งเตือนแล้ว');
        }}
      >
        <fieldset className="notify-group">
          <legend>ช่องทาง</legend>
          <label className="check">
            <input type="checkbox" className="switch" name="desktop" defaultChecked={notify.desktop} />
            <span>
              แจ้งเตือนบนหน้าจอ (เบราว์เซอร์)
              <span className="tiny muted block">
                {allowed === 'unsupported'
                  ? 'เบราว์เซอร์นี้แจ้งเตือนบนหน้าจอไม่ได้'
                  : allowed === 'denied'
                    ? 'เบราว์เซอร์บล็อกการแจ้งเตือนของเว็บนี้ไว้ เปิดได้ที่ไอคอนแม่กุญแจข้างที่อยู่เว็บ'
                    : 'เด้งขึ้นมุมจอแม้เปิดแท็บอื่นอยู่ ขณะที่ยังเปิดระบบค้างไว้'}
              </span>
            </span>
          </label>
          <label className="check">
            <input type="checkbox" className="switch" name="sound" defaultChecked={notify.sound} />
            <span>
              เสียงเตือน
              <span className="tiny muted block">เสียงสั้น ๆ เมื่อมีเรื่องใหม่ เสียงเร่งขึ้นเมื่อเคสด่วน ยกระดับ หรือเกิน SLA และเสียงเมื่อรับเคส ขณะเปิดระบบค้างไว้</span>
            </span>
          </label>
          <label className="check">
            <input type="checkbox" className="switch" name="celebrate" defaultChecked={notify.celebrate} />
            <span>
              ฉลองเมื่อปิดเคส ได้ 5 ดาว ได้คำชม หรือได้เหรียญใหม่
              <span className="tiny muted block">พลุกระดาษและการ์ดแสดงความยินดีสั้น ๆ มีเสียงด้วยเมื่อเปิดเสียงเตือนไว้</span>
            </span>
          </label>
          <label className="check">
            <input type="checkbox" className="switch" name="recap" defaultChecked={notify.recap} />
            <span>
              สรุปผลงานประจำเดือน
              <span className="tiny muted block">เด้งการ์ดสรุปผลงานของเดือนที่แล้วครั้งเดียว เมื่อเข้าระบบครั้งแรกของเดือน ดูย้อนหลังได้ที่ ผลงานของฉัน</span>
            </span>
          </label>
          <label className="check">
            <input type="checkbox" className="switch" name="email" defaultChecked={notify.email} />
            <span>
              อีเมล
              <span className="tiny muted block">
                {view.mail_ready ? 'ส่งถึงอีเมลที่ใช้เข้าสู่ระบบ แม้ไม่ได้เปิดระบบอยู่' : 'ระบบยังส่งอีเมลไม่ได้ จะเริ่มส่งเมื่อผู้ดูแลแพลตฟอร์มตั้งค่าอีเมลกลาง'}
              </span>
            </span>
          </label>
        </fieldset>
        <fieldset className="notify-group">
          <legend>เตือนเมื่อ</legend>
          {(Object.keys(view.events) as NotifyEvent[]).map((key) => (
            <label key={key} className="check">
              <input type="checkbox" className="switch" name={`event:${key}`} defaultChecked={notify.events[key]} />
              {view.events[key]}
            </label>
          ))}
        </fieldset>
        <button className="btn primary" type="submit">
          <Icon name="check" />
          บันทึกการแจ้งเตือน
        </button>
      </Form>
      <div className="card-body notify-tests">
        <h3>ทดสอบ</h3>
        <div className="security-actions">
          <button
            className="btn"
            type="button"
            onClick={() => {
              const played = playAlertSound();
              toast(played ? 'เล่นเสียงแจ้งเตือนแล้ว' : 'เบราว์เซอร์นี้เล่นเสียงไม่ได้', !played);
            }}
          >
            <Icon name="bell" />
            ทดสอบเสียงแจ้งเตือน
          </button>
          <button
            className="btn"
            type="button"
            onClick={() => {
              const played = playSound('urgent');
              toast(played ? 'เล่นเสียงเคสด่วนแล้ว' : 'เบราว์เซอร์นี้เล่นเสียงไม่ได้', !played);
            }}
          >
            <Icon name="bolt" />
            ทดสอบเสียงเคสด่วน
          </button>
          <button
            className="btn"
            type="button"
            onClick={() => {
              showCelebration({ kind: 'resolved', title: 'ลองฉลอง: ปิดเคสสำเร็จ', detail: 'หน้าตาแบบนี้เมื่อคุณปิดเคส' });
            }}
          >
            <Icon name="sparkle" />
            ลองดูการฉลอง
          </button>
          <button
            className="btn"
            type="button"
            onClick={() =>
              void run(async () => {
                if (!(await allowDesktop())) {
                  setPermission(desktopPermission());
                  throw new Error('เบราว์เซอร์ไม่อนุญาตให้แจ้งเตือนบนหน้าจอ กดอนุญาตที่ไอคอนแม่กุญแจข้างที่อยู่เว็บก่อน');
                }
                setPermission('granted');
                // A fresh tag every time: one fixed tag replaces the notice already in the system's notification
                // centre, and a replacement never pops up again - so the second press onwards looked like nothing.
                const shown = showDesktop(
                  'ทดสอบการแจ้งเตือน',
                  'การแจ้งเตือนบนหน้าจอใช้งานได้แล้ว',
                  '/account?tab=notifications',
                  `bookdose-test-${Date.now()}`,
                );
                // Saying "sent" when the browser refused it is what made this hard to see: it is said only when it worked.
                if (!shown) throw new Error('เบราว์เซอร์สร้างการแจ้งเตือนไม่สำเร็จ ลองปิดโหมดห้ามรบกวนของเครื่อง แล้วลองใหม่');
                toast('ส่งการแจ้งเตือนทดสอบแล้ว · ถ้าไม่เห็นที่มุมจอ ให้ดูที่ศูนย์การแจ้งเตือนของเครื่อง และตรวจว่าโหมดห้ามรบกวนปิดอยู่');
              })
            }
          >
            <Icon name="sidebar" />
            ทดสอบแจ้งเตือนบนหน้าจอ
          </button>
          <button
            className="btn"
            type="button"
            disabled={!view.mail_ready}
            onClick={() =>
              void run(async () => {
                const sent = await sendTestEmail();
                toast(`ส่งอีเมลทดสอบถึง ${sent.email} แล้ว`);
              })
            }
          >
            <Icon name="send" />
            ส่งอีเมลทดสอบ
          </button>
        </div>
      </div>
    </section>
  );
}
