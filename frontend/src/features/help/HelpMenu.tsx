'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { Icon } from '@/components/Icon';
import { useOpenOnThisPage } from '@/components/shell/chrome';
import { useDialogs } from '@/components/ui/Dialogs';
import { Form } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { reportProblem } from './api';

/* The ? in the top bar: the three things a member reaches for when the screen does not do what they expected -
   the keys that save time, the guides the Bookdose team writes, and a way to say that something is broken.

   A report goes to the platform, not to the organization's own admins: what is reported here is the product, and
   only the team that builds it can fix it. It is read in the platform console (ผู้ดูแลแพลตฟอร์ม → รายงานปัญหา).
   Markup: styles/layout.css (help-menu). */

const MAX = 4000;

/** ⌘ on a Mac, Ctrl everywhere else; the top bar's search hint is written the same way. */
const MOD = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';

const SHORTCUTS: { keys: string; what: string; where: string }[] = [
  { keys: `${MOD} K`, what: 'ไปที่ช่องค้นหาเคส', where: 'ทุกหน้า' },
  { keys: '/', what: 'แทรกคำตอบสำเร็จรูป พิมพ์ต่อเพื่อค้นหา', where: 'ช่องพิมพ์ตอบ' },
  { keys: '↑ ↓', what: 'เลือกคำตอบในเมนูที่ขึ้นมา', where: 'ช่องพิมพ์ตอบ' },
  { keys: 'Enter หรือ Tab', what: 'แทรกคำตอบที่เลือกไว้', where: 'ช่องพิมพ์ตอบ' },
  { keys: 'Alt 1 … Alt 9', what: 'แทรกคำตอบด่วนของฉันอันที่ 1 ถึง 9', where: 'ช่องพิมพ์ตอบ' },
  { keys: 'Esc', what: 'ปิดเมนู กล่องข้อความ หรือหน้าต่างที่เปิดอยู่', where: 'ทุกหน้า' },
];

export function HelpMenu() {
  const [open, setOpen] = useOpenOnThisPage();
  const { openModal } = useDialogs();
  const pathname = usePathname();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!root.current?.contains(target) || target.closest('.menu-item')) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, setOpen]);

  return (
    <div className="profile-menu help-menu" ref={root}>
      <button
        ref={button}
        type="button"
        className="icon-btn help-btn"
        aria-expanded={open}
        aria-controls="help-menu"
        aria-label="ความช่วยเหลือ"
        data-tip="ความช่วยเหลือ"
        title="ความช่วยเหลือ"
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="help" />
      </button>
      <div className="profile-menu-panel" id="help-menu" hidden={!open}>
        <button type="button" className="menu-item" onClick={() => openModal('คีย์ลัดทั้งหมด', <ShortcutList />)}>
          <Icon name="bolt" />
          คีย์ลัดทั้งหมด
        </button>
        <Link className="menu-item" href="/guides">
          <Icon name="book" />
          คู่มือจาก Bookdose
        </Link>
        <button type="button" className="menu-item" onClick={() => openModal('รายงานปัญหา', <ReportForm page={pathname} />)}>
          <Icon name="bell" />
          รายงานปัญหา
        </button>
      </div>
    </div>
  );
}

function ShortcutList() {
  return (
    <>
      <p className="notice">ใช้ได้ทันทีโดยไม่ต้องเปิดอะไรก่อน คีย์ลัดของช่องพิมพ์ตอบใช้ได้ในกล่องข้อความและในเคส</p>
      <dl className="shortcut-list">
        {SHORTCUTS.map((s) => (
          <div className="shortcut-row" key={s.keys}>
            <dt>
              <span className="kbd">{s.keys}</span>
            </dt>
            <dd>
              {s.what}
              <span className="tiny muted block">{s.where}</span>
            </dd>
          </div>
        ))}
      </dl>
      <p className="tiny muted">คำตอบด่วนของฉันและคีย์ลัดของแต่ละอันตั้งได้ที่ ตั้งค่าบัญชี → คำตอบด่วนและคีย์ลัด</p>
    </>
  );
}

function ReportForm({ page }: { page: string }) {
  const { closeModal } = useDialogs();
  const toast = useToast();
  return (
    <Form
      data-form="problem-report"
      onSubmit={async (values) => {
        await reportProblem(String(values.message ?? ''), page);
        closeModal(true);
        toast('ส่งรายงานให้ผู้ดูแลแพลตฟอร์มแล้ว ขอบคุณครับ');
      }}
    >
      <p className="notice">
        เรื่องนี้ส่งตรงถึง<strong>ทีมที่ทำระบบ</strong> ไม่ผ่านผู้ดูแลองค์กรของคุณ เจออะไรก็บอกได้เลย
      </p>
      <div className="field">
        <label htmlFor="report-message">เกิดอะไรขึ้น</label>
        <textarea
          id="report-message"
          name="message"
          rows={6}
          maxLength={MAX}
          required
          autoFocus
          placeholder="เช่น กดปุ่มมอบหมายในหน้าเคสแล้วไม่มีอะไรเกิดขึ้น ทำซ้ำได้ทุกครั้ง"
        />
        <span className="tiny muted">แนบชื่อ อีเมล และหน้าที่คุณเปิดอยู่ไปด้วย จะได้ติดต่อกลับถูกคน ข้อความที่คุยกับลูกค้าไม่ถูกส่งไป</span>
      </div>
      <div className="form-actions">
        <button type="button" className="btn" onClick={() => closeModal()}>
          ยกเลิก
        </button>
        <button type="submit" className="btn primary">
          <Icon name="send" />
          ส่งรายงาน
        </button>
      </div>
    </Form>
  );
}
